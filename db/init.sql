-- Projects (one per agent/repo)
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  agent_id text NOT NULL UNIQUE,
  name text NOT NULL,
  workspace_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Sessions (parallel workstreams within a project)
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  name text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_key text
);
CREATE INDEX IF NOT EXISTS sessions_project_id_idx ON sessions(project_id);
CREATE INDEX IF NOT EXISTS sessions_session_key_idx ON sessions(session_key);

-- GSD Tasks (per project)
CREATE TABLE IF NOT EXISTS gsd_tasks (
  id text PRIMARY KEY,
  project_id text REFERENCES projects(id),
  title text NOT NULL,
  status text NOT NULL,
  wave int,
  file_path text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gsd_tasks_project_status_idx ON gsd_tasks(project_id, status);
