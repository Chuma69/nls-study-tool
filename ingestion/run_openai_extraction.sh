#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
source .venv/bin/activate
exec python -u -m nls_ingest.main extract-questions \
  --approve-dry-run 7b0b75cef9def02fb00f \
  --max-cost-usd 4.78
