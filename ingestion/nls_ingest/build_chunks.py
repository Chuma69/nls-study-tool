"""Build the provider-neutral chunk artifact from the Codex corpus, and measure
its size — the core of the retrieval decision-gate spike (PRD §2).

Emits:
  build/source_documents.jsonl  — one row per non-duplicate source doc
  build/chunks.jsonl            — de-duplicated, page-located chunks

De-dup: notes/knowledge chunks collapse by normalized-text hash across the whole
corpus; past-question documents are NEVER de-duped (integrity rule).
"""

from __future__ import annotations

import json

from . import chunk as chunker
from . import config, corpus, fsutil, locators, tagging


def _estimate_neon_mb(content_bytes: int, n_chunks: int) -> float:
    """Rough Neon storage estimate: stored content + tsvector (~1.0x content)
    + GIN index (~0.5x) + row/column overhead (~120 B/chunk)."""
    return (content_bytes * 2.5 + n_chunks * 120) / (1024 * 1024)


def build() -> dict:
    config.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    seen_hashes: set[str] = set()
    stats = {
        "documents": 0, "past_question_docs": 0, "chunks_total": 0,
        "chunks_kept": 0, "chunks_deduped": 0, "content_bytes_kept": 0,
        "pages_located": 0, "no_page_docs": 0,
    }

    src_out = config.SOURCE_ARTIFACT_PATH.open("w", encoding="utf-8")
    chk_out = config.CHUNK_ARTIFACT_PATH.open("w", encoding="utf-8")

    for doc in corpus.iter_documents():
        stats["documents"] += 1
        if doc.is_past_question:
            stats["past_question_docs"] += 1

        try:
            text = doc.txt_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        tags = tagging.tag_document(doc.rel_source_path, sample_text=text[:4000])
        # Past-question year is authoritative from past_questions.jsonl.
        year = ",".join(doc.detected_years) if doc.detected_years else tags["year"]
        doc_type = "past_questions" if doc.is_past_question else tags["doc_type"]

        src_out.write(json.dumps({
            "content_sha256": doc.sha256,
            "rel_source_path": doc.rel_source_path,
            "display_name": doc.txt_path.stem,
            "ext": doc.ext,
            "extraction_method": doc.method,
            "ocr_used": doc.ocr_used,
            "page_count": doc.pages,
            "course": tags["course"],
            "jurisdiction": tags["jurisdiction"],
            "effective_year": year,
            "doc_type": doc_type,
            "is_past_question": doc.is_past_question,
            "detected_years": doc.detected_years,
        }, ensure_ascii=False) + "\n")

        # Past-question papers become structured questions (MCQ + theory),
        # surfaced with year provenance — they are NOT part of the tutor's
        # grounding corpus, so they are recorded as sources but not chunked.
        if doc.is_past_question:
            continue

        pages = locators.split_pages(text)
        if len(pages) == 1 and pages[0][0] is None:
            stats["no_page_docs"] += 1

        chunk_index = 0
        for page_no, seg in pages:
            for c in chunker.chunk_text(seg):
                stats["chunks_total"] += 1
                dedup_hash = None
                if config.DEDUP_CHUNKS and not doc.is_past_question:
                    norm = fsutil.normalize_for_dedup(c)
                    if len(norm) >= 40:
                        dedup_hash = fsutil.sha1_text(norm)
                        if dedup_hash in seen_hashes:
                            stats["chunks_deduped"] += 1
                            continue
                        seen_hashes.add(dedup_hash)
                loc = locators.locator_str(page_no)
                if loc:
                    stats["pages_located"] += 1
                chk_out.write(json.dumps({
                    "content_sha256": doc.sha256,
                    "chunk_index": chunk_index,
                    "content": c,
                    "content_sha1": dedup_hash or fsutil.sha1_text(c),
                    "page_locator": loc,
                    "course": tags["course"],
                    "jurisdiction": tags["jurisdiction"],
                    "effective_year": year,
                    "doc_type": doc_type,
                    "token_est": len(c) // 4,
                }, ensure_ascii=False) + "\n")
                stats["chunks_kept"] += 1
                stats["content_bytes_kept"] += len(c.encode("utf-8"))
                chunk_index += 1

    src_out.close()
    chk_out.close()

    stats["content_mb_kept"] = round(stats["content_bytes_kept"] / (1024 * 1024), 1)
    stats["est_neon_mb"] = round(
        _estimate_neon_mb(stats["content_bytes_kept"], stats["chunks_kept"]), 1)
    stats["dedup_reduction_pct"] = (
        round(100 * stats["chunks_deduped"] / stats["chunks_total"], 1)
        if stats["chunks_total"] else 0)
    return stats
