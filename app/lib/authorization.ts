import { NextResponse } from "next/server";
import { currentUser, type CurrentUser } from "./session";

export async function requireRole(...roles: CurrentUser["role"][]) {
  const user = await currentUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  if (!roles.includes(user.role)) return { user: null, response: NextResponse.json({ error: "This account is not authorised for expert review." }, { status: 403 }) };
  return { user, response: null };
}
