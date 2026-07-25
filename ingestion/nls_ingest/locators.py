"""Split extracted text into page segments, preserving page numbers for
citation locators. Embedded PDFs use form-feed (\\f) boundaries; OCR docs use
[[page N]] markers. Other formats (docx/pptx/txt) have no page structure."""

from __future__ import annotations

import re

_PAGE_MARKER = re.compile(r"\[\[page\s+(\d+)\]\]", re.I)


def split_pages(text: str) -> list[tuple[int | None, str]]:
    """Return [(page_no_or_None, segment_text), ...].

    - [[page N]] markers → the number labels the text that follows the marker.
    - form-feed \\f      → 1-based page numbering by position.
    - neither            → a single (None, text) segment.
    """
    if _PAGE_MARKER.search(text):
        segments: list[tuple[int | None, str]] = []
        parts = _PAGE_MARKER.split(text)
        # parts = [pre, num1, body1, num2, body2, ...]
        preamble = parts[0].strip()
        if preamble:
            segments.append((None, preamble))
        for i in range(1, len(parts), 2):
            page_no = int(parts[i])
            body = parts[i + 1] if i + 1 < len(parts) else ""
            if body.strip():
                segments.append((page_no, body))
        return segments or [(None, text)]

    if "\f" in text:
        pages = text.split("\f")
        return [(i + 1, seg) for i, seg in enumerate(pages) if seg.strip()] \
            or [(None, text)]

    return [(None, text)]


def locator_str(page_no: int | None) -> str | None:
    return f"p.{page_no}" if page_no is not None else None
