-- ─────────────────────────────────────────────────────────────
-- NLS Study Tool — Neon / Postgres schema (PRD §6)
-- Transactional/user data only. Knowledge-base chunks live in the
-- static SQLite FTS5 index, NOT here.
--
-- Idempotent: safe to re-run. Apply with:
--   psql "$DATABASE_URL" -f db/schema.sql
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username     TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The MCQ bank (populated by ingestion).
CREATE TABLE IF NOT EXISTS questions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_document TEXT,
  course          TEXT,
  topic           TEXT,
  stem            TEXT NOT NULL,
  options         JSONB NOT NULL,          -- [{key, text}, ...]
  answer_key      TEXT NOT NULL,
  explanation     TEXT,                    -- shared cache (§7.1), nullable until generated
  verified        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per answer submission.
CREATE TABLE IF NOT EXISTS attempts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chosen_key  TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved tutor chats.
CREATE TABLE IF NOT EXISTS conversations (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  citations       JSONB,                   -- nullable
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes the whole app leans on (PRD §6).
CREATE INDEX IF NOT EXISTS idx_attempts_user_question ON attempts (user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_correct  ON attempts (user_id, is_correct);

-- Supporting indexes.
CREATE INDEX IF NOT EXISTS idx_questions_course        ON questions (course);
CREATE INDEX IF NOT EXISTS idx_conversations_user      ON conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation   ON messages (conversation_id, created_at);
