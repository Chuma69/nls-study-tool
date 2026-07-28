import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("questionId"));
  const sql = getSql();
  if (Number.isSafeInteger(id)) {
    const rows = await sql`SELECT note FROM question_flags WHERE user_id=${user.id} AND question_id=${id} AND kind='saved' AND resolved_at IS NULL LIMIT 1` as { note: string | null }[];
    return NextResponse.json({ saved: Boolean(rows[0]), note: rows[0]?.note ?? "" });
  }
  const rows = await sql`
    SELECT q.id,q.course,q.topic,q.stem,q.options,qf.note,s.display_name
    FROM question_flags qf JOIN questions q ON q.id=qf.question_id
    LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE qf.user_id=${user.id} AND qf.kind='saved' AND qf.resolved_at IS NULL
    ORDER BY qf.created_at DESC
  `;
  return NextResponse.json({ items: rows });
}

export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  let body: { questionId?: number | string; saved?: boolean; note?: string }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId)) return NextResponse.json({ error: "Choose a valid question." }, { status: 400 });
  const sql = getSql();
  if (body.saved === false) {
    await sql`UPDATE question_flags SET resolved_at=now() WHERE user_id=${user.id} AND question_id=${questionId} AND kind='saved' AND resolved_at IS NULL`;
    return NextResponse.json({ saved: false });
  }
  const note = body.note?.trim().slice(0, 3000) ?? "";
  await sql`
    INSERT INTO question_flags(question_id,user_id,kind,note) VALUES(${questionId},${user.id},'saved',${note || null})
    ON CONFLICT (user_id,question_id,kind) WHERE resolved_at IS NULL DO UPDATE SET note=EXCLUDED.note
  `;
  return NextResponse.json({ saved: true, note });
}
