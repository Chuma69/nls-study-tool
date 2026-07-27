import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

type AnswerRow = {
  material_supported_key: string;
  verification_status: string;
  options: { key: string; text: string }[];
};

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });
  if (!(await allowRequest("attempt", String(user.id), 300, 60 * 60))) {
    return NextResponse.json({ error: "Study limit reached. Please try again in an hour." }, { status: 429 });
  }

  let body: { questionId?: number | string; chosenKey?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId) || !body.chosenKey) {
    return NextResponse.json({ error: "Choose a valid answer before checking it." }, { status: 400 });
  }

  const rows = await getSql()`
    SELECT material_supported_key, verification_status, options
    FROM questions
    WHERE id = ${questionId}
      AND question_type = 'mcq'
      AND material_supported_key IS NOT NULL
      AND verification_status IN ('material_supported', 'staff_corrected')
    LIMIT 1
  ` as AnswerRow[];
  const question = rows[0];
  if (!question || !question.options.some((option) => option.key === body.chosenKey)) {
    return NextResponse.json({ error: "That question or option is not available." }, { status: 404 });
  }

  const matchesMaterialKey = question.material_supported_key === body.chosenKey;
  await getSql()`
    INSERT INTO attempts (user_id, question_id, chosen_key, is_correct)
    VALUES (${user.id}, ${questionId}, ${body.chosenKey}, ${matchesMaterialKey})
  `;
  return NextResponse.json({
    matchesMaterialKey,
    materialSupportedKey: question.material_supported_key,
    verificationStatus: question.verification_status,
  });
}
