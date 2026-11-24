-- Map: cached coordinates for each job's address.
ALTER TABLE jobs ADD COLUMN lat REAL;
ALTER TABLE jobs ADD COLUMN lng REAL;
ALTER TABLE jobs ADD COLUMN geo_status TEXT NOT NULL DEFAULT 'none';  -- none | working | ok | failed
ALTER TABLE jobs ADD COLUMN geo_approx INTEGER NOT NULL DEFAULT 0;     -- 1 = only the town could be found
