import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { COURSE_IDS, isCourse, isTopicForCourse } from "@/lib/course-topics";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { questionType?: string; structure?: "standalone" | "scenario" | "group"; contextGroupId?: string; scenario?: string; course?: string; topic?: string; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string; publish?: boolean };
  if (body.questionType !== "mcq") return NextResponse.json({ error: "Only multiple-choice questions can be created while the MCQ bank is active." }, { status: 400 });
  const course = body.course ?? ""; const topic = body.topic ?? ""; const stem = (body.stem ?? "").trim(); const explanation = (body.explanation ?? "").trim();
  const options = (body.options ?? []).map((option) => ({ key: option.key.toUpperCase(), text: option.text.trim() })).filter((option) => option.text);
  const answerKey = (body.answerKey ?? "").toUpperCase();
  const wantsPublish = body.publish !== false;
  if (!isCourse(course)) return NextResponse.json({ error: "Choose one of the five courses." }, { status: 400 });
  if ((wantsPublish && !isTopicForCourse(course, topic)) || (topic && !isTopicForCourse(course, topic))) return NextResponse.json({ error: "Choose a valid official topic before publishing." }, { status: 400 });
  if (!stem || options.length < 2) return NextResponse.json({ error: "Add the question and at least two options." }, { status: 400 });
  if (wantsPublish && (!options.some((option) => option.key === answerKey) || !explanation)) return NextResponse.json({ error: "Choose the correct answer and add an explanation before publishing." }, { status: 400 });
  let contextGroupId = (body.contextGroupId ?? "").trim() || null; let sharedContext = (body.scenario ?? "").trim() || null; let position: number | null = null;
  if (contextGroupId) {
    const group = await getSql()`SELECT course,shared_context,COALESCE(max(context_position),0)::int AS last_position FROM questions WHERE context_group_id=${contextGroupId} GROUP BY course,shared_context LIMIT 1` as { course: string | null; shared_context: string | null; last_position: number }[];
    if (!group.length || group[0].course !== course) return NextResponse.json({ error: "The selected question set belongs to a different course." }, { status: 400 });
    sharedContext = group[0].shared_context; position = group[0].last_position + 1;
  } else if (body.structure === "scenario") {
    if (!sharedContext) return NextResponse.json({ error: "Add the case study text." }, { status: 400 });
    contextGroupId = crypto.randomUUID(); position = 1;
  } else if (body.structure === "group") {
    contextGroupId = crypto.randomUUID(); sharedContext = null; position = 1;
  }
  const fingerprint = `admin:${crypto.randomUUID()}`;
  const inserted = await getSql()`INSERT INTO questions(question_fingerprint,question_type,course,topic,stem,options,material_supported_key,verification_status,explanation,source_locator,context_group_id,shared_context,context_position,allowlisted_at,allowlisted_by) VALUES(${fingerprint},'mcq',${course},${topic || null},${stem},${JSON.stringify(options)}::jsonb,${answerKey || null},${wantsPublish ? "staff_corrected" : "unreviewed"},${explanation || null},'admin-created',${contextGroupId},${sharedContext},${position},${wantsPublish ? new Date().toISOString() : null},${wantsPublish ? auth.user.id : null}) RETURNING id,course,topic,stem,options,material_supported_key,explanation,verification_status,context_group_id,shared_context,context_position`;
  return NextResponse.json({ ok: true, question: inserted[0] }, { status: 201 });
}
export async function GET(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const url = new URL(request.url); const requestedQuestionId = Number(url.searchParams.get("questionId")); const snapshot = url.searchParams.get("snapshot") === "1"; const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200); const course = url.searchParams.get("course") ?? ""; const topic = url.searchParams.get("topic") ?? ""; const status = url.searchParams.get("status") ?? ""; const scenario = url.searchParams.get("scenario") ?? ""; const allowlist = url.searchParams.get("allowlist") ?? ""; const view = url.searchParams.get("view") ?? "list"; const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const requestedLimit = Number(url.searchParams.get("limit")) || 25; const limit = view === "review" ? 1 : ([10,25,50,100].includes(requestedLimit) ? requestedLimit : 25); const offset = (page - 1) * limit;
  if (Number.isSafeInteger(requestedQuestionId) && requestedQuestionId > 0) {
    const rows = await getSql()`SELECT q.id,COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'),'') AS course,q.topic,q.stem,q.options,q.material_supported_key,q.explanation,q.verification_status,q.shared_context,q.context_group_id,q.context_position,q.allowlisted_at,q.allowlisted_by,(q.allowlisted_at IS NOT NULL) AS allowlisted FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id WHERE q.id=${requestedQuestionId} AND q.question_type='mcq' LIMIT 1`;
    if (!rows.length) return NextResponse.json({ error: "Question not found." }, { status: 404 });
    const reviewFlags = await getSql()`
      SELECT qf.id,qf.note,qf.created_at,
             COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),'Admin') AS reviewer
      FROM question_flags qf
      LEFT JOIN users u ON u.id=qf.user_id
      WHERE qf.question_id=${requestedQuestionId}
        AND qf.kind='admin_review'
        AND qf.resolved_at IS NULL
      ORDER BY qf.created_at DESC,qf.id DESC
    `;
    const learnerReviews = await getSql()`
      SELECT r.id,r.category,r.details,r.created_at,
             COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),'Learner') AS reporter
      FROM question_reports r
      LEFT JOIN users u ON u.id=r.user_id
      WHERE r.question_id=${requestedQuestionId} AND r.status='open'
      ORDER BY r.created_at DESC,r.id DESC
    `;
    return NextResponse.json({ question: rows[0], reviewFlags, learnerReviews });
  }
  if (course && course !== "none" && !isCourse(course)) return NextResponse.json({ error: "Unknown course." }, { status: 400 });
  if (topic && topic !== "none" && !COURSE_IDS.some((id) => isTopicForCourse(id, topic))) return NextResponse.json({ error: "Unknown topic." }, { status: 400 });
  if (topic && topic !== "none" && course && course !== "none" && !isTopicForCourse(course, topic)) return NextResponse.json({ error: "That topic is not part of the selected course." }, { status: 400 });
  if (status && !["live", "not_live", "flagged"].includes(status)) return NextResponse.json({ error: "Unknown question status." }, { status: 400 });
  if (scenario && !["grouped", "scenario", "group", "standalone"].includes(scenario)) return NextResponse.json({ error: "Unknown question structure." }, { status: 400 });
  if (allowlist && !["allowlisted", "not_allowlisted"].includes(allowlist)) return NextResponse.json({ error: "Unknown allowlist status." }, { status: 400 });
  if (!['list', 'review'].includes(view)) return NextResponse.json({ error: "Unknown question-bank view." }, { status: 400 });
  const sql = getSql(); const pattern = `%${search}%`;
  if (snapshot) {
    const rows = await sql`
      SELECT q.id
      FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
      WHERE q.question_type='mcq'
        AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course}))
        AND (${search}='' OR q.stem ILIKE ${pattern} OR q.shared_context ILIKE ${pattern})
        AND (${status}='' OR (${status}='flagged' AND (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open'))) OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')))
        AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))
        AND (${scenario}='' OR (${scenario}='grouped' AND q.context_group_id IS NOT NULL) OR (${scenario}='scenario' AND q.context_group_id IS NOT NULL AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NOT NULL) OR (${scenario}='group' AND q.context_group_id IS NOT NULL AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NULL) OR (${scenario}='standalone' AND q.context_group_id IS NULL))
        AND (${allowlist}='' OR (${allowlist}='allowlisted' AND q.allowlisted_at IS NOT NULL) OR (${allowlist}='not_allowlisted' AND q.allowlisted_at IS NULL))
      ORDER BY CASE WHEN q.context_group_id IS NULL THEN 1 ELSE 0 END,q.context_group_id,q.context_position,q.id DESC
    ` as { id: number }[];
    return NextResponse.json({ questionIds: rows.map((row) => row.id), total: rows.length });
  }
  if (view !== "review" && ["grouped", "scenario", "group"].includes(scenario)) {
    const groupCounts = await sql`
      SELECT count(DISTINCT q.context_group_id)::int AS total
      FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
      WHERE q.question_type='mcq' AND q.context_group_id IS NOT NULL
        AND (${scenario}='grouped' OR (${scenario}='scenario' AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NOT NULL) OR (${scenario}='group' AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NULL))
        AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course}))
        AND (${search}='' OR q.stem ILIKE ${pattern} OR q.shared_context ILIKE ${pattern})
        AND (${status}='' OR (${status}='flagged' AND (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open'))) OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')))
        AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))
        AND (${allowlist}='' OR (${allowlist}='allowlisted' AND q.allowlisted_at IS NOT NULL) OR (${allowlist}='not_allowlisted' AND q.allowlisted_at IS NULL))
    ` as { total: number }[];
    const total = groupCounts[0]?.total ?? 0;
    const questions = await sql`
      WITH matching_groups AS (
        SELECT q.context_group_id, max(q.id) AS newest_id
        FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
        WHERE q.question_type='mcq' AND q.context_group_id IS NOT NULL
          AND (${scenario}='grouped' OR (${scenario}='scenario' AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NOT NULL) OR (${scenario}='group' AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NULL))
          AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course}))
          AND (${search}='' OR q.stem ILIKE ${pattern} OR q.shared_context ILIKE ${pattern})
          AND (${status}='' OR (${status}='flagged' AND (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open'))) OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')))
          AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))
          AND (${allowlist}='' OR (${allowlist}='allowlisted' AND q.allowlisted_at IS NOT NULL) OR (${allowlist}='not_allowlisted' AND q.allowlisted_at IS NULL))
        GROUP BY q.context_group_id ORDER BY newest_id DESC LIMIT ${limit} OFFSET ${offset}
      )
      SELECT q.id,COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'),'') AS course,q.topic,q.stem,q.options,q.material_supported_key,q.explanation,q.explanation_citations,q.verification_status,q.shared_context,q.context_group_id,q.context_position,s.display_name,q.allowlisted_at,q.allowlisted_by,(q.allowlisted_at IS NOT NULL) AS allowlisted,
             (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) AS admin_flagged,
             (SELECT qf.note FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL ORDER BY qf.created_at DESC LIMIT 1) AS admin_flag_note
      FROM matching_groups mg JOIN questions q ON q.context_group_id=mg.context_group_id LEFT JOIN source_documents s ON s.id=q.source_document_id
      ORDER BY mg.newest_id DESC,q.context_position,q.id
    `;
    return NextResponse.json({ questions, page, total, totalKind: "question_groups", hasMore: offset + Math.min(limit, total) < total });
  }
  const questions = await sql`
    SELECT q.id,COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'),'') AS course,q.topic,q.stem,q.options,q.material_supported_key,q.explanation,q.explanation_citations,q.verification_status,q.shared_context,q.context_group_id,q.context_position,s.display_name,q.allowlisted_at,q.allowlisted_by,(q.allowlisted_at IS NOT NULL) AS allowlisted,
           (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) AS admin_flagged,
           (SELECT qf.note FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL ORDER BY qf.created_at DESC LIMIT 1) AS admin_flag_note
    FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id
    WHERE q.question_type='mcq' AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course})) AND (${search}='' OR q.stem ILIKE ${pattern} OR q.shared_context ILIKE ${pattern})
      AND (${status}='' OR (${status}='flagged' AND (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open'))) OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')))
      AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic}))
      AND (${scenario}='' OR (${scenario}='grouped' AND q.context_group_id IS NOT NULL) OR (${scenario}='scenario' AND q.context_group_id IS NOT NULL AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NOT NULL) OR (${scenario}='group' AND q.context_group_id IS NOT NULL AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NULL) OR (${scenario}='standalone' AND q.context_group_id IS NULL))
      AND (${allowlist}='' OR (${allowlist}='allowlisted' AND q.allowlisted_at IS NOT NULL) OR (${allowlist}='not_allowlisted' AND q.allowlisted_at IS NULL))
    ORDER BY CASE WHEN q.context_group_id IS NULL THEN 1 ELSE 0 END, q.context_group_id, q.context_position, q.id DESC LIMIT ${limit} OFFSET ${offset}
  `;
  const counts = await sql`SELECT count(*)::int AS total FROM questions q LEFT JOIN source_documents s ON s.id=q.source_document_id WHERE q.question_type='mcq' AND (${course}='' OR (${course}='none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general')) IS NULL) OR (${course}<>'none' AND COALESCE(NULLIF(q.course,'general'),NULLIF(s.course,'general'))=${course})) AND (${search}='' OR q.stem ILIKE ${pattern} OR q.shared_context ILIKE ${pattern}) AND (${status}='' OR (${status}='flagged' AND (EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open'))) OR (${status}='live' AND q.verification_status IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open')) OR (${status}='not_live' AND q.verification_status NOT IN ('material_supported','staff_corrected') AND NOT EXISTS(SELECT 1 FROM question_flags qf WHERE qf.question_id=q.id AND qf.kind='admin_review' AND qf.resolved_at IS NULL) AND NOT EXISTS(SELECT 1 FROM question_reports qr WHERE qr.question_id=q.id AND qr.status='open'))) AND (${topic}='' OR (${topic}='none' AND NULLIF(q.topic,'') IS NULL) OR (${topic}<>'none' AND q.topic=${topic})) AND (${scenario}='' OR (${scenario}='grouped' AND q.context_group_id IS NOT NULL) OR (${scenario}='scenario' AND q.context_group_id IS NOT NULL AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NOT NULL) OR (${scenario}='group' AND q.context_group_id IS NOT NULL AND NULLIF(trim(COALESCE(q.shared_context,'')),'') IS NULL) OR (${scenario}='standalone' AND q.context_group_id IS NULL)) AND (${allowlist}='' OR (${allowlist}='allowlisted' AND q.allowlisted_at IS NOT NULL) OR (${allowlist}='not_allowlisted' AND q.allowlisted_at IS NULL))` as { total: number }[];
  return NextResponse.json({ questions, page, total: counts[0]?.total ?? 0, hasMore: offset + questions.length < (counts[0]?.total ?? 0) });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const body = await request.json() as { questionId?: number | string; questionIds?: number[]; flagId?: number | string; action?: "unpublish" | "delete" | "flag" | "unflag" | "allowlist" | "remove_allowlist" | "allowlist_attempted" | "resolve_review_flag" | "group_scenario" | "group_ordered" | "ungroup_scenario" | "bulk_publish" | "bulk_unpublish" | "bulk_flag" | "bulk_unflag" | "bulk_allowlist" | "bulk_remove_allowlist" | "bulk_delete"; structure?: "standalone" | "scenario" | "group"; scenario?: string; comment?: string; stem?: string; options?: { key: string; text: string }[]; answerKey?: string; explanation?: string; citations?: string[]; course?: string; topic?: string; publish?: boolean; preserveStatus?: boolean; resolveReviewFlags?: boolean };
  if (body.action === "allowlist_attempted") {
    const updated = await getSql()`UPDATE questions q SET allowlisted_at=now(),allowlisted_by=${auth.user.id},updated_at=now() WHERE q.allowlisted_at IS NULL AND EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id AND a.user_id=${auth.user.id}) RETURNING q.id` as { id: number }[];
    return NextResponse.json({ ok: true, updated: updated.length });
  }
  if (["bulk_publish", "bulk_unpublish", "bulk_flag", "bulk_unflag", "bulk_allowlist", "bulk_remove_allowlist", "bulk_delete"].includes(body.action ?? "")) {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 250);
    if (!questionIds.length) return NextResponse.json({ error: "Select at least one question." }, { status: 400 });
    if (body.action === "bulk_publish") {
      const updated = await getSql()`UPDATE questions SET verification_status='staff_corrected',allowlisted_at=COALESCE(allowlisted_at,now()),allowlisted_by=COALESCE(allowlisted_by,${auth.user.id}),updated_at=now() WHERE id=ANY(${questionIds}) AND question_type='mcq' AND material_supported_key IS NOT NULL AND NULLIF(trim(explanation),'') IS NOT NULL AND course=ANY(${COURSE_IDS}) AND NULLIF(trim(topic),'') IS NOT NULL RETURNING id` as { id: number }[];
      const publishedIds = updated.map((question) => question.id);
      const resolved = publishedIds.length ? await getSql()`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=ANY(${publishedIds}) AND kind='admin_review' AND resolved_at IS NULL RETURNING id` as { id: number }[] : [];
      const resolvedReports = publishedIds.length ? await getSql()`UPDATE question_reports SET status='resolved',resolved_by=${auth.user.id},resolved_at=now(),resolution_note='Question reviewed and published by admin.' WHERE question_id=ANY(${publishedIds}) AND status='open' RETURNING id` as { id: number }[] : [];
      return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length, resolvedReviewFlags: resolved.length + resolvedReports.length });
    }
    if (body.action === "bulk_unpublish") {
      const updated = await getSql()`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=ANY(${questionIds}) RETURNING id` as { id: number }[];
      return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
    }
    if (body.action === "bulk_flag") {
      await getSql()`INSERT INTO question_flags(question_id,user_id,kind) SELECT selected.selected_id,${auth.user.id},'admin_review' FROM unnest(${questionIds}::bigint[]) AS selected(selected_id) ON CONFLICT (user_id,question_id,kind) WHERE resolved_at IS NULL DO NOTHING`;
      await getSql()`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=ANY(${questionIds})`;
      return NextResponse.json({ ok: true, updated: questionIds.length, skipped: 0 });
    }
    if (body.action === "bulk_delete") {
      const deleted = await getSql()`DELETE FROM questions WHERE id=ANY(${questionIds}) RETURNING id` as { id: number }[];
      return NextResponse.json({ ok: true, updated: deleted.length, skipped: questionIds.length - deleted.length });
    }
    if (body.action === "bulk_allowlist") {
      const updated = await getSql()`UPDATE questions SET allowlisted_at=now(),allowlisted_by=${auth.user.id},updated_at=now() WHERE id=ANY(${questionIds}) RETURNING id` as { id: number }[];
      return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
    }
    if (body.action === "bulk_remove_allowlist") {
      const updated = await getSql()`UPDATE questions SET allowlisted_at=NULL,allowlisted_by=NULL,updated_at=now() WHERE id=ANY(${questionIds}) RETURNING id` as { id: number }[];
      return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
    }
    const updated = await getSql()`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=ANY(${questionIds}) AND kind='admin_review' AND resolved_at IS NULL RETURNING id` as { id: number }[];
    return NextResponse.json({ ok: true, updated: updated.length, skipped: questionIds.length - updated.length });
  }
  if (body.action === "group_scenario") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 50);
    const scenario = (body.scenario ?? "").trim();
    if (questionIds.length < 2 || !scenario) return NextResponse.json({ error: "Select at least two questions and enter their shared scenario." }, { status: 400 });
    const selected = await getSql()`SELECT id,course,topic FROM questions WHERE id=ANY(${questionIds}) AND question_type='mcq'` as { id: number; course: string | null; topic: string | null }[];
    if (selected.length !== questionIds.length) return NextResponse.json({ error: "One or more selected questions could not be found." }, { status: 400 });
    if (new Set(selected.map((question) => question.course)).size !== 1 || new Set(selected.map((question) => question.topic)).size !== 1) return NextResponse.json({ error: "A scenario set must use questions from the same course and topic." }, { status: 400 });
    const groupId = crypto.randomUUID();
    await getSql()`UPDATE questions q SET context_group_id=${groupId},shared_context=${scenario},context_position=chosen.position,updated_at=now() FROM (SELECT value::bigint AS id,ordinality::int AS position FROM jsonb_array_elements_text(${JSON.stringify(questionIds)}::jsonb) WITH ORDINALITY) chosen WHERE q.id=chosen.id`;
    return NextResponse.json({ ok: true, contextGroupId: groupId });
  }
  if (body.action === "group_ordered") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 50);
    if (questionIds.length < 2) return NextResponse.json({ error: "Select at least two questions." }, { status: 400 });
    const selected = await getSql()`SELECT id,course FROM questions WHERE id=ANY(${questionIds}) AND question_type='mcq'` as { id: number; course: string | null }[];
    if (selected.length !== questionIds.length) return NextResponse.json({ error: "One or more selected questions could not be found." }, { status: 400 });
    if (new Set(selected.map((question) => question.course)).size !== 1) return NextResponse.json({ error: "An ordered group must use questions from the same course." }, { status: 400 });
    const groupId = crypto.randomUUID();
    await getSql()`UPDATE questions q SET context_group_id=${groupId},shared_context=NULL,context_position=chosen.position,updated_at=now() FROM (SELECT value::bigint AS id,ordinality::int AS position FROM jsonb_array_elements_text(${JSON.stringify(questionIds)}::jsonb) WITH ORDINALITY) chosen WHERE q.id=chosen.id`;
    return NextResponse.json({ ok: true, contextGroupId: groupId });
  }
  if (body.action === "ungroup_scenario") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter(Number.isSafeInteger))].slice(0, 50);
    if (!questionIds.length) return NextResponse.json({ error: "Select a scenario set to ungroup." }, { status: 400 });
    await getSql()`UPDATE questions SET context_group_id=NULL,shared_context=NULL,context_position=NULL,updated_at=now() WHERE id=ANY(${questionIds})`;
    return NextResponse.json({ ok: true });
  }
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId)) return NextResponse.json({ error: "Choose a question." }, { status: 400 });
  if (body.action === "allowlist") {
    await getSql()`UPDATE questions SET allowlisted_at=now(),allowlisted_by=${auth.user.id},updated_at=now() WHERE id=${questionId}`;
    return NextResponse.json({ ok: true, allowlisted: true });
  }
  if (body.action === "remove_allowlist") {
    await getSql()`UPDATE questions SET allowlisted_at=NULL,allowlisted_by=NULL,updated_at=now() WHERE id=${questionId}`;
    return NextResponse.json({ ok: true, allowlisted: false });
  }
  if (body.action === "resolve_review_flag") {
    const flagId = Number(body.flagId);
    if (!Number.isSafeInteger(flagId)) return NextResponse.json({ error: "Choose a review item." }, { status: 400 });
    const resolved = await getSql()`
      UPDATE question_flags
      SET resolved_at=now(),resolved_by=${String(auth.user.id)}
      WHERE id=${flagId} AND question_id=${questionId} AND kind='admin_review' AND resolved_at IS NULL
      RETURNING id
    ` as { id: number }[];
    if (!resolved.length) return NextResponse.json({ error: "That review item is no longer open." }, { status: 404 });
    return NextResponse.json({ ok: true, resolvedId: flagId });
  }
  if (body.action === "flag") {
    await getSql()`INSERT INTO question_flags(question_id,user_id,kind) VALUES(${questionId},${auth.user.id},'admin_review') ON CONFLICT (user_id,question_id,kind) WHERE resolved_at IS NULL DO NOTHING`;
    await getSql()`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=${questionId}`;
    return NextResponse.json({ ok: true, flagged: true });
  }
  if (body.action === "unflag") {
    await getSql()`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=${questionId} AND kind='admin_review' AND resolved_at IS NULL`;
    return NextResponse.json({ ok: true, flagged: false });
  }
  if (body.action === "unpublish") {
    await getSql()`UPDATE questions SET verification_status='unreviewed',updated_at=now() WHERE id=${questionId}`;
    const comment = (body.comment ?? "").trim().slice(0, 2000);
    if (comment) await getSql()`INSERT INTO question_flags(question_id,user_id,kind,note) VALUES(${questionId},${auth.user.id},'admin_review',${comment}) ON CONFLICT (user_id,question_id,kind) WHERE resolved_at IS NULL DO UPDATE SET note=EXCLUDED.note,created_at=now()`;
    return NextResponse.json({ ok: true });
  }
  if (body.action === "delete") {
    await getSql()`DELETE FROM questions WHERE id=${questionId}`;
    return NextResponse.json({ ok: true });
  }
  const stem = (body.stem ?? "").trim(); const explanation = (body.explanation ?? "").trim(); const options = body.options ?? []; const citations = body.citations?.map((citation) => citation.trim()).filter(Boolean).slice(0, 12);
  const current = await getSql()`SELECT verification_status FROM questions WHERE id=${questionId} LIMIT 1` as { verification_status: string }[];
  const currentlyLive = ["material_supported", "staff_corrected"].includes(current[0]?.verification_status ?? "");
  const wantsPublish = body.preserveStatus ? currentlyLive : body.publish !== false;
  const scenarioText = (body.scenario ?? "").trim();
  if (!stem || !options.length) return NextResponse.json({ error: "Keep the question and its answer options." }, { status: 400 });
  if (body.structure === "scenario" && !scenarioText) return NextResponse.json({ error: "Add the scenario text." }, { status: 400 });
  if (wantsPublish && (!explanation || !body.answerKey || !options.some((option) => option.key === body.answerKey && option.text.trim()))) return NextResponse.json({ error: "Choose the correct answer and add an explanation before publishing." }, { status: 400 });
  if (!body.course || !isCourse(body.course)) return NextResponse.json({ error: "Choose one of the five courses." }, { status: 400 });
  if ((wantsPublish && (!body.topic || !isTopicForCourse(body.course, body.topic))) || (body.topic && !isTopicForCourse(body.course, body.topic))) return NextResponse.json({ error: "Choose an official topic before publishing." }, { status: 400 });
  const publishStatus = body.preserveStatus ? (current[0]?.verification_status ?? "unreviewed") : body.publish === false ? "unreviewed" : "staff_corrected";
  if (citations) await getSql()`UPDATE questions SET course=${body.course},topic=${body.topic || null},stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey || null},verification_status=${publishStatus},explanation=${explanation || null},explanation_citations=${JSON.stringify(citations)}::jsonb,updated_at=now() WHERE id=${questionId}`;
  else await getSql()`UPDATE questions SET course=${body.course},topic=${body.topic || null},stem=${stem},options=${JSON.stringify(options)}::jsonb,material_supported_key=${body.answerKey || null},verification_status=${publishStatus},explanation=${explanation || null},updated_at=now() WHERE id=${questionId}`;
  let resolvedReviewFlags = 0;
  if (publishStatus === "staff_corrected") {
    const resolved = await getSql()`UPDATE question_flags SET resolved_at=now(),resolved_by=${String(auth.user.id)} WHERE question_id=${questionId} AND kind='admin_review' AND resolved_at IS NULL RETURNING id` as { id: number }[];
    const resolvedLearnerReports = await getSql()`UPDATE question_reports SET status='resolved',resolved_by=${auth.user.id},resolved_at=now(),resolution_note='Question reviewed and published by admin.' WHERE question_id=${questionId} AND status='open' RETURNING id` as { id: number }[];
    resolvedReviewFlags = resolved.length + resolvedLearnerReports.length;
  }
  if (body.structure !== undefined) {
    const existing = await getSql()`SELECT context_group_id FROM questions WHERE id=${questionId} LIMIT 1` as { context_group_id: string | null }[];
    const groupId = existing[0]?.context_group_id;
    if (body.structure === "standalone") {
      await getSql()`UPDATE questions SET context_group_id=NULL,shared_context=NULL,context_position=NULL,updated_at=now() WHERE id=${questionId}`;
      if (groupId) {
        const remaining = await getSql()`SELECT id FROM questions WHERE context_group_id=${groupId} ORDER BY context_position NULLS LAST,id` as { id: number }[];
        if (remaining.length) await getSql()`UPDATE questions q SET context_position=chosen.position,updated_at=now() FROM (SELECT value::bigint AS id,ordinality::int AS position FROM jsonb_array_elements_text(${JSON.stringify(remaining.map((row) => row.id))}::jsonb) WITH ORDINALITY) chosen WHERE q.id=chosen.id`;
      }
    } else if (body.structure === "scenario") {
      if (groupId) await getSql()`UPDATE questions SET shared_context=${scenarioText},updated_at=now() WHERE context_group_id=${groupId}`;
      else await getSql()`UPDATE questions SET context_group_id=${crypto.randomUUID()},shared_context=${scenarioText},context_position=1,updated_at=now() WHERE id=${questionId}`;
    } else {
      if (groupId) await getSql()`UPDATE questions SET shared_context=NULL,updated_at=now() WHERE context_group_id=${groupId}`;
      else await getSql()`UPDATE questions SET context_group_id=${crypto.randomUUID()},shared_context=NULL,context_position=1,updated_at=now() WHERE id=${questionId}`;
    }
  } else if ((body.scenario ?? "").trim()) {
    const existing = await getSql()`SELECT context_group_id FROM questions WHERE id=${questionId} LIMIT 1` as { context_group_id: string | null }[];
    const groupId = existing[0]?.context_group_id;
    if (groupId) await getSql()`UPDATE questions SET shared_context=${scenarioText},updated_at=now() WHERE context_group_id=${groupId}`;
    else await getSql()`UPDATE questions SET context_group_id=${crypto.randomUUID()},shared_context=${scenarioText},context_position=1,updated_at=now() WHERE id=${questionId}`;
  }
  const saved = await getSql()`SELECT context_group_id,shared_context,context_position FROM questions WHERE id=${questionId} LIMIT 1` as { context_group_id: string | null; shared_context: string | null; context_position: number | null }[];
  return NextResponse.json({ ok: true, question: saved[0] ?? null, resolvedReviewFlags });
}
