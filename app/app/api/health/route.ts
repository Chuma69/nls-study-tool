import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Phase 0 connectivity check: proves the app can reach Neon and that the
// schema is applied. Visit /api/health after deploy.
export async function GET() {
  try {
    const sql = getSql();
    // A cheap query that also confirms the expected tables exist.
    const rows = await sql`
      SELECT
        (SELECT count(*) FROM users)     AS users,
        (SELECT count(*) FROM questions) AS questions
    `;
    return NextResponse.json({
      ok: true,
      db: "connected",
      counts: rows[0],
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        db: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
