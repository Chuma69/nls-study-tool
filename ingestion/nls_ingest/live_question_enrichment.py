"""Cost-gated course/topic enrichment and tutor-explanation refresh for live MCQs."""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone

from . import config, db
from .question_verify import _evidence
from .topic_taxonomy import COURSE_TOPICS, is_valid_topic

OUTPUT_TOKENS_PER_QUESTION = 900
LIVE_STATUSES = ("material_supported", "staff_corrected")

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["course", "topic", "explanation", "citation_chunk_ids"],
    "properties": {
        "course": {"type": "string", "enum": list(COURSE_TOPICS)},
        "topic": {"type": "string"},
        "explanation": {"type": "string"},
        "citation_chunk_ids": {"type": "array", "items": {"type": "integer"}},
    },
}

TAXONOMY = "\n\n".join(
    f"{item['name']} ({course_id}):\n" + "\n".join(f"- {topic}" for topic in item["topics"])
    for course_id, item in COURSE_TOPICS.items()
)

SYSTEM = f"""You are an expert Nigerian Law School Bar Finals tutor. Work only from the quoted study-material excerpts and the supplied answer key. Do not use outside knowledge and never fabricate legal authorities.

Assign exactly one course and exactly one official topic from this taxonomy:\n\n{TAXONOMY}

Write one concise tutor-style paragraph explaining why the supplied answer is right. It must begin with \"According to\" followed immediately by a statute, rule, regulation, order, article, or case expressly named in the excerpts. If no authority is named, begin \"According to the cited study materials\". Explain the rule in two or three sentences and end by connecting it to the supplied answer. Do not say \"the material says\", \"the correct answer is\", or \"option X is correct\". Select only excerpt IDs that directly support the explanation."""


def _rows():
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, stem, options, material_supported_key, course, topic, verification_status, explanation_version
                           FROM questions
                          WHERE question_type='mcq'
                            AND verification_status IN ('material_supported', 'staff_corrected')
                            AND material_supported_key IS NOT NULL
                          ORDER BY id""")
            return [{"id": row[0], "stem": row[1], "options": row[2], "key": row[3],
                     "course": row[4], "topic": row[5], "verification_status": row[6], "explanation_version": row[7]} for row in cur.fetchall()]


def _pending_rows():
    return [question for question in _rows() if (
        question["verification_status"] == "material_supported" and question["explanation_version"] != 2
    ) or (
        question["verification_status"] == "staff_corrected" and not question["topic"]
    )]


def _cost(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * config.REASONING_INPUT_USD_PER_MTOK + output_tokens * config.REASONING_OUTPUT_USD_PER_MTOK) / 1_000_000


def dry_run():
    rows = _pending_rows()
    # Estimate follows the observed high-reasoning calibration usage when available.
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT questions_processed, actual_input_tokens, actual_output_tokens
                           FROM reasoning_calibration_runs
                          WHERE questions_processed > 0
                          ORDER BY id DESC LIMIT 1""")
            observed = cur.fetchone()
    if observed:
        done, inp, out = observed
        input_tokens = round(len(rows) * inp / done)
        output_tokens = round(len(rows) * out / done)
        basis = "observed_reasoning_calibration_usage"
    else:
        input_tokens = len(rows) * 8500
        output_tokens = len(rows) * OUTPUT_TOKENS_PER_QUESTION
        basis = "conservative_context_allowance"
    report = {
        "report_id": hashlib.sha256(json.dumps({"ids": [row["id"] for row in rows], "model": config.MODEL_REASONING}, sort_keys=True).encode()).hexdigest()[:20],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": True,
        "model_id": config.MODEL_REASONING,
        "questions_planned": len(rows),
        "estimated_input_tokens": input_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_cost_usd": round(_cost(input_tokens, output_tokens), 4),
        "recommended_cap_usd": round(_cost(input_tokens, output_tokens) * 1.15, 2),
        "estimate_basis": basis,
        "method": "official course/topic assignment plus grounded tutor explanation; supplied live answer key retained; missing internal excerpt tags no longer discard an otherwise grounded result",
    }
    config.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    config.LIVE_ENRICHMENT_DRY_RUN_PATH.write_text(json.dumps(report, indent=2) + "\n")
    return report


def _one(question):
    from openai import OpenAI, RateLimitError
    try:
        for attempt in range(3):
            try:
                evidence = _evidence(question)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(5 * (attempt + 1))
        if not evidence:
            return question, None, 0, 0, "no_retrieval"
        source = "\n\n".join(f"[EXCERPT {item['id']}] {item['document']} {item['locator'] or ''}\n{item['content']}" for item in evidence)
        prompt = f"Question:\n{question['stem']}\n\nOptions:\n{json.dumps(question['options'], ensure_ascii=False)}\n\nSupplied live answer key: {question['key']}\n\n<study_materials>\n{source}\n</study_materials>"
        client = OpenAI(api_key=config.require_openai_key())
        for attempt in range(5):
            try:
                response = client.responses.create(
                    model=config.MODEL_REASONING, instructions=SYSTEM, input=prompt,
                    reasoning={"effort": "high"}, max_output_tokens=1500,
                    text={"verbosity": "medium", "format": {"type": "json_schema", "name": "live_mcq_enrichment", "strict": True, "schema": SCHEMA}},
                )
                break
            except RateLimitError:
                if attempt == 4:
                    raise
                time.sleep(min(60, 5 * (2 ** attempt)))
        payload = json.loads(response.output_text)
        if not is_valid_topic(payload["course"], payload["topic"]):
            return question, None, int(response.usage.input_tokens or 0), int(response.usage.output_tokens or 0), "invalid_taxonomy"
        allowed = {item["id"]: item for item in evidence}
        citations = [allowed[item] for item in payload["citation_chunk_ids"] if item in allowed]
        explanation = payload["explanation"].strip()
        if not explanation:
            return question, None, int(response.usage.input_tokens or 0), int(response.usage.output_tokens or 0), "missing_explanation"
        if not explanation.startswith("According to"):
            explanation = f"According to the cited study materials, {explanation[0].lower() + explanation[1:]}"
        result = {"course": payload["course"], "topic": payload["topic"], "explanation": explanation,
                  "citations": [{"chunk_id": item["id"], "document": item["document"], "locator": item["locator"]} for item in citations]}
        return question, result, int(response.usage.input_tokens or 0), int(response.usage.output_tokens or 0), None
    except Exception as exc:
        return question, None, 0, 0, type(exc).__name__


def run(approved_report_id: str, max_cost_usd: float):
    report = json.loads(config.LIVE_ENRICHMENT_DRY_RUN_PATH.read_text())
    if report["report_id"] != approved_report_id:
        raise RuntimeError("Approval ID does not match the latest live-question enrichment dry run.")
    if max_cost_usd < float(report["recommended_cap_usd"]):
        raise RuntimeError("Cap is below the recommended reserve.")
    rows = _pending_rows()
    if len(rows) != report["questions_planned"]:
        raise RuntimeError("The remaining live-question count changed; run a new dry-run before spending.")
    config.require_openai_key()
    spent = 0.0
    processed = enriched = skipped = 0
    for question in rows:
        if spent >= max_cost_usd:
            break
        question, result, inp, out, error = _one(question)
        spent += _cost(inp, out)
        processed += 1
        if result:
            with db.connect() as conn:
                with conn.cursor() as cur:
                    # Preserve an administrator's own answer/explanation. We only add the
                    # topic to those questions; materials-backed explanations can refresh.
                    if question["verification_status"] == "staff_corrected":
                        cur.execute("UPDATE questions SET course=%s, topic=%s, updated_at=now() WHERE id=%s", (result["course"], result["topic"], question["id"]))
                    else:
                        cur.execute("""UPDATE questions
                                          SET course=%s, topic=%s, explanation=%s,
                                              explanation_citations=%s::jsonb, explanation_version=2, updated_at=now()
                                        WHERE id=%s AND verification_status='material_supported'""",
                                    (result["course"], result["topic"], result["explanation"], json.dumps(result["citations"]), question["id"]))
            enriched += 1
        else:
            skipped += 1
        print(f"  enriched {processed}/{len(rows)}; {enriched} saved; {skipped} skipped; ${spent:.4f}", flush=True)
    return {"questions_processed": processed, "questions_enriched": enriched, "questions_skipped": skipped, "actual_cost_usd": round(spent, 6)}
