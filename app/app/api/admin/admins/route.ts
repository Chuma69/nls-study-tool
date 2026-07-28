import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const admins = await getSql()`SELECT id,username,email,last_seen_at FROM users WHERE role='admin' ORDER BY last_seen_at DESC`;
  return NextResponse.json({ admins });
}

export async function POST(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  const { email } = await request.json() as { email?: string }; const normalized = email?.trim().toLowerCase() ?? "";
  if (!emailPattern.test(normalized)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const sql = getSql(); const existing = await sql`SELECT id FROM users WHERE email=${normalized} AND identity_type='registered' LIMIT 1` as { id: number }[];
  if (existing[0]) await sql`UPDATE users SET role='admin',last_seen_at=now() WHERE id=${existing[0].id}`;
  else await sql`INSERT INTO users(username,email,identity_type,role) VALUES('Admin',${normalized},'registered','admin')`;
  return NextResponse.json({ ok: true });
}
