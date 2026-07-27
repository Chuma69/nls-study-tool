import { createHash } from "node:crypto";
import { getSql } from "./db";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function allowRequest(scope: string, identifier: string, maximum: number, windowSeconds: number) {
  const sql = getSql();
  const keyHash = hash(identifier);
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM rate_limit_events
    WHERE scope = ${scope}
      AND key_hash = ${keyHash}
      AND created_at > now() - (${windowSeconds} * interval '1 second')
  ` as { count: number }[];
  if (rows[0].count >= maximum) return false;

  await sql`INSERT INTO rate_limit_events (scope, key_hash) VALUES (${scope}, ${keyHash})`;
  return true;
}
