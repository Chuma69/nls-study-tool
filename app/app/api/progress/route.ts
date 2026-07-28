import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

type SessionRow = { id: number; course: string; started_at: string; last_activity_at: string; answers_count: number; correct_count: number; total_seconds: number };
type CourseRow = { course: string; total_questions: number; attempted_questions: number; correct_questions: number; total_topics: number; covered_topics: number };

const courseIds = ["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills"];

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  const sessions = await getSql()`
    SELECT id, course, started_at, last_activity_at, answers_count, correct_count, total_seconds
    FROM practice_sessions WHERE user_id = ${user.id}
    ORDER BY last_activity_at DESC LIMIT 50
  ` as SessionRow[];
  const rawCourses = await getSql()`
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
    return { ...row, accuracy, coverage };
  });
  const totals = courses.reduce((sum, course) => ({
    questions: sum.questions + course.total_questions,
    answered: sum.answered + course.attempted_questions,
    topics: sum.topics + course.total_topics,
    topicsCovered: sum.topicsCovered + course.covered_topics,
  }), { questions: 0, answered: 0, topics: 0, topicsCovered: 0 });
  const coverage = { ...totals, percentage: totals.questions ? Math.round(totals.answered / totals.questions * 100) : 0 };
  return NextResponse.json({ sessions, courses, coverage });
}
