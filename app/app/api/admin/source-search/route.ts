import { NextResponse } from "next/server";
import { requireRole } from "@/lib/authorization";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

const STOP_WORDS = new Set(["about", "after", "before", "being", "could", "does", "following", "from", "have", "into", "shall", "should", "that", "their", "there", "these", "this", "under", "what", "when", "where", "which", "with", "would"]);

export async function GET(request: Request) {
  const auth = await requireRole("admin");
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const questionId = Number(url.searchParams.get("questionId"));
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 500);
  if (!Number.isSafeInteger(questionId) || query.length < 3) return NextResponse.json({ error: "Enter at least three characters to search." }, { status: 400 });

  const terms = [...new Set((query.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).map((word) => word.replaceAll("'", "")).filter((word) => word.length > 3 && !STOP_WORDS.has(word)))].slice(0, 16);
  if (!terms.length) return NextResponse.json({ error: "Use a more distinctive word or phrase." }, { status: 400 });
  const tsQuery = terms.join(" | ");
  const phrasePattern = `%${query}%`;
  const rows = await getSql()`
    WITH target AS (SELECT source_document_id,course FROM questions WHERE id=${questionId} LIMIT 1)
    SELECT c.id,c.content,c.page_locator,c.chunk_index,
           COALESCE(s.display_name,s.rel_source_path,'Unknown document') AS document,
           s.rel_source_path,
           ts_rank_cd(c.tsv,to_tsquery('english',${tsQuery}),32)
             + CASE WHEN c.source_document_id=(SELECT source_document_id FROM target) THEN .8 ELSE 0 END
             + CASE WHEN c.course=(SELECT course FROM target) THEN .2 ELSE 0 END
             + CASE WHEN c.content ILIKE ${phrasePattern} THEN 1 ELSE 0 END AS rank
    FROM chunks c JOIN source_documents s ON s.id=c.source_document_id
    WHERE c.tsv @@ to_tsquery('english',${tsQuery}) OR c.content ILIKE ${phrasePattern}
    ORDER BY rank DESC,c.id LIMIT 20
  `;
  return NextResponse.json({ results: rows });
}
