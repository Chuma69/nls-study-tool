ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS allowlisted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS allowlisted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questions_allowlisted
  ON questions (allowlisted_at)
  WHERE allowlisted_at IS NOT NULL;

-- Questions already attempted by an administrator have already received a
-- manual consumption check in the learner flow, so preserve that work.
UPDATE questions q
SET allowlisted_at = now(),
    allowlisted_by = (
      SELECT a.user_id
      FROM attempts a
      JOIN users u ON u.id = a.user_id
      WHERE a.question_id = q.id
        AND u.role = 'admin'
      ORDER BY a.answered_at DESC
      LIMIT 1
    )
WHERE q.allowlisted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM attempts a
    JOIN users u ON u.id = a.user_id
    WHERE a.question_id = q.id
      AND u.role = 'admin'
  );
