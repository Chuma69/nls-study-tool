import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

const courses = new Set(["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills"]);

type SessionRow = { id: number; answers_count: number; total_seconds: number; last_question_id: number | null };

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  let body: { course?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please choose a course." }, { status: 400 }); }
  if (!body.course || !courses.has(body.course)) return NextResponse.json({ error: "Choose one of the listed courses." }, { status: 400 });

  const sql = getSql();
  const existing = await sql`
    SELECT id, answers_count, total_seconds, last_question_id
    FROM practice_sessions
    WHERE user_id = ${user.id} AND course = ${body.course} AND ended_at IS NULL
    LIMIT 1
  ` as SessionRow[];
  if (existing[0]) return NextResponse.json({ session: existing[0], resumed: true });

  const created = await sql`
    INSERT INTO practice_sessions (user_id, course)
    VALUES (${user.id}, ${body.course})
    RETURNING id, answers_count, total_seconds, last_question_id
  ` as SessionRow[];
  return NextResponse.json({ session: created[0], resumed: false });
}
