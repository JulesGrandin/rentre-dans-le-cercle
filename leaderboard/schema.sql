CREATE TABLE IF NOT EXISTS scores (
  name TEXT NOT NULL,
  name_key TEXT NOT NULL PRIMARY KEY,
  score INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
