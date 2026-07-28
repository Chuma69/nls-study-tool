import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSql } from "@/lib/db";
import { isCourse, isTopicForCourse } from "@/lib/course-topics";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const sql = getSql();
  if (params.get("history") === "1") {
    const sprints = await sql`
      SELECT s.id,s.courses,s.question_count,s.duration_seconds,s.started_at,s.completed_at,s.status,
             count(si.id) FILTER (WHERE si.is_correct)::int AS correct_count
      FROM sprints s LEFT JOIN sprint_items si ON si.sprint_id=s.id
      WHERE s.user_id=${user.id} AND s.status <> 'active'
      GROUP BY s.id ORDER BY COALESCE(s.completed_at,s.started_at) DESC LIMIT 50
    `;
    return NextResponse.json({ sprints });
  }
  const id = Number(params.get("id")); if (!Number.isSafeInteger(id)) return NextResponse.json({ error: "Choose a sprint." }, { status: 400 });
  const sprints = await sql`SELECT id,courses,question_count,duration_seconds,started_at,completed_at,status FROM sprints WHERE id=${id} AND user_id=${user.id} LIMIT 1` as { id: number; courses: string[]; question_count: number; duration_seconds: number; started_at: string; completed_at: string | null; status: string }[];
  const sprint = sprints[0]; if (!sprint) return NextResponse.json({ error: "Sprint not found." }, { status: 404 });
  const finished = sprint.status !== "active";
  const items = await sql`
    SELECT si.position,si.question_id,si.chosen_key,CASE WHEN ${finished} THEN si.is_correct ELSE NULL END AS is_correct,si.seconds_spent,q.course,q.stem,q.options,q.shared_context,q.context_group_id,q.context_position,
           ${finished}::boolean AS finished,
           CASE WHEN ${finished} THEN q.material_supported_key ELSE NULL END AS material_supported_key,
           CASE WHEN ${finished} THEN q.explanation ELSE NULL END AS explanation
    FROM sprint_items si JOIN questions q ON q.id=si.question_id WHERE si.sprint_id=${id} ORDER BY si.position
  `;
  return NextResponse.json({ sprint, items });
}

export async function POST(request: Request) {
  const user = await currentUser(); if (!user) return NextResponse.json({ error: "Start a study session first." }, { status: 401 });
  const body = await request.json() as { action?: "create" | "answer" | "finish"; courses?: string[]; topics?: string[]; count?: number; minutes?: number; sprintId?: number; questionId?: number; chosenKey?: string; secondsSpent?: number; timedOut?: boolean };
  const sql = getSql();
  if (body.action === "create") {
    const courses = [...new Set((body.courses ?? []).filter(isCourse))];
    const topics = [...new Set((body.topics ?? []).map((topic) => topic.trim()).filter(Boolean))];
    const count = Number(body.count); const minutes = Number(body.minutes);
    if (!courses.length || !Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(minutes) || minutes < 1 || minutes > 180) return NextResponse.json({ error: "Choose 1–100 questions and 1–180 minutes." }, { status: 400 });
    if (!topics.length) return NextResponse.json({ error: "Choose at least one topic before starting a sprint." }, { status: 400 });
    if (topics.some((topic) => !courses.some((course) => isTopicForCourse(course, topic)))) return NextResponse.json({ error: "Choose topics from the selected courses." }, { status: 400 });
    const available = await sql`
      SELECT id,context_group_id,context_position FROM questions WHERE question_type='mcq' AND course=ANY(${courses})
        AND material_supported_key IS NOT NULL AND verification_status IN ('material_supported','staff_corrected')
        AND (cardinality(${topics}::text[]) = 0 OR topic = ANY(${topics}))
    ` as { id: number; context_group_id: string | null; context_position: number | null }[];
    const units = new Map<string, typeof available>();
    for (const question of available) { const key = question.context_group_id ?? `question-${question.id}`; units.set(key, [...(units.get(key) ?? []), question]); }
    const shuffled = [...units.values()].sort(() => Math.random() - 0.5);
    const questions: { id: number }[] = [];
    for (const unit of shuffled) {
      const ordered = [...unit].sort((a, b) => (a.context_position ?? 1) - (b.context_position ?? 1));
      if (questions.length + ordered.length <= count) questions.push(...ordered.map(({ id }) => ({ id })));
      if (questions.length === count) break;
    }
    if (questions.length < count) return NextResponse.json({ error: `Only ${questions.length} questions can be assembled without splitting a scenario set. Choose a smaller count.` }, { status: 400 });
    const created = await sql`INSERT INTO sprints(user_id,courses,question_count,duration_seconds) VALUES(${user.id},${JSON.stringify(courses)}::jsonb,${count},${minutes * 60}) RETURNING id` as { id: number }[];
    for (let index = 0; index < questions.length; index += 1) await sql`INSERT INTO sprint_items(sprint_id,question_id,position) VALUES(${created[0].id},${questions[index].id},${index + 1})`;
    return NextResponse.json({ sprintId: created[0].id });
  }
  const sprintId = Number(body.sprintId); if (!Number.isSafeInteger(sprintId)) return NextResponse.json({ error: "Choose a sprint." }, { status: 400 });
  const sprints = await sql`SELECT id,status FROM sprints WHERE id=${sprintId} AND user_id=${user.id} LIMIT 1` as { id: number; status: string }[];
  if (!sprints[0]) return NextResponse.json({ error: "Sprint not found." }, { status: 404 });
  if (body.action === "answer") {
    const questionId = Number(body.questionId);
    if (sprints[0].status !== "active") return NextResponse.json({ error: "This sprint has already ended." }, { status: 400 });
    if (!Number.isSafeInteger(questionId) || !body.chosenKey) return NextResponse.json({ error: "Choose an answer before continuing." }, { status: 400 });
    const rows = await sql`SELECT q.material_supported_key,q.options,si.chosen_key FROM sprint_items si JOIN questions q ON q.id=si.question_id WHERE si.sprint_id=${sprintId} AND si.question_id=${questionId}` as { material_supported_key: string; options: { key: string }[]; chosen_key: string | null }[];
    const question = rows[0]; if (!question?.options.some((option) => option.key === body.chosenKey)) return NextResponse.json({ error: "Invalid sprint answer." }, { status: 400 });
    // A duplicate browser request should not make a learner lose their answer.
    if (question.chosen_key) return NextResponse.json({ ok: true, alreadyRecorded: true });
    const correct = question.material_supported_key === body.chosenKey; const seconds = Math.max(0, Math.min(7200, Math.round(Number(body.secondsSpent) || 0)));
    await sql`UPDATE sprint_items SET chosen_key=${body.chosenKey},is_correct=${correct},seconds_spent=${seconds},answered_at=now() WHERE sprint_id=${sprintId} AND question_id=${questionId}`;
    await sql`INSERT INTO attempts(user_id,question_id,chosen_key,is_correct,seconds_spent) VALUES(${user.id},${questionId},${body.chosenKey},${correct},${seconds})`;
    return NextResponse.json({ ok: true });
  }
  if (body.action === "finish") {
    if (sprints[0].status === "active") {
      const unanswered = await sql`UPDATE sprint_items SET is_correct=false, seconds_spent=0, answered_at=now() WHERE sprint_id=${sprintId} AND chosen_key IS NULL RETURNING question_id` as { question_id: number }[];
      for (const item of unanswered) await sql`INSERT INTO attempts(user_id,question_id,chosen_key,is_correct,seconds_spent) VALUES(${user.id},${item.question_id},NULL,false,0)`;
      await sql`UPDATE sprints SET status=${body.timedOut ? 'timed_out' : 'completed'},completed_at=now() WHERE id=${sprintId}`;
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Invalid sprint action." }, { status: 400 });
}
