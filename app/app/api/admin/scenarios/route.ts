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
  const contextGroupId = (url.searchParams.get("contextGroupId") ?? "").trim();
  const pattern = `%${search}%`;
  if (contextGroupId) {
    const scenario = await getSql()`SELECT context_group_id,course FROM questions WHERE context_group_id=${contextGroupId} LIMIT 1` as { context_group_id: string; course: string | null }[];
    if (!scenario.length) return NextResponse.json({ error: "The case study could not be found." }, { status: 404 });
    const questions = await getSql()`
      SELECT q.id,q.stem,q.topic,q.verification_status,q.context_group_id
      FROM questions q
      WHERE q.question_type='mcq'
        AND q.course=${scenario[0].course}
        AND q.context_group_id IS DISTINCT FROM ${contextGroupId}
        AND (${search}='' OR q.stem ILIKE ${pattern})
      ORDER BY CASE WHEN q.verification_status IN ('material_supported','staff_corrected') THEN 0 ELSE 1 END,q.id DESC
      LIMIT 20
    `;
    return NextResponse.json({ questions });
  }
  const scenarios = await getSql()`
    SELECT q.context_group_id, max(q.shared_context) AS shared_context,
           max(q.course) AS course, count(*)::int AS question_count
    FROM questions q
    WHERE q.question_type='mcq' AND q.context_group_id IS NOT NULL
      AND NULLIF(trim(q.shared_context),'') IS NOT NULL
      AND (${course}='' OR q.course=${course})
      AND (${search}='' OR q.shared_context ILIKE ${pattern})
    GROUP BY q.context_group_id ORDER BY max(q.updated_at) DESC LIMIT 20
  `;
  return NextResponse.json({ scenarios });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin");
  if (auth.response) return auth.response;
  const body = await request.json() as { questionId?: number; contextGroupId?: string };
  const questionId = Number(body.questionId);
  const contextGroupId = (body.contextGroupId ?? "").trim();
  if (!Number.isSafeInteger(questionId) || !contextGroupId) return NextResponse.json({ error: "Choose a question and case study." }, { status: 400 });

  const question = await getSql()`SELECT id,course FROM questions WHERE id=${questionId} AND question_type='mcq' LIMIT 1` as { id: number; course: string | null }[];
  const scenario = await getSql()`SELECT context_group_id,shared_context,course FROM questions WHERE context_group_id=${contextGroupId} AND NULLIF(trim(shared_context),'') IS NOT NULL ORDER BY context_position NULLS LAST,id LIMIT 1` as { context_group_id: string; shared_context: string; course: string | null }[];
  if (!question.length || !scenario.length) return NextResponse.json({ error: "The question or case study could not be found." }, { status: 404 });
  if (question[0].course && scenario[0].course && question[0].course !== scenario[0].course) return NextResponse.json({ error: "A question can only join a case study from the same course." }, { status: 400 });

  const positions = await getSql()`SELECT COALESCE(max(context_position),0)::int AS position FROM questions WHERE context_group_id=${contextGroupId}` as { position: number }[];
  await getSql()`UPDATE questions SET context_group_id=${contextGroupId},shared_context=${scenario[0].shared_context},context_position=${(positions[0]?.position ?? 0) + 1},updated_at=now() WHERE id=${questionId}`;
  return NextResponse.json({ ok: true, sharedContext: scenario[0].shared_context, contextGroupId });
}
