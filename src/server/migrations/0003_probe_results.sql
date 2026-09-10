CREATE TABLE IF NOT EXISTS probe_results (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  pair_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  detail TEXT NOT NULL,
  selected TEXT,
  elapsed_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(attempt_id,pair_id,participant_id)
);
CREATE INDEX IF NOT EXISTS probe_results_attempt_pair ON probe_results(attempt_id,pair_id);
