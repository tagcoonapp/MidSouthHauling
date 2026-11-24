-- Set when a full NetSuite import no longer lists this open job (cancelled/finished there); cleared when it shows up again.
ALTER TABLE jobs ADD COLUMN missing_from_netsuite_at TEXT;
