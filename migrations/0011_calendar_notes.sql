-- Notes placed on the calendar between jobs (e.g. "Pick up trailer at shop"), in a driver's day order.
CREATE TABLE calendar_notes (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,                       -- YYYY-MM-DD
  driver_id  TEXT REFERENCES users(id),           -- NULL = everyone
  text       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,          -- shares the day's order with jobs
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX calendar_notes_date ON calendar_notes(date, driver_id);
