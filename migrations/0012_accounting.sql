-- Receipts, truck costs and driver pay. None of this is ever sent to drivers except their own fuel receipts.

-- Driver pay rates (percent of the NetSuite expense). NULL = not set yet.
ALTER TABLE users ADD COLUMN pay_haul_pct REAL;   -- New, Used, Shop Build, INV Haul
ALTER TABLE users ADD COLUMN pay_repo_pct REAL;   -- Repo (not the $50 fuel line, not escort fees)

-- Attempted repo where the customer paid to keep the building: who got the money.
ALTER TABLE jobs ADD COLUMN kept_paid_to TEXT CHECK (kept_paid_to IN ('driver', 'bhr'));
-- When the driver's pay for this job was paid out.
ALTER TABLE jobs ADD COLUMN pay_paid_at TEXT;
-- Pay frozen when it was marked paid, so later rate changes do not rewrite history.
ALTER TABLE jobs ADD COLUMN pay_cents INTEGER;
ALTER TABLE jobs ADD COLUMN pay_basis TEXT;

CREATE TABLE fuel_receipts (
  id            TEXT PRIMARY KEY,
  driver_id     TEXT NOT NULL REFERENCES users(id),
  date          TEXT NOT NULL,                 -- YYYY-MM-DD
  amount_cents  INTEGER,                       -- NULL until typed or read from the photo
  gallons       REAL,
  odometer      INTEGER,
  station       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  photo_key     TEXT,
  content_type  TEXT,
  ai_status     TEXT,                          -- reading | done | error | unavailable
  ai_error      TEXT,
  ai_result     TEXT,                          -- JSON of what Claude read
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX fuel_receipts_driver ON fuel_receipts(driver_id, date);
CREATE INDEX fuel_receipts_date ON fuel_receipts(date);

CREATE TABLE truck_costs (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  category      TEXT NOT NULL,                 -- repair | tires | maintenance | insurance | registration | other
  vehicle       TEXT NOT NULL DEFAULT '',      -- e.g. "Truck 1", "Trailer"
  driver_id     TEXT REFERENCES users(id),     -- optional: whose truck
  vendor        TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  amount_cents  INTEGER NOT NULL,
  photo_key     TEXT,
  content_type  TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX truck_costs_date ON truck_costs(date);
