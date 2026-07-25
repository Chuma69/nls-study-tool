"""Load the chunk artifact into Neon Postgres (retrieval backend).

Optimized for high-latency links: sources upsert via a single batched
executemany (no per-row RETURNING); chunks stream via COPY into a temp table
then upsert into `chunks`. Idempotent — re-running does not duplicate.

After load, reports actual on-disk size (pg_total_relation_size) — the real
retrieval-gate measurement. Requires DATABASE_URL and psycopg.
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


def load() -> dict:
    counts = {"sources": 0, "chunks": 0}
    with db.connect() as conn:
        with conn.cursor() as cur:
            # 1) Sources — one batched upsert, then read back the sha->id map.
            src_rows = [
                (r["content_sha256"], r["rel_source_path"], r["display_name"],
                 r["ext"], r["extraction_method"], r["ocr_used"], r["page_count"],
                 r["course"], r["jurisdiction"], r["effective_year"], r["doc_type"])
                for r in _iter_jsonl(config.SOURCE_ARTIFACT_PATH)
            ]
            cur.executemany(
                """INSERT INTO source_documents
                    (content_sha256, rel_source_path, display_name, ext,
                     extraction_method, ocr_used, page_count, course,
                     jurisdiction, effective_year, doc_type)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (content_sha256) DO UPDATE SET
                     rel_source_path = EXCLUDED.rel_source_path,
                     course = EXCLUDED.course, doc_type = EXCLUDED.doc_type""",
                src_rows,
            )
            counts["sources"] = len(src_rows)
            cur.execute("SELECT content_sha256, id FROM source_documents")
            sha_to_id = {sha: sid for sha, sid in cur.fetchall()}
            conn.commit()

            # 2) Chunks — batched executemany, committing every batch so a
            #    dropped link (high-latency intercontinental) loses at most one
            #    batch. Re-running resumes via ON CONFLICT (idempotent).
            batch: list[tuple] = []
            BATCH = 2000

            def flush():
                if not batch:
                    return
                cur.executemany(
                    """INSERT INTO chunks
                        (source_document_id, chunk_index, content, content_sha1,
                         page_locator, course, jurisdiction, effective_year,
                         doc_type, token_est)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (source_document_id, chunk_index) DO NOTHING""",
                    batch,
                )
                conn.commit()
                batch.clear()

            for r in _iter_jsonl(config.CHUNK_ARTIFACT_PATH):
                sid = sha_to_id.get(r["content_sha256"])
                if sid is None:
                    continue
                # Postgres text cannot store NUL; strip defensively.
                content = r["content"].replace("\x00", "")
                batch.append((
                    sid, r["chunk_index"], content, r["content_sha1"],
                    r["page_locator"], r["course"], r["jurisdiction"],
                    r["effective_year"], r["doc_type"], r["token_est"],
                ))
                counts["chunks"] += 1
                if len(batch) >= BATCH:
                    flush()
                    if counts["chunks"] % 20000 == 0:
                        print(f"  … {counts['chunks']} chunks loaded")
            flush()

            # 3) Real size measurement (the gate's actual number).
            cur.execute("""
                SELECT pg_size_pretty(pg_total_relation_size('chunks')),
                       pg_size_pretty(pg_database_size(current_database()))
            """)
            counts["chunks_table_size"], counts["database_size"] = cur.fetchone()
    return counts
