-- Guest users have the same private, opaque session mechanism as registered
-- users, but cannot be restored on a different device.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS identity_type TEXT NOT NULL DEFAULT 'registered'
  CHECK (identity_type IN ('registered', 'guest'));

CREATE INDEX IF NOT EXISTS idx_users_identity_type ON users(identity_type);
