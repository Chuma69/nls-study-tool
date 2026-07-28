import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
const courses = new Set(["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills", "general"]);

export async function GET(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const url = new URL(request.url); const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200); const course = url.searchParams.get("course") ?? ""; const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const limit = 25; const offset = (page - 1) * limit;
  if (course && !courses.has(course)) return NextResponse.json({ error: "Unknown course." }, { status: 400 });
  const sql = getSql(); const pattern = `%${search}%`;
  const questions = await sql`
    SELECT q.id,q.course,q.stem,q.options,q.material_supported_key,q.explanation,q.verification_status,s.display_name
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE (${course}='' OR q.course=${course}) AND (${search}='' OR q.stem ILIKE ${pattern})
    ORDER BY q.id DESC LIMIT ${limit} OFFSET ${offset}
  `;
  const counts = await sql`SELECT count(*)::int AS total FROM questions q WHERE (${course}='' OR q.course=${course}) AND (${search}='' OR q.stem ILIKE ${pattern})` as { total: number }[];
  return NextResponse.json({ questions, page, total: counts[0]?.total ?? 0, hasMore: offset + questions.length < (counts[0]?.total ?? 0) });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { questionId?: number; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string };
  if (!Number.isSafeInteger(body.questionId)) return NextResponse.json({ error: "Choose a question." }, { status: 400 });
  const stem = (body.stem ?? "").trim(); const explanation = (body.explanation ?? "").trim(); const options = body.options ?? [];
  if (!stem || !explanation || !options.length || !body.answerKey || !options.some((option) => option.key === body.answerKey && option.text.trim())) return NextResponse.json({ error: "Keep a question, answer options, the correct answer, and an explanation." }, { status: 400 });
  await getSql()`UPDATE questions SET stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey},verification_status='staff_corrected',explanation=${explanation},updated_at=now() WHERE id=${body.questionId}`;
  return NextResponse.json({ ok: true });
}
