import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

const courses = new Set(["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills"]);

type SessionRow = { id: number; answers_count: number; total_seconds: number; last_question_id: number | null };

// End the user's active session for a given id (preferred) or course. A session with no
// answers is deleted so empty runs never clutter the progress log; a session with answers
// is stamped ended_at so it is recorded and the next run starts fresh.
async function endActiveSession(userId: number, sessionId: number | null, course: string | null) {
  const sql = getSql();
  const rows = (sessionId
    ? await sql`SELECT id, answers_count FROM practice_sessions WHERE id = ${sessionId} AND user_id = ${userId} AND ended_at IS NULL LIMIT 1`
    : await sql`SELECT id, answers_count FROM practice_sessions WHERE user_id = ${userId} AND course = ${course} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`) as { id: number; answers_count: number }[];
  const session = rows[0];
  if (!session) return { ended: false, recorded: false, sessionId: null as number | null };
  if (session.answers_count > 0) {
    await sql`UPDATE practice_sessions SET ended_at = now(), last_activity_at = now() WHERE id = ${session.id}`;
    return { ended: true, recorded: true, sessionId: session.id };
  }
  await sql`DELETE FROM practice_sessions WHERE id = ${session.id}`;
  return { ended: true, recorded: false, sessionId: session.id };
}

// A run can span several courses. The session's `course` column stores a canonical
// key: the selected course ids sorted and comma-joined (a single course stays as its
// own id, so existing single-course sessions keep working unchanged).
function courseKeyFrom(body: { course?: string; courses?: string[] }) {
  const list = Array.isArray(body.courses) ? body.courses : body.course ? [body.course] : [];
  const valid = [...new Set(list.filter((course) => courses.has(course)))].sort();
  return valid.length ? valid.join(",") : null;
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  let body: { course?: string; courses?: string[]; action?: string; sessionId?: number | string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please choose a course." }, { status: 400 }); }
  // Ending can also arrive here (not only via PATCH) so navigator.sendBeacon can record a
  // session as the user leaves the page — sendBeacon only issues POST requests.
  if (body.action === "end") {
    const sessionId = Number(body.sessionId);
    const courseKey = courseKeyFrom(body);
    if (!Number.isSafeInteger(sessionId) && !courseKey) return NextResponse.json({ error: "Nothing to end." }, { status: 400 });
    const result = await endActiveSession(user.id, Number.isSafeInteger(sessionId) ? sessionId : null, courseKey);
    return NextResponse.json({ ok: true, ...result });
  }
  const courseKey = courseKeyFrom(body);
  if (!courseKey) return NextResponse.json({ error: "Choose one of the listed courses." }, { status: 400 });

  const sql = getSql();
  const existing = await sql`
    SELECT id, answers_count, total_seconds, last_question_id
    FROM practice_sessions
    WHERE user_id = ${user.id} AND course = ${courseKey} AND ended_at IS NULL
    LIMIT 1
  ` as SessionRow[];
  if (existing[0]) return NextResponse.json({ session: existing[0], resumed: true });

  const created = await sql`
    INSERT INTO practice_sessions (user_id, course)
    VALUES (${user.id}, ${courseKey})
    RETURNING id, answers_count, total_seconds, last_question_id
  ` as SessionRow[];
  return NextResponse.json({ session: created[0], resumed: false });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  let body: { sessionId?: number | string; course?: string; courses?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Nothing to end." }, { status: 400 }); }
  const sessionId = Number(body.sessionId);
  const courseKey = courseKeyFrom(body);
  if (!Number.isSafeInteger(sessionId) && !courseKey) return NextResponse.json({ error: "Nothing to end." }, { status: 400 });
  const result = await endActiveSession(user.id, Number.isSafeInteger(sessionId) ? sessionId : null, courseKey);
  return NextResponse.json({ ok: true, ...result });
}
