-- PHASE 5 ADDITIVE SCHEMA / CLOUDFARE D1 PREVIEW ONLY.
-- PREPARED FOR MANUAL REVIEW; DO NOT EXECUTE UNTIL PREVIEW BACKUP RESTORE
-- WAS VERIFIED AND THE OPERATOR HAS CONFIRMED THE DATABASE ID.
-- Target: duongtrcnhiem-auth-preview (binding AUTH_DB_PREVIEW).
-- NEVER use with duongtrcnhiem-auth-staging, main, or Production.
-- Create-only new phase5_content_* tables/triggers; NO seed; NO Phase4 changes.
-- Run before serverless/d1-phase5-preview-synthetic-math-seed.sql.
-- Existing 3 DEMO tables and the reserved _cf_KV are untouched.
-- SQLite in-memory tests plus Cloudflare D1 manual postflight required.
CREATE TABLE IF NOT EXISTS phase5_content_topics (
  topic_id TEXT PRIMARY KEY NOT NULL CHECK(length(topic_id) BETWEEN 3 AND 80),
  created_at INTEGER NOT NULL CHECK(created_at > 0)
);

-- Published revisions become immutable. Create a NEW revision to change questions.
CREATE TABLE IF NOT EXISTS phase5_content_versions (
  topic_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100000),
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 40),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 250),
  description TEXT NOT NULL CHECK(length(description) <= 2000),
  time_limit_seconds INTEGER NOT NULL CHECK(time_limit_seconds BETWEEN 60 AND 14400),
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),
  created_at INTEGER NOT NULL CHECK(created_at > 0),
  published_at INTEGER,
  PRIMARY KEY(topic_id,revision),
  FOREIGN KEY(topic_id) REFERENCES phase5_content_topics(topic_id) ON DELETE RESTRICT,
  CHECK(
    (state='draft' AND published_at IS NULL) OR
    (state='published' AND published_at IS NOT NULL AND published_at >= created_at)
  )
);

-- Never expose a browser SQL endpoint; publish only whitelisted columns.
CREATE TABLE IF NOT EXISTS phase5_content_questions (
  topic_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  question_id TEXT NOT NULL CHECK(length(question_id) BETWEEN 1 AND 80),
  order_index INTEGER NOT NULL CHECK(order_index BETWEEN 1 AND 500),
  question_text TEXT NOT NULL CHECK(length(question_text) BETWEEN 1 AND 4000),
  option_a TEXT NOT NULL CHECK(length(option_a) BETWEEN 1 AND 1000),
  option_b TEXT NOT NULL CHECK(length(option_b) BETWEEN 1 AND 1000),
  option_c TEXT NOT NULL CHECK(length(option_c) BETWEEN 1 AND 1000),
  option_d TEXT NOT NULL CHECK(length(option_d) BETWEEN 1 AND 1000),
  PRIMARY KEY(topic_id,revision,question_id),
  UNIQUE(topic_id,revision,order_index),
  FOREIGN KEY(topic_id,revision) REFERENCES phase5_content_versions(topic_id,revision)
    ON DELETE RESTRICT
);

-- Separate answer key: ONLY trusted server grader may query this.
-- Never add correct_index / explanation to questions, public documents, or client bundles.
CREATE TABLE IF NOT EXISTS phase5_content_answer_keys (
  topic_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  correct_index INTEGER NOT NULL CHECK(correct_index BETWEEN 0 AND 3),
  explanation TEXT NOT NULL DEFAULT '' CHECK(length(explanation) <= 4000),
  PRIMARY KEY(topic_id,revision,question_id),
  FOREIGN KEY(topic_id,revision,question_id)
    REFERENCES phase5_content_questions(topic_id,revision,question_id)
    ON DELETE RESTRICT
);

-- Only server-verified Firebase UID and active D1 enrollment may reach INSERT.
-- DO NOT implement any public write API before identity, anti-replay,
-- per-user authorization and server-side grading tests pass.
CREATE TABLE IF NOT EXISTS phase5_content_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL CHECK(length(attempt_id) BETWEEN 10 AND 100),
  student_uid TEXT NOT NULL CHECK(
    length(student_uid) BETWEEN 40 AND 128 AND student_uid GLOB 'student_*'
  ),
  topic_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  answers_json TEXT NOT NULL CHECK(
    json_valid(answers_json) AND json_type(answers_json)='object'
  ),
  correct_count INTEGER NOT NULL CHECK(correct_count BETWEEN 0 AND 500),
  total_count INTEGER NOT NULL CHECK(total_count BETWEEN 1 AND 500),
  score_tenths INTEGER NOT NULL CHECK(score_tenths BETWEEN 0 AND 100),
  started_at INTEGER NOT NULL CHECK(started_at>0),
  submitted_at INTEGER NOT NULL CHECK(submitted_at>=started_at),
  marker TEXT NOT NULL DEFAULT 'PHASE5_STAGING_MODEL'
    CHECK(marker='PHASE5_STAGING_MODEL'),
  UNIQUE(student_uid,topic_id,revision),
  FOREIGN KEY(topic_id,revision)
    REFERENCES phase5_content_versions(topic_id,revision) ON DELETE RESTRICT,
  CHECK(correct_count<=total_count),
  CHECK(score_tenths=CAST(ROUND(correct_count*100.0/total_count) AS INTEGER))
);

CREATE INDEX IF NOT EXISTS phase5_attempt_student_time
  ON phase5_content_attempts(student_uid,submitted_at DESC);
CREATE INDEX IF NOT EXISTS phase5_attempt_topic_time
  ON phase5_content_attempts(topic_id,revision,submitted_at DESC);

-- No published revision may be changed, even if later content is updated.
CREATE TRIGGER IF NOT EXISTS phase5_published_version_no_update
BEFORE UPDATE ON phase5_content_versions
WHEN OLD.state='published'
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_published_version_no_delete
BEFORE DELETE ON phase5_content_versions
WHEN OLD.state='published'
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_VERSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_publish_requires_complete_keys
BEFORE UPDATE OF state ON phase5_content_versions
WHEN OLD.state='draft' AND NEW.state='published'
BEGIN
  SELECT CASE WHEN
    (SELECT count(*) FROM phase5_content_questions
      WHERE topic_id=NEW.topic_id AND revision=NEW.revision) NOT BETWEEN 1 AND 500
    OR EXISTS (
      SELECT 1 FROM phase5_content_questions q
      LEFT JOIN phase5_content_answer_keys a
        ON a.topic_id=q.topic_id AND a.revision=q.revision AND a.question_id=q.question_id
      WHERE q.topic_id=NEW.topic_id AND q.revision=NEW.revision
        AND a.question_id IS NULL
    )
  THEN RAISE(ABORT,'PHASE5_KEYS_INCOMPLETE') END;
END;

CREATE TRIGGER IF NOT EXISTS phase5_published_questions_no_insert
BEFORE INSERT ON phase5_content_questions
WHEN EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=NEW.topic_id AND revision=NEW.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_QUESTIONS_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_published_questions_no_update
BEFORE UPDATE ON phase5_content_questions
WHEN EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=OLD.topic_id AND revision=OLD.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_QUESTIONS_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_published_questions_no_delete
BEFORE DELETE ON phase5_content_questions
WHEN EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=OLD.topic_id AND revision=OLD.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_QUESTIONS_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_published_keys_no_insert
BEFORE INSERT ON phase5_content_answer_keys
WHEN EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=NEW.topic_id AND revision=NEW.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_KEYS_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_published_keys_no_update
BEFORE UPDATE ON phase5_content_answer_keys
WHEN EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=OLD.topic_id AND revision=OLD.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_KEYS_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_published_keys_no_delete
BEFORE DELETE ON phase5_content_answer_keys
WHEN EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=OLD.topic_id AND revision=OLD.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_PUBLISHED_KEYS_IMMUTABLE'); END;

-- One immutable submission per user and published revision (staging rehearsal only).
CREATE TRIGGER IF NOT EXISTS phase5_attempt_requires_published
BEFORE INSERT ON phase5_content_attempts
WHEN NOT EXISTS(SELECT 1 FROM phase5_content_versions
 WHERE topic_id=NEW.topic_id AND revision=NEW.revision AND state='published')
BEGIN SELECT RAISE(ABORT,'PHASE5_REVISION_NOT_PUBLISHED'); END;

CREATE TRIGGER IF NOT EXISTS phase5_attempt_no_update
BEFORE UPDATE ON phase5_content_attempts
BEGIN SELECT RAISE(ABORT,'PHASE5_ATTEMPT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase5_attempt_no_delete
BEFORE DELETE ON phase5_content_attempts
BEGIN SELECT RAISE(ABORT,'PHASE5_ATTEMPT_IMMUTABLE'); END;
