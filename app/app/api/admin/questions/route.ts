import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { COURSE_IDS, isCourse, isTopicForCourse } from "@/lib/course-topics";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const url = new URL(request.url); const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200); const course = url.searchParams.get("course") ?? ""; const topic = url.searchParams.get("topic") ?? ""; const status = url.searchParams.get("status") ?? ""; const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const limit = 25; const offset = (page - 1) * limit;
  if (course && course !== "none" && !isCourse(course)) return NextResponse.json({ error: "Unknown course." }, { status: 400 });
  if (topic && topic !== "none" && !COURSE_IDS.some((id) => isTopicForCourse(id, topic))) return NextResponse.json({ error: "Unknown topic." }, { status: 400 });
  if (topic && topic !== "none" && course && course !== "none" && !isTopicForCourse(course, topic)) return NextResponse.json({ error: "That topic is not part of the selected course." }, { status: 400 });
  if (status && !["live", "not_live"].includes(status)) return NextResponse.json({ error: "Unknown live status." }, { status: 400 });
  const sql = getSql(); const pattern = `%${search}%`;
  const questions = await sql`
    SELECT q.id,COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'),'') AS course,q.topic,q.stem,q.options,q.material_supported_key,q.explanation,q.explanation_citations,q.verification_status,q.shared_context,q.context_group_id,q.context_position,s.display_name
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE q.question_type='mcq' AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course})) AND (${search}='' OR q.stem ILIKE ${pattern})
      AND (${status}='' OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected')))
      AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))
    ORDER BY CASE WHEN q.context_group_id IS NULL THEN 1 ELSE 0 END, q.context_group_id, q.context_position, q.id DESC LIMIT ${limit} OFFSET ${offset}
  `;
  const counts = await sql`SELECT count(*)::int AS total FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id WHERE q.question_type='mcq' AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course})) AND (${search}='' OR q.stem ILIKE ${pattern}) AND (${status}='' OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected'))) AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))` as { total: number }[];
  return NextResponse.json({ questions, page, total: counts[0]?.total ?? 0, hasMore: offset + questions.length < (counts[0]?.total ?? 0) });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { questionId?: number | string; action?: "unpublish" | "delete"; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string; citations?: string[]; course?: string; topic?: string };
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId)) return NextResponse.json({ error: "Choose a question." }, { status: 400 });
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
