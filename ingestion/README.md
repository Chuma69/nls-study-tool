# Ingestion pipeline (local)

Runs on your own machine — **not** deployed. Turns collected study materials
into a shippable SQLite FTS5 knowledge-base index and an MCQ bank in Neon.

## Setup

```bash
cd ingestion
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then paste DATABASE_URL + ANTHROPIC_API_KEY
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

## Phase 1 (coming next)

`python -m nls_ingest.main ingest` will:
1. Unzip `raw_zips/*.zip` into `raw_materials/` (nested zips, no overwrites).
2. Extract text (pdfplumber / python-docx); OCR scanned PDFs with Tesseract.
3. Tag each doc: `course`, `jurisdiction`, `year`, `doc_type` (unknowns → `unknown`).
4. Chunk (~500–800 tokens, ~100 overlap), keeping source doc + page ref.
5. Build `build/knowledge_base.sqlite` (FTS5).
6. Extract MCQs from `past_questions` docs (Claude Haiku) → upsert to Neon (`verified=false`).

Idempotent and resumable: re-running skips processed files, never duplicates.
