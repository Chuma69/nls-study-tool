// One-time (re-runnable) backfill: push existing registered users onto the Zoho
// marketing list via the Campaigns API. Guests (synthetic @guest.nls-study.local
// addresses) are excluded. Subscribing is idempotent, so re-running is safe and
// acts as a resume — already-listed contacts come back as "already".
//
// Usage (from the app/ directory, so it resolves node_modules):
//   node scripts/zoho-backfill.mjs --dry-run          # list who would be synced
//   node scripts/zoho-backfill.mjs                     # sync everyone
//   node scripts/zoho-backfill.mjs --limit 50          # most-active 50 (warm-up ramp)
//   node scripts/zoho-backfill.mjs --limit 150 --offset 50
//   node scripts/zoho-backfill.mjs --delay 250         # ms between calls (default 200)
//
// Reads .env.local for POSTGRES_URL/DATABASE_URL and the ZOHO_* vars (same names
// the app uses). Mirrors lib/zoho-campaigns.ts — keep the endpoints in sync.

import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// ── env ────────────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

// ── args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) { return args.includes(`--${name}`); }
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const DRY_RUN = flag("dry-run");
const LIMIT = opt("limit", null);
const OFFSET = Number(opt("offset", "0"));
const DELAY_MS = Number(opt("delay", "200"));
const ONLY = opt("only", null); // sync just this one email (smoke test)

// ── config guards ────────────────────────────────────────────────────────────
const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Missing POSTGRES_URL / DATABASE_URL in .env.local"); process.exit(1); }

const ZOHO = {
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  listKey: process.env.ZOHO_LIST_KEY,
  accountsHost: process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com",
  campaignsHost: process.env.ZOHO_CAMPAIGNS_HOST || "campaigns.zoho.com",
  source: process.env.ZOHO_CONTACT_SOURCE || "Call Ready backfill",
};
const zohoReady = ZOHO.clientId && ZOHO.clientSecret && ZOHO.refreshToken && ZOHO.listKey;
if (!zohoReady && !DRY_RUN) {
  console.error("Missing ZOHO_* vars in .env.local. Set them, or use --dry-run to preview the list.");
  process.exit(1);
}

// ── Zoho client ──────────────────────────────────────────────────────────────
let token = null;
async function getAccessToken(force = false) {
  if (token && !force) return token;
  const params = new URLSearchParams({
    refresh_token: ZOHO.refreshToken,
    client_id: ZOHO.clientId,
    client_secret: ZOHO.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`https://${ZOHO.accountsHost}/oauth/v2/token?${params}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  token = data.access_token;
  return token;
}

function splitName(name) {
  const t = (name || "").trim();
  if (!t) return { first: "", last: "" };
  const i = t.indexOf(" ");
  return i === -1 ? { first: t, last: "" } : { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}

async function subscribe(email, name, retry = true) {
  const { first, last } = splitName(name);
  const contactinfo = { "Contact Email": email };
  if (first) contactinfo["First Name"] = first;
  if (last) contactinfo["Last Name"] = last;
  const body = new URLSearchParams({
    resfmt: "JSON",
    listkey: ZOHO.listKey,
    contactinfo: JSON.stringify(contactinfo),
    source: ZOHO.source,
  });
  const res = await fetch(`https://${ZOHO.campaignsHost}/api/v1.1/json/listsubscribe`, {
    method: "POST",
    headers: {
      authorization: `Zoho-oauthtoken ${await getAccessToken()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  // Refresh once on an auth error and retry.
  if ((res.status === 401 || /invalid.*token|expired/i.test(data.message || "")) && retry) {
    await getAccessToken(true);
    return subscribe(email, name, false);
  }
  if (res.ok && (data.code === "0" || data.status === "success")) {
    const msg = data.message || "";
    // Double opt-in lists add the contact as PENDING and email a confirmation
    // link — a very different outcome from an active subscribe. Surface it.
    if (/confirmation email/i.test(msg)) return "pending";
    return /already/i.test(msg) ? "already" : "subscribed";
  }
  throw new Error(data.message || JSON.stringify(data) || `HTTP ${res.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── run ──────────────────────────────────────────────────────────────────────
const sql = neon(dbUrl);
const rows = await sql`
  SELECT username, email
  FROM users
  WHERE identity_type = 'registered'
    AND email ~ '^[^@]+@[^@]+\.[^@]+$'
    AND email NOT LIKE '%@guest.nls-study.local'
  ORDER BY last_seen_at DESC
`;
const filtered = ONLY ? rows.filter((u) => u.email.toLowerCase() === ONLY.toLowerCase()) : rows;
const slice = filtered.slice(OFFSET, LIMIT ? OFFSET + Number(LIMIT) : undefined);

console.log(`Registered users eligible: ${rows.length}`);
console.log(`This run: ${slice.length}${LIMIT ? ` (limit ${LIMIT}, offset ${OFFSET}, most-active first)` : ""}`);

if (DRY_RUN) {
  for (const u of slice) console.log(`  would sync  ${u.email}  (${u.username})`);
  console.log("\nDry run — nothing sent.");
  process.exit(0);
}

const tally = { subscribed: 0, already: 0, pending: 0, failed: 0 };
for (let i = 0; i < slice.length; i++) {
  const u = slice[i];
  try {
    const outcome = await subscribe(u.email, u.username);
    tally[outcome]++;
    console.log(`  [${i + 1}/${slice.length}] ${outcome.padEnd(10)} ${u.email}`);
  } catch (err) {
    tally.failed++;
    console.error(`  [${i + 1}/${slice.length}] FAILED     ${u.email} — ${err.message}`);
  }
  if (i < slice.length - 1) await sleep(DELAY_MS);
}

console.log(
  `\nDone. subscribed=${tally.subscribed} already=${tally.already} pending=${tally.pending} failed=${tally.failed}`,
);
if (tally.pending) {
  console.warn(
    `\n⚠️  ${tally.pending} contact(s) are PENDING — this list is double opt-in, so each was emailed a\n` +
      `   "confirm your subscription" link instead of being added active. Disable double opt-in in\n` +
      `   Zoho (Settings → Signup/Manage Opt-in) BEFORE running the full backfill, then re-run.`,
  );
}
if (tally.failed) process.exit(1);
