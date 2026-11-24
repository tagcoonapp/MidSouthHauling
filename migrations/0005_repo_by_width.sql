-- Repo pay by building width and miles ("Repo (Used) Buildings – Standard"), escort fees, attempted-repo outcome.
ALTER TABLE jobs ADD COLUMN escort_cents INTEGER;        -- 14'/16' wide repos, entered by the scheduler
ALTER TABLE jobs ADD COLUMN kept_paid_in_full INTEGER;   -- attempted repo: customer paid in full to keep the building

CREATE TABLE repo_rate_grid (
  width        INTEGER NOT NULL,
  up_to_miles  REAL,              -- NULL = "and up"
  amount_cents INTEGER,           -- flat pay, or
  pct          REAL,              -- percent of list price (plus escort fees)
  CHECK ((amount_cents IS NULL) <> (pct IS NULL))
);
CREATE UNIQUE INDEX repo_rate_grid_key ON repo_rate_grid(width, COALESCE(up_to_miles, 1e9));

-- 0–50 / 51–100 / 101–150 miles. 8' and 10': $300/$350/$425. 12': $350/$400/$525. 14' and 16': 5%/6%/7% + escort fees.
INSERT INTO repo_rate_grid (width, up_to_miles, amount_cents, pct) VALUES
  (8, 50, 30000, NULL),
  (8, 100, 35000, NULL),
  (8, 150, 42500, NULL),
  (10, 50, 30000, NULL),
  (10, 100, 35000, NULL),
  (10, 150, 42500, NULL),
  (12, 50, 35000, NULL),
  (12, 100, 40000, NULL),
  (12, 150, 52500, NULL),
  (14, 50, NULL, 5),
  (14, 100, NULL, 6),
  (14, 150, NULL, 7),
  (16, 50, NULL, 5),
  (16, 100, NULL, 6),
  (16, 150, NULL, 7);

DROP TABLE repo_rates;
