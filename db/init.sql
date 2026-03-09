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
CREATE INDEX IF NOT EXISTS projects_created_at_idx ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions(created_at DESC);

-- Constrain session status to known values
DO $$ BEGIN
  ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
    CHECK (status IN ('active', 'ended'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Allowed users (email allowlist for Auth.js sign-in)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         text NOT NULL UNIQUE,
  name          text,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- Seed default admin user
INSERT INTO users (email, name, password_hash)
VALUES (
  'info@innovandio.com',
  'Admin',
  crypt('E7f8TEzdSHiK', gen_salt('bf'))
)
ON CONFLICT (email) DO NOTHING;

-- OpenAI OAuth tokens (encrypted at rest via pgcrypto)
CREATE TABLE IF NOT EXISTS openai_tokens (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token  bytea NOT NULL,
  refresh_token bytea NOT NULL,
  id_token      text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS openai_tokens_user_id_idx ON openai_tokens(user_id);

