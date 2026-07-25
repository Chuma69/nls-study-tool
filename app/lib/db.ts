import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Neon serverless HTTP driver — the right fit for Vercel serverless functions.
// DATABASE_URL is injected by the Vercel <-> Neon Marketplace integration in
// production, and read from .env.local in development.
//
// The client is created lazily on first query so that merely importing a route
// module (e.g. during `next build`'s page-data collection) never requires a
// live connection string.
let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }
  // `neon(...)` returns a tagged-template query function; interpolated values
  // are sent as bound parameters (not string-concatenated), so it is
  // injection-safe.
  _sql = neon(url);
  return _sql;
}
