-- Phase 3C: audit-only schema for synthetic session-blocking tests.
-- NOT applied to Cloudflare by committing this file.
-- Never log passwords, hashes, tokens, student names or result data.
CREATE TABLE IF NOT EXISTS student_auth_block_audit (
  event_id TEXT PRIMARY KEY NOT NULL,
  firebase_uid TEXT NOT NULL
    REFERENCES student_auth_identities(firebase_uid),
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action = 'server-access-blocked'),
  prior_auth_version INTEGER NOT NULL CHECK(prior_auth_version >= 1),
  new_auth_version INTEGER NOT NULL CHECK(new_auth_version = prior_auth_version + 1),
  created_at INTEGER NOT NULL CHECK(created_at > 0)
);
CREATE INDEX IF NOT EXISTS student_auth_block_audit_by_uid
  ON student_auth_block_audit(firebase_uid, created_at);
