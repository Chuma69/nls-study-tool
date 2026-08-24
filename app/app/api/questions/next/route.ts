import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { isCourse, isTopicForCourse } from "@/lib/course-topics";

export const runtime = "nodejs";

type QuestionRow = {
  id: number;
  course: string | null;
  topic: string | null;
  exam_years: string[];
  stem: string;
  options: { key: string; text: string }[];
  verification_status: string;
  explanation: string | null;
  source_locator: string | null;
  display_name: string | null;
  rel_source_path: string | null;
  shared_context: string | null;
  context_group_id: string | null;
  context_position: number | null;
};

type CountRow = { total: number; attempted: number };
type SessionRow = { id: number; answers_count: number; last_question_id: number | null };

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });

  const url = new URL(request.url);
  const selectedCourses = [...new Set(url.searchParams.getAll("course").map((course) => course.trim()).filter(Boolean))];
  const selectedTopics = [...new Set([
    ...url.searchParams.getAll("topic"),
    ...(url.searchParams.get("topics") ?? "").split(","),
  ].map((topic) => topic.trim()).filter(Boolean))];
  const excludedQuestionId = Number(new URL(request.url).searchParams.get("exclude")) || 0;
  // Questions already served in the current run — excluded so a single run never repeats a question.
  const seenQuestionIds = [...new Set((url.searchParams.get("seen") ?? "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0))];
  const requestedQuestionId = Number(new URL(request.url).searchParams.get("question")) || 0;
  const requestedSessionId = Number(new URL(request.url).searchParams.get("session")) || 0;
  if (selectedCourses.some((course) => !isCourse(course))) {
    return NextResponse.json({ error: "Choose one of the listed courses." }, { status: 400 });
  }
  // Topic names are unique across courses, so a topic is valid if it belongs to any selected course.
  if (selectedTopics.length && (!selectedCourses.length || selectedTopics.some((topic) => !selectedCourses.some((course) => isTopicForCourse(course, topic))))) {
    return NextResponse.json({ error: "Choose topics from the selected courses." }, { status: 400 });
  }
  if (!selectedTopics.length) {
    return NextResponse.json({ error: "Choose at least one topic before starting practice." }, { status: 400 });
  }
  const sessions = requestedSessionId ? await getSql()`
    SELECT id, answers_count, last_question_id FROM practice_sessions
    WHERE id = ${requestedSessionId} AND user_id = ${user.id} AND ended_at IS NULL
    LIMIT 1
  ` as SessionRow[] : [];
  const session = sessions[0] ?? null;
  const sessionLastQuestionId = session?.last_question_id ?? 0;
  const rows = requestedQuestionId ? await getSql()`
    SELECT q.id, q.course, q.topic, q.exam_years, q.stem, q.options, q.explanation,q.shared_context,q.context_group_id,q.context_position,
           q.verification_status, q.source_locator, s.display_name, s.rel_source_path,
           false AS previously_failed
    FROM questions q LEFT JOIN source_documents s ON s.id = q.source_document_id
    WHERE q.id = ${requestedQuestionId} AND q.question_type = 'mcq'
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
      AND NOT EXISTS (SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')
      AND (cardinality(${selectedCourses}::text[]) = 0 OR q.course = ANY(${selectedCourses}))
      AND (cardinality(${selectedTopics}::text[]) = 0 OR q.topic = ANY(${selectedTopics}))
    LIMIT 1
  ` as QuestionRow[] : await getSql()`
    SELECT q.id, q.course, q.topic, q.exam_years, q.stem, q.options, q.explanation,q.shared_context,q.context_group_id,q.context_position,
           q.verification_status, q.source_locator,
           s.display_name, s.rel_source_path,
           COALESCE(bool_or(a.is_correct = false), false) AS previously_failed
    FROM questions q
    LEFT JOIN attempts a ON a.question_id = q.id AND a.user_id = ${user.id}
    LEFT JOIN source_documents s ON s.id = q.source_document_id
    WHERE q.question_type = 'mcq'
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
      AND NOT EXISTS (SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')
      AND (cardinality(${selectedCourses}::text[]) = 0 OR q.course = ANY(${selectedCourses}))
      AND (cardinality(${selectedTopics}::text[]) = 0 OR q.topic = ANY(${selectedTopics}))
      AND (${excludedQuestionId} = 0 OR q.id <> ${excludedQuestionId})
      AND (${sessionLastQuestionId} = 0 OR q.id <> ${sessionLastQuestionId})
      AND (cardinality(${seenQuestionIds}::int[]) = 0 OR q.id <> ALL(${seenQuestionIds}::int[]))
      AND (q.context_group_id IS NULL OR q.context_position=1)
    GROUP BY q.id, s.display_name, s.rel_source_path
    ORDER BY
      -- Tier fresh questions first, then ones the learner has failed, and finally
      -- ones already answered correctly (surfaced only as backfill, so mastered
      -- questions resurface far less often across runs). Random within each tier.
      CASE
        WHEN bool_or(a.is_correct) IS NULL THEN 0
        WHEN bool_or(a.is_correct) THEN 2
        ELSE 1
      END,
      random()
    LIMIT 1
  ` as QuestionRow[];

  let questionGroup = rows;
  if (rows[0]?.context_group_id) {
    questionGroup = await getSql()`
      SELECT q.id,q.course,q.topic,q.exam_years,q.stem,q.options,q.explanation,q.verification_status,q.source_locator,
             q.shared_context,q.context_group_id,q.context_position,s.display_name,s.rel_source_path
      FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
      WHERE q.context_group_id=${rows[0].context_group_id} AND q.question_type='mcq'
        AND q.material_supported_key IS NOT NULL AND q.verification_status IN ('material_supported','staff_corrected')
        AND NOT EXISTS (SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')
      ORDER BY q.context_position,q.id
    ` as QuestionRow[];
    // A direct question URL must reopen that exact subquestion, not jump back
    // to the first item in its scenario/group. Keep only it and the questions
    // that follow it in the fixed learner order.
    if (requestedQuestionId) {
      const requestedIndex = questionGroup.findIndex((question) => Number(question.id) === requestedQuestionId);
      if (requestedIndex >= 0) questionGroup = questionGroup.slice(requestedIndex);
    }
  }

  const totals = await getSql()`
    SELECT count(DISTINCT q.id)::int AS total,
           count(DISTINCT q.id) FILTER (WHERE a.question_id IS NOT NULL)::int AS attempted
    FROM questions q
    LEFT JOIN attempts a ON a.question_id = q.id AND a.user_id = ${user.id}
    WHERE q.question_type = 'mcq'
      AND q.material_supported_key IS NOT NULL
      AND q.verification_status IN ('material_supported', 'staff_corrected')
      AND NOT EXISTS (SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')
      AND (cardinality(${selectedCourses}::text[]) = 0 OR q.course = ANY(${selectedCourses}))
      AND (cardinality(${selectedTopics}::text[]) = 0 OR q.topic = ANY(${selectedTopics}))
  ` as CountRow[];

  return NextResponse.json({
    question: questionGroup[0] ?? null,
    questionGroup,
    // Every MCQ row counts once. A shared scenario is context only, so a
    // scenario with four linked MCQs contributes four to this total.
    totalQuestions: totals[0]?.total ?? 0,
    // Do not use practice_sessions.answers_count here: it includes retries
    // and can exceed the current live bank after filters or publishing changes.
    attemptedQuestions: totals[0]?.attempted ?? 0,
  });
}
