export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    directory TEXT NOT NULL,
    parent_id TEXT,
    context_from TEXT,
    context_watermark TEXT,
    status TEXT DEFAULT 'idle',
    model TEXT,
    provider TEXT,
    token_input INTEGER DEFAULT 0,
    token_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    summary_additions INTEGER DEFAULT 0,
    summary_deletions INTEGER DEFAULT 0,
    summary_files TEXT,
    last_checkpoint_message_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (parent_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    agent TEXT,
    model TEXT,
    token_input INTEGER DEFAULT 0,
    token_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_call_id TEXT,
    args TEXT,
    result TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_parts_message ON parts(message_id);
`
