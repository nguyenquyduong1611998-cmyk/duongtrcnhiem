-- STAGING ONLY: Cloudflare D1 database, separate from Firebase/Firestore.
-- Run in Cloudflare D1 Console. Never place real passwords in this file.
CREATE TABLE IF NOT EXISTS demo_students (
  username TEXT PRIMARY KEY NOT NULL,
  firebase_uid TEXT UNIQUE NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL DEFAULT 310000,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failed INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
