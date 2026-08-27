import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

const COURSE_IDS = ["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills"];

type UserRow = {
  id: number; username: string; email: string; identity_type: "registered" | "guest"; role: string;
  created_at: string; last_seen_at: string;
};
type AttemptRow = { user_id: number; answers: number; correct: number; distinct_q: number; total_seconds: number; last_answer_at: string | null; active_days: number };
type SessionRow = { user_id: number; sessions_count: number; last_active_at: string | null };
type SprintRow = { user_id: number; sprints_count: number; last_sprint_at: string | null };
type CourseAttemptRow = { user_id: number; course: string; answers: number; correct: number; total_seconds: number };

function accuracy(correct: number, answers: number) {
  return answers ? Math.round((correct / answers) * 100) : 0;
}

export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const sql = getSql();

  const [usersResult, attemptsResult, sessionsResult, sprintsResult, courseAttemptsResult] = await Promise.all([
    sql`SELECT id, username, email, identity_type, role, created_at, last_seen_at FROM users`,
    // Study time comes from per-answer seconds_spent, so it covers BOTH practice and sprint answers.
    sql`
      SELECT user_id,
             count(*)::int AS answers,
             count(*) FILTER (WHERE is_correct)::int AS correct,
             count(DISTINCT question_id)::int AS distinct_q,
             COALESCE(sum(seconds_spent), 0)::int AS total_seconds,
             max(answered_at) AS last_answer_at,
             count(DISTINCT (answered_at AT TIME ZONE 'Africa/Lagos')::date)::int AS active_days
      FROM attempts GROUP BY user_id
    `,
    sql`
      SELECT user_id, count(*)::int AS sessions_count, max(last_activity_at) AS last_active_at
      FROM practice_sessions GROUP BY user_id
    `,
    sql`
      SELECT user_id, count(*)::int AS sprints_count, max(started_at) AS last_sprint_at
      FROM sprints GROUP BY user_id
    `,
    sql`
      SELECT a.user_id, q.course, count(*)::int AS answers, count(*) FILTER (WHERE a.is_correct)::int AS correct,
             COALESCE(sum(a.seconds_spent), 0)::int AS total_seconds
      FROM attempts a JOIN questions q ON q.id = a.question_id
      WHERE q.course = ANY(${COURSE_IDS})
      GROUP BY a.user_id, q.course
    `,
  ]);
  const users = usersResult as unknown as UserRow[];
  const attempts = attemptsResult as unknown as AttemptRow[];
  const sessions = sessionsResult as unknown as SessionRow[];
  const sprints = sprintsResult as unknown as SprintRow[];
  const courseAttempts = courseAttemptsResult as unknown as CourseAttemptRow[];

  const attemptsByUser = new Map(attempts.map((row) => [row.user_id, row]));
  const sessionsByUser = new Map(sessions.map((row) => [row.user_id, row]));
  const sprintsByUser = new Map(sprints.map((row) => [row.user_id, row]));
  const courseByUser = new Map<number, Map<string, { course: string; answers: number; correct: number; total_seconds: number }>>();
  const courseFor = (userId: number, course: string) => {
    if (!courseByUser.has(userId)) courseByUser.set(userId, new Map());
    const map = courseByUser.get(userId)!;
    if (!map.has(course)) map.set(course, { course, answers: 0, correct: 0, total_seconds: 0 });
    return map.get(course)!;
  };
  for (const row of courseAttempts) { const c = courseFor(row.user_id, row.course); c.answers += row.answers; c.correct += row.correct; c.total_seconds += row.total_seconds; }

  const now = Date.now();
  const DAY = 86_400_000;
  const enriched = users.map((user) => {
    const a = attemptsByUser.get(user.id);
    const s = sessionsByUser.get(user.id);
    const sp = sprintsByUser.get(user.id);
    const answers = a?.answers ?? 0;
    const correct = a?.correct ?? 0;
    const lastActive = [user.last_seen_at, a?.last_answer_at, s?.last_active_at, sp?.last_sprint_at]
      .filter(Boolean)
      .map((value) => new Date(value as string).getTime())
      .reduce((max, value) => Math.max(max, value), 0);
    const courses = [...(courseByUser.get(user.id)?.values() ?? [])]
      .map((c) => ({ ...c, accuracy: accuracy(c.correct, c.answers) }))
      .sort((first, second) => second.answers - first.answers);
    return {
      id: user.id, username: user.username, email: user.email, identity_type: user.identity_type, role: user.role,
      created_at: user.created_at,
      last_active_at: lastActive ? new Date(lastActive).toISOString() : user.last_seen_at,
      questions_answered: answers,
      distinct_questions: a?.distinct_q ?? 0,
      correct_count: correct,
      accuracy: accuracy(correct, answers),
      active_days: a?.active_days ?? 0,
      sessions_count: s?.sessions_count ?? 0,
      sprints_count: sp?.sprints_count ?? 0,
      total_seconds: a?.total_seconds ?? 0,
      courses,
    };
  }).sort((first, second) => new Date(second.last_active_at).getTime() - new Date(first.last_active_at).getTime());

  const totalAnswers = enriched.reduce((sum, user) => sum + user.questions_answered, 0);
  const totalCorrect = enriched.reduce((sum, user) => sum + user.correct_count, 0);
  const summary = {
    totalUsers: enriched.length,
    registered: enriched.filter((user) => user.identity_type === "registered").length,
    guests: enriched.filter((user) => user.identity_type === "guest").length,
    experts: enriched.filter((user) => user.role === "expert").length,
    admins: enriched.filter((user) => user.role === "admin").length,
    active24h: enriched.filter((user) => now - new Date(user.last_active_at).getTime() <= DAY).length,
    active7d: enriched.filter((user) => now - new Date(user.last_active_at).getTime() <= 7 * DAY).length,
    newThisWeek: enriched.filter((user) => now - new Date(user.created_at).getTime() <= 7 * DAY).length,
    activeLearners: enriched.filter((user) => user.questions_answered > 0).length,
    totalAnswers,
    totalSeconds: enriched.reduce((sum, user) => sum + user.total_seconds, 0),
    avgAccuracy: accuracy(totalCorrect, totalAnswers),
  };

  return NextResponse.json({ users: enriched, summary });
}
