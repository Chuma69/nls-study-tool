import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { currentUser, guestEmail, hashSessionToken, isAdminEmail, makeSessionToken, SESSION_COOKIE, sessionExpiry } from "@/lib/session";
import { allowRequest } from "@/lib/rate-limit";

export const runtime = "nodejs";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  return NextResponse.json({ user: await currentUser() });
}

export async function POST(request: Request) {
  let body: { mode?: string; username?: string; email?: string; inviteToken?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }

  const isGuest = body.mode === "guest";
  const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  if (!(await allowRequest("session-create", clientAddress, 12, 60 * 60))) {
    return NextResponse.json({ error: "Too many session requests. Please try again in an hour." }, { status: 429 });
  }
  const username = isGuest ? "Guest" : body.username?.trim();
  const email = isGuest ? guestEmail() : body.email?.trim().toLowerCase();
  if (!username || username.length < 2 || username.length > 40) {
    return NextResponse.json({ error: "Enter a name between 2 and 40 characters." }, { status: 400 });
  }
  if (!email || !emailPattern.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const sql = getSql();
  try {
    const invite = !isGuest && body.inviteToken ? await sql`
      SELECT id FROM expert_invites
      WHERE email = ${email} AND token_hash = ${hashSessionToken(body.inviteToken)}
        AND accepted_at IS NULL AND expires_at > now() LIMIT 1
    ` as { id: number }[] : [];
    const role = isGuest ? "learner" : isAdminEmail(email) ? "admin" : invite.length ? "expert" : "learner";
    const users = await sql`
      INSERT INTO users (username, email, identity_type, role)
      VALUES (${username}, ${email}, ${isGuest ? "guest" : "registered"}, ${role})
      RETURNING id
    ` as { id: number }[];
    if (invite.length) await sql`UPDATE expert_invites SET accepted_at = now() WHERE id = ${invite[0].id}`;
    const token = makeSessionToken();
    const expiresAt = sessionExpiry();
    await sql`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (${users[0].id}, ${hashSessionToken(token)}, ${expiresAt.toISOString()})`;
    const response = NextResponse.json({ user: { id: users[0].id, username, identityType: isGuest ? "guest" : "registered", role } });
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/" });
    return response;
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "That email already has a study profile on another device. Continue as a guest here instead." }, { status: 409 });
    }
    console.error("Unable to create study session", error);
    return NextResponse.json({ error: "We could not start your study session." }, { status: 500 });
  }
}

export async function DELETE() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await getSql()`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hashSessionToken(token)}`;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { expires: new Date(0), path: "/" });
  return response;
}
