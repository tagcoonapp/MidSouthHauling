-- Expense pricing: 5 pay types, driver answers, price sheet, repo mileage rates, approved expenses.

-- Job types become the 5 pay types.
UPDATE jobs SET job_type = 'new'  WHERE job_type = 'off_lot_delivery';
UPDATE jobs SET job_type = 'used' WHERE job_type IN ('private_move', 'inventory');

-- What the driver answers when they do the job.
ALTER TABLE jobs ADD COLUMN reported_customer_name TEXT NOT NULL DEFAULT '';  -- name as written on the happy sheet
ALTER TABLE jobs ADD COLUMN miles REAL;
ALTER TABLE jobs ADD COLUMN lot_taken_to TEXT NOT NULL DEFAULT '';            -- repos only
-- Set by the scheduler at review.
ALTER TABLE jobs ADD COLUMN moody INTEGER NOT NULL DEFAULT 0;                 -- happy sheet says Moody: new pays 10%
ALTER TABLE jobs ADD COLUMN amount_override_cents INTEGER;                    -- scheduler's own amount for the main expense

CREATE TABLE price_list (
  style       TEXT NOT NULL,
  width       INTEGER NOT NULL,
  length      INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (style, width, length)
);

CREATE TABLE repo_rates (
  id           TEXT PRIMARY KEY,
  up_to_miles  REAL,              -- NULL = "and up"
  amount_cents INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Expenses frozen at approval. A successful repo makes two rows (main + fuel).
CREATE TABLE expenses (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('main', 'fuel')),
  description  TEXT NOT NULL,
  basis        TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  approved_by  TEXT REFERENCES users(id),
  approved_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  entered_at   TEXT                -- when it was typed into NetSuite Employee Center
);
CREATE INDEX expenses_job ON expenses(job_id);
CREATE INDEX expenses_approved ON expenses(approved_at);
