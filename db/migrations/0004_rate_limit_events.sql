-- Short-lived, hashed identifiers support basic request limits without
-- storing raw IP addresses or session tokens.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope      TEXT NOT NULL,
  key_hash   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_scope_key_time
  ON rate_limit_events(scope, key_hash, created_at DESC);
