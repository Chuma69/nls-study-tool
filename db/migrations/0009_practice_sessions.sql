-- Timed MCQ practice can resume by course while retaining per-answer timing.
CREATE TABLE IF NOT EXISTS practice_sessions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course              TEXT NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ,
  answers_count       INTEGER NOT NULL DEFAULT 0,
  correct_count       INTEGER NOT NULL DEFAULT 0,
  total_seconds       INTEGER NOT NULL DEFAULT 0,
  last_question_id    BIGINT REFERENCES questions(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_practice_sessions_one_active_course
  ON practice_sessions(user_id, course) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_recent
  ON practice_sessions(user_id, last_activity_at DESC);

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS practice_session_id BIGINT
  REFERENCES practice_sessions(id) ON DELETE SET NULL;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS seconds_spent INTEGER;
CREATE INDEX IF NOT EXISTS idx_attempts_practice_session ON attempts(practice_session_id);
