"""Cost-gated calibration plan for stronger materials-only adjudication."""
from __future__ import annotations

import hashlib, json, time
from datetime import datetime, timezone
from . import config
from .question_verify import PROMPT_TOKENS, _chunk_stats, _clean_rows, _evidence
from . import db

# A reasoning adjudicator receives the same capped evidence but is allowed a
# structured issue map, option-by-option comparison, and a short explanation.
# This conservative output allowance includes its reasoning work.
PILOT_OUTPUT_TOKENS_PER_QUESTION = 1200

SCHEMA = {"type":"object","additionalProperties":False,"required":["status","selected_key","issue_map","explanation","citation_chunk_ids"],"properties":{
    "status":{"type":"string","enum":["material_supported","material_conflicted","insufficient_material"]},
    "selected_key":{"type":["string","null"]}, "issue_map":{"type":"string"},
    "explanation":{"type":["string","null"]},
    "citation_chunk_ids":{"type":"array","items":{"type":"integer"}}}}
SYSTEM = """You are an expert Nigerian Law School Bar Finals tutor and careful legal-study evidence adjudicator. Work only from the quoted study-material excerpts; source answer keys are withheld.

First identify the legal issue and what each option claims. Then compare each option to the excerpts, including exceptions and conditions. Choose one option only where the cited excerpts clearly support it and no cited excerpt conflicts. If evidence conflicts return material_conflicted; if it cannot decide return insufficient_material.

For a supported answer, write one concise tutor-style paragraph. It must begin with "According to" followed immediately by the statute, rule, regulation, order, article, or case expressly identified in the excerpts. Explain the legal principle in two or three sentences and finish by connecting that principle to the selected option. Do not begin with "The correct answer is", "Option X is correct", or "This is because". Never invent or update a legal provision, rule, case citation, course, or topic from outside the excerpts. If the excerpts do not name an authority, begin "According to the cited study materials" rather than fabricating one. Cite only the excerpt IDs that directly support the explanation."""

def dry_run(sample_size: int | None = None):
    rows = _clean_rows(skip_completed=False)
    size = min(sample_size or config.REASONING_PILOT_SIZE, len(rows))
    # Deterministic spread through the ordered corpus, so reruns estimate the
    # exact same representative pilot rather than cherry-picking easy items.
    selected = [rows[(i * len(rows)) // size] for i in range(size)] if size else []
    p90 = _chunk_stats()
    question_tokens = sum((len(q['stem']) + len(json.dumps(q['options'])) + 3) // 4 for q in selected)
    # For full-bank estimates, use the completed pilot's observed per-question
    # usage. The original p90/1,200-token budget remains the conservative
    # estimate for an untested small pilot.
    with db.connect() as conn:
      with conn.cursor() as cur:
        cur.execute("SELECT questions_processed,actual_input_tokens,actual_output_tokens FROM reasoning_calibration_runs WHERE status IN ('completed','stopped') AND questions_processed>0 ORDER BY id DESC LIMIT 1")
        observed = cur.fetchone()
    if observed and size > config.REASONING_PILOT_SIZE:
        processed, observed_in, observed_out = observed
        input_tokens = round(size * (observed_in / processed))
        output_tokens = round(size * (observed_out / processed))
        estimate_basis = "completed_pilot_observed_usage"
    else:
        input_tokens = size * (min(config.QUESTION_VERIFICATION_MAX_CONTEXT_TOKENS, 6 * p90) + PROMPT_TOKENS) + question_tokens
        output_tokens = size * PILOT_OUTPUT_TOKENS_PER_QUESTION
        estimate_basis = "conservative_p90_context"
    cost = (input_tokens * config.REASONING_INPUT_USD_PER_MTOK + output_tokens * config.REASONING_OUTPUT_USD_PER_MTOK) / 1_000_000
    signature = {"model": config.MODEL_REASONING, "ids": [q['id'] for q in selected], "input": input_tokens, "output": output_tokens}
    report = {"report_id": hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()[:20],
              "generated_at": datetime.now(timezone.utc).isoformat(), "dry_run": True,
              "model_id": config.MODEL_REASONING, "questions_planned": size,
              "estimated_input_tokens": input_tokens, "estimated_output_tokens": output_tokens,
              "estimated_cost_usd": round(cost, 4), "recommended_cap_usd": round(cost * 1.15, 2),
              "estimate_basis": estimate_basis,
              "method": "issue map + option comparison + evidence-only adjudication; source answer keys withheld"}
    config.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    config.REASONING_PILOT_DRY_RUN_PATH.write_text(json.dumps(report, indent=2) + "\n")
    return report

def _sample(size):
    rows = _clean_rows(skip_completed=False); size = min(size, len(rows))
    return [rows[(i * len(rows)) // size] for i in range(size)] if size else []

def _cost(inp, out):
    return (inp * config.REASONING_INPUT_USD_PER_MTOK + out * config.REASONING_OUTPUT_USD_PER_MTOK) / 1_000_000

def _one(question):
    from openai import OpenAI, RateLimitError
    try:
        # Neon connections can occasionally time out mid-run. Retrying the
        # evidence lookup avoids throwing away an otherwise recoverable run.
        for attempt in range(3):
            try:
                evidence = _evidence(question)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(5 * (attempt + 1))
        if not evidence: return question, None, 0, 0, "no_retrieval"
        source = "\n\n".join(f"[EXCERPT {x['id']}] {x['document']} {x['locator'] or ''}\n{x['content']}" for x in evidence)
        prompt = f"Question:\n{question['stem']}\n\nOptions:\n{json.dumps(question['options'],ensure_ascii=False)}\n\n<study_materials>\n{source}\n</study_materials>"
        client = OpenAI(api_key=config.require_openai_key())
        for attempt in range(5):
            try:
                response = client.responses.create(model=config.MODEL_REASONING, instructions=SYSTEM, input=prompt,
                    reasoning={"effort":"high"}, max_output_tokens=1800, text={"verbosity":"medium","format":{"type":"json_schema","name":"reasoned_mcq_adjudication","strict":True,"schema":SCHEMA}})
                break
            except RateLimitError:
                if attempt == 4: raise
                time.sleep(min(60, 5 * (2 ** attempt)))
        payload = json.loads(response.output_text)
        allowed = {x['id']:x for x in evidence}; keys = {str(o.get('key')) for o in question['options']}
        citations = [allowed[x] for x in payload['citation_chunk_ids'] if x in allowed]
        if payload['status'] != 'material_supported' or payload['selected_key'] not in keys or not citations:
            payload['status'] = 'insufficient_material' if payload['status'] != 'material_conflicted' else 'material_conflicted'
            payload['selected_key'] = None; payload['explanation'] = None; citations = []
        result = {"status":payload['status'], "key":payload['selected_key'], "issue_map":payload['issue_map'],
                  "explanation":payload['explanation'], "citations":[{"chunk_id":x['id'],"document":x['document'],"locator":x['locator']} for x in citations]}
        usage = response.usage
        return question, result, int(usage.input_tokens or 0), int(usage.output_tokens or 0), None
    except Exception as exc: return question, None, 0, 0, type(exc).__name__

def _progress(run_id: int, processed: int, input_tokens: int, output_tokens: int, spent: float, status: str = "running", complete: bool = False):
    with db.connect() as conn:
      with conn.cursor() as cur:
        cur.execute("UPDATE reasoning_calibration_runs SET status=%s,questions_processed=%s,actual_input_tokens=%s,actual_output_tokens=%s,actual_cost_usd=%s,completed_at=%s WHERE id=%s",
                    (status, processed, input_tokens, output_tokens, spent, datetime.now(timezone.utc) if complete else None, run_id))

def run(approved_report_id: str, max_cost_usd: float, sample_size: int | None = None, promote: bool = False, resume_run_id: int | None = None):
    report = json.loads(config.REASONING_PILOT_DRY_RUN_PATH.read_text())
    if report['report_id'] != approved_report_id: raise RuntimeError('Approval ID does not match the latest reasoning-pilot dry run.')
    if max_cost_usd < float(report['recommended_cap_usd']): raise RuntimeError('Cap is below the approved pilot reserve.')
    all_questions = _sample(sample_size or report['questions_planned']); config.require_openai_key()
    with db.connect() as conn:
      with conn.cursor() as cur:
        if resume_run_id:
            cur.execute("SELECT report_id,requested_cap_usd,questions_planned FROM reasoning_calibration_runs WHERE id=%s FOR UPDATE", (resume_run_id,))
            prior = cur.fetchone()
            if not prior: raise RuntimeError('That calibration run does not exist.')
            if prior[0] != approved_report_id or prior[2] != len(all_questions): raise RuntimeError('The saved run does not match this approved calibration report.')
            if max_cost_usd < float(prior[1]): raise RuntimeError('Use at least the original approved spend cap when resuming.')
            run_id = resume_run_id
            cur.execute("SELECT question_id FROM reasoning_calibration_items WHERE run_id=%s", (run_id,))
            saved_ids = {row[0] for row in cur.fetchall()}
            cur.execute("SELECT COUNT(*)::int,COALESCE(SUM(input_tokens),0)::int,COALESCE(SUM(output_tokens),0)::int,COALESCE(SUM(actual_cost_usd),0) FROM reasoning_calibration_items WHERE run_id=%s", (run_id,))
            done, total_i, total_o, spent = cur.fetchone()
            questions = [question for question in all_questions if question['id'] not in saved_ids]
        else:
            cur.execute("INSERT INTO reasoning_calibration_runs(report_id,model_id,requested_cap_usd,questions_planned) VALUES(%s,%s,%s,%s) RETURNING id",(approved_report_id,config.MODEL_REASONING,max_cost_usd,len(all_questions)))
            run_id=cur.fetchone()[0]
            questions = all_questions
            total_i=total_o=done=0; spent=0.0
    if resume_run_id:
        print(f"  resuming {done}/{len(all_questions)}; ${spent:.4f} already recorded", flush=True)
    status = 'completed'
    try:
      for q in questions:
        if spent >= max_cost_usd:
            status = 'stopped'
            break
        q,result,inp,out,error=_one(q); cost=_cost(inp,out)
        with db.connect() as conn:
          with conn.cursor() as cur:
            cur.execute("INSERT INTO reasoning_calibration_items(run_id,question_id,status,selected_key,explanation,citations,input_tokens,output_tokens,actual_cost_usd,error_code) VALUES(%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)",(run_id,q['id'],result['status'] if result else 'failed',result['key'] if result else None,result['explanation'] if result else None,json.dumps(result['citations']) if result else '[]',inp,out,cost,error))
            if promote and result:
                cur.execute("UPDATE questions SET material_supported_key=%s,verification_status=%s,explanation=%s,explanation_version=1,explanation_citations=%s::jsonb,updated_at=now() WHERE id=%s AND verification_status<>'staff_corrected'",(result['key'],result['status'],result['explanation'],json.dumps(result['citations']),q['id']))
        total_i+=inp; total_o+=out; spent+=cost; done+=1
        _progress(run_id, done, total_i, total_o, spent)
        print(f"  calibrated {done}/{len(all_questions)}; ${spent:.4f}",flush=True)
    except KeyboardInterrupt:
      status = 'stopped'
      raise
    finally:
      _progress(run_id, done, total_i, total_o, spent, status=status, complete=True)
    return {"questions_processed":done,"actual_input_tokens":total_i,"actual_output_tokens":total_o,"actual_cost_usd":round(spent,6)}
