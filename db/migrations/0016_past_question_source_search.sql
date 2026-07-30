-- Searchable source text for reconstructing past questions. Kept separate from
-- `chunks`, which is reserved for learning-material answer grounding.
CREATE TABLE IF NOT EXISTS past_question_text_chunks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_sha1 TEXT NOT NULL UNIQUE,
  content      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS past_question_text_sources (
  chunk_id          BIGINT NOT NULL REFERENCES past_question_text_chunks(id) ON DELETE CASCADE,
  source_document_id BIGINT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  chunk_index       INTEGER NOT NULL,
  page_locator      TEXT,
  PRIMARY KEY (source_document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_pq_text_sources_chunk
  ON past_question_text_sources(chunk_id);
