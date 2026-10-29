CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160), status TEXT NOT NULL CHECK(status IN ('Pendiente','En curso','Hecha')), priority TEXT NOT NULL CHECK(priority IN ('Baja','Media','Alta')), is_example INTEGER NOT NULL DEFAULT 0 CHECK(is_example IN (0,1)), version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seed_markers (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (workspace_id TEXT NOT NULL REFERENCES workspaces(id), key TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('create','update','delete')), payload TEXT NOT NULL, state TEXT NOT NULL CHECK(state = 'confirmed'), result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,key));
CREATE INDEX IF NOT EXISTS tasks_owner_order ON tasks(workspace_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(workspace_id);
