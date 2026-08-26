import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSql } from "@/lib/db";
import { isCourse, isTopicForCourse } from "@/lib/course-topics";

export const runtime = "nodejs";

const CATEGORIES = ["typo", "answer", "missing_case_study", "other", "reclassify"];

export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const body = await request.json() as { questionId?: number | string; category?: string; details?: string; proposedCourse?: string; proposedTopic?: string };
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId) || !CATEGORIES.includes(body.category ?? "")) return NextResponse.json({ error: "Choose the problem you found." }, { status: 400 });
  const details = (body.details ?? "").trim().slice(0, 2000);
  const sql = getSql();

  // A course/topic reassignment is a proposal only — it is stored for admin review and
  // does not change the question or unpublish it.
  if (body.category === "reclassify") {
    const course = (body.proposedCourse ?? "").trim();
    const topic = (body.proposedTopic ?? "").trim();
    if (!isCourse(course) || !isTopicForCourse(course, topic)) return NextResponse.json({ error: "Choose a course and a topic within it." }, { status: 400 });
    await sql`INSERT INTO question_reports(question_id,user_id,category,details,proposed_course,proposed_topic) VALUES(${questionId},${user.id},'reclassify',${details || null},${course},${topic})`;
    return NextResponse.json({ ok: true });
  }

  await sql`INSERT INTO question_reports(question_id,user_id,category,details) VALUES(${questionId},${user.id},${body.category},${details || null})`;
  await sql`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=${questionId}`;
  return NextResponse.json({ ok: true });
}
