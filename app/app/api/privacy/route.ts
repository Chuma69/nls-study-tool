import { NextResponse } from "next/server";
import { currentUser, SESSION_COOKIE } from "@/lib/session";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "No active study session." }, { status: 401 });
  const sql = getSql();
  const [attempts, flags, conversations] = await Promise.all([
    sql`SELECT question_id, chosen_key, is_correct, answered_at FROM attempts WHERE user_id = ${user.id} ORDER BY answered_at`,
    sql`SELECT question_id, kind, note, created_at, resolved_at FROM question_flags WHERE user_id = ${user.id} ORDER BY created_at`,
    sql`SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ${user.id} ORDER BY updated_at DESC`,
  ]);
  return NextResponse.json({ exportedAt: new Date().toISOString(), user, attempts, flags, conversations });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "No active study session." }, { status: 401 });
  await getSql()`DELETE FROM users WHERE id = ${user.id}`;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { expires: new Date(0), path: "/" });
  return response;
}
