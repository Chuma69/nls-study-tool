"""Shared Nigerian Law School course and topic taxonomy."""
from __future__ import annotations

import json
from pathlib import Path

TAXONOMY_PATH = Path(__file__).resolve().parents[2] / "app" / "data" / "course-topics.json"
COURSE_TOPICS: dict[str, dict[str, object]] = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
COURSE_IDS = tuple(COURSE_TOPICS)
COURSE_NAMES = {course_id: str(item["name"]) for course_id, item in COURSE_TOPICS.items()}
TOPICS_BY_COURSE = {course_id: tuple(str(topic) for topic in item["topics"]) for course_id, item in COURSE_TOPICS.items()}

def is_valid_topic(course: str | None, topic: str | None) -> bool:
    return bool(course and topic and topic in TOPICS_BY_COURSE.get(course, ()))
