"""NLS ingestion pipeline package.

Local-only tool that turns collected study materials (zip files) into:
  1. a shippable read-only SQLite FTS5 knowledge-base index, and
  2. an upserted MCQ bank in Neon Postgres.

Phase 0 provides configuration + DB connectivity only. The full
unzip -> extract/OCR -> tag -> chunk -> index -> extract-MCQ pipeline
lands in Phase 1.
"""

__version__ = "0.1.0"
