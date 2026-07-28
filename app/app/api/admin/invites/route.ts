import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { hashSessionToken } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { email } = await request.json() as { email?: string };
  const clean = email?.trim().toLowerCase();
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return NextResponse.json({ error: "Enter a valid expert email." }, { status: 400 });
  const token = randomBytes(24).toString("base64url");
  const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await getSql()`INSERT INTO expert_invites(email,token_hash,invited_by,expires_at) VALUES(${clean},${hashSessionToken(token)},${auth.user.id},${expiry})
    ON CONFLICT(email) DO UPDATE SET token_hash=EXCLUDED.token_hash,invited_by=EXCLUDED.invited_by,expires_at=EXCLUDED.expires_at,accepted_at=NULL`;
  return NextResponse.json({ inviteUrl: `${new URL(request.url).origin}/expert/join?invite=${token}` });
}
