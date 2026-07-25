"""Configuration and shared constants for the ingestion pipeline."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load ingestion/.env if present.
_INGESTION_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_INGESTION_ROOT / ".env")

# ── Paths ─────────────────────────────────────────────────────
INGESTION_ROOT: Path = _INGESTION_ROOT
RAW_ZIPS_DIR: Path = INGESTION_ROOT / "raw_zips"
RAW_MATERIALS_DIR: Path = INGESTION_ROOT / "raw_materials"
BUILD_DIR: Path = INGESTION_ROOT / "build"
STATE_DIR: Path = INGESTION_ROOT / ".state"
KB_INDEX_PATH: Path = BUILD_DIR / "knowledge_base.sqlite"

# ── Codex extraction corpus (READ-ONLY; never modified) ───────
CORPUS_ROOT: Path = Path(os.environ.get(
    "NLS_CORPUS_ROOT", "/Users/raymondchuma-onwuoku/Claude/output"))
EXTRACTED_DIR: Path = CORPUS_ROOT / "extracted"
MANIFEST_PATH: Path = CORPUS_ROOT / "manifest.jsonl"
PAST_QUESTIONS_PATH: Path = CORPUS_ROOT / "past_questions.jsonl"
FAILURES_PATH: Path = CORPUS_ROOT / "failures.jsonl"

# Provider-neutral chunk artifact (consumed by the Neon loader).
CHUNK_ARTIFACT_PATH: Path = BUILD_DIR / "chunks.jsonl"
SOURCE_ARTIFACT_PATH: Path = BUILD_DIR / "source_documents.jsonl"

# ── Secrets / connections ─────────────────────────────────────
DATABASE_URL: str | None = os.environ.get("DATABASE_URL")
ANTHROPIC_API_KEY: str | None = os.environ.get("ANTHROPIC_API_KEY")

# ── Domain constants ──────────────────────────────────────────
# The five Bar Finals courses, plus 'general' for cross-cutting material.
COURSES = (
    "civil_litigation",
    "criminal_litigation",
    "corporate_law_practice",
    "property_law_practice",
    "professional_ethics_skills",
    "general",
)

DOC_TYPES = ("notes", "draft", "past_questions", "other")

# ── Model IDs ─────────────────────────────────────────────────
# PRD §2 / §12: VERIFY current model IDs + pricing at
# https://docs.claude.com/en/docs/about-claude/models before relying on these.
# Haiku for bulk MCQ extraction, Sonnet reserved for higher-stakes reasoning.
# These are placeholders confirmed in Phase 1/3 when Claude calls are wired up.
MODEL_EXTRACTION = os.environ.get("MODEL_EXTRACTION", "claude-haiku-4-5-20251001")
MODEL_REASONING = os.environ.get("MODEL_REASONING", "claude-sonnet-5")

# ── Chunking (PRD §5.4) ───────────────────────────────────────
CHUNK_TARGET_TOKENS = 650      # ~500–800 range
CHUNK_OVERLAP_TOKENS = 100
# Char-based approximation for chunking (~4 chars/token) — avoids a tokenizer
# dependency. 650 tokens ≈ 2600 chars, 100 overlap ≈ 400 chars.
CHUNK_TARGET_CHARS = CHUNK_TARGET_TOKENS * 4
CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP_TOKENS * 4

# ── File handling ─────────────────────────────────────────────
# Extensions we extract text from.
TEXT_EXTS = {".pdf", ".docx", ".doc", ".pptx", ".txt", ".rtf", ".md"}

# Parallelism for the CPU-bound extraction stage.
import os as _os
WORKERS = max(1, (_os.cpu_count() or 4) - 2)
# Per-file extraction timeout (seconds): guards against a pathological PDF
# stalling a worker forever.
FILE_TIMEOUT_SEC = 60

# Path fragments / names that are pure noise — never extracted.
JUNK_DIR_NAMES = {"__MACOSX"}
JUNK_NAME_PREFIXES = ("~$", "._", ".~")
JUNK_NAMES = {".DS_Store", "Thumbs.db"}
# Saved-webpage asset folders (e.g. "NLS STUDY GROUP_files/") are browser junk.
JUNK_DIR_SUFFIXES = ("_files",)

# A file whose direct text extraction yields fewer than this many characters
# is treated as scanned / image-only and flagged for OCR.
MIN_CHARS_FOR_TEXT = 200

# ── De-duplication ────────────────────────────────────────────
# Notes/knowledge chunks are de-duplicated by normalized-text hash so the same
# note appearing in many compilations is stored once. Past-question documents
# are NEVER pruned for breadth — only byte-identical duplicate FILES are skipped
# (by sha256), so every distinct paper/year is preserved.
DEDUP_CHUNKS = True


def require_database_url() -> str:
    if not DATABASE_URL:
        raise SystemExit(
            "DATABASE_URL is not set. Copy .env.example to ingestion/.env "
            "and paste your Neon connection string."
        )
    return DATABASE_URL


def require_anthropic_key() -> str:
    if not ANTHROPIC_API_KEY:
        raise SystemExit(
            "ANTHROPIC_API_KEY is not set. Copy .env.example to ingestion/.env "
            "and paste your Anthropic API key."
        )
    return ANTHROPIC_API_KEY
