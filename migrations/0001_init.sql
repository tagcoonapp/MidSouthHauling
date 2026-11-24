-- Midsouth Hauling: initial schema.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role          TEXT NOT NULL CHECK (role IN ('driver', 'scheduler', 'owner')),
  color         TEXT NOT NULL DEFAULT '#2563eb',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE jobs (
  id             TEXT PRIMARY KEY,
  customer_name  TEXT NOT NULL,
  address        TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  serial         TEXT NOT NULL DEFAULT '',
  building       TEXT NOT NULL DEFAULT '',
  balance_cents  INTEGER,                      -- NULL = unknown, 0 = paid in full. Never sent to drivers.
  job_type       TEXT NOT NULL,
  stage          TEXT NOT NULL DEFAULT 'pipeline' CHECK (stage IN ('pipeline', 'scheduled', 'submitted', 'approved')),
  call_status    TEXT NOT NULL DEFAULT 'not_called' CHECK (call_status IN ('not_called', 'attempted', 'waiting', 'confirmed')),
  call_attempts  INTEGER NOT NULL DEFAULT 0,
  driver_id      TEXT REFERENCES users(id),
  scheduled_date TEXT,                         -- YYYY-MM-DD, local business date
  scheduled_time TEXT,                         -- free text like "8:00 AM"
  sort_order     INTEGER NOT NULL DEFAULT 0,
  office_notes   TEXT NOT NULL DEFAULT '',     -- from the office, shown to the driver
  driver_notes   TEXT NOT NULL DEFAULT '',     -- from the driver
  pdf_key        TEXT,                         -- customer PDF in R2
  submitted_at   TEXT,
  approved_at    TEXT,
  source         TEXT NOT NULL DEFAULT 'manual',
  created_by     TEXT REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX jobs_stage ON jobs(stage);
CREATE INDEX jobs_date ON jobs(scheduled_date);
CREATE INDEX jobs_driver ON jobs(driver_id, scheduled_date);
CREATE INDEX jobs_serial ON jobs(serial);

CREATE TABLE job_photos (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  uploaded_by  TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX job_photos_job ON job_photos(job_id);

-- Call log and audit trail: who did what to a job, and when.
CREATE TABLE job_events (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX job_events_job ON job_events(job_id, created_at);
