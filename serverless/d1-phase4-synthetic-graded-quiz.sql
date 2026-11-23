-- PHASE 4A: isolated synthetic quiz proof, NOT APPLIED to Cloudflare D1.
-- Do not move real scores or questions into this table. Real quizzes require
-- a vetted question bank, anti-cheating controls and a new schema.
-- Existing demo_students, unit_accounts and attempt history remain untouched.
CREATE TABLE IF NOT EXISTS synthetic_graded_attempts (
  firebase_uid TEXT PRIMARY KEY NOT NULL
    REFERENCES demo_students(firebase_uid) ON DELETE CASCADE
    CHECK (firebase_uid GLOB 'student_*'
      AND length(firebase_uid)=40
      AND firebase_uid NOT GLOB '*[^a-f0-9_]*'),
  quiz_id TEXT NOT NULL DEFAULT 'synthetic_math_v1'
    CHECK (quiz_id='synthetic_math_v1'),
  answer_index INTEGER NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
  score INTEGER NOT NULL CHECK (
    (answer_index=1 AND score=10)
    OR (answer_index<>1 AND score=0)
  ),
  submitted_at INTEGER NOT NULL CHECK (submitted_at>0),
  marker TEXT NOT NULL DEFAULT 'SYNTHETIC_ONLY'
    CHECK (marker='SYNTHETIC_ONLY')
);
CREATE INDEX IF NOT EXISTS synthetic_graded_attempts_by_date
  ON synthetic_graded_attempts(submitted_at DESC);
