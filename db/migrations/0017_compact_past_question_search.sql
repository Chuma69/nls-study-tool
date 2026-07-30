DROP INDEX IF EXISTS idx_pq_text_chunks_tsv;
ALTER TABLE past_question_text_chunks DROP COLUMN IF EXISTS tsv;
