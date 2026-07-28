import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

type UserRow = { id: number; username: string; email: string; identity_type: "registered" | "guest"; role: string; created_at: string; last_active_at: string; questions_answered: number; sessions_count: number; total_seconds: number };
type CourseRow = { user_id: number; course: string; answers_count: number; total_seconds: number };

export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const sql = getSql();
  const users = await sql`
    SELECT u.id, u.username, u.email, u.identity_type, u.role, u.created_at,
           GREATEST(u.last_seen_at, COALESCE(p.last_active_at, u.last_seen_at)) AS last_active_at,
           COALESCE(a.questions_answered, 0)::int AS questions_answered,
           COALESCE(p.sessions_count, 0)::int AS sessions_count,
           COALESCE(p.total_seconds, 0)::int AS total_seconds
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*) AS questions_answered FROM attempts WHERE user_id = u.id
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS sessions_count, COALESCE(sum(total_seconds), 0) AS total_seconds, max(last_activity_at) AS last_active_at
      FROM practice_sessions WHERE user_id = u.id
    ) p ON true
    ORDER BY GREATEST(u.last_seen_at, COALESCE(p.last_active_at, u.last_seen_at)) DESC
    LIMIT 100
  ` as UserRow[];
  const usage = await sql`
    SELECT user_id, course, sum(answers_count)::int AS answers_count, sum(total_seconds)::int AS total_seconds
    FROM practice_sessions GROUP BY user_id, course
  ` as CourseRow[];
  const usageByUser = new Map<number, CourseRow[]>();
  for (const row of usage) usageByUser.set(row.user_id, [...(usageByUser.get(row.user_id) ?? []), row]);
  return NextResponse.json({ users: users.map((user) => ({ ...user, courses: usageByUser.get(user.id) ?? [] })) });
}
