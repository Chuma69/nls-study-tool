#!/usr/bin/env bash
# Full-corpus, text-first ingestion (no OCR). Logs everything to build/ingest.log.
set -euo pipefail
cd "$(dirname "$0")"

SRC="/Users/raymondchuma-onwuoku/Downloads/NLS STUDY TOOL Learning Materials.zip"
mkdir -p build
exec > >(tee -a build/ingest.log) 2>&1

echo "=== $(date) : copying source zip into raw_zips (8.7 GB) ==="
cp "$SRC" raw_zips/

echo "=== $(date) : activating venv ==="
source .venv/bin/activate

echo "=== $(date) : UNZIP (recursive) ==="
python -m nls_ingest.main unzip

echo "=== $(date) : BUILD (text-first, no OCR) ==="
python -m nls_ingest.main build 2>/dev/null

echo "=== $(date) : DONE ==="
