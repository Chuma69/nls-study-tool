import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

type QuestionRow = {
  id: number;
  course: string | null;
  exam_years: string[];
  stem: string;
  options: { key: string; text: string }[];
  verification_status: string;
  explanation: string | null;
  source_locator: string | null;
  display_name: string | null;
  rel_source_path: string | null;
};

type CountRow = { total: number };
type SessionRow = { id: number; answers_count: number; last_question_id: number | null };

const courses = new Set(["civil_litigation", "criminal_litigation", "corporate_law_practice", "property_law_practice", "professional_ethics_skills"]);

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });

  const selectedCourse = new URL(request.url).searchParams.get("course") ?? "";
  const excludedQuestionId = Number(new URL(request.url).searchParams.get("exclude")) || 0;
  const requestedQuestionId = Number(new URL(request.url).searchParams.get("question")) || 0;
  const requestedSessionId = Number(new URL(request.url).searchParams.get("session")) || 0;
  if (selectedCourse && !courses.has(selectedCourse)) {
    return NextResponse.json({ error: "Choose one of the listed courses." }, { status: 400 });
  }
  const sessions = requestedSessionId ? await getSql()`
    SELECT id, answers_count, last_question_id FROM practice_sessions
    WHERE id = ${requestedSessionId} AND user_id = ${user.id} AND course = ${selectedCourse} AND ended_at IS NULL
    LIMIT 1
  ` as SessionRow[] : [];
  const session = sessions[0] ?? null;
  const sessionLastQuestionId = session?.last_question_id ?? 0;
  const rows = requestedQuestionId ? await getSql()`
    SELECT q.id, q.course, q.exam_years, q.stem, q.options, q.explanation,
           q.verification_status, q.source_locator, s.display_name, s.rel_source_path,
           false AS previously_failed
    FROM questions q LEFT JOIN source_documents s ON s.id = q.source_document_id
    WHERE q.id = ${requestedQuestionId} AND q.question_type = 'mcq'
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
      AND (${selectedCourse} = '' OR q.course = ${selectedCourse})
    LIMIT 1
  ` as QuestionRow[] : await getSql()`
    SELECT q.id, q.course, q.exam_years, q.stem, q.options, q.explanation,
           q.verification_status, q.source_locator,
           s.display_name, s.rel_source_path,
           COALESCE(bool_or(a.is_correct = false), false) AS previously_failed
    FROM questions q
    LEFT JOIN attempts a ON a.question_id = q.id AND a.user_id = ${user.id}
    LEFT JOIN source_documents s ON s.id = q.source_document_id
    WHERE q.question_type = 'mcq'
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
      AND (${selectedCourse} = '' OR q.course = ${selectedCourse})
      AND (${excludedQuestionId} = 0 OR q.id <> ${excludedQuestionId})
      AND (${sessionLastQuestionId} = 0 OR q.id <> ${sessionLastQuestionId})
    GROUP BY q.id, s.display_name, s.rel_source_path
    HAVING NOT COALESCE(bool_or(a.is_correct), false)
    ORDER BY COALESCE(bool_or(a.is_correct = false), false) ASC, random()
    LIMIT 1
  ` as QuestionRow[];

  const totals = await getSql()`
    SELECT count(*)::int AS total
    FROM questions q
    WHERE q.question_type = 'mcq'
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
      AND (${selectedCourse} = '' OR q.course = ${selectedCourse})
  ` as CountRow[];

  return NextResponse.json({ question: rows[0] ?? null, totalQuestions: totals[0]?.total ?? 0, answeredCount: session?.answers_count ?? 0 });
}
