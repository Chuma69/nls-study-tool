# Deploy & provision — Phase 0

These are the account-authenticated steps for **you** to run (they use your
Vercel and Neon logins). Run them in order from the repo root. When done, the
Phase 0 acceptance criteria are met and I'll start Phase 1.

> Prereqs: Node 18+ and the Vercel CLI (`npm i -g vercel`), plus `psql`
> (`brew install libpq` then add it to PATH, or `brew install postgresql`).

## 1. Install app dependencies

```bash
cd app
npm install
```

## 2. Link the project to Vercel

From the `app/` directory (this is the Next.js root Vercel deploys):

```bash
vercel login          # if not already logged in
vercel link           # create/link a project — accept defaults, root = ./
```

## 3. Provision Neon via the Vercel Marketplace

```bash
vercel install neon
```

This adds Neon to the project and injects `DATABASE_URL` (and related vars) as
Vercel env vars. Confirm it landed:

```bash
vercel env ls
```

## 4. Apply the schema to Neon

Pull the connection string locally, then run the schema:

```bash
# Pulls Vercel env (incl. DATABASE_URL) into app/.env.local
vercel env pull .env.local

# Apply the schema (idempotent — safe to re-run)
export $(grep -E '^DATABASE_URL=' .env.local | xargs)
psql "$DATABASE_URL" -f ../db/schema.sql
```

You should see `CREATE TABLE` / `CREATE INDEX` lines with no errors.

## 5. Set the remaining env vars on Vercel

```bash
# Anthropic key (used from Phase 3/4 onward, but set it now)
vercel env add ANTHROPIC_API_KEY production

# Session signing secret — generate a random value:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
vercel env add SESSION_SECRET production
# (repeat for `preview` and `development` targets if you want them there too)
```

## 6. Deploy

```bash
vercel --prod
```

## 7. Verify Phase 0 acceptance criteria

Open the deployed URL:

- `/` renders the placeholder home page.
- `/api/health` returns `{"ok":true,"db":"connected","counts":{"users":0,"questions":0}}`
  — this proves the app reaches Neon **and** the schema is applied.

Then verify the ingestion project connects to the same Neon DB:

```bash
cd ../ingestion
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # paste the same DATABASE_URL from app/.env.local
python -m nls_ingest.main check
# → ✓ Connected to Neon and schema present.
```

---

### Notes
- **PWA icons:** `manifest.json` references `/icon-192.png` and `/icon-512.png`,
  which aren't created yet (they 404 harmlessly). Real icons + service worker
  land in Phase 6 (Polish). Deploy is unaffected.
- **Model IDs** in `ingestion/nls_ingest/config.py` are placeholders; I'll
  verify current IDs/pricing against docs.claude.com before wiring Claude calls
  in Phase 1/3.
