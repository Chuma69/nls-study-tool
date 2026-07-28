-- Question numbers belong to the source document's sequence, not to the stem.
-- Removing them prevents a sprint or saved question from looking out of context.
UPDATE questions
SET stem = regexp_replace(stem, '^\\s*[0-9]{1,3}\\s*[\\.\\):\\-]\\s*', '')
WHERE stem ~ '^\\s*[0-9]{1,3}\\s*[\\.\\):\\-]\\s*';
