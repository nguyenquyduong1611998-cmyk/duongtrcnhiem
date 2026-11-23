-- Phase 3L: synthetic-only additional reviewer admins, NOT DEPLOYED.
-- There is no bootstrap/INSERT seed. Every reviewer defaults to disabled.
-- Add real reviewer permissions only after out-of-band identity verification,
-- least-privilege operating procedure, and approved staging migration.
CREATE TABLE IF NOT EXISTS student_pilot_review_admins (
  firebase_uid TEXT PRIMARY KEY NOT NULL
    CHECK(
      length(firebase_uid) BETWEEN 6 AND 128
      AND firebase_uid NOT GLOB '*[^A-Za-z0-9_-]*'
      AND firebase_uid NOT GLOB 'student_*'
    ),
  role TEXT NOT NULL DEFAULT 'unlock_reviewer'
    CHECK(role='unlock_reviewer'),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  tokens_valid_after INTEGER NOT NULL DEFAULT 0
    CHECK(tokens_valid_after>=0),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at)
);
-- No client-visible grants, passwords, provider secrets or admin email stored.
