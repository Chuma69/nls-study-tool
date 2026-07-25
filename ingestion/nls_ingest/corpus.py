"""Reader over the read-only Codex extraction corpus (manifest + extracted txt).

Yields one record per NON-duplicate source document, joined with past-question
metadata (detected_years). The corpus is never modified.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import config


@dataclass
class DocRecord:
    rel_source_path: str
    sha256: str
    ext: str
    method: str
    pages: int | None
    ocr_used: bool
    duplicate_of: str | None
    txt_path: Path
    is_past_question: bool
    detected_years: list[str]


def _load_past_questions() -> dict[str, list[str]]:
    """rel_source_path -> detected_years (source of truth for PQ + years)."""
    pq: dict[str, list[str]] = {}
    if not config.PAST_QUESTIONS_PATH.exists():
        return pq
    with config.PAST_QUESTIONS_PATH.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            pq[rec["rel_source_path"]] = rec.get("detected_years", []) or []
    return pq


def _txt_path_for(rel_source_path: str) -> Path:
    """Codex writes extracted/<rel_source_path>.txt (mirrors source path)."""
    return config.EXTRACTED_DIR / (rel_source_path + ".txt")


def iter_documents(include_duplicates: bool = False):
    """Yield DocRecord for each manifest entry whose extraction exists."""
    pq = _load_past_questions()
    with config.MANIFEST_PATH.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            m = json.loads(line)
            rel = m["rel_source_path"]
            if m.get("duplicate_of") and not include_duplicates:
                continue
            txt = _txt_path_for(rel)
            if not txt.exists():
                continue
            yield DocRecord(
                rel_source_path=rel,
                sha256=m["sha256"],
                ext=m.get("ext", ""),
                method=m.get("method", ""),
                pages=m.get("pages"),
                ocr_used=bool(m.get("ocr_used", False)),
                duplicate_of=m.get("duplicate_of"),
                txt_path=txt,
                is_past_question=rel in pq,
                detected_years=pq.get(rel, []),
            )
