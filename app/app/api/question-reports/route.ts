import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const body = await request.json() as { questionId?: number; category?: "typo" | "answer" | "other"; details?: string };
  if (!Number.isSafeInteger(body.questionId) || !["typo", "answer", "other"].includes(body.category ?? "")) return NextResponse.json({ error: "Choose the problem you found." }, { status: 400 });
  const details = (body.details ?? "").trim().slice(0, 2000);
  await getSql()`INSERT INTO question_reports(question_id,user_id,category,details) VALUES(${body.questionId},${user.id},${body.category},${details || null})`;
  return NextResponse.json({ ok: true });
}
