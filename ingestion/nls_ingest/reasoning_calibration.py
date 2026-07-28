"""Cost-gated calibration plan for stronger materials-only adjudication."""
from __future__ import annotations

import hashlib, json
from datetime import datetime, timezone
from . import config
from .question_verify import PROMPT_TOKENS, _chunk_stats, _clean_rows

# A reasoning adjudicator receives the same capped evidence but is allowed a
# structured issue map, option-by-option comparison, and a short explanation.
# This conservative output allowance includes its reasoning work.
PILOT_OUTPUT_TOKENS_PER_QUESTION = 1200

def dry_run(sample_size: int | None = None):
    rows = _clean_rows(skip_completed=False)
    size = min(sample_size or config.REASONING_PILOT_SIZE, len(rows))
    # Deterministic spread through the ordered corpus, so reruns estimate the
    # exact same representative pilot rather than cherry-picking easy items.
    selected = [rows[(i * len(rows)) // size] for i in range(size)] if size else []
    p90 = _chunk_stats()
    question_tokens = sum((len(q['stem']) + len(json.dumps(q['options'])) + 3) // 4 for q in selected)
    input_tokens = size * (min(config.QUESTION_VERIFICATION_MAX_CONTEXT_TOKENS, 6 * p90) + PROMPT_TOKENS) + question_tokens
    output_tokens = size * PILOT_OUTPUT_TOKENS_PER_QUESTION
    cost = (input_tokens * config.REASONING_INPUT_USD_PER_MTOK + output_tokens * config.REASONING_OUTPUT_USD_PER_MTOK) / 1_000_000
    signature = {"model": config.MODEL_REASONING, "ids": [q['id'] for q in selected], "input": input_tokens, "output": output_tokens}
    report = {"report_id": hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()[:20],
              "generated_at": datetime.now(timezone.utc).isoformat(), "dry_run": True,
              "model_id": config.MODEL_REASONING, "questions_planned": size,
              "estimated_input_tokens": input_tokens, "estimated_output_tokens": output_tokens,
              "estimated_cost_usd": round(cost, 4), "recommended_cap_usd": round(cost * 1.15, 2),
              "method": "issue map + option comparison + evidence-only adjudication; source answer keys withheld"}
    config.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    config.REASONING_PILOT_DRY_RUN_PATH.write_text(json.dumps(report, indent=2) + "\n")
    return report
