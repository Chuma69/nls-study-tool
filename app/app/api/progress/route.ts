import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

type SessionRow = { id: number; course: string; started_at: string; last_activity_at: string; answers_count: number; correct_count: number; total_seconds: number };

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  const sessions = await getSql()`
    SELECT id, course, started_at, last_activity_at, answers_count, correct_count, total_seconds
    FROM practice_sessions WHERE user_id = ${user.id}
    ORDER BY last_activity_at DESC LIMIT 50
  ` as SessionRow[];
  return NextResponse.json({ sessions });
}
