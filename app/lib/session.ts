import { cookies } from "next/headers";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSql } from "./db";

export const SESSION_COOKIE = "nls_study_session";
const SESSION_DAYS = 90;

export type CurrentUser = {
  id: number;
  username: string;
  email: string;
  identityType: "registered" | "guest";
  role: "learner" | "expert" | "admin";
};

type SessionRow = {
  id: number;
  username: string;
  email: string;
  identity_type: "registered" | "guest";
  role: "learner" | "expert" | "admin";
};

export function makeSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function guestEmail() {
  return `guest-${randomUUID()}@guest.nls-study.local`;
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export async function currentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const sql = getSql();
  const rows = await sql`
    SELECT users.id, users.username, users.email, users.identity_type, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${hashSessionToken(token)}
      AND sessions.revoked_at IS NULL
      AND sessions.expires_at > now()
    LIMIT 1
  ` as SessionRow[];
  const user = rows[0];
  if (!user) return null;

  return { id: user.id, username: user.username, email: user.email, identityType: user.identity_type,
    role: isAdminEmail(user.email) ? "admin" : user.role };
}

export function isAdminEmail(email: string) {
  return (process.env.ADMIN_EMAIL_ALLOWLIST ?? "").split(",").map((value) => value.trim().toLowerCase()).includes(email.toLowerCase());
}
