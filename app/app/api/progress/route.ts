import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

type SessionRow = { id: number; course: string; started_at: string; last_activity_at: string; answers_count: number; correct_count: number; total_seconds: number };
type SprintRow = { id: number; started_at: string; completed_at: string | null; status: string; question_count: number; correct_count: number; answered_count: number; duration_seconds: number };
type CourseRow = { course: string; total_questions: number; attempted_questions: number; correct_questions: number; total_topics: number; covered_topics: number };

const courseIds = ["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills"];

function readinessForCourse(total: number, attempted: number, correct: number) {
  if (!total || !attempted) return 0;
  const coverage = attempted / total * 100;
  const accuracy = correct / attempted * 100;
  // A short run of answers is volatile. Accuracy starts from a neutral 50%
  // and reaches its observed value after 20 distinct questions.
  const confidence = Math.min(attempted / 20, 1);
  const calibratedAccuracy = 50 + (accuracy - 50) * confidence;
  return Math.round(calibratedAccuracy * 0.55 + coverage * 0.45);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  const sql = getSql();
  const sessions = await sql`
    SELECT id, course, started_at, last_activity_at, answers_count, correct_count, total_seconds
    FROM practice_sessions WHERE user_id = ${user.id}
    ORDER BY last_activity_at DESC LIMIT 50
  ` as SessionRow[];
  const sprints = await sql`
    SELECT s.id,s.started_at,s.completed_at,s.status,s.question_count,s.duration_seconds,
           count(si.id) FILTER (WHERE si.chosen_key IS NOT NULL)::int AS answered_count,
           count(si.id) FILTER (WHERE si.is_correct)::int AS correct_count
    FROM sprints s LEFT JOIN sprint_items si ON si.sprint_id=s.id
    WHERE s.user_id=${user.id} AND s.status <> 'active'
    GROUP BY s.id ORDER BY COALESCE(s.completed_at,s.started_at) DESC LIMIT 50
  ` as SprintRow[];
  const rawCourses = await sql`
    WITH latest_attempt AS (
      SELECT DISTINCT ON (question_id) question_id, is_correct
      FROM attempts WHERE user_id = ${user.id}
      ORDER BY question_id, answered_at DESC, id DESC
    )
    SELECT q.course, count(*)::int AS total_questions,
           count(la.question_id)::int AS attempted_questions,
           count(*) FILTER (WHERE la.is_correct)::int AS correct_questions,
           count(DISTINCT NULLIF(q.topic, ''))::int AS total_topics,
           count(DISTINCT NULLIF(q.topic, '')) FILTER (WHERE la.question_id IS NOT NULL)::int AS covered_topics
    FROM questions q
    LEFT JOIN latest_attempt la ON la.question_id = q.id
    WHERE q.question_type = 'mcq' AND q.course = ANY(${courseIds})
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
    GROUP BY q.course
  ` as CourseRow[];
  const lookup = new Map(rawCourses.map((row) => [row.course, row]));
  const courses = courseIds.map((course) => {
    const row = lookup.get(course) ?? { course, total_questions: 0, attempted_questions: 0, correct_questions: 0, total_topics: 0, covered_topics: 0 };
    const accuracy = row.attempted_questions ? Math.round(row.correct_questions / row.attempted_questions * 100) : 0;
    const coverage = row.total_questions ? Math.round(row.attempted_questions / row.total_questions * 100) : 0;
    return { ...row, readiness: readinessForCourse(row.total_questions, row.attempted_questions, row.correct_questions), accuracy, coverage };
  });
  const totals = courses.reduce((sum, course) => ({
    questions: sum.questions + course.total_questions,
    answered: sum.answered + course.attempted_questions,
    topics: sum.topics + course.total_topics,
    topicsCovered: sum.topicsCovered + course.covered_topics,
  }), { questions: 0, answered: 0, topics: 0, topicsCovered: 0 });
  const coverage = { ...totals, percentage: totals.questions ? Math.round(totals.answered / totals.questions * 100) : 0 };
  const activeCourses = courses.filter((course) => course.total_questions > 0);
  const average = activeCourses.length ? activeCourses.reduce((sum, course) => sum + course.readiness, 0) / activeCourses.length : 0;
  const weakest = activeCourses.length ? activeCourses.reduce((lowest, course) => course.readiness < lowest.readiness ? course : lowest) : null;
  const overall = activeCourses.length ? Math.round(average * 0.8 + (weakest?.readiness ?? 0) * 0.2) : 0;
  const streakRows = await sql`
    WITH RECURSIVE active_days AS (
      SELECT DISTINCT (answered_at AT TIME ZONE 'Africa/Lagos')::date AS day
      FROM attempts WHERE user_id = ${user.id}
    ), streak(day) AS (
      SELECT CURRENT_DATE WHERE EXISTS (SELECT 1 FROM active_days WHERE day = CURRENT_DATE)
      UNION ALL
      SELECT streak.day - 1 FROM streak
      WHERE EXISTS (SELECT 1 FROM active_days WHERE day = streak.day - 1)
    ) SELECT count(*)::int AS days FROM streak
  ` as { days: number }[];
  return NextResponse.json({ sessions, sprints, courses, coverage, readiness: { overall, weakestCourse: weakest?.course ?? null, streak: streakRows[0]?.days ?? 0 } });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  const course = new URL(request.url).searchParams.get("course") ?? "";
  if (!courseIds.includes(course)) return NextResponse.json({ error: "Choose one of the listed courses." }, { status: 400 });
  const sql = getSql();
  await sql`
    DELETE FROM attempts a
    USING questions q
    WHERE a.question_id = q.id AND a.user_id = ${user.id} AND q.course = ${course}
  `;
  await sql`DELETE FROM practice_sessions WHERE user_id = ${user.id} AND course = ${course}`;
  return NextResponse.json({ ok: true });
}
