-- Audit trail for local OpenAI-backed past-question extraction.
-- No credentials, prompts, raw session tokens, or model output are stored here.
-- The source document and extracted rows remain the authoritative provenance.

CREATE TABLE IF NOT EXISTS question_extraction_runs (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id              TEXT NOT NULL,
  model_id               TEXT NOT NULL,
  dry_run                BOOLEAN NOT NULL,
  requested_cap_usd      NUMERIC(12,6),
  estimated_input_tokens BIGINT,
  estimated_output_tokens BIGINT,
  estimated_cost_usd     NUMERIC(12,6),
  actual_input_tokens    BIGINT NOT NULL DEFAULT 0,
  actual_output_tokens   BIGINT NOT NULL DEFAULT 0,
  actual_cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
  papers_planned         INTEGER NOT NULL DEFAULT 0,
  papers_processed       INTEGER NOT NULL DEFAULT 0,
  questions_upserted     INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'planned'
                         CHECK (status IN ('planned','running','completed','stopped','failed')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS question_extraction_papers (
  run_id               BIGINT NOT NULL REFERENCES question_extraction_runs(id) ON DELETE CASCADE,
  source_document_id   BIGINT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  classification        TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('planned','skipped','completed','failed')),
  input_tokens         INTEGER NOT NULL DEFAULT 0,
  output_tokens        INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd   NUMERIC(12,6) NOT NULL DEFAULT 0,
  actual_cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
  questions_upserted   INTEGER NOT NULL DEFAULT 0,
  error_code           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, source_document_id)
);

CREATE INDEX IF NOT EXISTS idx_question_extraction_papers_source
  ON question_extraction_papers(source_document_id, status);
