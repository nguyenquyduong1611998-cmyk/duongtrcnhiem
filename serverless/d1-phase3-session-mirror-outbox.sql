-- Phase 3E: synthetic-only durable revocation delivery queue.
-- NOT deployed by committing. Never run against production without review.
-- This queues D1 blocking events for a future trusted Firestore publisher.
-- An event in this table does NOT mean Firebase or Firestore was revoked.
CREATE TABLE IF NOT EXISTS student_auth_mirror_outbox (
  event_id TEXT PRIMARY KEY NOT NULL
    REFERENCES student_auth_block_audit(event_id),
  firebase_uid TEXT NOT NULL
    REFERENCES student_auth_identities(firebase_uid),
  auth_version INTEGER NOT NULL CHECK (auth_version >= 2),
  revoke_after_seconds INTEGER NOT NULL CHECK (revoke_after_seconds >= 0),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts BETWEEN 0 AND 1000000),
  next_attempt_at INTEGER NOT NULL DEFAULT 0 CHECK (next_attempt_at >= 0),
  lease_owner TEXT,
  lease_until INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (state = 'pending' AND lease_owner IS NULL
      AND lease_until IS NULL AND delivered_at IS NULL)
    OR (state = 'processing' AND lease_owner IS NOT NULL
      AND lease_until IS NOT NULL AND delivered_at IS NULL)
    OR (state = 'delivered' AND lease_owner IS NULL
      AND lease_until IS NULL AND delivered_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS student_auth_mirror_outbox_due
  ON student_auth_mirror_outbox(state, next_attempt_at, lease_until, created_at);
