# NLS Study Tool

A hosted, passwordless PWA to help candidates prepare for the **Nigerian Law
School Bar Part II Finals**. MCQ trainer, grounded tutor chat, and a per-user
progress dashboard — all answers grounded in the builder's own ingested
materials, with citations.

See [`nls-study-tool-prd-v2.md`](../../Downloads/nls-study-tool-prd-v2.md) for the full spec.

## Repository layout

```
app/         Next.js (App Router, TS) PWA — deployed on Vercel
ingestion/   Python pipeline (local only) — builds the SQLite KB index + MCQ bank
db/          Neon Postgres schema (schema.sql)
DEPLOY.md    Exact commands to deploy + provision infrastructure (run by you)
```

## Infrastructure (PRD §2 — hard constraint)

- **App/hosting:** Next.js on Vercel Hobby (free).
- **Database:** Neon Postgres via the Vercel Marketplace (free tier). Stores
  users, questions, attempts, conversations, messages.
- **Knowledge base:** prebuilt read-only SQLite FTS5 index (bundled if < ~50 MB,
  else Vercel Blob).
- **LLM:** OpenAI API (GPT-5.6 Terra reserved for grounded tutor/explanations;
  GPT-4o mini for bulk MCQ/theory extraction).

## Build status

- [x] **Phase 0 — Setup** (this scaffold): repo, empty app, schema, `.env.example`.
- [ ] Phase 1 — Ingestion pipeline
- [ ] Phase 2 — Passwordless identity
- [ ] Phase 3 — MCQ trainer
- [ ] Phase 4 — Tutor chat
- [ ] Phase 5 — History dashboard
- [ ] Phase 6 — Polish (PWA install, mobile, export)

## Quick start (local dev)

```bash
cd app
npm install
cp ../.env.example .env.local     # paste DATABASE_URL etc.
npm run dev                       # http://localhost:3000
```

See [`DEPLOY.md`](DEPLOY.md) to provision Neon and deploy to Vercel.
