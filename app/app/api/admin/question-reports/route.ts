import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { isCourse } from "@/lib/course-topics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(5, Number(url.searchParams.get("limit") ?? 10) || 10));
  const status = ["open", "resolved", "all"].includes(url.searchParams.get("status") ?? "") ? (url.searchParams.get("status") as "open" | "resolved" | "all") : "open";
  const requestedCourse = url.searchParams.get("course") ?? "";
  const course = isCourse(requestedCourse) ? requestedCourse : "";
  // Learner view = learner reports + admin flags. Expert view = expert answer reviews,
  // flags, and reclassification proposals. Keeps the two audiences in separate queues.
  const source = url.searchParams.get("source") === "expert" ? "expert" : "learner";
  const offset = (page - 1) * limit;
  const sql = getSql();
  const reports = await sql`
    WITH review_queue AS (
      SELECT r.id,'learner_report'::text AS review_source,r.question_id,r.category,r.details,r.created_at,
             CASE WHEN r.status='open' THEN 'open' ELSE 'resolved' END::text AS queue_status,
             COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),'Learner') AS reporter,
             r.proposed_course, r.proposed_topic
      FROM question_reports r LEFT JOIN users u ON u.id=r.user_id
      WHERE (${source}='learner' AND COALESCE(u.role,'learner') <> 'expert') OR (${source}='expert' AND u.role='expert')
      UNION ALL
      SELECT f.id,'admin_flag'::text AS review_source,f.question_id,'flagged_for_review'::text AS category,f.note AS details,f.created_at,
             CASE WHEN f.resolved_at IS NULL THEN 'open' ELSE 'resolved' END::text AS queue_status,
             COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),'Admin') AS reporter,
             NULL::text AS proposed_course, NULL::text AS proposed_topic
      FROM question_flags f LEFT JOIN users u ON u.id=f.user_id
      WHERE f.kind='admin_review' AND ${source}='learner'
      UNION ALL
      SELECT er.id,'expert_answer'::text AS review_source,er.question_id,'answer_review'::text AS category,
             ('Chose '||er.selected_key||' · '||er.confidence||' confidence'||CASE WHEN NULLIF(trim(er.explanation),'') IS NOT NULL THEN ' — '||er.explanation ELSE '' END) AS details,
             er.created_at,
             CASE WHEN q2.verification_status IN ('material_supported','staff_corrected') THEN 'resolved' ELSE 'open' END::text AS queue_status,
             COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),'Expert') AS reporter,
             NULL::text AS proposed_course, NULL::text AS proposed_topic
      FROM expert_reviews er JOIN questions q2 ON q2.id=er.question_id LEFT JOIN users u ON u.id=er.expert_id
      WHERE er.status='submitted' AND ${source}='expert'
    ), matching_queue AS (
      SELECT queue.*
      FROM review_queue queue JOIN questions q ON q.id=queue.question_id
      WHERE (${status}='all' OR queue.queue_status=${status})
        AND (${course}='' OR q.course=${course})
    ), paged_questions AS (
      SELECT question_id,min(created_at) AS first_created_at
      FROM matching_queue GROUP BY question_id
      ORDER BY first_created_at ASC,question_id ASC LIMIT ${limit} OFFSET ${offset}
    )
    SELECT q.id AS question_id,q.stem,q.options,q.material_supported_key,q.explanation,q.course,q.topic,
           CASE WHEN bool_or(mq.queue_status='open') THEN 'open' ELSE 'resolved' END::text AS queue_status,
           min(mq.id)::int AS id,
           CASE WHEN count(DISTINCT mq.review_source)>1 THEN 'mixed' ELSE min(mq.review_source) END::text AS review_source,
           count(*)::int AS review_count,
           json_agg(json_build_object(
             'id',mq.id,'review_source',mq.review_source,'category',mq.category,'details',mq.details,
             'created_at',mq.created_at,'queue_status',mq.queue_status,'reporter',mq.reporter,
             'proposed_course',mq.proposed_course,'proposed_topic',mq.proposed_topic
           ) ORDER BY mq.created_at ASC,mq.id ASC) AS reviews
    FROM paged_questions pq
    JOIN matching_queue mq ON mq.question_id=pq.question_id
    JOIN questions q ON q.id=pq.question_id
    GROUP BY q.id,q.stem,q.options,q.material_supported_key,q.explanation,q.course,q.topic,pq.first_created_at
    ORDER BY pq.first_created_at ASC,q.id ASC
  `;
  const counts = await sql`
    WITH review_queue AS (
      SELECT r.question_id,CASE WHEN r.status='open' THEN 'open' ELSE 'resolved' END::text AS queue_status
      FROM question_reports r LEFT JOIN users u ON u.id=r.user_id
      WHERE (${source}='learner' AND COALESCE(u.role,'learner') <> 'expert') OR (${source}='expert' AND u.role='expert')
      UNION ALL
      SELECT f.question_id,CASE WHEN f.resolved_at IS NULL THEN 'open' ELSE 'resolved' END::text AS queue_status
      FROM question_flags f WHERE f.kind='admin_review' AND ${source}='learner'
      UNION ALL
      SELECT er.question_id,CASE WHEN q2.verification_status IN ('material_supported','staff_corrected') THEN 'resolved' ELSE 'open' END::text AS queue_status
      FROM expert_reviews er JOIN questions q2 ON q2.id=er.question_id WHERE er.status='submitted' AND ${source}='expert'
    )
    SELECT
      count(DISTINCT queue.question_id) FILTER (WHERE (${status}='all' OR queue.queue_status=${status}) AND (${course}='' OR q.course=${course}))::int AS total,
      count(DISTINCT queue.question_id) FILTER (WHERE queue.queue_status='open')::int AS open_total
    FROM review_queue queue JOIN questions q ON q.id=queue.question_id
  ` as { total: number; open_total: number }[];
  return NextResponse.json({ reports, page, limit, status, course, total: counts[0]?.total ?? 0, openTotal: counts[0]?.open_total ?? 0 });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { reportId?: number | string; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string; course?: string; topic?: string; action?: "save" | "dismiss" | "apply_reclassify" };
  const reportId = Number(body.reportId);
  if (!Number.isSafeInteger(reportId) || !["save", "dismiss", "apply_reclassify"].includes(body.action ?? "")) return NextResponse.json({ error: "Invalid report update." }, { status: 400 });
  const sql = getSql();
  if (body.action === "dismiss") { await sql`UPDATE question_reports SET status='dismissed',resolved_by=${auth.user.id},resolved_at=now() WHERE id=${reportId}`; return NextResponse.json({ ok: true }); }
  // Publish an expert's proposed course/topic reassignment onto the question.
  if (body.action === "apply_reclassify") {
    const proposal = await sql`SELECT question_id, proposed_course, proposed_topic FROM question_reports WHERE id=${reportId} AND status='open' AND category='reclassify' LIMIT 1` as { question_id: number; proposed_course: string | null; proposed_topic: string | null }[];
    if (!proposal[0]) return NextResponse.json({ error: "This reassignment is no longer open." }, { status: 404 });
    const { isCourse, isTopicForCourse } = await import("@/lib/course-topics");
    const proposedCourse = proposal[0].proposed_course ?? "";
    const proposedTopic = proposal[0].proposed_topic ?? "";
    if (!isCourse(proposedCourse) || !isTopicForCourse(proposedCourse, proposedTopic)) return NextResponse.json({ error: "The proposed course/topic is no longer valid." }, { status: 400 });
    await sql`UPDATE questions SET course=${proposedCourse},topic=${proposedTopic},updated_at=now() WHERE id=${proposal[0].question_id}`;
    await sql`UPDATE question_reports SET status='resolved',resolved_by=${auth.user.id},resolved_at=now(),resolution_note='Reassignment applied by admin.' WHERE id=${reportId}`;
    return NextResponse.json({ ok: true });
  }
  const stem = (body.stem ?? "").trim(); const explanation = (body.explanation ?? "").trim(); const options = body.options ?? [];
  if (!stem || !explanation || !options.length || !body.answerKey || !options.some((option) => option.key === body.answerKey && option.text.trim())) return NextResponse.json({ error: "Keep a question, answer options, the correct answer, and an explanation." }, { status: 400 });
  const report = await sql`SELECT question_id FROM question_reports WHERE id=${reportId} AND status='open' LIMIT 1` as { question_id: number }[];
  if (!report[0]) return NextResponse.json({ error: "This report is no longer open." }, { status: 404 });
  const { isCourse, isTopicForCourse } = await import("@/lib/course-topics");
  if (!body.course || !isCourse(body.course)) return NextResponse.json({ error: "Choose one of the five courses." }, { status: 400 });
  if (!body.topic || !isTopicForCourse(body.course, body.topic)) return NextResponse.json({ error: "Choose an official topic for the selected course." }, { status: 400 });
  await sql`UPDATE questions SET course=${body.course},topic=${body.topic},stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey},verification_status='staff_corrected',explanation=${explanation},updated_at=now() WHERE id=${report[0].question_id}`;
  const resolvedReports = await sql`
    UPDATE question_reports
    SET status='resolved', resolved_by=${auth.user.id}, resolved_at=now(), resolution_note='Question updated by admin.'
    WHERE question_id=${report[0].question_id} AND status='open'
    RETURNING id
  ` as { id: number }[];
  const resolvedFlags = await sql`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=${report[0].question_id} AND kind='admin_review' AND resolved_at IS NULL RETURNING id` as { id: number }[];
  return NextResponse.json({ ok: true, resolvedReports: resolvedReports.length, resolvedReviewFlags: resolvedFlags.length });
}
