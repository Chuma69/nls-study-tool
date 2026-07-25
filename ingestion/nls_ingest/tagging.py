"""Heuristic tagging of documents from their path + filename (and, for years,
their text). Ambiguous course tags fall back to 'general'; unknown
jurisdiction/year are 'unknown' rather than guessed (PRD §5.3)."""

from __future__ import annotations

import re

# Course keyword -> canonical course. Order matters (first hit wins).
_COURSE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("civil_litigation", re.compile(r"\bcivil\b", re.I)),
    ("criminal_litigation", re.compile(r"\bcrim(inal)?\b", re.I)),
    ("corporate_law_practice", re.compile(r"\bcorp(orate)?\b|\bcompany\b|\bclp\b", re.I)),
    ("property_law_practice", re.compile(r"\bproperty\b|\bland\b|\bconveyanc", re.I)),
    ("professional_ethics_skills",
     re.compile(r"\bethic|\bprofessional\b|\brpc\b|\blegal skills?\b|\bpes\b", re.I)),
]

_DOC_TYPE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("past_questions", re.compile(r"past.?question|\bpq\b|\bmcq\b|exam|\bquestions?\b", re.I)),
    ("draft", re.compile(r"\bdraft|\bprecedent|\bsample\b|\bform\b", re.I)),
    ("notes", re.compile(r"\bnotes?\b|\bcompendium\b|\bcompilation\b|\bsummary\b", re.I)),
]

# A 19xx/20xx year, or a range like "2010 - 2023".
_YEAR = re.compile(r"\b(19[89]\d|20[0-4]\d)\b")

_STATE = re.compile(
    r"\b(lagos|abuja|fct|rivers|kano|enugu|yenagoa|bayelsa|yola|adamawa|"
    r"kaduna|ogun|oyo|delta|anambra)\b", re.I)


def tag_course(text: str) -> str:
    for course, pat in _COURSE_PATTERNS:
        if pat.search(text):
            return course
    return "general"


def tag_doc_type(text: str) -> str:
    for dt, pat in _DOC_TYPE_PATTERNS:
        if pat.search(text):
            return dt
    return "other"


def tag_jurisdiction(text: str) -> str:
    m = _STATE.search(text)
    return m.group(1).lower() if m else "unknown"


def find_years(text: str) -> list[str]:
    """All plausible years found, de-duplicated, in order."""
    seen: dict[str, None] = {}
    for m in _YEAR.finditer(text):
        seen.setdefault(m.group(1), None)
    return list(seen.keys())


def tag_document(rel_path: str, sample_text: str = "") -> dict[str, str]:
    """Infer tags from the path/filename primarily, sampling text for years.
    `sample_text` should be the first page or two (cheap, avoids scanning MB)."""
    basis = rel_path.replace("_", " ").replace("/", " ")
    years = find_years(basis) or find_years(sample_text[:4000])
    return {
        "course": tag_course(basis),
        "doc_type": tag_doc_type(basis),
        "jurisdiction": tag_jurisdiction(basis) if tag_jurisdiction(basis) != "unknown"
        else tag_jurisdiction(sample_text[:4000]),
        "year": ",".join(years) if years else "unknown",
    }
