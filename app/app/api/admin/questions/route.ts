import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { COURSE_IDS, isCourse, isTopicForCourse } from "@/lib/course-topics";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const url = new URL(request.url); const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200); const course = url.searchParams.get("course") ?? ""; const topic = url.searchParams.get("topic") ?? ""; const status = url.searchParams.get("status") ?? ""; const review = url.searchParams.get("review") ?? ""; const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const requestedLimit = Number(url.searchParams.get("limit")) || 25; const limit = [10,25,50,100].includes(requestedLimit) ? requestedLimit : 25; const offset = (page - 1) * limit;
  if (course && course !== "none" && !isCourse(course)) return NextResponse.json({ error: "Unknown course." }, { status: 400 });
  if (topic && topic !== "none" && !COURSE_IDS.some((id) => isTopicForCourse(id, topic))) return NextResponse.json({ error: "Unknown topic." }, { status: 400 });
  if (topic && topic !== "none" && course && course !== "none" && !isTopicForCourse(course, topic)) return NextResponse.json({ error: "That topic is not part of the selected course." }, { status: 400 });
  if (status && !["live", "not_live"].includes(status)) return NextResponse.json({ error: "Unknown live status." }, { status: 400 });
  if (review && !["flagged", "not_flagged"].includes(review)) return NextResponse.json({ error: "Unknown review flag." }, { status: 400 });
  const sql = getSql(); const pattern = `%${search}%`;
  const questions = await sql`
    SELECT q.id,COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'),'') AS course,q.topic,q.stem,q.options,q.material_supported_key,q.explanation,q.explanation_citations,q.verification_status,q.shared_context,q.context_group_id,q.context_position,s.display_name,
           EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.user_id=${auth.user.id} AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AS admin_flagged
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE q.question_type='mcq' AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course})) AND (${search}='' OR q.stem ILIKE ${pattern})
      AND (${status}='' OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected')))
      AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))
      AND (${review}='' OR (${review}='flagged' AND EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.user_id=${auth.user.id} AND qf.kind='admin_review' AND qf.resolved_at IS NULL)) OR (${review}='not_flagged' AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.user_id=${auth.user.id} AND qf.kind='admin_review' AND qf.resolved_at IS NULL)))
    ORDER BY CASE WHEN q.context_group_id IS NULL THEN 1 ELSE 0 END, q.context_group_id, q.context_position, q.id DESC LIMIT ${limit} OFFSET ${offset}
  `;
  const counts = await sql`SELECT count(*)::int AS total FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id WHERE q.question_type='mcq' AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course})) AND (${search}='' OR q.stem ILIKE ${pattern}) AND (${status}='' OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected'))) AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic})) AND (${review}='' OR (${review}='flagged' AND EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.user_id=${auth.user.id} AND qf.kind='admin_review' AND qf.resolved_at IS NULL)) OR (${review}='not_flagged' AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.user_id=${auth.user.id} AND qf.kind='admin_review' AND qf.resolved_at IS NULL)))` as { total: number }[];
  return NextResponse.json({ questions, page, total: counts[0]?.total ?? 0, hasMore: offset + questions.length < (counts[0]?.total ?? 0) });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { questionId?: number | string; questionIds?: number[]; action?: "unpublish" | "delete" | "flag" | "unflag" | "group_scenario" | "ungroup_scenario" | "bulk_publish" | "bulk_unpublish" | "bulk_flag" | "bulk_unflag"; scenario?: string; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string; citations?: string[]; course?: string; topic?: string };
  if (["bulk_publish", "bulk_unpublish", "bulk_flag", "bulk_unflag"].includes(body.action ?? "")) {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 250);
    if (!questionIds.length) return NextResponse.json({ error: "Select at least one question." }, { status: 400 });
    if (body.action === "bulk_publish") {
      const updated = await getSql()`UPDATE questions SET verification_status='staff_corrected',updated_at=now() WHERE id=ANY(${questionIds}) AND question_type='mcq' AND material_supported_key IS NOT NULL AND NULLIF(trim(explanation),'') IS NOT NULL AND course=ANY(${COURSE_IDS}) AND NULLIF(trim(topic),'') IS NOT NULL RETURNING id` as { id: number }[];
      return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
    }
    if (body.action === "bulk_unpublish") {
      const updated = await getSql()`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=ANY(${questionIds}) RETURNING id` as { id: number }[];
      return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
    }
    if (body.action === "bulk_flag") {
      await getSql()`INSERT INTO question_flags(question_id,user_id,kind) SELECT selected.selected_id,${auth.user.id},'admin_review' FROM unnest(${questionIds}::bigint[]) AS selected(selected_id) ON CONFLICT (user_id,question_id,kind) WHERE resolved_at IS NULL DO NOTHING`;
      return NextResponse.json({ ok: true, updated: questionIds.length, skipped: 0 });
    }
    const updated = await getSql()`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=ANY(${questionIds}) AND user_id=${auth.user.id} AND kind='admin_review' AND resolved_at IS NULL RETURNING id` as { id: number }[];
    return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
  }
  if (body.action === "group_scenario") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 50);
    const scenario = (body.scenario ?? "").trim();
    if (questionIds.length < 2 || !scenario) return NextResponse.json({ error: "Select at least two questions and enter their shared scenario." }, { status: 400 });
    const selected = await getSql()`SELECT id,course,topic FROM questions WHERE id=ANY(${questionIds}) AND question_type='mcq'` as { id: number; course: string | null; topic: string | null }[];
    if (selected.length !== questionIds.length) return NextResponse.json({ error: "One or more selected questions could not be found." }, { status: 400 });
    if (new Set(selected.map((question) => question.course)).size !== 1 || new Set(selected.map((question) => question.topic)).size !== 1) return NextResponse.json({ error: "A scenario set must use questions from the same course and topic." }, { status: 400 });
    const groupId = crypto.randomUUID();
    await getSql()`UPDATE questions q SET context_group_id=${groupId},shared_context=${scenario},context_position=chosen.position,updated_at=now() FROM (SELECT value::bigint AS id,ordinality::int AS position FROM jsonb_array_elements_text(${JSON.stringify(questionIds)}::jsonb) WITH ORDINALITY) chosen WHERE q.id=chosen.id`;
    return NextResponse.json({ ok: true, contextGroupId: groupId });
  }
  if (body.action === "ungroup_scenario") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 50);
    if (!questionIds.length) return NextResponse.json({ error: "Select a scenario set to ungroup." }, { status: 400 });
    await getSql()`UPDATE questions SET context_group_id=NULL,shared_context=NULL,context_position=NULL,updated_at=now() WHERE id=ANY(${questionIds})`;
    return NextResponse.json({ ok: true });
  }
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId)) return NextResponse.json({ error: "Choose a question." }, { status: 400 });
  if (body.action === "flag") {
    await getSql()`INSERT INTO question_flags(question_id,user_id,kind) VALUES(${questionId},${auth.user.id},'admin_review') ON CONFLICT (user_id,question_id,kind) WHERE resolved_at IS NULL DO NOTHING`;
    return NextResponse.json({ ok: true, flagged: true });
  }
  if (body.action === "unflag") {
    await getSql()`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=${questionId} AND user_id=${auth.user.id} AND kind='admin_review' AND resolved_at IS NULL`;
    return NextResponse.json({ ok: true, flagged: false });
  }
  if (body.action === "unpublish") {
    await getSql()`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=${questionId}`;
    return NextResponse.json({ ok: true });
  }
  if (body.action === "delete") {
    await getSql()`DELETE FROM questions WHERE id=${questionId}`;
    return NextResponse.json({ ok: true });
  }
  const stem = (body.stem ?? "").trim(); const explanation = (body.explanation ?? "").trim(); const options = body.options ?? []; const citations = body.citations?.map((citation) => citation.trim()).filter(Boolean).slice(0, 12);
  if (!stem || !explanation || !options.length || !body.answerKey || !options.some((option) => option.key === body.answerKey && option.text.trim())) return NextResponse.json({ error: "Keep a question, answer options, the correct answer, and an explanation." }, { status: 400 });
  if (!body.course || !isCourse(body.course)) return NextResponse.json({ error: "Choose one of the five courses." }, { status: 400 });
  if (!body.topic || !isTopicForCourse(body.course, body.topic)) return NextResponse.json({ error: "Choose an official topic for the selected course." }, { status: 400 });
  if (citations) await getSql()`UPDATE questions SET course=${body.course},topic=${body.topic},stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey},verification_status='staff_corrected',explanation=${explanation},explanation_citations=${JSON.stringify(citations)}::jsonb,updated_at=now() WHERE id=${questionId}`;
  else await getSql()`UPDATE questions SET course=${body.course},topic=${body.topic},stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey},verification_status='staff_corrected',explanation=${explanation},updated_at=now() WHERE id=${questionId}`;
  return NextResponse.json({ ok: true });
}
