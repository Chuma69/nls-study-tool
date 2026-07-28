import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const rows = await getSql()`
    SELECT q.id,q.course,q.stem,q.options,q.material_supported_key,q.explanation,s.display_name,
           cr.interval_days
    FROM questions q LEFT JOIN card_reviews cr ON cr.question_id=q.id AND cr.user_id=${user.id}
    LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE q.question_type='mcq' AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported','staff_corrected')
      AND (cr.due_at IS NULL OR cr.due_at <= now())
    ORDER BY cr.due_at NULLS FIRST, random() LIMIT 1
  `;
  return NextResponse.json({ card: rows[0] ?? null });
}

export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const body = await request.json() as { questionId?: number; rating?: "shaky" | "got_it" };
  if (!Number.isSafeInteger(body.questionId) || !["shaky", "got_it"].includes(body.rating ?? "")) return NextResponse.json({ error: "Invalid card review." }, { status: 400 });
  const sql = getSql();
  const current = await sql`SELECT interval_days FROM card_reviews WHERE user_id=${user.id} AND question_id=${body.questionId}` as { interval_days: number }[];
  const previous = current[0]?.interval_days ?? 1;
  const next = body.rating === "shaky" ? 1 : previous <= 1 ? 3 : previous <= 3 ? 7 : previous <= 7 ? 16 : 35;
  await sql`
    INSERT INTO card_reviews(user_id,question_id,due_at,interval_days,last_reviewed_at)
    VALUES(${user.id},${body.questionId},now() + (${next} * interval '1 day'),${next},now())
    ON CONFLICT(user_id,question_id) DO UPDATE SET due_at=EXCLUDED.due_at,interval_days=EXCLUDED.interval_days,last_reviewed_at=now()
  `;
  return NextResponse.json({ ok: true, nextDueDays: next });
}
