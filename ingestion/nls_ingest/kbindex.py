"""The shippable knowledge base: a single SQLite file with an FTS5 index over
de-duplicated knowledge chunks, a documents catalog, a dedicated
past-questions catalog (never pruned), and an empty embedding table reserved
for a future semantic-search upgrade (PRD §3)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  rel_path      TEXT NOT NULL,
  sha256        TEXT NOT NULL UNIQUE,
  source_archive TEXT,
  course        TEXT,
  jurisdiction  TEXT,
  year          TEXT,
  doc_type      TEXT,
  char_count    INTEGER,
  page_count    INTEGER,
  method        TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- FTS5 over knowledge chunks. Metadata columns are UNINDEXED (stored, not
-- searched) so filtered retrieval (by course, etc.) works without a join.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
  text,
  doc_id UNINDEXED,
  rel_path UNINDEXED,
  course UNINDEXED,
  doc_type UNINDEXED,
  jurisdiction UNINDEXED,
  year UNINDEXED,
  page_ref UNINDEXED,
  tokenize = 'porter unicode61'
);

-- Chunk de-dup ledger: normalized-text hash -> first chunk rowid.
CREATE TABLE IF NOT EXISTS chunk_dedup (
  hash TEXT PRIMARY KEY
);

-- Reserved for Phase 7 semantic upgrade; empty for v1.
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_rowid INTEGER PRIMARY KEY,
  embedding   BLOB
);

-- Past-question papers catalog. Preserved verbatim; year is authoritative.
CREATE TABLE IF NOT EXISTS past_questions_catalog (
  id             INTEGER PRIMARY KEY,
  doc_id         INTEGER,
  source_document TEXT NOT NULL,
  course         TEXT,
  years          TEXT,
  page_count     INTEGER,
  char_count     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_documents_course ON documents(course);
CREATE INDEX IF NOT EXISTS idx_pqc_years ON past_questions_catalog(years);
"""


class KnowledgeBase:
    def __init__(self, path: Path = config.KB_INDEX_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def has_document(self, sha256: str) -> bool:
        cur = self.conn.execute("SELECT 1 FROM documents WHERE sha256 = ?", (sha256,))
        return cur.fetchone() is not None

    def add_document(self, *, rel_path: str, sha256: str, source_archive: str,
                     tags: dict, char_count: int, page_count: int, method: str) -> int:
        cur = self.conn.execute(
            """INSERT INTO documents
               (rel_path, sha256, source_archive, course, jurisdiction, year,
                doc_type, char_count, page_count, method)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (rel_path, sha256, source_archive, tags["course"], tags["jurisdiction"],
             tags["year"], tags["doc_type"], char_count, page_count, method),
        )
        return int(cur.lastrowid)

    def add_chunk(self, *, text: str, doc_id: int, rel_path: str, tags: dict,
                  page_ref: str, dedup_hash: str | None) -> bool:
        """Insert a chunk unless its dedup hash was already seen. Returns True
        if inserted, False if skipped as a duplicate."""
        if dedup_hash is not None:
            exists = self.conn.execute(
                "SELECT 1 FROM chunk_dedup WHERE hash = ?", (dedup_hash,)
            ).fetchone()
            if exists:
                return False
            self.conn.execute("INSERT INTO chunk_dedup(hash) VALUES (?)", (dedup_hash,))
        self.conn.execute(
            """INSERT INTO chunks
               (text, doc_id, rel_path, course, doc_type, jurisdiction, year, page_ref)
               VALUES (?,?,?,?,?,?,?,?)""",
            (text, doc_id, rel_path, tags["course"], tags["doc_type"],
             tags["jurisdiction"], tags["year"], page_ref),
        )
        return True

    def add_past_question_paper(self, *, doc_id: int, source_document: str,
                                course: str, years: str, page_count: int,
                                char_count: int) -> None:
        self.conn.execute(
            """INSERT INTO past_questions_catalog
               (doc_id, source_document, course, years, page_count, char_count)
               VALUES (?,?,?,?,?,?)""",
            (doc_id, source_document, course, years, page_count, char_count),
        )

    def commit(self) -> None:
        self.conn.commit()

    def optimize(self) -> None:
        self.conn.execute("INSERT INTO chunks(chunks) VALUES ('optimize')")
        self.conn.commit()
        # VACUUM cannot run inside a transaction; commit first, then reclaim.
        self.conn.execute("VACUUM")
        self.conn.commit()

    def stats(self) -> dict:
        c = self.conn
        return {
            "documents": c.execute("SELECT count(*) FROM documents").fetchone()[0],
            "chunks": c.execute("SELECT count(*) FROM chunks").fetchone()[0],
            "unique_chunk_hashes": c.execute("SELECT count(*) FROM chunk_dedup").fetchone()[0],
            "past_question_papers": c.execute(
                "SELECT count(*) FROM past_questions_catalog").fetchone()[0],
            "needs_ocr": c.execute(
                "SELECT count(*) FROM documents WHERE method = 'needs_ocr'").fetchone()[0],
        }

    def close(self) -> None:
        self.conn.close()
