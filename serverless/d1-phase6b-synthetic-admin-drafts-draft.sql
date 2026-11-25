-- PHASE 6B OFFLINE DRAFT. NEVER APPLY TO CLOUDFLARE WITHOUT OPERATOR REVIEW.
-- Additive standalone tables: no references to existing Phase 4/5, no migration,
-- no publication and no student data. Synthetic arithmetic templates ONLY.
-- Preview DB candidate: duongtrcnhiem-auth-preview, binding AUTH_DB_PREVIEW.
CREATE TABLE IF NOT EXISTS phase6_admin_drafts (
  draft_id TEXT PRIMARY KEY NOT NULL
    CHECK(length(draft_id)=40 AND draft_id GLOB 'p6_demo_*'),
  title_code TEXT NOT NULL CHECK(title_code IN ('basic','practice','challenge')),
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 240),
  templates_json TEXT NOT NULL CHECK(
    json_valid(templates_json) AND json_type(templates_json)='array'
    AND json_array_length(templates_json) BETWEEN 0 AND 12
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100000),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
  marker TEXT NOT NULL DEFAULT 'PHASE6_SYNTHETIC_DRAFT'
    CHECK(marker='PHASE6_SYNTHETIC_DRAFT')
);
CREATE INDEX IF NOT EXISTS phase6_drafts_updated_at
  ON phase6_admin_drafts(updated_at DESC);

-- Minimal audit metadata only: never store questions/answers, tokens or identity.
CREATE TABLE IF NOT EXISTS phase6_admin_draft_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('create','save','delete')),
  version INTEGER NOT NULL,
  happened_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS phase6_admin_draft_created
AFTER INSERT ON phase6_admin_drafts
BEGIN
  INSERT INTO phase6_admin_draft_events(draft_id,event_type,version,happened_at)
  VALUES (NEW.draft_id,'create',NEW.version,unixepoch());
END;
CREATE TRIGGER IF NOT EXISTS phase6_admin_draft_saved
AFTER UPDATE ON phase6_admin_drafts
BEGIN
  INSERT INTO phase6_admin_draft_events(draft_id,event_type,version,happened_at)
  VALUES (NEW.draft_id,'save',NEW.version,unixepoch());
END;
CREATE TRIGGER IF NOT EXISTS phase6_admin_draft_deleted
AFTER DELETE ON phase6_admin_drafts
BEGIN
  INSERT INTO phase6_admin_draft_events(draft_id,event_type,version,happened_at)
  VALUES (OLD.draft_id,'delete',OLD.version,unixepoch());
END;
