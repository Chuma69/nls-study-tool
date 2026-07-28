ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'learner'
  CHECK (role IN ('learner','expert','admin'));

CREATE TABLE IF NOT EXISTS expert_invites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS expert_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  expert_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_key TEXT NOT NULL,
  explanation TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','withdrawn','superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, expert_id)
);
CREATE INDEX IF NOT EXISTS idx_expert_reviews_question ON expert_reviews(question_id, status);

CREATE TABLE IF NOT EXISTS question_consensus (
  question_id BIGINT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  selected_key TEXT,
  review_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_reviews'
    CHECK (status IN ('awaiting_reviews','consensus_reached','conflicted','staff_approved','staff_rejected')),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_question_consensus_status ON question_consensus(status);
