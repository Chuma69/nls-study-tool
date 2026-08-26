import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireRole } from "@/lib/authorization";
import { isCourse } from "@/lib/course-topics";

export const runtime = "nodejs";

async function refreshConsensus(questionId: number) {
  const sql = getSql();
  const rows = await sql`SELECT selected_key, COUNT(*)::int AS count FROM expert_reviews WHERE question_id=${questionId} AND status='submitted' GROUP BY selected_key ORDER BY count DESC` as { selected_key: string; count: number }[];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const agreed = rows.find((row) => row.count >= 2);
  const proposed = agreed?.selected_key ?? (rows.length === 1 ? rows[0].selected_key : null);
  const status = agreed ? "consensus_reached" : rows.length > 1 ? "conflicted" : "awaiting_reviews";
  await sql`INSERT INTO question_consensus(question_id,selected_key,review_count,status,updated_at)
    VALUES(${questionId},${proposed},${total},${status},now())
    ON CONFLICT(question_id) DO UPDATE SET selected_key=EXCLUDED.selected_key,review_count=EXCLUDED.review_count,status=EXCLUDED.status,updated_at=now()`;
}

export async function GET(request: Request) {
  const auth = await requireRole("expert", "admin");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const requestedQuestionId = Number(url.searchParams.get("question")) || 0;
  const courseParam = url.searchParams.get("course") ?? "";
  const course = isCourse(courseParam) ? courseParam : "";
  const expertId = auth.user.id;
  const sql = getSql();
  const rows = await sql`SELECT q.id,q.stem,q.options,q.course,q.exam_years,q.source_locator,
    COALESCE(s.display_name,s.rel_source_path) AS source_name,COALESCE(c.status,'awaiting_reviews') AS consensus_status,COALESCE(c.review_count,0)::int AS review_count
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id LEFT JOIN question_consensus c ON c.question_id=q.id
    WHERE q.question_type='mcq' AND q.verification_status NOT IN ('material_supported','staff_corrected')
      AND (${requestedQuestionId}=0 OR q.id=${requestedQuestionId})
      AND (${course}='' OR q.course=${course})
      AND q.options IS NOT NULL AND COALESCE(s.rel_source_path,'') !~* 'answer'
      AND NOT EXISTS (SELECT 1 FROM expert_reviews er WHERE er.question_id=q.id AND er.expert_id=${expertId} AND er.status='submitted')
    ORDER BY COALESCE(c.review_count,0) ASC, random() LIMIT 20`;
  // How many this reviewer has done, and how many still await them, broken down by course.
  const reviewed = await sql`SELECT count(*)::int AS c FROM expert_reviews WHERE expert_id=${expertId} AND status='submitted'` as { c: number }[];
  const byCourse = await sql`SELECT q.course, count(*)::int AS c
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE q.question_type='mcq' AND q.verification_status NOT IN ('material_supported','staff_corrected')
      AND q.options IS NOT NULL AND COALESCE(s.rel_source_path,'') !~* 'answer'
      AND NOT EXISTS (SELECT 1 FROM expert_reviews er WHERE er.question_id=q.id AND er.expert_id=${expertId} AND er.status='submitted')
    GROUP BY q.course` as { course: string | null; c: number }[];
  const pendingByCourse: Record<string, number> = {};
  let pendingTotal = 0;
  for (const row of byCourse) { pendingTotal += row.c; if (row.course) pendingByCourse[row.course] = row.c; }
  return NextResponse.json({ questions: rows, reviewedCount: reviewed[0]?.c ?? 0, pendingTotal, pendingByCourse, course });
}

export async function POST(request: Request) {
  const auth = await requireRole("expert", "admin");
  if (auth.response) return auth.response;
  let body: { questionId?: number | string; selectedKey?: string; explanation?: string; citations?: string[]; confidence?: "low" | "medium" | "high" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId) || !body.selectedKey || !body.explanation?.trim() || !body.confidence) {
    return NextResponse.json({ error: "Choose an option, explain it, and set confidence." }, { status: 400 });
  }
  const citations = body.citations?.filter(Boolean).slice(0, 6) ?? [];
  const sql = getSql();
  const questions = await sql`SELECT options FROM questions WHERE id=${questionId} AND question_type='mcq' LIMIT 1` as { options: { key: string }[] }[];
  if (!questions[0]?.options.some((option) => option.key === body.selectedKey)) return NextResponse.json({ error: "That option is not available." }, { status: 400 });
  await sql`INSERT INTO expert_reviews(question_id,expert_id,selected_key,explanation,citations,confidence,updated_at)
    VALUES(${questionId},${auth.user.id},${body.selectedKey},${body.explanation.trim()},${JSON.stringify(citations)}::jsonb,${body.confidence},now())
    ON CONFLICT(question_id,expert_id) DO UPDATE SET selected_key=EXCLUDED.selected_key,explanation=EXCLUDED.explanation,citations=EXCLUDED.citations,confidence=EXCLUDED.confidence,status='submitted',updated_at=now()`;
  if (auth.user.role === "admin") {
    const reviewCount = await sql`SELECT count(*)::int AS count FROM expert_reviews WHERE question_id=${questionId} AND status='submitted'` as { count: number }[];
    await sql`UPDATE questions SET material_supported_key=${body.selectedKey},verification_status='staff_corrected',explanation=${body.explanation.trim()},explanation_version=1,explanation_citations=${JSON.stringify(citations)}::jsonb,allowlisted_at=COALESCE(allowlisted_at,now()),allowlisted_by=COALESCE(allowlisted_by,${auth.user.id}),updated_at=now() WHERE id=${questionId}`;
    await sql`INSERT INTO question_consensus(question_id,selected_key,review_count,status,reviewed_by,reviewed_at,updated_at)
      VALUES(${questionId},${body.selectedKey},${reviewCount[0]?.count ?? 1},'staff_approved',${auth.user.id},now(),now())
      ON CONFLICT(question_id) DO UPDATE SET selected_key=EXCLUDED.selected_key,review_count=EXCLUDED.review_count,status='staff_approved',reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now(),updated_at=now()`;
    return NextResponse.json({ ok: true, published: true });
  }
  await refreshConsensus(questionId);
  return NextResponse.json({ ok: true });
}
