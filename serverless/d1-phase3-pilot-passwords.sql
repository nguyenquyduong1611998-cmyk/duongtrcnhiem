-- PHASE 3 / SYNTHETIC PILOT ONLY. Source file, NOT a deployed migration.
-- Apply only after review and to a fresh staging test database.
-- Existing unit_accounts, demo_students, login_attempts are untouched.
-- cf-chain-v1 is a staging DEMO-only KDF, not approved for real passwords.
CREATE TABLE IF NOT EXISTS student_pilot_credentials (
  enrollment_id TEXT PRIMARY KEY NOT NULL
    REFERENCES student_pilot_enrollments(enrollment_id),
  password_salt TEXT NOT NULL CHECK (password_salt GLOB 'cf-chain-v1.*'),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 43),
  kdf_iterations INTEGER NOT NULL DEFAULT 310000
    CHECK (kdf_iterations BETWEEN 310000 AND 650000),
  password_reset_required INTEGER NOT NULL DEFAULT 1
    CHECK (password_reset_required IN (0, 1)),
  password_version INTEGER NOT NULL DEFAULT 1 CHECK (password_version >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at > 0),
  password_changed_at INTEGER,
  CHECK (
    (password_reset_required = 1 AND password_changed_at IS NULL) OR
    (password_reset_required = 0 AND password_changed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS student_pilot_password_attempts (
  enrollment_id TEXT PRIMARY KEY NOT NULL
    REFERENCES student_pilot_enrollments(enrollment_id),
  failures INTEGER NOT NULL CHECK (failures BETWEEN 1 AND 1000000),
  first_failed INTEGER NOT NULL CHECK (first_failed > 0),
  locked_until INTEGER NOT NULL DEFAULT 0 CHECK (locked_until >= 0)
);

CREATE TABLE IF NOT EXISTS student_pilot_password_audit (
  event_id TEXT PRIMARY KEY NOT NULL,
  enrollment_id TEXT NOT NULL
    REFERENCES student_pilot_enrollments(enrollment_id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'student')),
  action TEXT NOT NULL CHECK (action IN ('temporary-issued', 'password-rotated')),
  created_at INTEGER NOT NULL CHECK (created_at > 0)
);
CREATE INDEX IF NOT EXISTS student_pilot_password_audit_by_enrollment
  ON student_pilot_password_audit(enrollment_id, created_at);
