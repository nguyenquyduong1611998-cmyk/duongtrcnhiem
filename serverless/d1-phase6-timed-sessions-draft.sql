-- PHASE 6A DESIGN DRAFT ONLY. DO NOT RUN ON CLOUDFLARE D1.
-- Additive schema for isolated future Preview tests, after a fresh verified backup.
-- Not used by any current HTTP route. NO data migration, NO real examinations.
-- Depends on existing phase5_content_versions/questions tables.
-- Never target Production, main, or duongtrcnhiem-auth-staging.

CREATE TABLE IF NOT EXISTS phase6_exam_sessions (
  session_id TEXT PRIMARY KEY NOT NULL
    CHECK(length(session_id) BETWEEN 16 AND 100),
  student_uid TEXT NOT NULL CHECK(length(student_uid)=40 AND student_uid GLOB 'student_*'),
  topic_id TEXT NOT NULL CHECK(length(topic_id) BETWEEN 3 AND 80),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100000),
  question_count INTEGER NOT NULL CHECK(question_count BETWEEN 1 AND 500),
  time_limit_seconds INTEGER NOT NULL CHECK(
    time_limit_seconds BETWEEN 60 AND 14400 AND time_limit_seconds%60=0
  ),
  started_at INTEGER NOT NULL CHECK(started_at>0),
  expires_at INTEGER NOT NULL CHECK(expires_at=started_at+time_limit_seconds),
  marker TEXT NOT NULL DEFAULT 'PHASE6_PREVIEW_DRAFT'
    CHECK(marker='PHASE6_PREVIEW_DRAFT'),
  UNIQUE(student_uid,topic_id,revision),
  FOREIGN KEY(topic_id,revision) REFERENCES phase5_content_versions(topic_id,revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS phase6_session_uid_time
  ON phase6_exam_sessions(student_uid,started_at DESC);

-- Validate the snapshot against the published immutable version and question count.
-- The start time must come from the trusted DB clock (not the candidate's browser).
CREATE TRIGGER IF NOT EXISTS phase6_session_start_guard
BEFORE INSERT ON phase6_exam_sessions
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM phase5_content_versions v
    WHERE v.topic_id=NEW.topic_id AND v.revision=NEW.revision
      AND v.state='published' AND v.time_limit_seconds=NEW.time_limit_seconds
      AND (SELECT count(*) FROM phase5_content_questions q
           WHERE q.topic_id=v.topic_id AND q.revision=v.revision)=NEW.question_count
  ) THEN RAISE(ABORT,'PHASE6_PUBLISHED_EXAM_MISMATCH') END;
  SELECT CASE WHEN ABS(unixepoch()-NEW.started_at)>5
    THEN RAISE(ABORT,'PHASE6_SERVER_TIME_REQUIRED') END;
END;

-- No changing the start/deadline after it was assigned. A future submission
-- table/API must atomically enforce session ownership and expiry.
CREATE TRIGGER IF NOT EXISTS phase6_session_no_update
BEFORE UPDATE ON phase6_exam_sessions
BEGIN SELECT RAISE(ABORT,'PHASE6_SESSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS phase6_session_no_delete
BEFORE DELETE ON phase6_exam_sessions
BEGIN SELECT RAISE(ABORT,'PHASE6_SESSION_IMMUTABLE'); END;
