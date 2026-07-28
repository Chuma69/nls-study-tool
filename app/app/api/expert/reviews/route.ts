import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { requireRole } from "@/lib/authorization";

export const runtime = "nodejs";

async function refreshConsensus(questionId: number) {
  const sql = getSql();
  const rows = await sql`SELECT selected_key, COUNT(*)::int AS count FROM expert_reviews WHERE question_id=${questionId} AND status='submitted' GROUP BY selected_key ORDER BY count DESC` as { selected_key: string; count: number }[];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const agreed = rows.find((row) => row.count >= 2);
  const status = agreed ? "consensus_reached" : rows.length > 1 ? "conflicted" : "awaiting_reviews";
  await sql`INSERT INTO question_consensus(question_id,selected_key,review_count,status,updated_at)
    VALUES(${questionId},${agreed?.selected_key ?? null},${total},${status},now())
    ON CONFLICT(question_id) DO UPDATE SET selected_key=EXCLUDED.selected_key,review_count=EXCLUDED.review_count,status=EXCLUDED.status,updated_at=now()`;
}

export async function GET() {
  const auth = await requireRole("expert", "admin");
  if (auth.response) return auth.response;
  const rows = await getSql()`SELECT q.id,q.stem,q.options,q.course,q.exam_years,q.source_locator,
    COALESCE(s.display_name,s.rel_source_path) AS source_name,COALESCE(c.status,'awaiting_reviews') AS consensus_status
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id LEFT JOIN question_consensus c ON c.question_id=q.id
    WHERE q.question_type='mcq' AND q.verification_status NOT IN ('material_supported','staff_corrected')
      AND q.options IS NOT NULL AND COALESCE(s.rel_source_path,'') !~* 'answer'
    ORDER BY CASE WHEN c.status='conflicted' THEN 0 ELSE 1 END,q.id LIMIT 20`;
  return NextResponse.json({ questions: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("expert", "admin");
  if (auth.response) return auth.response;
  let body: { questionId?: number | string; selectedKey?: string; explanation?: string; citations?: string[]; confidence?: "low" | "medium" | "high" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId) || !body.selectedKey || !body.explanation?.trim() || !body.citations?.filter(Boolean).length || !body.confidence) {
    return NextResponse.json({ error: "Choose an option, explain it, add at least one citation, and set confidence." }, { status: 400 });
  }
  const sql = getSql();
  const questions = await sql`SELECT options FROM questions WHERE id=${questionId} AND question_type='mcq' LIMIT 1` as { options: { key: string }[] }[];
  if (!questions[0]?.options.some((option) => option.key === body.selectedKey)) return NextResponse.json({ error: "That option is not available." }, { status: 400 });
  await sql`INSERT INTO expert_reviews(question_id,expert_id,selected_key,explanation,citations,confidence,updated_at)
    VALUES(${questionId},${auth.user.id},${body.selectedKey},${body.explanation.trim()},${JSON.stringify(body.citations.filter(Boolean).slice(0,6))}::jsonb,${body.confidence},now())
    ON CONFLICT(question_id,expert_id) DO UPDATE SET selected_key=EXCLUDED.selected_key,explanation=EXCLUDED.explanation,citations=EXCLUDED.citations,confidence=EXCLUDED.confidence,status='submitted',updated_at=now()`;
  await refreshConsensus(questionId);
  return NextResponse.json({ ok: true });
}
