import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { hashSessionToken } from "@/lib/session";
import { sendExpertAddedEmail, sendExpertInviteEmail } from "@/lib/email";

export const runtime = "nodejs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// List every invited reviewer with their status and review activity.
export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const rows = await getSql()`
    SELECT i.email, i.created_at AS invited_at, i.expires_at, i.accepted_at,
           u.id AS user_id, u.username AS name, u.role, u.last_seen_at,
           COALESCE(rc.review_count, 0)::int AS review_count, rc.last_review_at
    FROM expert_invites i
    LEFT JOIN users u ON u.email = i.email AND u.identity_type = 'registered'
    LEFT JOIN (
      SELECT expert_id, count(*)::int AS review_count, max(updated_at) AS last_review_at
      FROM expert_reviews WHERE status = 'submitted' GROUP BY expert_id
    ) rc ON rc.expert_id = u.id
    ORDER BY i.created_at DESC
  `;
  return NextResponse.json({ experts: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { email } = await request.json() as { email?: string };
  const clean = email?.trim().toLowerCase();
  if (!clean || !emailPattern.test(clean)) return NextResponse.json({ error: "Enter a valid expert email." }, { status: 400 });
  const sql = getSql();
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await sql`INSERT INTO expert_invites(email,token_hash,invited_by,expires_at) VALUES(${clean},${hashSessionToken(token)},${auth.user.id},${expires.toISOString()})
    ON CONFLICT(email) DO UPDATE SET token_hash=EXCLUDED.token_hash,invited_by=EXCLUDED.invited_by,expires_at=EXCLUDED.expires_at,accepted_at=NULL`;
  const inviteUrl = `${new URL(request.url).origin}/expert/join?invite=${token}`;
  // An existing Call Ready account is simply added and pointed at the review view;
  // a new address gets the full "create a profile and join" invitation.
  const existing = await sql`SELECT id FROM users WHERE email = ${clean} AND identity_type = 'registered' LIMIT 1` as { id: number }[];
  const isExisting = existing.length > 0;
  const expiresLabel = expires.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const emailResult = isExisting
    ? await sendExpertAddedEmail(clean, inviteUrl)
    : await sendExpertInviteEmail(clean, inviteUrl, expiresLabel);
  return NextResponse.json({ inviteUrl, email: clean, emailed: emailResult.sent, emailReason: emailResult.reason ?? null, isExisting });
}

// Revoke a pending invite, or remove an accepted reviewer's expert access.
export async function DELETE(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { email } = await request.json() as { email?: string };
  const clean = email?.trim().toLowerCase();
  if (!clean) return NextResponse.json({ error: "No reviewer specified." }, { status: 400 });
  const sql = getSql();
  await sql`DELETE FROM expert_invites WHERE email = ${clean}`;
  // Demote the account if it had been granted expert access (leave admins untouched).
  await sql`UPDATE users SET role = 'learner' WHERE email = ${clean} AND role = 'expert'`;
  return NextResponse.json({ ok: true });
}
