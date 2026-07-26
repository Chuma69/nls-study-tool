# Ingestion pipeline (local)

Runs on your own machine — **not** deployed. It loads the proven corpus into
Neon full-text search and structures past papers into a question bank.

## Setup

```bash
cd ingestion
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then paste DATABASE_URL + OPENAI_API_KEY
```

### System dependencies (for OCR of scanned PDFs, Phase 1)

Tesseract + poppler are native binaries, installed outside pip:

```bash
brew install tesseract poppler      # macOS
```

## Phase 0 — connectivity check

Confirms the pipeline can reach Neon and that the schema is applied:

```bash
python -m nls_ingest.main check
```

Expected output:

```
✓ Connected to Neon and schema present.
  users:     0
  questions: 0
```

## Corpus commands

`python -m nls_ingest.main ingest` will:
1. Unzip `raw_zips/*.zip` into `raw_materials/` (nested zips, no overwrites).
2. Extract text (pdfplumber / python-docx); OCR scanned PDFs with Tesseract.
3. Tag each doc: `course`, `jurisdiction`, `year`, `doc_type` (unknowns → `unknown`).
4. Chunk (~500–800 tokens, ~100 overlap), keeping source doc + page ref.
5. Build a provider-neutral retrieval artifact and load it into Neon.

## Past-question extraction

First produce an API-free estimate. It scans the immutable past-question
catalog, classifies MCQ/theory/mixed papers heuristically, and writes a report
to `build/question_extraction_dry_run.json`:

```bash
python -m nls_ingest.main extract-questions --dry-run
```

Review the cost and source list. Only after the owner approves, apply the audit
migration and start a capped paid run:

```bash
python -m nls_ingest.main migrate
python -m nls_ingest.main extract-questions \
  --approve-dry-run REPORT_ID --max-cost-usd CAP
```

The paid command cannot run without both the exact report ID and a hard dollar
ceiling. It uses GPT-4o mini only to structure the supplied paper; it does not
infer answer keys, years, or missing text. Imported keys remain `unreviewed`.
Completed papers are skipped on later runs.

Idempotent and resumable: re-running skips completed papers and never
duplicates questions (`question_fingerprint` is the unique key).
