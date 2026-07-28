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

MIGRATIONS_DIR: Path = INGESTION_ROOT.parent / "db" / "migrations"

# ── Secrets / connections ─────────────────────────────────────
DATABASE_URL: str | None = os.environ.get("DATABASE_URL")
OPENAI_API_KEY: str | None = os.environ.get("OPENAI_API_KEY")

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
# Keep model IDs in configuration rather than app logic. GPT-4o mini handles
# bulk document-to-JSON extraction; GPT-5.6 Terra is reserved for later
# grounded tutor/explanation reasoning.
MODEL_EXTRACTION = os.environ.get("MODEL_EXTRACTION", "gpt-4o-mini")
MODEL_REASONING = os.environ.get("MODEL_REASONING", "gpt-5.6-terra")

# GPT-4o mini list pricing, verified against OpenAI's model documentation on
# 2026-07-25. Kept in configuration so a pricing/model revision does not
# require changing extraction logic. Values are USD per million tokens.
EXTRACTION_INPUT_USD_PER_MTOK = float(
    os.environ.get("EXTRACTION_INPUT_USD_PER_MTOK", "0.15"))
EXTRACTION_OUTPUT_USD_PER_MTOK = float(
    os.environ.get("EXTRACTION_OUTPUT_USD_PER_MTOK", "0.60"))

# Question-extraction controls. The hard cap is enforced for every paid run;
# --approve-dry-run binds a run to the exact preceding dry-run report.
QUESTION_EXTRACTION_MAX_INPUT_TOKENS = int(
    os.environ.get("QUESTION_EXTRACTION_MAX_INPUT_TOKENS", "30000"))
QUESTION_EXTRACTION_MAX_OUTPUT_TOKENS = int(
    os.environ.get("QUESTION_EXTRACTION_MAX_OUTPUT_TOKENS", "16000"))
QUESTION_EXTRACTION_WORKERS = int(
    os.environ.get("QUESTION_EXTRACTION_WORKERS", "2"))
QUESTION_EXTRACTION_DEFAULT_CAP_USD = float(
    os.environ.get("QUESTION_EXTRACTION_DEFAULT_CAP_USD", "10.00"))
QUESTION_DRY_RUN_PATH: Path = BUILD_DIR / "question_extraction_dry_run.json"

# Materials-only MCQ verification controls. The source-provided key is never
# supplied to this pass. Six retrieved chunks are capped at the PRD's 8k token
# ceiling; the conservative estimate uses the observed p90 chunk size.
QUESTION_VERIFICATION_MODEL = os.environ.get("QUESTION_VERIFICATION_MODEL", MODEL_EXTRACTION)
QUESTION_VERIFICATION_WORKERS = int(os.environ.get("QUESTION_VERIFICATION_WORKERS", "2"))
QUESTION_VERIFICATION_DRY_RUN_PATH: Path = BUILD_DIR / "question_verification_dry_run.json"
QUESTION_VERIFICATION_MAX_CONTEXT_TOKENS = int(os.environ.get("QUESTION_VERIFICATION_MAX_CONTEXT_TOKENS", "8000"))
REASONING_INPUT_USD_PER_MTOK = float(os.environ.get("REASONING_INPUT_USD_PER_MTOK", "2.50"))
REASONING_OUTPUT_USD_PER_MTOK = float(os.environ.get("REASONING_OUTPUT_USD_PER_MTOK", "15.00"))
REASONING_PILOT_SIZE = int(os.environ.get("REASONING_PILOT_SIZE", "150"))
REASONING_PILOT_DRY_RUN_PATH: Path = BUILD_DIR / "reasoning_calibration_dry_run.json"
LIVE_ENRICHMENT_DRY_RUN_PATH: Path = BUILD_DIR / "live_question_enrichment_dry_run.json"
GENERAL_CLEANUP_DRY_RUN_PATH: Path = BUILD_DIR / "general_question_cleanup_dry_run.json"
CORPUS_AUDIT_PATH: Path = BUILD_DIR / "corpus_quality_audit.json"

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


def require_openai_key() -> str:
    if not OPENAI_API_KEY:
        raise SystemExit(
            "OPENAI_API_KEY is not set. Add it to ingestion/.env before running extraction."
        )
    return OPENAI_API_KEY
