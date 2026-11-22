// Phase 3C - PROPOSED server-side session registry. NOT APPLIED BY COMMIT.
// Identity-only: no passwords, names, grades, or personally identifying fields.
// Every account starts disabled and requiring a completed password reset.
// A Firebase ID token alone is NOT evidence an account is active.
CREATE TABLE IF NOT EXISTS student_auth_identities (
  firebase_uid TEXT PRIMARY KEY NOT NULL
    CHECK (
      firebase_uid GLOB 'student_*'
      AND length(firebase_uid) = 40
      AND firebase_uid NOT GLOB '*[^a-z0-9_]*'
    ),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  password_reset_required INTEGER NOT NULL DEFAULT 1
    CHECK (password_reset_required IN (0, 1)),
  tokens_valid_after INTEGER NOT NULL DEFAULT 0
    CHECK (tokens_valid_after >= 0),
  last_block_event_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
);
