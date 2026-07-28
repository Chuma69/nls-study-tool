import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const reports = await getSql()`
    SELECT r.id,r.question_id,r.category,r.details,r.status,r.created_at,u.username AS reporter,
           q.stem,q.options,q.material_supported_key,q.explanation,q.course,q.topic
    FROM question_reports r JOIN questions q ON q.id=r.question_id JOIN users u ON u.id=r.user_id
    WHERE r.status='open' ORDER BY r.created_at ASC LIMIT 100
  `;
  return NextResponse.json({ reports });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { reportId?: number | string; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string; course?: string; topic?: string; action?: "save" | "dismiss" };
  const reportId = Number(body.reportId);
  if (!Number.isSafeInteger(reportId) || !["save", "dismiss"].includes(body.action ?? "")) return NextResponse.json({ error: "Invalid report update." }, { status: 400 });
  const sql = getSql();
  if (body.action === "dismiss") { await sql`UPDATE question_reports SET status='dismissed',resolved_by=${auth.user.id},resolved_at=now() WHERE id=${reportId}`; return NextResponse.json({ ok: true }); }
  const stem = (body.stem ?? "").trim(); const explanation = (body.explanation ?? "").trim(); const options = body.options ?? [];
  if (!stem || !explanation || !options.length || !body.answerKey || !options.some((option) => option.key === body.answerKey && option.text.trim())) return NextResponse.json({ error: "Keep a question, answer options, the correct answer, and an explanation." }, { status: 400 });
  const report = await sql`SELECT question_id FROM question_reports WHERE id=${reportId} AND status='open' LIMIT 1` as { question_id: number }[];
  if (!report[0]) return NextResponse.json({ error: "This report is no longer open." }, { status: 404 });
  const { isCourse, isTopicForCourse } = await import("@/lib/course-topics");
  if (!body.course || !isCourse(body.course)) return NextResponse.json({ error: "Choose one of the five courses." }, { status: 400 });
  if (!body.topic || !isTopicForCourse(body.course, body.topic)) return NextResponse.json({ error: "Choose an official topic for the selected course." }, { status: 400 });
  await sql`UPDATE questions SET course=${body.course},topic=${body.topic},stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey},verification_status='staff_corrected',explanation=${explanation},updated_at=now() WHERE id=${report[0].question_id}`;
  await sql`UPDATE question_reports SET status='resolved',resolved_by=${auth.user.id},resolved_at=now(),resolution_note='Question updated by admin.' WHERE id=${reportId}`;
  return NextResponse.json({ ok: true });
}
