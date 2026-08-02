import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireRole("admin");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200);
  const course = (url.searchParams.get("course") ?? "").trim();
  const structure = (url.searchParams.get("structure") ?? "scenario").trim();
  const contextGroupId = (url.searchParams.get("contextGroupId") ?? "").trim();
  const standaloneCandidates = url.searchParams.get("standaloneCandidates") === "true";
  const excludeQuestionId = Number(url.searchParams.get("excludeQuestionId"));
  const pattern = `%${search}%`;
  if (standaloneCandidates) {
    if (!course || course === "general") return NextResponse.json({ error: "Assign this question to a course before creating a group." }, { status: 400 });
    const questions = await getSql()`
      SELECT q.id,q.stem,q.topic,q.verification_status,q.context_group_id,q.context_position
      FROM questions q
      WHERE q.question_type='mcq'
        AND q.context_group_id IS NULL
        AND q.course=${course}
        AND (${Number.isSafeInteger(excludeQuestionId)}=false OR q.id<>${Number.isSafeInteger(excludeQuestionId) ? excludeQuestionId : 0})
        AND (${search}='' OR q.stem ILIKE ${pattern})
      ORDER BY CASE WHEN q.verification_status IN ('material_supported','staff_corrected') THEN 0 ELSE 1 END,q.id DESC
      LIMIT 50
    `;
    return NextResponse.json({ questions });
  }
  if (contextGroupId) {
    const scenario = await getSql()`
      SELECT context_group_id,
             max(NULLIF(NULLIF(trim(course),''),'general')) AS course
      FROM questions
      WHERE context_group_id=${contextGroupId}
      GROUP BY context_group_id
      LIMIT 1
    ` as { context_group_id: string; course: string | null }[];
    if (!scenario.length) return NextResponse.json({ error: "The question set could not be found." }, { status: 404 });
    const linkedQuestions = await getSql()`
      SELECT q.id,q.course,q.stem,q.topic,q.verification_status,q.context_group_id,q.context_position,
             q.shared_context,q.options,q.material_supported_key,q.explanation
      FROM questions q
      WHERE q.question_type='mcq' AND q.context_group_id=${contextGroupId}
      ORDER BY q.context_position NULLS LAST,q.id
    `;
    const questions = await getSql()`
      SELECT q.id,q.stem,q.topic,q.verification_status,q.context_group_id
      FROM questions q
      WHERE q.question_type='mcq'
        AND (
          q.course=${scenario[0].course}
          OR NULLIF(NULLIF(trim(q.course),''),'general') IS NULL
        )
        AND q.context_group_id IS NULL
        AND (${search}='' OR q.stem ILIKE ${pattern})
      ORDER BY CASE WHEN q.verification_status IN ('material_supported','staff_corrected') THEN 0 ELSE 1 END,q.id DESC
      LIMIT 20
    `;
    const setStructure = linkedQuestions.some((question: { shared_context?: string | null }) => question.shared_context?.trim()) ? "scenario" : "group";
    return NextResponse.json({ questions, linkedQuestions, structure: setStructure });
  }
  if (!["scenario", "group"].includes(structure)) return NextResponse.json({ error: "Unknown question structure." }, { status: 400 });
  const scenarios = await getSql()`
    SELECT q.context_group_id, max(q.shared_context) AS shared_context,
           max(q.course) AS course, count(*)::int AS question_count
    FROM questions q
    WHERE q.question_type='mcq' AND q.context_group_id IS NOT NULL
      AND ((${structure}='scenario' AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NOT NULL) OR (${structure}='group' AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NULL))
      AND (${course}='' OR q.course=${course})
      AND (${search}='' OR q.shared_context ILIKE ${pattern} OR q.stem ILIKE ${pattern})
    GROUP BY q.context_group_id ORDER BY max(q.updated_at) DESC LIMIT 20
  `;
  return NextResponse.json({ scenarios });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin");
  if (auth.response) return auth.response;
  const body = await request.json() as { questionId?: number; contextGroupId?: string; action?: "reorder" | "detach"; questionIds?: number[]; sharedContext?: string };
  const questionId = Number(body.questionId);
  const contextGroupId = (body.contextGroupId ?? "").trim();
  if (!contextGroupId) return NextResponse.json({ error: "Choose a question set." }, { status: 400 });
  if (body.action === "reorder") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 100);
    const existing = await getSql()`SELECT id FROM questions WHERE context_group_id=${contextGroupId}` as { id: number }[];
    if (!questionIds.length || existing.length !== questionIds.length || existing.some((row) => !questionIds.includes(Number(row.id)))) return NextResponse.json({ error: "The question order does not match its linked questions." }, { status: 400 });
    const sharedContext = (body.sharedContext ?? "").trim() || null;
    await getSql()`UPDATE questions q SET context_position=chosen.position,shared_context=${sharedContext},updated_at=now() FROM (SELECT value::bigint AS id,ordinality::int AS position FROM jsonb_array_elements_text(${JSON.stringify(questionIds)}::jsonb) WITH ORDINALITY) chosen WHERE q.id=chosen.id AND q.context_group_id=${contextGroupId}`;
    return NextResponse.json({ ok: true });
  }
  if (!Number.isSafeInteger(questionId)) return NextResponse.json({ error: "Choose a question." }, { status: 400 });
  if (body.action === "detach") {
    const linked = await getSql()`SELECT id FROM questions WHERE id=${questionId} AND context_group_id=${contextGroupId} LIMIT 1`;
    if (!linked.length) return NextResponse.json({ error: "This question is not linked to the set." }, { status: 404 });
    await getSql()`UPDATE questions SET context_group_id=NULL,shared_context=NULL,context_position=NULL,updated_at=now() WHERE id=${questionId} AND context_group_id=${contextGroupId}`;
    const remaining = await getSql()`SELECT id FROM questions WHERE context_group_id=${contextGroupId} ORDER BY context_position NULLS LAST,id` as { id: number }[];
    if (remaining.length) {
      await getSql()`UPDATE questions q SET context_position=chosen.position,updated_at=now() FROM (SELECT value::bigint AS id,ordinality::int AS position FROM jsonb_array_elements_text(${JSON.stringify(remaining.map((row) => row.id))}::jsonb) WITH ORDINALITY) chosen WHERE q.id=chosen.id`;
    }
    return NextResponse.json({ ok: true });
  }

  const question = await getSql()`SELECT id,NULLIF(NULLIF(trim(course),''),'general') AS course FROM questions WHERE id=${questionId} AND question_type='mcq' LIMIT 1` as { id: number; course: string | null }[];
  const scenario = await getSql()`
    SELECT context_group_id,
           max(shared_context) FILTER (WHERE NULLIF(trim(shared_context),'') IS NOT NULL) AS shared_context,
           max(NULLIF(NULLIF(trim(course),''),'general')) AS course
    FROM questions
    WHERE context_group_id=${contextGroupId}
    GROUP BY context_group_id
    LIMIT 1
  ` as { context_group_id: string; shared_context: string; course: string | null }[];
  if (!question.length || !scenario.length) return NextResponse.json({ error: "The question or question set could not be found." }, { status: 404 });
  if (question[0].course && scenario[0].course && question[0].course !== scenario[0].course) return NextResponse.json({ error: "A question can only join a set from the same course." }, { status: 400 });

  const positions = await getSql()`SELECT COALESCE(max(context_position),0)::int AS position FROM questions WHERE context_group_id=${contextGroupId}` as { position: number }[];
  await getSql()`
    UPDATE questions
    SET context_group_id=${contextGroupId},
        shared_context=${scenario[0].shared_context},
        context_position=${(positions[0]?.position ?? 0) + 1},
        course=CASE
          WHEN NULLIF(NULLIF(trim(course),''),'general') IS NULL THEN ${scenario[0].course}
          ELSE course
        END,
        updated_at=now()
    WHERE id=${questionId}
  `;
  return NextResponse.json({ ok: true, sharedContext: scenario[0].shared_context, contextGroupId, course: question[0].course ?? scenario[0].course });
}
