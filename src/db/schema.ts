export const bootstrapSql = `
CREATE TABLE IF NOT EXISTS run_state (
  run_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  run_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
