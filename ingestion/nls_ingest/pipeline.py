"""Build orchestration.

Extraction (hashing, text extraction, chunking) is CPU-bound and runs across a
process pool with a per-file timeout. De-duplication and all SQLite writes stay
in the main process (single writer). Idempotent and resumable via
documents.sha256 — workers skip files already in the DB.
"""

from __future__ import annotations

import signal
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from . import chunk as chunker
from . import config, fsutil, tagging, textextract
from .kbindex import KnowledgeBase

# Populated per-worker via the pool initializer.
_EXISTING_SHA: set[str] = set()
_MATERIALS_ROOT: Path = config.RAW_MATERIALS_DIR
_OCR = False


def _init_worker(existing_sha: set[str], materials_root: str, ocr: bool) -> None:
    global _EXISTING_SHA, _MATERIALS_ROOT, _OCR
    _EXISTING_SHA = existing_sha
    _MATERIALS_ROOT = Path(materials_root)
    _OCR = ocr


class _Timeout(BaseException):
    """Subclasses BaseException (not Exception) so that library code with broad
    `except Exception` blocks — notably pdfminer's page parser — cannot swallow
    the per-file timeout signal."""
    pass


def _process_file(path_str: str) -> dict | None:
    """Runs in a worker process. Returns a result dict, or None to skip."""
    path = Path(path_str)
    try:
        sha = fsutil.sha256_file(path)
    except OSError:
        return None
    if sha in _EXISTING_SHA:
        return None  # resume: already ingested

    rel_path = str(path.relative_to(_MATERIALS_ROOT))

    def _alarm(_signum, _frame):
        raise _Timeout()

    # The timeout window covers extraction AND chunking — the whole CPU-bound
    # span — so no step runs unprotected.
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(config.FILE_TIMEOUT_SEC)
    try:
        result = textextract.extract(path, ocr=_OCR)
        text = result.text or ""
        if not text.strip():
            return {"sha": sha, "rel_path": rel_path, "timeout": False,
                    "method": result.method, "pages": result.pages, "text_len": 0,
                    "tags": tagging.tag_document(rel_path), "chunks": [], "is_pq": False}

        tags = tagging.tag_document(rel_path, sample_text=text[:4000])
        is_pq = tags["doc_type"] == "past_questions"

        chunks: list[tuple[str, str | None]] = []
        for c in chunker.chunk_text(text):
            dedup_hash: str | None = None
            if config.DEDUP_CHUNKS and not is_pq:
                norm = fsutil.normalize_for_dedup(c)
                if len(norm) >= 40:
                    dedup_hash = fsutil.sha1_text(norm)
            chunks.append((c, dedup_hash))

        return {"sha": sha, "rel_path": rel_path, "timeout": False,
                "method": result.method, "pages": result.pages, "text_len": len(text),
                "tags": tags, "chunks": chunks, "is_pq": is_pq}
    except _Timeout:
        return {"sha": sha, "rel_path": rel_path, "timeout": True,
                "method": "needs_ocr", "pages": 0, "text_len": 0,
                "tags": tagging.tag_document(rel_path), "chunks": [], "is_pq": False}
    except Exception:
        return None
    finally:
        signal.alarm(0)


def build(*, ocr: bool = False, limit: int | None = None,
          materials_dir: Path = config.RAW_MATERIALS_DIR,
          workers: int = config.WORKERS, commit_every: int = 25) -> dict:
    kb = KnowledgeBase()
    existing_sha = {r[0] for r in kb.conn.execute("SELECT sha256 FROM documents")}
    seen_hashes = {r[0] for r in kb.conn.execute("SELECT hash FROM chunk_dedup")}

    files = [p for p in fsutil.iter_files(materials_dir)
             if p.suffix.lower() in config.TEXT_EXTS]
    # Smallest-first: thousands of small docs stream through quickly for fast
    # early progress; the handful of giant (usually scanned) PDFs run last,
    # bounded by the per-file timeout, instead of blocking the first wave.
    files.sort(key=lambda p: p.stat().st_size if p.exists() else 0)
    if limit:
        files = files[:limit]

    counts = {
        "total_files": len(files), "processed": 0, "skipped_resume": 0,
        "skipped_empty": 0, "chunks_kept": 0, "chunks_deduped": 0,
        "past_papers": 0, "needs_ocr": 0, "timeouts": 0,
    }
    print(f"Dispatching {len(files)} files across {workers} workers "
          f"(timeout {config.FILE_TIMEOUT_SEC}s/file) …")

    done = 0
    with ProcessPoolExecutor(
        max_workers=workers,
        initializer=_init_worker,
        initargs=(existing_sha, str(materials_dir), ocr),
    ) as ex:
        futures = [ex.submit(_process_file, str(p)) for p in files]
        for fut in as_completed(futures):
            done += 1
            res = fut.result()
            if res is None:
                counts["skipped_resume"] += 1
            else:
                _ingest_result(kb, res, seen_hashes, counts)
            if done % commit_every == 0:
                kb.commit()
                print(f"  … {done}/{len(files)} files "
                      f"({counts['processed']} docs, {counts['chunks_kept']} chunks kept, "
                      f"{counts['chunks_deduped']} deduped, {counts['needs_ocr']} need OCR)")

    kb.commit()
    kb.optimize()
    counts["kb_stats"] = kb.stats()
    kb.close()
    return counts


def _ingest_result(kb: KnowledgeBase, res: dict, seen_hashes: set[str],
                   counts: dict) -> None:
    if res["method"] == "needs_ocr":
        counts["needs_ocr"] += 1
    if res["timeout"]:
        counts["timeouts"] += 1

    doc_id = kb.add_document(
        rel_path=res["rel_path"], sha256=res["sha"],
        source_archive=res["rel_path"].split("/")[0], tags=res["tags"],
        char_count=res["text_len"], page_count=res["pages"], method=res["method"],
    )

    if not res["chunks"]:
        counts["skipped_empty"] += 1
        return

    if res["is_pq"]:
        kb.add_past_question_paper(
            doc_id=doc_id, source_document=res["rel_path"], course=res["tags"]["course"],
            years=res["tags"]["year"], page_count=res["pages"], char_count=res["text_len"],
        )
        counts["past_papers"] += 1

    for text, dedup_hash in res["chunks"]:
        if dedup_hash is not None:
            if dedup_hash in seen_hashes:
                counts["chunks_deduped"] += 1
                continue
            seen_hashes.add(dedup_hash)
            kb.conn.execute("INSERT INTO chunk_dedup(hash) VALUES (?)", (dedup_hash,))
        kb.conn.execute(
            """INSERT INTO chunks
               (text, doc_id, rel_path, course, doc_type, jurisdiction, year, page_ref)
               VALUES (?,?,?,?,?,?,?,?)""",
            (text, doc_id, res["rel_path"], res["tags"]["course"], res["tags"]["doc_type"],
             res["tags"]["jurisdiction"], res["tags"]["year"], ""),
        )
        counts["chunks_kept"] += 1
    counts["processed"] += 1
