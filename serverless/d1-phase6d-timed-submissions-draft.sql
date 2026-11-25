-- PHASE 6D OFFLINE DRAFT ONLY: never apply to a live Cloudflare D1 here.
-- Requires Phase5 schema + 6A sessions + 6C publication metadata and
-- 6B demo enrollment. No writes to preexisting Phase4/5 data.
-- Store one server-graded submission per immutable session, owned by UID.
CREATE TABLE IF NOT EXISTS phase6_exam_submissions (
  submission_id TEXT PRIMARY KEY NOT NULL
    CHECK(length(submission_id) BETWEEN 16 AND 100),
  session_id TEXT NOT NULL UNIQUE,
  student_uid TEXT NOT NULL CHECK(length(student_uid)=40 AND student_uid GLOB 'student_*'),
  topic_id TEXT NOT NULL CHECK(length(topic_id) BETWEEN 3 AND 80),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100000),
  answers_json TEXT NOT NULL CHECK(
    json_valid(answers_json) AND json_type(answers_json)='object'
    AND length(answers_json)<=4096
  ),
  correct_count INTEGER NOT NULL CHECK(correct_count BETWEEN 0 AND 12),
  total_count INTEGER NOT NULL CHECK(total_count BETWEEN 1 AND 12),
  score_tenths INTEGER NOT NULL CHECK(score_tenths BETWEEN 0 AND 100),
  submitted_at INTEGER NOT NULL CHECK(submitted_at>0),
  marker TEXT NOT NULL DEFAULT 'PHASE6_SYNTHETIC_SUBMISSION'
    CHECK(marker='PHASE6_SYNTHETIC_SUBMISSION'),
  FOREIGN KEY(session_id) REFERENCES phase6_exam_sessions(session_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(topic_id,revision)
    REFERENCES phase5_content_versions(topic_id,revision) ON DELETE RESTRICT,
  UNIQUE(student_uid,topic_id,revision),
  CHECK(correct_count<=total_count),
  CHECK(score_tenths=CAST(ROUND(correct_count*100.0/total_count) AS INTEGER))
);
CREATE INDEX IF NOT EXISTS phase6_submissions_uid_time
  ON phase6_exam_submissions(student_uid,submitted_at DESC);

-- DB itself checks ownership, published revision, enrolment and deadline,
-- independently of what the browser or a caller supplies. Submissions at
-- the exact expiry second are valid; one second later are rejected.
CREATE TRIGGER IF NOT EXISTS phase6_submission_guard
BEFORE INSERT ON phase6_exam_submissions
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM phase6_exam_sessions s
    JOIN phase6_admin_publications p
      ON p.draft_id=s.topic_id AND p.revision=s.revision
    JOIN demo_students d ON d.firebase_uid=s.student_uid AND d.active=1
    WHERE s.session_id=NEW.session_id
      AND s.student_uid=NEW.student_uid
      AND s.topic_id=NEW.topic_id
      AND s.revision=NEW.revision
      AND s.question_count=NEW.total_count
      AND NEW.submitted_at BETWEEN s.started_at AND s.expires_at
      AND unixepoch() BETWEEN s.started_at AND s.expires_at
  ) THEN RAISE(ABORT,'PHASE6_SESSION_OWNER_OR_DEADLINE') END;
  SELECT CASE WHEN ABS(unixepoch()-NEW.submitted_at)>1
    THEN RAISE(ABORT,'PHASE6_DB_TIMESTAMP_REQUIRED') END;
END;

CREATE TRIGGER IF NOT EXISTS phase6_submission_no_update
BEFORE UPDATE ON phase6_exam_submissions
BEGIN SELECT RAISE(ABORT,'PHASE6_SUBMISSION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS phase6_submission_no_delete
BEFORE DELETE ON phase6_exam_submissions
BEGIN SELECT RAISE(ABORT,'PHASE6_SUBMISSION_IMMUTABLE'); END;
