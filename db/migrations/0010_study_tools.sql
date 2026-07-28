-- Persistent saved-question notes, flashcard scheduling, and timed sprints.
CREATE UNIQUE INDEX IF NOT EXISTS idx_question_flags_one_kind
  ON question_flags(user_id, question_id, kind) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS card_reviews (
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id    BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  due_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  interval_days  INTEGER NOT NULL DEFAULT 1,
  last_reviewed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_card_reviews_due ON card_reviews(user_id, due_at);

CREATE TABLE IF NOT EXISTS sprints (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  courses          JSONB NOT NULL,
  question_count   INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','timed_out'))
);
CREATE TABLE IF NOT EXISTS sprint_items (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sprint_id      BIGINT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  question_id    BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  chosen_key     TEXT,
  is_correct     BOOLEAN,
  seconds_spent  INTEGER,
  answered_at    TIMESTAMPTZ,
  UNIQUE(sprint_id, position),
  UNIQUE(sprint_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_sprints_user_recent ON sprints(user_id, started_at DESC);
