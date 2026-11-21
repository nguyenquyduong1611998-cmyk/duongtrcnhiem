-- Phase 2B: STAGING-ONLY account table for synthetic tests.
-- Run ONLY in Cloudflare D1 "duongtrcnhiem-auth-staging".
-- No INSERT, UPDATE, DELETE, DROP, or ALTER statements in this migration.
-- Existing demo_students and login_attempts tables are not changed.
-- Guardrail: only usernames beginning test_unit_ can exist in this table.
-- IMPORTANT: Schema creation alone does NOT enable new logins or real-data sync.
CREATE TABLE IF NOT EXISTS unit_accounts (
  username TEXT PRIMARY KEY NOT NULL COLLATE NOCASE
    CHECK (
      length(username) BETWEEN 11 AND 40
      AND username GLOB 'test_unit_*'
      AND username = lower(username)
      AND username NOT GLOB '*[^a-z0-9_]*'
    ),
  firebase_uid TEXT NOT NULL UNIQUE
    CHECK (firebase_uid GLOB 'student_*' AND length(firebase_uid) <= 128),
  role TEXT NOT NULL DEFAULT 'student'
    CHECK (role = 'student'),
  password_salt TEXT NOT NULL
    CHECK (password_salt GLOB 'cf-chain-v1.*'),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 43),
  kdf_scheme TEXT NOT NULL DEFAULT 'cf-chain-v1'
    CHECK (kdf_scheme = 'cf-chain-v1'),
  kdf_iterations INTEGER NOT NULL DEFAULT 310000
    CHECK (kdf_iterations BETWEEN 310000 AND 650000),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  password_reset_required INTEGER NOT NULL DEFAULT 1
    CHECK (password_reset_required IN (0, 1)),
  auth_version INTEGER NOT NULL DEFAULT 1
    CHECK (auth_version >= 1),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  password_changed_at INTEGER,
  disabled_at INTEGER
);
