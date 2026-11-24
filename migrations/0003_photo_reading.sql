-- AI photo reading: what Claude read off the happy sheet / serial / building photos.
ALTER TABLE jobs ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'none';  -- none | reading | done | error | unavailable
ALTER TABLE jobs ADD COLUMN ai_result TEXT;                          -- JSON (shared/photo-read.ts PhotoRead)
ALTER TABLE jobs ADD COLUMN ai_error TEXT;
ALTER TABLE jobs ADD COLUMN ai_read_at TEXT;
ALTER TABLE jobs ADD COLUMN ai_runs INTEGER NOT NULL DEFAULT 0;
