-- Money the driver collects: balance due on New/Used/Shop Build jobs, or what the customer gave on a Private Move.
ALTER TABLE jobs ADD COLUMN collected_cents INTEGER;
ALTER TABLE jobs ADD COLUMN collected_method TEXT;   -- cash | check | card
ALTER TABLE jobs ADD COLUMN collected_ref TEXT NOT NULL DEFAULT '';  -- card transaction ID or check number
