-- Phase 3M: DRAFT/OFFLINE synthetic-only unlock PREPARATION journal.
-- This file does NOT activate a Firebase user or create login sessions.
-- Use only in isolated SQLite tests. No Cloudflare migration is applied.
-- The pilot no-direct-activation triggers stay in effect.
CREATE TABLE IF NOT EXISTS student_pilot_unlock_preparations (
  prepare_id TEXT PRIMARY KEY NOT NULL
    CHECK (prepare_id GLOB 'prepare_*' AND length(prepare_id)=40),
  review_id TEXT NOT NULL UNIQUE
    REFERENCES student_pilot_unlock_reviews(review_id),
  firebase_uid TEXT NOT NULL
    REFERENCES student_auth_identities(firebase_uid),
  prior_auth_version INTEGER NOT NULL CHECK (prior_auth_version >= 2),
  new_auth_version INTEGER NOT NULL
    CHECK (new_auth_version=prior_auth_version+1),
  token_cutoff INTEGER NOT NULL CHECK (token_cutoff>0),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK(status IN ('prepared','aborted')),
  created_at INTEGER NOT NULL CHECK (created_at>0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at)
);
-- There may only be one unresolved preparation for a student.
CREATE UNIQUE INDEX IF NOT EXISTS pilot_unlock_one_prepared
  ON student_pilot_unlock_preparations(firebase_uid)
  WHERE status='prepared';
