import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { hashSessionToken } from "@/lib/session";
import { sendExpertInviteEmail } from "@/lib/email";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { email } = await request.json() as { email?: string };
  const clean = email?.trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return NextResponse.json({ error: "Enter a valid expert email." }, { status: 400 });
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await getSql()`INSERT INTO expert_invites(email,token_hash,invited_by,expires_at) VALUES(${clean},${hashSessionToken(token)},${auth.user.id},${expires.toISOString()})
    ON CONFLICT(email) DO UPDATE SET token_hash=EXCLUDED.token_hash,invited_by=EXCLUDED.invited_by,expires_at=EXCLUDED.expires_at,accepted_at=NULL`;
  const inviteUrl = `${new URL(request.url).origin}/expert/join?invite=${token}`;
  const expiresLabel = expires.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const emailResult = await sendExpertInviteEmail(clean, inviteUrl, expiresLabel);
  return NextResponse.json({ inviteUrl, email: clean, emailed: emailResult.sent, emailReason: emailResult.reason ?? null });
}
