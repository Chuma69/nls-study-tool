# Handoff — NLS Study Tool (next stage)

You are taking over implementation of the **Nigerian Law School Bar Finals Study Tool**.
Phase 0 (foundation + architecture spike) is **done and verified**. Your job is the
**MCQ + theory extraction pipeline**, then the app feature phases. Build against the
existing code; do not re-architect without cause.

Spec is **PRD v3**: `/Users/raymondchuma-onwuoku/Claude/nls-study-tool-prd-v3.md` — read it.

## Non-negotiable rules (PRD v3 §0)
1. **Grounding:** tutor answers & MCQ explanations come only from retrieved corpus material, always cited `[document, p./s. locator]`. If uncovered, reply exactly: **“This isn't covered in the loaded materials.”** Never answer from model knowledge.
2. **Past-question integrity:** preserve every question, its options, source locator, and exam year(s). Never merge/summarize/repair. Every imported answer key is `verification_status='unreviewed'` and `marked_answer_key` is never overwritten.
3. **No fabricated metadata:** if a year/key/course/jurisdiction can't be reliably identified, store `unknown` / `not identified` / empty — never guess. Years shown to users must be verbatim from source or "Exam year not identified in source".
4. **Infra discipline:** stay within Vercel + Neon (via Vercel) + Anthropic. New service/paid tier needs the owner's approval.
5. **Model IDs:** do NOT hardcode in app logic; keep in config. Verify current Claude model IDs/pricing before use. Haiku-class for bulk extraction, Sonnet-class for reasoning/tutor.

## What already exists (do not redo)
- **Repo:** `/Users/raymondchuma-onwuoku/Claude/nls-study-tool` → github.com/Chuma69/nls-study-tool (`main`).
  **Commits must NOT list any AI as co-author** (owner preference).
- **App:** `app/` — Next.js App Router + TS, PWA-ready. **Design is monochrome B&W, monospace, thin outlines** (tokens in `app/app/globals.css`); keep it. DB client `app/lib/db.ts` reads `POSTGRES_URL || DATABASE_URL`. Health route at `app/app/api/health/route.ts`. **Vercel project Root Directory = `app`.**
- **DB (Neon `neon-violet-prism`, Free tier, provisioned via Vercel):** v3 schema applied — migration `db/migrations/0001_init.sql` (tables: users, sessions, source_documents, chunks, questions, attempts, question_flags, conversations, messages). Neon injects `POSTGRES_*` env vars.
- **Retrieval backend = Neon Postgres FTS** (decided + measured). `chunks.tsv` is a generated `tsvector` with a GIN index. **Loaded & verified:** 118,518 chunks / 3,292 sources → **378 MB / 512 MB free tier (134 MB headroom)**; FTS ~312 ms. Past-question papers are deliberately EXCLUDED from `chunks` (they become structured `questions`, not tutor-grounding text).
- **Ingestion (`ingestion/`, Python, local-only, venv at `ingestion/.venv`):** CLI `python -m nls_ingest.main <cmd>`:
  - `chunks` — build provider-neutral chunk artifact from the Codex corpus + measure size
  - `migrate` — apply `db/migrations/*.sql` (no psql needed)
  - `load` — resumable batched load of the artifact into Neon
  - Key modules: `corpus.py` (reads manifest + past_questions), `locators.py` (page splitting via `\f` / `[[page N]]`), `build_chunks.py`, `load_neon.py`, `tagging.py`, `config.py`.
  - **DB creds** live in `ingestion/.env` (git-ignored): `DATABASE_URL` = Neon **non-pooled** (direct) string. Owner is in West Africa; Neon is us-east-1 (~460 ms RTT) → **all bulk DB ops must be batched, commit per batch, and be resumable via `ON CONFLICT`. A single COPY drops mid-stream — don't rely on it.**

## The read-only corpus (never modify)
`/Users/raymondchuma-onwuoku/Claude/output/` — extraction by a prior Codex run:
- `extracted/**/*.txt` — 4,507 UTF-8 docs mirroring source paths. Page markers: form-feed `\f` (embedded PDFs), `[[page N]]` (OCR); docx/pptx have none.
- `manifest.jsonl` — provenance per doc: `rel_source_path, sha256, ext, method, pages, ocr_used, duplicate_of`.
- `past_questions.jsonl` — **869 papers, SOURCE OF TRUTH for past questions + `detected_years`.** Papers are a MIX of MCQ and essay/theory.
- `failures.jsonl` (77, mostly slides; `CRL 2020.pdf` is password-protected).

## YOUR TASK — Stage: MCQ + theory extraction → structured `questions`
Owner decision: support **both** an MCQ trainer **and** a user-selectable **theory practice set**. The `questions` table has a `question_type` discriminator (`'mcq'|'theory'`).

1. Iterate `past_questions.jsonl`. For each paper, read its `extracted/<rel_source_path>.txt`.
2. Map to its `source_documents.id` via `content_sha256` (join manifest sha → source_documents).
3. **Classify MCQ vs theory** with a cheap heuristic first (lettered options `A.`/`B.`, "which of the following", high question density) — this **caps Claude spend** to true MCQ papers.
4. **MCQ papers →** extract structured items with a Claude call (grounded, low temp): `stem`, `options[{key,text}]`, `marked_answer_key` (if the paper states one; else null), `question_type='mcq'`. Set `exam_years` from `detected_years` (verbatim), `verification_status='unreviewed'`, `material_supported_key=null`, `source_locator` = page marker where present, `question_fingerprint` = stable hash of normalized stem+options+source. **Upsert idempotently by `question_fingerprint`.**
5. **Theory papers →** extract essay prompts as `question_type='theory'` rows: `stem`, `exam_years`, `model_answer` only if the paper actually contains one, no `options`/`marked_answer_key`. Same provenance + fingerprint rules.
6. **Cost controls (PRD §2):** implement a **`--dry-run` that estimates token cost + item counts before spending**, a per-run cap, and log model id / tokens / cost. Get owner approval on the projected spend before the real run. Make it resumable (skip papers already extracted).
7. **Never** infer a missing year from neighbours or invent a key. Unclear → empty/unknown.

## After extraction — app phases (PRD v3 §10, in order)
- **Phase 2 identity:** username+email → user + opaque session token; store only `token_hash`; httpOnly Secure SameSite=Lax cookie. Same-device restore only; email alone must NOT restore another user's history. Rate limits, export/delete.
- **Phase 3 MCQ trainer + theory set:** default pool = questions never answered correctly (failed prioritized); filters by course/topic/exam-year/verification; record `attempts`; mastery/review/reset; **question header shows `Course · Exam year(s) · Verification status` before the stem**; flags; shared versioned explanations (generated, grounded, never auto-upgrade verification). Theory mode = browsable year-tagged prompts (no auto-grading).
- **Phase 4 tutor chat:** retrieve top-6 from `chunks` (`tsv @@ plainto_tsquery`, filter course/jurisdiction/year, rank primary law over notes), cite `[document, p.locator]`, decline below threshold, surface conflicts (don't blend), save/reopen conversations, persist `citations` + `retrieval_trace`. Grounding system prompts: PRD v3 §7 (and the stricter v2 §8A wording is a good base).
- **Phase 5 dashboard:** attempts aggregates + per-course accuracy bar + mastered-vs-remaining ring.
- **Phase 6 readiness:** PWA/mobile a11y, privacy flows, admin corpus/status view, eval set (≥50 prompts), load test.

## Run / verify quickstart
```bash
cd ingestion && source .venv/bin/activate
python -m nls_ingest.main migrate     # schema (idempotent)
python -m nls_ingest.main load        # corpus → Neon (already done; resumable)
# app:
cd ../app && npm install && npm run dev   # or deploy via Vercel (Root Directory = app)
```
Footer (required, all pages): *“Answers are limited to the loaded study materials and may be incomplete or outdated. This tool is exam-study support, not legal advice.”*

## Open items / housekeeping
- Confirm `/api/health` is green on the Vercel deployment (needs the redeploy that reads `POSTGRES_URL`).
- Old `ingestion/raw_zips/*.zip` (8.7 GB) + `ingestion/raw_materials/` (18 GB) are dead weight (extraction now comes from `output/`) — safe to delete to reclaim ~27 GB.
- The Neon DB password was shared in plaintext during setup; owner may rotate it.
