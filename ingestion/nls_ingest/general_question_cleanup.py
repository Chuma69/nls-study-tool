"""Cost-gated cleanup of live MCQs that are still assigned to ``general``."""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone

from . import config, db
from .question_verify import _evidence
from .topic_taxonomy import COURSE_TOPICS, is_valid_topic

LIVE_STATUSES = ("material_supported", "staff_corrected")
OUTPUT_TOKENS_PER_QUESTION = 1200

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "course",
        "topic",
        "status",
        "selected_key",
        "explanation",
        "citation_chunk_ids",
    ],
    "properties": {
        "course": {"type": "string", "enum": list(COURSE_TOPICS)},
        "topic": {"type": "string"},
        "status": {
            "type": "string",
            "enum": [
                "material_supported",
                "material_conflicted",
                "insufficient_material",
            ],
        },
        "selected_key": {"type": ["string", "null"]},
        "explanation": {"type": ["string", "null"]},
        "citation_chunk_ids": {
            "type": "array",
            "items": {"type": "integer"},
        },
    },
}

TAXONOMY = "\n\n".join(
    f"{item['name']} ({course_id}):\n"
    + "\n".join(f"- {topic}" for topic in item["topics"])
    for course_id, item in COURSE_TOPICS.items()
)

SYSTEM = f"""You are an expert Nigerian Law School Bar Finals tutor and a careful legal-study evidence adjudicator. Work only from the quoted study-material excerpts. Never fabricate or modernise a legal authority.

Assign exactly one course and one official topic from this taxonomy:

{TAXONOMY}

For a materials-backed question, independently compare every option with the excerpts. Return material_supported only when one option is directly supported and the cited excerpts do not conflict. Otherwise return material_conflicted or insufficient_material and leave selected_key, explanation, and citations empty.

For a supported answer, write one concise tutor-style paragraph. Begin with "According to" followed by an authority expressly named in the excerpts, or "According to the cited study materials" if none is named. Explain the rule in two or three sentences and connect it to the answer text without saying "Option X is correct" or "the material says". Cite only excerpt IDs that directly support the answer.

If the prompt says the answer was corrected by an administrator, preserve that answer and explanation. In that case, use the excerpts only to assign the closest official course and topic."""


def _rows():
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id,stem,options,material_supported_key,course,topic,
                          verification_status,explanation
                     FROM questions
                    WHERE question_type='mcq'
                      AND verification_status IN ('material_supported','staff_corrected')
                      AND material_supported_key IS NOT NULL
                      AND (course='general' OR course IS NULL OR course='')
                    ORDER BY id"""
            )
            return [
                {
                    "id": row[0],
                    "stem": row[1],
                    "options": row[2],
                    "key": row[3],
                    "course": row[4],
                    "topic": row[5],
                    "verification_status": row[6],
                    "explanation": row[7],
                }
                for row in cur.fetchall()
            ]


def _cost(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * config.REASONING_INPUT_USD_PER_MTOK
        + output_tokens * config.REASONING_OUTPUT_USD_PER_MTOK
    ) / 1_000_000


def dry_run():
    rows = _rows()
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT questions_processed,actual_input_tokens,actual_output_tokens
                     FROM reasoning_calibration_runs
                    WHERE questions_processed > 0
                    ORDER BY id DESC LIMIT 1"""
            )
            observed = cur.fetchone()
    if observed:
        done, observed_input, observed_output = observed
        input_tokens = round(len(rows) * observed_input / done)
        output_tokens = round(len(rows) * observed_output / done)
        estimate_basis = "observed_reasoning_usage"
    else:
        input_tokens = len(rows) * 8500
        output_tokens = len(rows) * OUTPUT_TOKENS_PER_QUESTION
        estimate_basis = "conservative_context_allowance"
    cost = _cost(input_tokens, output_tokens)
    signature = {
        "ids": [row["id"] for row in rows],
        "model": config.MODEL_REASONING,
        "method_version": 1,
    }
    report = {
        "report_id": hashlib.sha256(
            json.dumps(signature, sort_keys=True).encode()
        ).hexdigest()[:20],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": True,
        "model_id": config.MODEL_REASONING,
        "questions_planned": len(rows),
        "staff_corrected_protected": sum(
            row["verification_status"] == "staff_corrected" for row in rows
        ),
        "materials_answers_rechecked": sum(
            row["verification_status"] == "material_supported" for row in rows
        ),
        "estimated_input_tokens": input_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_cost_usd": round(cost, 4),
        "recommended_cap_usd": round(cost * 1.15, 2),
        "estimate_basis": estimate_basis,
        "method": (
            "Assign an official course/topic to every live general MCQ; "
            "independently recheck materials-backed answers; protect "
            "administrator-corrected answers; remove unsupported results from live."
        ),
    }
    config.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    config.GENERAL_CLEANUP_DRY_RUN_PATH.write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def _one(question):
    from openai import OpenAI, RateLimitError

    try:
        for attempt in range(4):
            try:
                evidence = _evidence(question)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(5 * (attempt + 1))
        if not evidence:
            return question, None, 0, 0, "no_retrieval"

        source = "\n\n".join(
            f"[EXCERPT {item['id']}] {item['document']} "
            f"{item['locator'] or ''}\n{item['content']}"
            for item in evidence
        )
        protected = question["verification_status"] == "staff_corrected"
        protection = (
            "\n\nThis answer was corrected by an administrator and must be preserved."
            f"\nPreserved answer: {question['key']}"
            f"\nPreserved explanation: {question['explanation'] or ''}"
            if protected
            else "\n\nNo answer key is supplied. Decide from the excerpts."
        )
        prompt = (
            f"Question:\n{question['stem']}\n\nOptions:\n"
            f"{json.dumps(question['options'], ensure_ascii=False)}"
            f"{protection}\n\n<study_materials>\n{source}\n</study_materials>"
        )
        client = OpenAI(api_key=config.require_openai_key())
        for attempt in range(5):
            try:
                response = client.responses.create(
                    model=config.MODEL_REASONING,
                    instructions=SYSTEM,
                    input=prompt,
                    reasoning={"effort": "high"},
                    max_output_tokens=1800,
                    text={
                        "verbosity": "medium",
                        "format": {
                            "type": "json_schema",
                            "name": "general_live_mcq_cleanup",
                            "strict": True,
                            "schema": SCHEMA,
                        },
                    },
                )
                break
            except RateLimitError as exc:
                if getattr(exc, "code", None) == "insufficient_quota":
                    return question, None, 0, 0, "insufficient_quota"
                if attempt == 4:
                    raise
                time.sleep(min(60, 5 * (2**attempt)))

        usage = response.usage
        input_tokens = int(usage.input_tokens or 0)
        output_tokens = int(usage.output_tokens or 0)
        payload = json.loads(response.output_text)
        if not is_valid_topic(payload["course"], payload["topic"]):
            return question, None, input_tokens, output_tokens, "invalid_taxonomy"

        if protected:
            return (
                question,
                {
                    "course": payload["course"],
                    "topic": payload["topic"],
                    "status": "staff_corrected",
                    "key": question["key"],
                    "explanation": question["explanation"],
                    "citations": [],
                },
                input_tokens,
                output_tokens,
                None,
            )

        allowed = {item["id"]: item for item in evidence}
        keys = {str(option.get("key")) for option in question["options"]}
        citations = [
            allowed[chunk_id]
            for chunk_id in payload["citation_chunk_ids"]
            if chunk_id in allowed
        ]
        supported = (
            payload["status"] == "material_supported"
            and payload["selected_key"] in keys
            and bool(payload["explanation"])
            and bool(citations)
        )
        status = (
            "material_supported"
            if supported
            else (
                "material_conflicted"
                if payload["status"] == "material_conflicted"
                else "insufficient_material"
            )
        )
        return (
            question,
            {
                "course": payload["course"],
                "topic": payload["topic"],
                "status": status,
                "key": payload["selected_key"] if supported else None,
                "explanation": payload["explanation"] if supported else None,
                "citations": [
                    {
                        "chunk_id": item["id"],
                        "document": item["document"],
                        "locator": item["locator"],
                    }
                    for item in citations
                ]
                if supported
                else [],
            },
            input_tokens,
            output_tokens,
            None,
        )
    except Exception as exc:
        return question, None, 0, 0, type(exc).__name__


def _update_progress(
    run_id: int,
    processed: int,
    input_tokens: int,
    output_tokens: int,
    spent: float,
    status: str = "running",
    complete: bool = False,
):
    for attempt in range(4):
        try:
            with db.connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """UPDATE reasoning_calibration_runs
                              SET status=%s,questions_processed=%s,
                                  actual_input_tokens=%s,actual_output_tokens=%s,
                                  actual_cost_usd=%s,completed_at=%s
                            WHERE id=%s""",
                        (
                            status,
                            processed,
                            input_tokens,
                            output_tokens,
                            spent,
                            datetime.now(timezone.utc) if complete else None,
                            run_id,
                        ),
                    )
            return
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def run(
    approved_report_id: str,
    max_cost_usd: float,
    resume_run_id: int | None = None,
):
    report = json.loads(
        config.GENERAL_CLEANUP_DRY_RUN_PATH.read_text(encoding="utf-8")
    )
    if report["report_id"] != approved_report_id:
        raise RuntimeError("Approval ID does not match the latest cleanup dry run.")
    if max_cost_usd < float(report["recommended_cap_usd"]):
        raise RuntimeError("Cap is below the recommended reserve.")
    all_questions = _rows()
    config.require_openai_key()

    with db.connect() as conn:
        with conn.cursor() as cur:
            if resume_run_id:
                cur.execute(
                    """SELECT report_id,requested_cap_usd,questions_planned
                         FROM reasoning_calibration_runs
                        WHERE id=%s FOR UPDATE""",
                    (resume_run_id,),
                )
                prior = cur.fetchone()
                if not prior:
                    raise RuntimeError("That cleanup run does not exist.")
                if (
                    prior[0] != approved_report_id
                    or prior[2] != report["questions_planned"]
                ):
                    raise RuntimeError(
                        "The saved run does not match this approved cleanup report."
                    )
                if max_cost_usd < float(prior[1]):
                    raise RuntimeError(
                        "Use at least the original approved cap when resuming."
                    )
                run_id = resume_run_id
                # Zero-token failures (for example an exhausted API balance)
                # were never processed and must be retried on resume.
                cur.execute(
                    """SELECT question_id FROM reasoning_calibration_items
                        WHERE run_id=%s AND status<>'failed'""",
                    (run_id,),
                )
                saved_ids = {row[0] for row in cur.fetchall()}
                cur.execute(
                    """DELETE FROM reasoning_calibration_items
                        WHERE run_id=%s AND status='failed'""",
                    (run_id,),
                )
                cur.execute(
                    """SELECT COUNT(*)::int,COALESCE(SUM(input_tokens),0)::int,
                              COALESCE(SUM(output_tokens),0)::int,
                              COALESCE(SUM(actual_cost_usd),0)
                         FROM reasoning_calibration_items WHERE run_id=%s""",
                    (run_id,),
                )
                done, total_input, total_output, spent = cur.fetchone()
                questions = [
                    question
                    for question in all_questions
                    if question["id"] not in saved_ids
                ]
            else:
                if len(all_questions) != report["questions_planned"]:
                    raise RuntimeError(
                        "The number of general live questions changed; run a new dry run."
                    )
                cur.execute(
                    """INSERT INTO reasoning_calibration_runs
                              (report_id,model_id,requested_cap_usd,questions_planned)
                       VALUES(%s,%s,%s,%s) RETURNING id""",
                    (
                        approved_report_id,
                        config.MODEL_REASONING,
                        max_cost_usd,
                        len(all_questions),
                    ),
                )
                run_id = cur.fetchone()[0]
                questions = all_questions
                done = total_input = total_output = 0
                spent = 0.0

    if resume_run_id:
        print(
            f"  resuming {done}/{report['questions_planned']}; "
            f"${float(spent):.4f} already recorded",
            flush=True,
        )

    final_status = "completed"
    try:
        for question in questions:
            if float(spent) >= max_cost_usd:
                final_status = "stopped"
                break
            question, result, input_tokens, output_tokens, error = _one(question)
            if error == "insufficient_quota":
                final_status = "stopped"
                print(
                    "  stopped: OpenAI API balance is exhausted; "
                    "add credits, then resume this run.",
                    flush=True,
                )
                break
            cost = _cost(input_tokens, output_tokens)
            for attempt in range(4):
                try:
                    with db.connect() as conn:
                        with conn.cursor() as cur:
                            cur.execute(
                                """INSERT INTO reasoning_calibration_items
                                          (run_id,question_id,status,selected_key,
                                           explanation,citations,input_tokens,
                                           output_tokens,actual_cost_usd,error_code)
                                   VALUES(%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)""",
                                (
                                    run_id,
                                    question["id"],
                                    result["status"] if result else "failed",
                                    result["key"] if result else None,
                                    result["explanation"] if result else None,
                                    json.dumps(result["citations"])
                                    if result
                                    else "[]",
                                    input_tokens,
                                    output_tokens,
                                    cost,
                                    error,
                                ),
                            )
                            if result and result["status"] == "staff_corrected":
                                cur.execute(
                                    """UPDATE questions SET course=%s,topic=%s,
                                              updated_at=now() WHERE id=%s
                                         AND verification_status='staff_corrected'""",
                                    (
                                        result["course"],
                                        result["topic"],
                                        question["id"],
                                    ),
                                )
                            elif result and result["status"] == "material_supported":
                                cur.execute(
                                    """UPDATE questions SET course=%s,topic=%s,
                                              material_supported_key=%s,
                                              verification_status='material_supported',
                                              explanation=%s,explanation_version=3,
                                              explanation_citations=%s::jsonb,
                                              updated_at=now()
                                        WHERE id=%s
                                          AND verification_status='material_supported'""",
                                    (
                                        result["course"],
                                        result["topic"],
                                        result["key"],
                                        result["explanation"],
                                        json.dumps(result["citations"]),
                                        question["id"],
                                    ),
                                )
                            elif result:
                                cur.execute(
                                    """UPDATE questions SET course=%s,topic=%s,
                                              verification_status=%s,updated_at=now()
                                        WHERE id=%s
                                          AND verification_status='material_supported'""",
                                    (
                                        result["course"],
                                        result["topic"],
                                        result["status"],
                                        question["id"],
                                    ),
                                )
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(5 * (attempt + 1))
            total_input += input_tokens
            total_output += output_tokens
            spent = float(spent) + cost
            done += 1
            _update_progress(
                run_id, done, total_input, total_output, spent
            )
            print(
                f"  cleaned {done}/{report['questions_planned']}; "
                f"${spent:.4f}",
                flush=True,
            )
    except KeyboardInterrupt:
        final_status = "stopped"
        raise
    finally:
        _update_progress(
            run_id,
            done,
            total_input,
            total_output,
            float(spent),
            status=final_status,
            complete=True,
        )
    return {
        "run_id": run_id,
        "questions_processed": done,
        "actual_input_tokens": total_input,
        "actual_output_tokens": total_output,
        "actual_cost_usd": round(float(spent), 6),
    }
