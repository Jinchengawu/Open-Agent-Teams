export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  agent_id    TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  tokens      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`;

export function initSchema(db: { exec: (sql: string) => void }): void {
  db.exec(SCHEMA_SQL);
}
