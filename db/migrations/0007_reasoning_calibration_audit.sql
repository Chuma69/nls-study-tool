CREATE TABLE IF NOT EXISTS reasoning_calibration_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id TEXT NOT NULL, model_id TEXT NOT NULL, requested_cap_usd NUMERIC(12,6),
  questions_planned INTEGER NOT NULL, questions_processed INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens BIGINT NOT NULL DEFAULT 0, actual_output_tokens BIGINT NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','stopped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS reasoning_calibration_items (
  run_id BIGINT NOT NULL REFERENCES reasoning_calibration_runs(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL, selected_key TEXT, explanation TEXT, citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0, error_code TEXT,
  PRIMARY KEY (run_id, question_id)
);
