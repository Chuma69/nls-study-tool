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

## 4. Apply the v3 migration to Neon

Pull the connection string locally, then run the ordered migration:

The Neon/Vercel integration injects `POSTGRES_*` vars (not `DATABASE_URL`). For
local migration/load, use the **non-pooling** (direct) connection string —
copy `POSTGRES_URL_NON_POOLING` from the Neon dashboard (Quickstart → .env.local
→ Show secret), then:

```bash
# In ingestion/.env set:  DATABASE_URL=<POSTGRES_URL_NON_POOLING value>
export $(grep -E '^DATABASE_URL=' ../ingestion/.env | xargs)

# Apply migration 0001 (idempotent — safe to re-run)
psql "$DATABASE_URL" -f ../db/migrations/0001_init.sql
# …or paste db/migrations/0001_init.sql into Neon's SQL Editor and Run.
```

You should see `CREATE TABLE` / `CREATE INDEX` lines with no errors.

## 5. Load the retrieval corpus into Neon (real index-size measurement)

The chunk artifact was built locally from the read-only Codex corpus
(`nls_ingest chunks`). Load it into Neon and confirm the real on-disk size
against the free-tier limit (retrieval decision gate, PRD §2):

```bash
cd ../ingestion
source .venv/bin/activate
# reuse the same DATABASE_URL exported above (or put it in ingestion/.env)
python -m nls_ingest.main load
```

Expected tail:
```
  chunks             118518
  chunks table size  <REAL SIZE>   (real gate measurement)
  database size      <REAL SIZE> / 512 MB free tier
```
If `database size` is comfortably under 512 MB, the SQLite-free Neon FTS
decision is confirmed. If it's over, tell me — we curate further or approve a
paid tier before proceeding.

## 6. Set the remaining env vars on Vercel

```bash
vercel env add OPENAI_API_KEY production         # used from the MCQ/tutor phases
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
vercel env add SESSION_SECRET production
# PRD v3 cost/admin controls:
vercel env add LLM_DAILY_GLOBAL_LIMIT production
vercel env add LLM_DAILY_SESSION_LIMIT production
vercel env add ADMIN_EMAIL_ALLOWLIST production
```

## 7. Deploy

```bash
cd ../app && vercel --prod
```

## 8. Verify Phase 0 acceptance criteria

Open the deployed URL:

- `/` renders the placeholder home page.
- `/api/health` returns `{"ok":true,"db":"connected",...}`
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
  verify current IDs/pricing against developers.openai.com before wiring OpenAI calls
  in Phase 1/3.
