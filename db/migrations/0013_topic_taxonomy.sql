-- Questions already have a free-text topic column. Index it for topic-specific
-- practice, sprint generation, and progress reporting.
CREATE INDEX IF NOT EXISTS idx_questions_course_topic_verif
  ON questions(course, topic, verification_status);
