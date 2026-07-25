"""Load the chunk artifact into Neon Postgres (retrieval backend).

Idempotent: source_documents upsert by content_sha256; chunks upsert by
(source_document_id, chunk_index). Re-running does not duplicate. After load,
reports actual on-disk size (pg_total_relation_size) — the real retrieval-gate
measurement.

Requires DATABASE_URL and psycopg. Run after applying db/migrations.
"""

from __future__ import annotations

import json

from . import config, db


def _iter_jsonl(path):
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def load(batch: int = 1000) -> dict:
    counts = {"sources": 0, "chunks": 0}
    with db.connect() as conn:
        with conn.cursor() as cur:
            # 1) Sources — upsert, collect sha -> id.
            sha_to_id: dict[str, int] = {}
            for rec in _iter_jsonl(config.SOURCE_ARTIFACT_PATH):
                cur.execute(
                    """INSERT INTO source_documents
                        (content_sha256, rel_source_path, display_name, ext,
                         extraction_method, ocr_used, page_count, course,
                         jurisdiction, effective_year, doc_type)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (content_sha256) DO UPDATE SET
                         rel_source_path = EXCLUDED.rel_source_path,
                         course = EXCLUDED.course,
                         doc_type = EXCLUDED.doc_type
                       RETURNING id""",
                    (rec["content_sha256"], rec["rel_source_path"],
                     rec["display_name"], rec["ext"], rec["extraction_method"],
                     rec["ocr_used"], rec["page_count"], rec["course"],
                     rec["jurisdiction"], rec["effective_year"], rec["doc_type"]),
                )
                sha_to_id[rec["content_sha256"]] = cur.fetchone()[0]
                counts["sources"] += 1
            conn.commit()

            # 2) Chunks — batched upsert.
            rows: list[tuple] = []

            def flush():
                if not rows:
                    return
                cur.executemany(
                    """INSERT INTO chunks
                        (source_document_id, chunk_index, content, content_sha1,
                         page_locator, course, jurisdiction, effective_year,
                         doc_type, token_est)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (source_document_id, chunk_index) DO NOTHING""",
                    rows,
                )
                conn.commit()
                rows.clear()

            for rec in _iter_jsonl(config.CHUNK_ARTIFACT_PATH):
                sid = sha_to_id.get(rec["content_sha256"])
                if sid is None:
                    continue
                rows.append((
                    sid, rec["chunk_index"], rec["content"], rec["content_sha1"],
                    rec["page_locator"], rec["course"], rec["jurisdiction"],
                    rec["effective_year"], rec["doc_type"], rec["token_est"],
                ))
                counts["chunks"] += 1
                if len(rows) >= batch:
                    flush()
            flush()

            # 3) Real size measurement (the gate's actual number).
            cur.execute("""
                SELECT pg_size_pretty(pg_total_relation_size('chunks')),
                       pg_total_relation_size('chunks'),
                       pg_size_pretty(pg_database_size(current_database()))
            """)
            chunks_pretty, chunks_bytes, db_pretty = cur.fetchone()
            counts["chunks_table_size"] = chunks_pretty
            counts["chunks_table_bytes"] = chunks_bytes
            counts["database_size"] = db_pretty
    return counts
