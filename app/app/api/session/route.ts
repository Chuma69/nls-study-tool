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
  // Fail open: a rate-limiter DB hiccup must never crash the whole endpoint into an
  // empty 500 (which the client can't parse). Only enforce the limit when it answers.
  let withinLimit = true;
  try { withinLimit = await allowRequest("session-create", clientAddress, 12, 60 * 60); }
  catch (error) { console.error("Rate limiter unavailable; allowing session request", error); }
  if (!withinLimit) {
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
    // A registered profile is deliberately resumable after the browser session
    // has been ended. (Guests remain browser-only and always receive a new id.)
    // This is a lightweight profile, not password-based authentication.
    const existing = !isGuest ? await sql`
      SELECT id, role FROM users
      WHERE email = ${email} AND identity_type = 'registered'
      LIMIT 1
    ` as { id: number; role: "learner" | "expert" | "admin" }[] : [];
    const users = existing.length ? existing : await sql`
      INSERT INTO users (username, email, identity_type, role)
      VALUES (${username}, ${email}, ${isGuest ? "guest" : "registered"}, ${role})
      RETURNING id, role
    ` as { id: number; role: "learner" | "expert" | "admin" }[];
    const effectiveRole = isAdminEmail(email) ? "admin" : invite.length ? "expert" : existing.length ? existing[0].role : role;
    if (existing.length) {
      await sql`UPDATE users SET username = ${username}, role = ${effectiveRole}, last_seen_at = now() WHERE id = ${users[0].id}`;
    }
    if (invite.length) await sql`UPDATE expert_invites SET accepted_at = now() WHERE id = ${invite[0].id}`;
    const token = makeSessionToken();
    const expiresAt = sessionExpiry();
    await sql`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (${users[0].id}, ${hashSessionToken(token)}, ${expiresAt.toISOString()})`;
    const response = NextResponse.json({ user: { id: users[0].id, username, identityType: isGuest ? "guest" : "registered", role: effectiveRole } });
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/" });
    return response;
  } catch (error: unknown) {
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
