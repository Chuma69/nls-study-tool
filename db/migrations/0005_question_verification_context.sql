-- A verified answer must carry the exact material citations that support it.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS explanation_citations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Some source papers provide one fact pattern or case study for several
-- numbered MCQs. The shared context and stable group ID keep those questions
-- inseparable in practice mode.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS shared_context TEXT,
  ADD COLUMN IF NOT EXISTS context_group_id TEXT,
  ADD COLUMN IF NOT EXISTS context_position INTEGER;

CREATE INDEX IF NOT EXISTS idx_questions_context_group
  ON questions(context_group_id, context_position)
  WHERE context_group_id IS NOT NULL;
