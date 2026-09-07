-- Keep existing databases intact while adding data required for exact event accounting.
ALTER TABLE diagnostic_events ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER IF NOT EXISTS diagnostic_events_account_insert
AFTER INSERT ON diagnostic_events
BEGIN
  UPDATE runs
  SET event_count = event_count + 1,
      event_bytes = event_bytes + NEW.byte_size,
      updated_at = NEW.received_at
  WHERE id = NEW.run_id;
END;
CREATE INDEX IF NOT EXISTS signals_expiry ON signals(expires_at);
CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires_at);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));
