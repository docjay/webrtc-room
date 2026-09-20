ALTER TABLE probe_results ADD COLUMN connectivity TEXT;
ALTER TABLE probe_results ADD COLUMN protocol_verification TEXT;
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'));
