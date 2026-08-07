import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";
import { isCourse } from "@/lib/course-topics";

export const runtime = "nodejs";

// Duplicate detection groups MCQ questions by a normalized signature.
//  - "exact":   shared_context + stem + the (order-independent) set of option texts.
//  - "similar": shared_context + stem only (options/answers may have been edited).
// The stem has any leading question number ("12. ", "3) ") stripped, everything is
// lower-cased, and runs of non-alphanumeric characters collapse to single spaces so
// punctuation and spacing differences never hide a genuine duplicate.
//
// A cluster is any signature shared by two or more questions in the same course.
// Admins keep one canonical question, delete the rest (every question reference
// cascades on delete), and allowlist the survivor — or dismiss the cluster as a false
// positive, remembered in duplicate_ignores so it never resurfaces.
//
// The Neon HTTP driver has no raw-fragment interpolation, so queries that need these
// constant SQL expressions use the sql(text, params) form with $n placeholders. The
// expressions below contain no user input; only the $n values are parameterized.
const STEM_KEY = `regexp_replace(q.stem, '^\\s*\\d{1,3}\\s*[\\.\\):\\-]\\s*', '')`;
const OPTION_KEY = `coalesce((SELECT string_agg(lower(btrim(value->>'text')), '|' ORDER BY lower(btrim(value->>'text'))) FROM jsonb_array_elements(q.options) AS value), '')`;
// $1 carries the "exact mode" boolean; option texts join the signature only in exact mode.
const NORM_EXPR = `btrim(regexp_replace(lower(coalesce(q.shared_context,'') || ' ' || ${STEM_KEY} || CASE WHEN $1 THEN ' ' || ${OPTION_KEY} ELSE '' END), '[^a-z0-9]+', ' ', 'g'))`;
const SIMILAR_EXPR = `btrim(regexp_replace(lower(coalesce(q.shared_context,'') || ' ' || ${STEM_KEY}), '[^a-z0-9]+', ' ', 'g'))`;

let ignoreTableReady: Promise<unknown> | null = null;
function ensureIgnoreTable() {
  // Self-migrating: the dismissal table is created on first use so the feature works
  // in any environment (including a fresh deploy) without a separate migration step.
  if (!ignoreTableReady) {
    ignoreTableReady = getSql()`
      CREATE TABLE IF NOT EXISTS duplicate_ignores (
        cluster_key text PRIMARY KEY,
        mode text NOT NULL DEFAULT 'exact',
        ignored_by bigint,
        ignored_at timestamptz NOT NULL DEFAULT now()
      )
    `.catch((error) => { ignoreTableReady = null; throw error; });
  }
  return ignoreTableReady;
}

export async function GET(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  await ensureIgnoreTable();
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "similar" ? "similar" : "exact";
  const course = url.searchParams.get("course") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const requestedLimit = Number(url.searchParams.get("limit")) || 10;
  const limit = [5, 10, 25, 50].includes(requestedLimit) ? requestedLimit : 10;
  const offset = (page - 1) * limit;
  if (course && !isCourse(course)) return NextResponse.json({ error: "Unknown course." }, { status: 400 });

  const sql = getSql();
  const isExact = mode === "exact";

  // One full scan builds every cluster signature; window functions carry the overall
  // totals so counting and paging share a single pass. Each row also brings its member
  // ids (allowlisted copy first) so member details are then fetched by primary key
  // instead of re-scanning and re-normalizing the whole bank.
  const clusterRows = await sql(
    `WITH norm AS (
       SELECT q.id, (q.allowlisted_at IS NOT NULL) AS allowlisted, ${NORM_EXPR} AS nkey
       FROM questions q
       WHERE q.question_type='mcq' AND ($2='' OR q.course=$2)
     ), clusters AS (
       SELECT nkey, count(*)::int AS n, min(id) AS first_id,
              array_agg(id ORDER BY allowlisted DESC, id) AS ids
       FROM norm WHERE length(nkey) > 5 GROUP BY nkey HAVING count(*) > 1
     ), filtered AS (
       SELECT c.nkey, c.n, c.first_id, c.ids,
              count(*) OVER()::int AS total,
              coalesce(sum(c.n - 1) OVER(), 0)::int AS removable
       FROM clusters c LEFT JOIN duplicate_ignores di ON di.cluster_key = c.nkey
       WHERE di.cluster_key IS NULL
     )
     SELECT nkey, n, ids, total, removable FROM filtered
     ORDER BY n DESC, first_id
     LIMIT $3 OFFSET $4`,
    [isExact, course, limit, offset],
  ) as { nkey: string; n: number; ids: (number | string)[]; total: number; removable: number }[];

  const total = clusterRows[0]?.total ?? 0;
  const removable = clusterRows[0]?.removable ?? 0;
  const allIds = clusterRows.flatMap((row) => row.ids.map(Number));
  let clusters: Array<{ key: string; count: number; questions: Record<string, unknown>[] }> = [];
  if (allIds.length) {
    const members = await sql(
      `SELECT q.id, q.course, q.topic, q.stem, q.options, q.material_supported_key, q.explanation,
              q.shared_context, q.context_group_id, q.context_position, q.verification_status,
              q.created_at, (q.allowlisted_at IS NOT NULL) AS allowlisted,
              (SELECT count(*)::int FROM attempts a WHERE a.question_id=q.id) AS attempts
       FROM questions q WHERE q.id = ANY($1::bigint[])`,
      [allIds],
    ) as Array<Record<string, unknown> & { id: number | string }>;
    const byId = new Map(members.map((row) => [Number(row.id), row]));
    clusters = clusterRows.map((row) => ({
      key: row.nkey,
      count: row.n,
      questions: row.ids.map((id) => byId.get(Number(id))).filter((q): q is Record<string, unknown> => Boolean(q)),
    }));
  }

  return NextResponse.json({ clusters, total, removable, page, limit, mode, hasMore: offset + clusters.length < total });
}

export async function PATCH(request: Request) {
  const auth = await requireRole("admin"); if (auth.response) return auth.response;
  await ensureIgnoreTable();
  const body = await request.json() as {
    action?: "merge" | "ignore" | "delete_all";
    canonicalId?: number | string;
    duplicateIds?: (number | string)[];
    questionIds?: (number | string)[];
    allowlist?: boolean;
    clusterKey?: string;
    mode?: string;
  };
  const sql = getSql();

  if (body.action === "ignore") {
    const clusterKey = (body.clusterKey ?? "").trim();
    if (!clusterKey) return NextResponse.json({ error: "Missing cluster reference." }, { status: 400 });
    const mode = body.mode === "similar" ? "similar" : "exact";
    await sql(
      `INSERT INTO duplicate_ignores (cluster_key, mode, ignored_by) VALUES ($1, $2, $3)
       ON CONFLICT (cluster_key) DO UPDATE SET mode=EXCLUDED.mode, ignored_by=EXCLUDED.ignored_by, ignored_at=now()`,
      [clusterKey, mode, auth.user.id],
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (body.action === "delete_all") {
    const questionIds = [...new Set((body.questionIds ?? []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 50);
    if (questionIds.length < 2) return NextResponse.json({ error: "Select a duplicate cluster to delete." }, { status: 400 });
    // Same safety gate as merge: every id must share the "similar" signature so a stale
    // cluster can never delete unrelated questions.
    const sig = await sql(
      `SELECT q.id, ${SIMILAR_EXPR} AS skey FROM questions q WHERE q.id = ANY($1) AND q.question_type='mcq'`,
      [questionIds],
    ) as { id: number; skey: string }[];
    if (sig.length !== questionIds.length) return NextResponse.json({ error: "One or more of these questions no longer exists." }, { status: 400 });
    if (new Set(sig.map((row) => row.skey)).size !== 1) {
      return NextResponse.json({ error: "These questions are no longer duplicates — reload the duplicate list and try again." }, { status: 409 });
    }
    const deleted = await sql(`DELETE FROM questions WHERE id = ANY($1) RETURNING id`, [questionIds]) as { id: number }[];
    return NextResponse.json({ ok: true, deleted: deleted.length });
  }

  if (body.action === "merge") {
    const canonicalId = Number(body.canonicalId);
    if (!Number.isSafeInteger(canonicalId) || canonicalId <= 0) return NextResponse.json({ error: "Choose which question to keep." }, { status: 400 });
    const duplicateIds = [...new Set((body.duplicateIds ?? []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0 && id !== canonicalId))].slice(0, 50);
    if (!duplicateIds.length) return NextResponse.json({ error: "Select at least one duplicate to merge away." }, { status: 400 });

    // Safety gate: every question in the merge must share the same "similar" signature
    // (shared_context + stem). Exact matches satisfy this too, so it is the loosest check
    // that still blocks an accidental delete of unrelated questions.
    const allIds = [canonicalId, ...duplicateIds];
    const sig = await sql(
      `SELECT q.id, ${SIMILAR_EXPR} AS skey FROM questions q WHERE q.id = ANY($1) AND q.question_type='mcq'`,
      [allIds],
    ) as { id: number; skey: string }[];
    if (sig.length !== allIds.length) return NextResponse.json({ error: "One or more of these questions no longer exists." }, { status: 400 });
    if (new Set(sig.map((row) => row.skey)).size !== 1) {
      return NextResponse.json({ error: "These questions are no longer duplicates — reload the duplicate list and try again." }, { status: 409 });
    }

    const deleted = await sql(`DELETE FROM questions WHERE id = ANY($1) RETURNING id`, [duplicateIds]) as { id: number }[];
    let allowlisted = false;
    if (body.allowlist !== false) {
      await sql(`UPDATE questions SET allowlisted_at=now(), allowlisted_by=$2, updated_at=now() WHERE id=$1 AND allowlisted_at IS NULL`, [canonicalId, auth.user.id]);
      allowlisted = true;
    }
    return NextResponse.json({ ok: true, canonicalId, merged: deleted.length, allowlisted });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
