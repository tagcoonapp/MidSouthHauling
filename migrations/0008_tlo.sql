-- Repos: other possible addresses for the customer from a TLO search, one per line.
ALTER TABLE jobs ADD COLUMN tlo_notes TEXT NOT NULL DEFAULT '';
