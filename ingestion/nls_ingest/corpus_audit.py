"""Read-only audit of source quality and retrieval coverage."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

from . import config, db
from .question_verify import _evidence


def _artifact_documents():
    if not config.SOURCE_ARTIFACT_PATH.exists():
        return []
    return [json.loads(line) for line in config.SOURCE_ARTIFACT_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]


def _live_questions():
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, stem, options, course, topic
                           FROM questions
                          WHERE question_type='mcq'
                            AND verification_status IN ('material_supported', 'staff_corrected')
                            AND material_supported_key IS NOT NULL
                          ORDER BY id""")
            return [{"id": row[0], "stem": row[1], "options": row[2], "course": row[3], "topic": row[4]} for row in cur.fetchall()]


def run(sample_size: int = 100):
    documents = _artifact_documents()
    live = _live_questions()
    methods = Counter(str(document.get("extraction_method") or "unknown") for document in documents)
    courses = Counter(str(document.get("course") or "unknown") for document in documents)
    doc_types = Counter(str(document.get("doc_type") or "unknown") for document in documents)
    duplicates = sum(1 for document in documents if document.get("duplicate_of"))
    # DOCX and slide decks do not have a useful page count in this artifact, so
    # a missing page count is not evidence of missing text. Only explicit OCR
    # failures belong in this metric.
    no_text = sum(
        1
        for document in documents
        if str(document.get("extraction_method") or "") == "needs_ocr"
    )

    # Spread the retrieval test across the ordered live pool. This is intentionally
    # read-only: it measures the same retrieval function the calibration uses.
    size = min(max(0, sample_size), len(live))
    sample = [live[(index * len(live)) // size] for index in range(size)] if size else []
    retrieval = Counter()
    retrieval_by_course: dict[str, Counter] = defaultdict(Counter)
    failures: list[dict[str, object]] = []
    for question in sample:
        try:
            evidence = _evidence(question)
            result = "retrieved" if evidence else "no_retrieval"
            if not evidence and len(failures) < 20:
                failures.append({"id": question["id"], "course": question["course"], "topic": question["topic"], "stem": question["stem"][:180]})
        except Exception as exc:
            result = type(exc).__name__
            if len(failures) < 20:
                failures.append({"id": question["id"], "course": question["course"], "topic": question["topic"], "stem": question["stem"][:180], "error": result})
        retrieval[result] += 1
        retrieval_by_course[str(question["course"] or "unassigned")][result] += 1

    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT course,
                                  count(*)::int AS live_questions,
                                  count(*) FILTER (WHERE topic IS NULL OR topic='')::int AS without_topic,
                                  count(*) FILTER (WHERE explanation IS NULL OR explanation='')::int AS without_explanation
                           FROM questions
                          WHERE question_type='mcq'
                            AND verification_status IN ('material_supported', 'staff_corrected')
                          GROUP BY course ORDER BY course""")
            question_quality = [
                {"course": row[0] or "unassigned", "live_questions": row[1], "without_topic": row[2], "without_explanation": row[3]}
                for row in cur.fetchall()
            ]

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "read_only": True,
        "source_documents": {
            "total": len(documents), "duplicate_records": duplicates, "needs_text_or_ocr": no_text,
            "by_extraction_method": dict(methods), "by_course": dict(courses), "by_document_type": dict(doc_types),
        },
        "live_question_quality": question_quality,
        "retrieval_sample": {
            "sample_size": size, "outcomes": dict(retrieval),
            "by_course": {course: dict(counts) for course, counts in retrieval_by_course.items()},
            "examples_without_evidence": failures,
        },
    }
    config.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    config.CORPUS_AUDIT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
