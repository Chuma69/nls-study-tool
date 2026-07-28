import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const rows = await getSql()`SELECT q.id,q.stem,q.options,c.selected_key,c.review_count,c.status
    FROM question_consensus c JOIN questions q ON q.id=c.question_id
    WHERE c.status IN ('awaiting_reviews','consensus_reached','conflicted') ORDER BY c.updated_at DESC LIMIT 50`;
  return NextResponse.json({ items: rows });
}
export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { questionId, action } = await request.json() as { questionId?: number | string; action?: "approve" | "reject" };
  const id = Number(questionId); if (!Number.isSafeInteger(id) || !["approve","reject"].includes(action ?? "")) return NextResponse.json({ error: "Invalid review action." }, { status: 400 });
  const sql = getSql();
  const consensus = await sql`SELECT selected_key,status FROM question_consensus WHERE question_id=${id} LIMIT 1` as { selected_key: string | null; status: string }[];
  if (action === "approve" && consensus[0]?.selected_key) {
    const review = await sql`SELECT explanation,citations FROM expert_reviews WHERE question_id=${id} AND selected_key=${consensus[0].selected_key} AND status='submitted' ORDER BY created_at LIMIT 1` as { explanation: string; citations: unknown }[];
    if (!review[0]) return NextResponse.json({ error: "There is no submitted expert review to approve." }, { status: 400 });
    await sql`UPDATE questions SET material_supported_key=${consensus[0].selected_key},verification_status='staff_corrected',explanation=${review[0].explanation},explanation_version=1,explanation_citations=${JSON.stringify(review[0].citations)}::jsonb,updated_at=now() WHERE id=${id}`;
    await sql`UPDATE question_consensus SET status='staff_approved',reviewed_by=${auth.user.id},reviewed_at=now(),updated_at=now() WHERE question_id=${id}`;
  } else if (action === "reject") {
    await sql`UPDATE question_consensus SET status='staff_rejected',reviewed_by=${auth.user.id},reviewed_at=now(),updated_at=now() WHERE question_id=${id}`;
  } else {
    return NextResponse.json({ error: "Choose a submitted expert review before approving." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
