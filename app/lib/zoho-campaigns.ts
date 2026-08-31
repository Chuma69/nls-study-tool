// Marketing-list sync via the Zoho Campaigns REST API (no SDK dependency).
//
// Env-gated: with the Zoho vars unset, isZohoConfigured() is false and every
// call is a no-op, so signup and local/demo runs keep working with no Zoho
// account. Set these to enable it (all required unless noted):
//
//   ZOHO_CLIENT_ID       OAuth client id      (Zoho API console: Self Client)
//   ZOHO_CLIENT_SECRET   OAuth client secret
//   ZOHO_REFRESH_TOKEN   OAuth refresh token  (scope: ZohoCampaigns.contact.CREATE-UPDATE)
//   ZOHO_LIST_KEY        the mailing list's List Key
//   ZOHO_ACCOUNTS_HOST   optional, default "accounts.zoho.com"   (data-center specific)
//   ZOHO_CAMPAIGNS_HOST  optional, default "campaigns.zoho.com"  (data-center specific)
//   ZOHO_CONTACT_SOURCE  optional label recorded against each contact
//
// Data centers: pick the hosts matching where the Zoho account lives, e.g.
//   EU  -> accounts.zoho.eu     / campaigns.zoho.eu
//   IN  -> accounts.zoho.in     / campaigns.zoho.in
//   AU  -> accounts.zoho.com.au / campaigns.zoho.com.au
//
// NOTE: whether a newly subscribed contact receives a Zoho confirmation ("please
// confirm") email is governed by the LIST's opt-in setting in Zoho, not by this
// code. For syncing people who already signed up for the product, configure the
// list so it does not require re-confirmation, otherwise every synced user is
// emailed a confirmation request.

type SubscribeResult = {
  ok: boolean;
  // "subscribed" | "already" | "not_configured" | "auth_failed" | "send_failed" | "error"
  reason?: string;
  detail?: string;
};

export function isZohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN &&
      process.env.ZOHO_LIST_KEY,
  );
}

function accountsHost() {
  return process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com";
}
function campaignsHost() {
  return process.env.ZOHO_CAMPAIGNS_HOST || "campaigns.zoho.com";
}

// Access tokens live ~1 hour. Cache per warm serverless instance and refresh a
// minute before expiry; a cold instance just fetches a fresh one.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  try {
    const res = await fetch(`https://${accountsHost()}/oauth/v2/token?${params.toString()}`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !data.access_token) return null;
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

// Split a single display name into Zoho's First/Last Name fields.
function splitName(name: string): { first: string; last: string } {
  const trimmed = (name || "").trim();
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1).trim() };
}

/**
 * Add (or update) one contact on the configured Zoho mailing list.
 * Idempotent: re-subscribing an existing contact is treated as success.
 * Never throws — returns a structured result so callers can log and move on.
 */
export async function subscribeContact(input: {
  email: string;
  name?: string;
}): Promise<SubscribeResult> {
  if (!isZohoConfigured()) return { ok: false, reason: "not_configured" };

  const token = await getAccessToken();
  if (!token) return { ok: false, reason: "auth_failed" };

  const { first, last } = splitName(input.name ?? "");
  const contactinfo: Record<string, string> = { "Contact Email": input.email };
  if (first) contactinfo["First Name"] = first;
  if (last) contactinfo["Last Name"] = last;

  const body = new URLSearchParams({
    resfmt: "JSON",
    listkey: process.env.ZOHO_LIST_KEY!,
    contactinfo: JSON.stringify(contactinfo),
  });
  const source = process.env.ZOHO_CONTACT_SOURCE;
  if (source) body.set("source", source);

  try {
    const res = await fetch(`https://${campaignsHost()}/api/v1.1/json/listsubscribe`, {
      method: "POST",
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      code?: string;
      message?: string;
    };
    // Zoho returns code "0" / status "success" on subscribe. Contacts that are
    // already on the list come back with a message rather than an error; treat
    // any non-error 2xx as success so a re-run is harmless.
    if (res.ok && (data.code === "0" || data.status === "success")) {
      const already = /already/i.test(data.message ?? "");
      return { ok: true, reason: already ? "already" : "subscribed" };
    }
    return {
      ok: false,
      reason: "send_failed",
      detail: (data.message || JSON.stringify(data) || `HTTP ${res.status}`).slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
