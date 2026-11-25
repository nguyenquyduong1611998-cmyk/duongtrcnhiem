-- PHASE 6C: OFFLINE REVIEW ONLY; NEVER EXECUTE ON CLOUDFLARE WITHOUT APPROVAL.
-- Requires Phase5 additive schema and Phase6B synthetic drafts schema.
-- Isolated metadata linking a synthetic draft version to an immutable
-- published Phase5 content revision. No changes to existing tables.
-- The Phase5 published triggers protect version/questions/private answer keys.
-- Do not run on Production, duongtrcnhiem-auth-staging or actual D1 today.
CREATE TABLE IF NOT EXISTS phase6_admin_publications (
  draft_id TEXT NOT NULL
    CHECK(length(draft_id)=40 AND draft_id GLOB 'p6_demo_*'),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100000),
  published_at INTEGER NOT NULL CHECK(published_at>0),
  marker TEXT NOT NULL DEFAULT 'PHASE6_SYNTHETIC_PUBLICATION'
    CHECK(marker='PHASE6_SYNTHETIC_PUBLICATION'),
  PRIMARY KEY(draft_id,revision),
  FOREIGN KEY(draft_id,revision)
    REFERENCES phase5_content_versions(topic_id,revision) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS phase6_publications_latest
  ON phase6_admin_publications(draft_id,revision DESC);
CREATE TRIGGER IF NOT EXISTS phase6_publication_requires_published
BEFORE INSERT ON phase6_admin_publications
WHEN NOT EXISTS(
  SELECT 1 FROM phase5_content_versions v
  WHERE v.topic_id=NEW.draft_id AND v.revision=NEW.revision
    AND v.state='published' AND v.published_at=NEW.published_at
)
BEGIN SELECT RAISE(ABORT,'PHASE6_PUBLICATION_NOT_PUBLISHED'); END;
CREATE TRIGGER IF NOT EXISTS phase6_publication_no_update
BEFORE UPDATE ON phase6_admin_publications
BEGIN SELECT RAISE(ABORT,'PHASE6_PUBLICATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS phase6_publication_no_delete
BEFORE DELETE ON phase6_admin_publications
BEGIN SELECT RAISE(ABORT,'PHASE6_PUBLICATION_IMMUTABLE'); END;
