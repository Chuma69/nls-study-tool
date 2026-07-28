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

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Start a private or guest session first." }, { status: 401 });

  const rows = await getSql()`
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
    GROUP BY q.id, s.display_name, s.rel_source_path
    HAVING NOT COALESCE(bool_or(a.is_correct), false)
    ORDER BY COALESCE(bool_or(a.is_correct = false), false) DESC, random()
    LIMIT 1
  ` as QuestionRow[];

  return NextResponse.json({ question: rows[0] ?? null });
}
