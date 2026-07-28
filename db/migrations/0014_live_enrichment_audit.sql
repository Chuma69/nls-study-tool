CREATE TABLE IF NOT EXISTS live_question_enrichment_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  requested_cap_usd NUMERIC(12,6) NOT NULL,
  estimated_input_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_output_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  questions_planned INTEGER NOT NULL,
  questions_processed INTEGER NOT NULL DEFAULT 0,
  questions_enriched INTEGER NOT NULL DEFAULT 0,
  questions_skipped INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens BIGINT NOT NULL DEFAULT 0,
  actual_output_tokens BIGINT NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','stopped','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS live_question_enrichment_items (
  run_id BIGINT NOT NULL REFERENCES live_question_enrichment_runs(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('enriched','skipped','failed')),
  assigned_course TEXT,
  assigned_topic TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_live_enrichment_items_question
  ON live_question_enrichment_items(question_id, status);

