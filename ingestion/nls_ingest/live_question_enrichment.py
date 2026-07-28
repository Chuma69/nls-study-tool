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
            cur.execute("""SELECT id, stem, options, material_supported_key, course, topic,
                                  verification_status, explanation_version, explanation
                           FROM questions
                          WHERE question_type='mcq'
                            AND verification_status IN ('material_supported', 'staff_corrected')
                            AND material_supported_key IS NOT NULL
                          ORDER BY id""")
            return [{"id": row[0], "stem": row[1], "options": row[2], "key": row[3],
                     "course": row[4], "topic": row[5], "verification_status": row[6],
                     "explanation_version": row[7], "explanation": row[8]} for row in cur.fetchall()]


def _pending_rows():
    # Reprocess only records that fail the current live-content contract. Older
    # version numbers alone are not a reason to pay for another model call.
    return [question for question in _rows() if
            not is_valid_topic(question["course"], question["topic"])
            or not (question["explanation"] or "").strip()]


def _cost(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * config.REASONING_INPUT_USD_PER_MTOK + output_tokens * config.REASONING_OUTPUT_USD_PER_MTOK) / 1_000_000


def _progress(run_id, processed, enriched, skipped, input_tokens, output_tokens,
              spent, status="running", complete=False):
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE live_question_enrichment_runs
                      SET status=%s, questions_processed=%s,
                          questions_enriched=%s, questions_skipped=%s,
                          actual_input_tokens=%s, actual_output_tokens=%s,
                          actual_cost_usd=%s, completed_at=%s
                    WHERE id=%s""",
                (status, processed, enriched, skipped, input_tokens,
                 output_tokens, spent,
                 datetime.now(timezone.utc) if complete else None, run_id),
            )


def _record_item(run_id, question, result, input_tokens, output_tokens,
                 cost, error):
    status = "enriched" if result else ("skipped" if error in {
        "no_retrieval", "invalid_taxonomy", "missing_explanation"
    } else "failed")
    with db.connect() as conn:
        with conn.cursor() as cur:
            # Keep the content mutation and its audit record atomic. An upsert
            # makes a retry safe if a Neon connection drops around COMMIT.
            if result:
                if question["verification_status"] == "staff_corrected":
                    cur.execute(
                        "UPDATE questions SET course=%s, topic=%s, updated_at=now() WHERE id=%s",
                        (result["course"], result["topic"], question["id"]),
                    )
                else:
                    cur.execute(
                        """UPDATE questions
                              SET course=%s, topic=%s, explanation=%s,
                                  explanation_citations=%s::jsonb,
                                  explanation_version=2, updated_at=now()
                            WHERE id=%s AND verification_status='material_supported'""",
                        (result["course"], result["topic"], result["explanation"],
                         json.dumps(result["citations"]), question["id"]),
                    )
            cur.execute(
                """INSERT INTO live_question_enrichment_items
                       (run_id,question_id,status,assigned_course,assigned_topic,
                        input_tokens,output_tokens,actual_cost_usd,error_code)
                     VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                     ON CONFLICT (run_id,question_id) DO UPDATE SET
                       status=excluded.status,
                       assigned_course=excluded.assigned_course,
                       assigned_topic=excluded.assigned_topic,
                       input_tokens=excluded.input_tokens,
                       output_tokens=excluded.output_tokens,
                       actual_cost_usd=excluded.actual_cost_usd,
                       error_code=excluded.error_code""",
                (run_id, question["id"], status,
                 result["course"] if result else None,
                 result["topic"] if result else None,
                 input_tokens, output_tokens, cost, error),
            )
    return status


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
    input_tokens = output_tokens = 0
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
                input_tokens = int(response.usage.input_tokens or 0)
                output_tokens = int(response.usage.output_tokens or 0)
                break
            except RateLimitError:
                if attempt == 4:
                    raise
                time.sleep(min(60, 5 * (2 ** attempt)))
        payload = json.loads(response.output_text)
        if not is_valid_topic(payload["course"], payload["topic"]):
            return question, None, input_tokens, output_tokens, "invalid_taxonomy"
        allowed = {item["id"]: item for item in evidence}
        citations = [allowed[item] for item in payload["citation_chunk_ids"] if item in allowed]
        explanation = payload["explanation"].strip()
        if not explanation:
            return question, None, input_tokens, output_tokens, "missing_explanation"
        if not explanation.startswith("According to"):
            explanation = f"According to the cited study materials, {explanation[0].lower() + explanation[1:]}"
        result = {"course": payload["course"], "topic": payload["topic"], "explanation": explanation,
                  "citations": [{"chunk_id": item["id"], "document": item["document"], "locator": item["locator"]} for item in citations]}
        return question, result, input_tokens, output_tokens, None
    except Exception as exc:
        # A response may have been billed even when its payload later fails
        # validation or JSON decoding. Preserve that usage in the item ledger.
        return question, None, input_tokens, output_tokens, type(exc).__name__


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
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO live_question_enrichment_runs
                       (report_id,model_id,requested_cap_usd,
                        estimated_input_tokens,estimated_output_tokens,
                        estimated_cost_usd,questions_planned)
                     VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (approved_report_id, config.MODEL_REASONING, max_cost_usd,
                 report["estimated_input_tokens"], report["estimated_output_tokens"],
                 report["estimated_cost_usd"], len(rows)),
            )
            run_id = cur.fetchone()[0]

    spent = 0.0
    total_input = total_output = 0
    processed = enriched = skipped = 0
    run_status = "completed"
    try:
        for question in rows:
            if spent >= max_cost_usd:
                run_status = "stopped"
                break
            question, result, inp, out, error = _one(question)
            cost = _cost(inp, out)
            item_status = _record_item(
                run_id, question, result, inp, out, cost, error
            )
            spent += cost
            total_input += inp
            total_output += out
            processed += 1
            enriched += item_status == "enriched"
            skipped += item_status != "enriched"
            _progress(run_id, processed, enriched, skipped, total_input,
                      total_output, spent)
            print(
                f"  enriched {processed}/{len(rows)}; {enriched} saved; "
                f"{skipped} skipped; ${spent:.4f} (run {run_id})",
                flush=True,
            )
    except KeyboardInterrupt:
        run_status = "stopped"
        raise
    except Exception:
        run_status = "failed"
        raise
    finally:
        _progress(run_id, processed, enriched, skipped, total_input,
                  total_output, spent, status=run_status, complete=True)
    return {
        "run_id": run_id,
        "questions_processed": processed,
        "questions_enriched": enriched,
        "questions_skipped": skipped,
        "actual_input_tokens": total_input,
        "actual_output_tokens": total_output,
        "actual_cost_usd": round(spent, 6),
    }
