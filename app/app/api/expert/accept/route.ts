import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { hashSessionToken, isAdminEmail, makeSessionToken, SESSION_COOKIE, sessionExpiry } from "@/lib/session";

export const runtime = "nodejs";

type InviteRow = { id: number; email: string };
type UserRow = { id: number; username: string };

// Resolve an invite token to the email it was sent to, and whether that person
// already has a Call Ready profile (so the join page can auto-accept them).
async function resolveInvite(token: string) {
  if (!token) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT id, email FROM expert_invites
    WHERE token_hash = ${hashSessionToken(token)} AND accepted_at IS NULL AND expires_at > now()
    LIMIT 1
  ` as InviteRow[];
  return rows[0] ?? null;
}

async function existingRegistered(email: string) {
  const rows = await getSql()`SELECT id, username FROM users WHERE email = ${email} AND identity_type = 'registered' LIMIT 1` as UserRow[];
  return rows[0] ?? null;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("invite") ?? "";
  const invite = await resolveInvite(token);
  if (!invite) return NextResponse.json({ valid: false });
  const user = await existingRegistered(invite.email);
  return NextResponse.json({ valid: true, email: invite.email, existingUser: Boolean(user), name: user?.username ?? null });
}

export async function POST(request: Request) {
  let body: { invite?: string; username?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const invite = await resolveInvite(body.invite ?? "");
  if (!invite) return NextResponse.json({ error: "This invitation is invalid or has expired. Ask the admin to resend it." }, { status: 400 });

  const sql = getSql();
  const existing = await existingRegistered(invite.email);
  const role = isAdminEmail(invite.email) ? "admin" : "expert";
  let userId: number;
  if (existing) {
    userId = existing.id;
    await sql`UPDATE users SET role = ${role}, last_seen_at = now() WHERE id = ${userId}`;
  } else {
    const username = body.username?.trim();
    if (!username || username.length < 2 || username.length > 40) {
      return NextResponse.json({ error: "Enter a name between 2 and 40 characters.", needsName: true, email: invite.email }, { status: 400 });
    }
    const created = await sql`
      INSERT INTO users (username, email, identity_type, role)
      VALUES (${username}, ${invite.email}, 'registered', ${role})
      RETURNING id
    ` as { id: number }[];
    userId = created[0].id;
  }
  await sql`UPDATE expert_invites SET accepted_at = now() WHERE id = ${invite.id}`;

  const token = makeSessionToken();
  const expiresAt = sessionExpiry();
  await sql`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (${userId}, ${hashSessionToken(token)}, ${expiresAt.toISOString()})`;
  const response = NextResponse.json({ ok: true, role });
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/" });
  return response;
}
