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

-- Events (append-only, tagged with project + session)
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  project_id text REFERENCES projects(id),
  session_id text REFERENCES sessions(id),
  agent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project_session_idx ON events(project_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_event_type_idx ON events(event_type);
CREATE INDEX IF NOT EXISTS events_payload_gin_idx ON events USING gin (payload);

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
