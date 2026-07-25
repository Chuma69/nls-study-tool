"""Filesystem helpers: hashing, junk detection, safe walking."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Iterator

from . import config


def sha256_file(path: Path, _bufsize: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_bufsize):
            h.update(chunk)
    return h.hexdigest()


def sha1_text(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def is_junk(path: Path) -> bool:
    """True if a path is OS/editor noise we should never process."""
    name = path.name
    if name in config.JUNK_NAMES:
        return True
    if name.startswith(config.JUNK_NAME_PREFIXES):
        return True
    parts = set(path.parts)
    if parts & config.JUNK_DIR_NAMES:
        return True
    for part in path.parts:
        if part.endswith(config.JUNK_DIR_SUFFIXES):
            return True
    return False


def iter_files(root: Path) -> Iterator[Path]:
    """Yield non-junk files under root."""
    for p in root.rglob("*"):
        if p.is_file() and not is_junk(p):
            yield p


def normalize_for_dedup(text: str) -> str:
    """Aggressively normalize text so trivially-different copies of the same
    content collapse to one dedup key: unicode-normalize, lowercase, strip
    punctuation runs, collapse whitespace."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text
