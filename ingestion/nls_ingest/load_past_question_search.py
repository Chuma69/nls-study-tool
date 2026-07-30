"""Load deduplicated past-question source text into its Neon search index."""

from __future__ import annotations

import hashlib
import json
import re

from . import chunk, config, db, locators


def _hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().casefold()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def load() -> dict[str, int | str]:
    records = [json.loads(line) for line in config.PAST_QUESTIONS_PATH.open(encoding="utf-8") if line.strip()]
    documents = chunks_seen = links = missing = 0
    with db.connect() as conn:
        with conn.cursor() as cur:
            # Use the authoritative past_questions.jsonl list. Some older source
            # rows were tagged as notes/other even though they are past papers.
            cur.execute("SELECT id,rel_source_path FROM source_documents")
            source_ids = {path: source_id for source_id, path in cur.fetchall()}
            cur.execute("""CREATE TEMP TABLE pq_search_stage(
              content_sha1 text,content text,source_document_id bigint,
              chunk_index integer,page_locator text) ON COMMIT DROP""")
            staged = []
            for record in records:
                rel_path = record["rel_source_path"]
                text_path = config.EXTRACTED_DIR / (rel_path + ".txt")
                source_id = source_ids.get(rel_path)
                if not text_path.exists() or not source_id:
                    missing += 1
                    continue
                documents += 1
                text = text_path.read_text(encoding="utf-8", errors="replace")
                chunk_index = 0
                for page_no, page_text in locators.split_pages(text):
                    for content in chunk.chunk_text(page_text):
                        staged.append((_hash(content), content, source_id, chunk_index, locators.locator_str(page_no)))
                        chunks_seen += 1
                        chunk_index += 1
                if documents % 100 == 0:
                    print(f"  prepared {documents}/{len(records)} past-question documents", flush=True)
            print(f"  bulk-loading {len(staged)} source passages …", flush=True)
            with cur.copy("COPY pq_search_stage(content_sha1,content,source_document_id,chunk_index,page_locator) FROM STDIN") as copy:
                for row in staged:
                    copy.write_row(row)
            cur.execute("""INSERT INTO past_question_text_chunks(content_sha1,content)
              SELECT DISTINCT ON(content_sha1) content_sha1,content FROM pq_search_stage
              ORDER BY content_sha1 ON CONFLICT(content_sha1) DO NOTHING""")
            cur.execute("""INSERT INTO past_question_text_sources(chunk_id,source_document_id,chunk_index,page_locator)
              SELECT c.id,s.source_document_id,s.chunk_index,s.page_locator
              FROM pq_search_stage s JOIN past_question_text_chunks c USING(content_sha1)
              ON CONFLICT(source_document_id,chunk_index) DO UPDATE
              SET chunk_id=EXCLUDED.chunk_id,page_locator=EXCLUDED.page_locator""")
            links = len(staged)
            cur.execute("SELECT count(*) FROM past_question_text_chunks")
            unique_chunks = cur.fetchone()[0]
            cur.execute("SELECT pg_size_pretty(pg_total_relation_size('past_question_text_chunks') + pg_total_relation_size('past_question_text_sources'))")
            index_size = cur.fetchone()[0]
    return {"documents": documents, "missing": missing, "chunks_seen": chunks_seen, "source_links": links, "unique_chunks": unique_chunks, "index_size": index_size}
