import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  // Each item carries every submitted expert review so the admin can compare answers
  // and reasoning — and resolve conflicts by choosing the winning option.
  const rows = await getSql()`SELECT q.id,q.stem,q.options,c.selected_key,c.review_count,c.status,
      COALESCE((
        SELECT json_agg(json_build_object('selected_key',er.selected_key,'explanation',er.explanation,'confidence',er.confidence,
          'expert',COALESCE(NULLIF(u.username,''),NULLIF(u.email,''),'Expert')) ORDER BY er.created_at)
        FROM expert_reviews er LEFT JOIN users u ON u.id=er.expert_id
        WHERE er.question_id=q.id AND er.status='submitted'
      ),'[]'::json) AS reviews
    FROM question_consensus c JOIN questions q ON q.id=c.question_id
    WHERE c.status IN ('awaiting_reviews','consensus_reached','conflicted')
      AND q.verification_status NOT IN ('material_supported','staff_corrected')
    ORDER BY c.updated_at DESC LIMIT 50`;
  return NextResponse.json({ items: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { questionId, action, selectedKey } = await request.json() as { questionId?: number | string; action?: "approve" | "reject"; selectedKey?: string };
  const id = Number(questionId);
  if (!Number.isSafeInteger(id) || !["approve", "reject"].includes(action ?? "")) return NextResponse.json({ error: "Invalid review action." }, { status: 400 });
  const sql = getSql();

  if (action === "reject") {
    await sql`UPDATE question_consensus SET status='staff_rejected',reviewed_by=${auth.user.id},reviewed_at=now(),updated_at=now() WHERE question_id=${id}`;
    return NextResponse.json({ ok: true });
  }

  // Approve: the admin may pass an explicit selectedKey (to resolve a conflict) or fall
  // back to the auto-proposed consensus key.
  const consensus = await sql`SELECT selected_key FROM question_consensus WHERE question_id=${id} LIMIT 1` as { selected_key: string | null }[];
  const chosenKey = (selectedKey ?? consensus[0]?.selected_key ?? "").trim();
  if (!chosenKey) return NextResponse.json({ error: "Choose which answer to publish." }, { status: 400 });
  const question = await sql`SELECT options FROM questions WHERE id=${id} LIMIT 1` as { options: { key: string }[] }[];
  if (!question[0]?.options.some((option) => option.key === chosenKey)) return NextResponse.json({ error: "That option is not available on this question." }, { status: 400 });
  const review = await sql`SELECT explanation,citations FROM expert_reviews WHERE question_id=${id} AND selected_key=${chosenKey} AND status='submitted' ORDER BY created_at LIMIT 1` as { explanation: string; citations: unknown }[];
  if (!review[0]) return NextResponse.json({ error: "No expert review supports that answer." }, { status: 400 });
  await sql`UPDATE questions SET material_supported_key=${chosenKey},verification_status='staff_corrected',explanation=${review[0].explanation},explanation_version=1,explanation_citations=${JSON.stringify(review[0].citations)}::jsonb,allowlisted_at=COALESCE(allowlisted_at,now()),allowlisted_by=COALESCE(allowlisted_by,${auth.user.id}),updated_at=now() WHERE id=${id}`;
  await sql`UPDATE question_consensus SET selected_key=${chosenKey},status='staff_approved',reviewed_by=${auth.user.id},reviewed_at=now(),updated_at=now() WHERE question_id=${id}`;
  return NextResponse.json({ ok: true });
}
