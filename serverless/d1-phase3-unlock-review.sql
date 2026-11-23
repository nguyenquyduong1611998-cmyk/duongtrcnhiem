-- Phase 3K: UNDEPLOYED synthetic-only manual unlock review records.
-- This does NOT implement, authorize, or execute account activation.
-- Apply only to a disposable SQLite/D1 sandbox after review.
CREATE TABLE IF NOT EXISTS student_pilot_unlock_reviews (
  review_id TEXT PRIMARY KEY NOT NULL
    CHECK (review_id GLOB 'unlock_*' AND length(review_id)=39),
  firebase_uid TEXT NOT NULL
    REFERENCES student_auth_identities(firebase_uid),
  blocked_auth_version INTEGER NOT NULL CHECK (blocked_auth_version >= 2),
  block_event_id TEXT NOT NULL
    REFERENCES student_auth_block_audit(event_id),
  requested_by TEXT NOT NULL CHECK(length(requested_by) BETWEEN 1 AND 128),
  approved_by TEXT CHECK(approved_by IS NULL OR length(approved_by) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','cancelled')),
  requested_at INTEGER NOT NULL CHECK(requested_at > 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= requested_at),
  CHECK (
    (status IN ('pending','cancelled') AND approved_by IS NULL)
    OR (status='approved' AND approved_by IS NOT NULL
      AND approved_by<>requested_by)
  )
);
-- One review at a time, including an approved review until separate
-- reconciliation explicitly closes it. No activation code exists.
CREATE UNIQUE INDEX IF NOT EXISTS pilot_unlock_one_open_review
  ON student_pilot_unlock_reviews(firebase_uid)
  WHERE status IN ('pending','approved');

-- Defense in depth: experimental session identities MUST NOT transition
-- active:0 -> active:1 via manual SQL or a premature endpoint.
-- The real activation protocol must replace this guard only after a
-- reviewed versioned CAS and external IAM/Firestore/Auth integration.
CREATE TRIGGER IF NOT EXISTS phase3_no_direct_active_insert
BEFORE INSERT ON student_auth_identities
WHEN NEW.active=1
BEGIN
  SELECT RAISE(ABORT,'PILOT_DIRECT_ACTIVATION_FORBIDDEN');
END;
CREATE TRIGGER IF NOT EXISTS phase3_no_direct_reactivation
BEFORE UPDATE OF active ON student_auth_identities
WHEN OLD.active=0 AND NEW.active=1
BEGIN
  SELECT RAISE(ABORT,'PILOT_DIRECT_ACTIVATION_FORBIDDEN');
END;
