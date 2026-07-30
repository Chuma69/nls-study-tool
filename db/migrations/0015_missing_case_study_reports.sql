ALTER TABLE question_reports
  DROP CONSTRAINT IF EXISTS question_reports_category_check;

ALTER TABLE question_reports
  ADD CONSTRAINT question_reports_category_check
  CHECK (category IN ('typo','answer','missing_case_study','other'));
