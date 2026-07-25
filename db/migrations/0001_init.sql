-- ─────────────────────────────────────────────────────────────
-- NLS Study Tool — Neon/Postgres schema (PRD v3 §5)
-- Ordered migration 0001. Idempotent; safe to re-run.
--   psql "$DATABASE_URL" -f db/migrations/0001_init.sql
--
-- Retrieval backend = Postgres FTS (tsvector + GIN) on a de-duplicated
-- corpus (retrieval decision gate, PRD §2). Chunk text lives here.
-- ─────────────────────────────────────────────────────────────

-- ── Identity ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username     TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the token HASH is stored; the raw token is an httpOnly cookie (PRD §3).
CREATE TABLE IF NOT EXISTS sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── Corpus provenance ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_documents (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_sha256      TEXT NOT NULL UNIQUE,
  rel_source_path     TEXT NOT NULL,
  display_name        TEXT,
  ext                 TEXT,
  extraction_method   TEXT,
  ocr_used            BOOLEAN NOT NULL DEFAULT false,
  page_count          INTEGER,
  extracted_at        TIMESTAMPTZ,
  course              TEXT,
  jurisdiction        TEXT,
  effective_year      TEXT,
  metadata_confidence REAL,
  doc_type            TEXT,
  source_status       TEXT NOT NULL DEFAULT 'active'
                        CHECK (source_status IN ('active','superseded','excluded')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_srcdoc_course ON source_documents(course);
CREATE INDEX IF NOT EXISTS idx_srcdoc_doctype ON source_documents(doc_type);

-- ── Retrieval chunks (Postgres FTS) ───────────────────────────
-- Immutable, de-duplicated chunks. `page_locator` preserves citation target
-- (e.g. 'p.5'). tsv is a generated FTS vector with a GIN index.
CREATE TABLE IF NOT EXISTS chunks (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_document_id BIGINT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  chunk_index        INTEGER NOT NULL,
  content            TEXT NOT NULL,
  content_sha1       TEXT NOT NULL,          -- normalized-text hash (dedup key)
  page_locator       TEXT,                   -- 'p.5' | 's.X' | null
  course             TEXT,
  jurisdiction       TEXT,
  effective_year     TEXT,
  doc_type           TEXT,
  token_est          INTEGER,
  tsv                TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON chunks(course);
CREATE INDEX IF NOT EXISTS idx_chunks_dedup ON chunks(content_sha1);

-- ── Questions (MCQ + theory share this table) ─────────────────
CREATE TABLE IF NOT EXISTS questions (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_document_id     BIGINT REFERENCES source_documents(id) ON DELETE SET NULL,
  source_locator         TEXT,
  question_fingerprint   TEXT NOT NULL UNIQUE,
  question_type          TEXT NOT NULL DEFAULT 'mcq'
                           CHECK (question_type IN ('mcq','theory')),
  course                 TEXT,
  topic                  TEXT,
  exam_years             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["2018", ...] or []
  stem                   TEXT NOT NULL,
  options                JSONB,                                -- [{key,text}] for mcq; null for theory
  marked_answer_key      TEXT,                                 -- never overwritten; null for theory
  material_supported_key TEXT,                                 -- separate from marked key
  model_answer           TEXT,                                 -- optional, theory
  verification_status    TEXT NOT NULL DEFAULT 'unreviewed'
                           CHECK (verification_status IN
                             ('unreviewed','material_supported','material_conflicted',
                              'insufficient_material','staff_corrected')),
  explanation            TEXT,
  explanation_version    INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_course_verif ON questions(course, verification_status);
CREATE INDEX IF NOT EXISTS idx_questions_type_course ON questions(question_type, course);

-- ── Attempts / flags ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attempts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chosen_key  TEXT,
  is_correct  BOOLEAN NOT NULL,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_question ON attempts(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_correct ON attempts(user_id, is_correct);

CREATE TABLE IF NOT EXISTS question_flags (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_flags_question ON question_flags(question_id);

-- ── Tutor chat ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  citations       JSONB,
  retrieval_trace JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
