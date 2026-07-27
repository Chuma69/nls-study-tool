CREATE TABLE IF NOT EXISTS question_verification_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL, model_id TEXT NOT NULL, requested_cap_usd NUMERIC(12,6),
  estimated_input_tokens BIGINT, estimated_output_tokens BIGINT, estimated_cost_usd NUMERIC(12,6),
  actual_input_tokens BIGINT NOT NULL DEFAULT 0, actual_output_tokens BIGINT NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0, questions_planned INTEGER NOT NULL DEFAULT 0,
  questions_processed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','completed','stopped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS question_verification_items (
  run_id BIGINT NOT NULL REFERENCES question_verification_runs(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0, error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_question_verification_items_question
  ON question_verification_items(question_id, status);
