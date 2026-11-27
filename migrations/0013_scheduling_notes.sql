-- Office-only notes about scheduling a customer ("won't be ready until the 12th"). Never shown to drivers.
CREATE TABLE scheduling_notes (
  id            TEXT PRIMARY KEY,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  text          TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at       TEXT,
  done_by       TEXT REFERENCES users(id)
);
CREATE INDEX scheduling_notes_job ON scheduling_notes(job_id);
CREATE INDEX scheduling_notes_open ON scheduling_notes(done_at, created_at);

-- A scheduled job not submitted by the end of its day goes back to the pipeline; this remembers the day it missed.
ALTER TABLE jobs ADD COLUMN missed_date TEXT;
