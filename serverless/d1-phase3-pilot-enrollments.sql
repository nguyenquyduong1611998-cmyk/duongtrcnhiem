-- Phase 3: DRAFT enrollments for synthetic pilot accounts ONLY.
-- DO NOT execute on a real user database or insert personally identifying data.
-- Proposed staging migration; NOT applied by committing this file.
-- Does not change unit_accounts, demo_students, login_attempts or Firebase.
-- No password, password hash or Firebase UID is stored at this stage.
CREATE TABLE IF NOT EXISTS student_pilot_enrollments (
  enrollment_id TEXT PRIMARY KEY NOT NULL
    CHECK (enrollment_id GLOB 'pilot_*' AND length(enrollment_id) = 38),
  username TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (
      username GLOB 'pilot_hv_*'
      AND length(username) = 21
      AND username = lower(username)
      AND username NOT GLOB '*[^a-z0-9_]*'
    ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'disabled')),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
);
CREATE TABLE IF NOT EXISTS student_pilot_audit (
  event_id TEXT PRIMARY KEY NOT NULL,
  enrollment_id TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created')),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  FOREIGN KEY (enrollment_id) REFERENCES student_pilot_enrollments(enrollment_id)
);
CREATE INDEX IF NOT EXISTS student_pilot_audit_by_account
  ON student_pilot_audit(enrollment_id, created_at);
