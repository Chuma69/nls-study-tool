import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

type AnswerRow = {
  material_supported_key: string;
  verification_status: string;
  options: { key: string; text: string }[];
  previously_attempted: boolean;
};

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  if (!(await allowRequest("attempt", String(user.id), 300, 60 * 60))) {
    return NextResponse.json({ error: "Study limit reached. Please try again in an hour." }, { status: 429 });
  }

  let body: { questionId?: number | string; chosenKey?: string; practiceSessionId?: number | string; secondsSpent?: number | string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const questionId = Number(body.questionId);
  const practiceSessionId = Number(body.practiceSessionId);
  const secondsSpent = Math.max(0, Math.min(7200, Math.round(Number(body.secondsSpent) || 0)));
  if (!Number.isSafeInteger(questionId) || !body.chosenKey) {
    return NextResponse.json({ error: "Choose a valid answer before checking it." }, { status: 400 });
  }

  const rows = await getSql()`
    SELECT q.material_supported_key, q.verification_status, q.options,
           EXISTS (
             SELECT 1 FROM attempts a
             WHERE a.user_id = ${user.id} AND a.question_id = q.id
           ) AS previously_attempted
    FROM questions q
    WHERE q.id = ${questionId}
      AND question_type = 'mcq'
      AND material_supported_key IS NOT NULL
      AND verification_status IN ('material_supported', 'staff_corrected')
      AND NOT EXISTS (
        SELECT 1 FROM question_flags qf
        WHERE qf.question_id = q.id
          AND qf.kind = 'admin_review'
          AND qf.resolved_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM question_reports qr
        WHERE qr.question_id = q.id
          AND qr.status = 'open'
      )
    LIMIT 1
  ` as AnswerRow[];
  const question = rows[0];
  if (!question || !question.options.some((option) => option.key === body.chosenKey)) {
    return NextResponse.json({ error: "That question or option is not available." }, { status: 404 });
  }

  const matchesMaterialKey = question.material_supported_key === body.chosenKey;
  let sessionId: number | null = null;
  if (Number.isSafeInteger(practiceSessionId)) {
    const sessions = await getSql()`
      SELECT id FROM practice_sessions
      WHERE id = ${practiceSessionId} AND user_id = ${user.id} AND ended_at IS NULL
      LIMIT 1
    ` as { id: number }[];
    sessionId = sessions[0]?.id ?? null;
  }
  await getSql()`
    INSERT INTO attempts (user_id, question_id, chosen_key, is_correct, practice_session_id, seconds_spent)
    VALUES (${user.id}, ${questionId}, ${body.chosenKey}, ${matchesMaterialKey}, ${sessionId}, ${secondsSpent})
  `;
  if (sessionId) await getSql()`
    UPDATE practice_sessions
    SET answers_count = answers_count + 1,
        correct_count = correct_count + ${matchesMaterialKey ? 1 : 0},
        total_seconds = total_seconds + ${secondsSpent},
        last_question_id = ${questionId}, last_activity_at = now()
    WHERE id = ${sessionId}
  `;
  return NextResponse.json({
    matchesMaterialKey,
    materialSupportedKey: question.material_supported_key,
    verificationStatus: question.verification_status,
    firstAttempt: !question.previously_attempted,
  });
}
