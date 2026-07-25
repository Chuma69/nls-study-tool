"""Simple char-window chunking with overlap, preferring paragraph boundaries."""

from __future__ import annotations

import re

from . import config

_PARA = re.compile(r"\n\s*\n")


def chunk_text(text: str,
               target: int = config.CHUNK_TARGET_CHARS,
               overlap: int = config.CHUNK_OVERLAP_CHARS) -> list[str]:
    text = text.strip()
    if not text:
        return []

    # Build blocks from paragraphs, packing up to the target size.
    paras = [p.strip() for p in _PARA.split(text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for para in paras:
        if len(buf) + len(para) + 2 <= target:
            buf = f"{buf}\n\n{para}" if buf else para
        else:
            if buf:
                chunks.append(buf)
            # A single oversized paragraph is hard-split.
            if len(para) > target:
                for i in range(0, len(para), target - overlap):
                    chunks.append(para[i:i + target])
                buf = ""
            else:
                buf = para
    if buf:
        chunks.append(buf)

    # Add a trailing-overlap tail from the previous chunk for context continuity.
    if overlap > 0 and len(chunks) > 1:
        stitched = [chunks[0]]
        for i in range(1, len(chunks)):
            tail = chunks[i - 1][-overlap:]
            stitched.append(f"{tail} {chunks[i]}")
        chunks = stitched
    return chunks
