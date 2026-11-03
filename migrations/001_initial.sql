CREATE SCHEMA IF NOT EXISTS pursuk;
CREATE TABLE IF NOT EXISTS pursuk.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pursuk.users (id text PRIMARY KEY, name text NOT NULL, is_mock boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pursuk.usage (user_id text NOT NULL REFERENCES pursuk.users(id), period text NOT NULL, count integer NOT NULL DEFAULT 0 CHECK(count >= 0), PRIMARY KEY(user_id,period));
CREATE TABLE IF NOT EXISTS pursuk.reservations (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES pursuk.users(id), day text NOT NULL, month text NOT NULL, state text NOT NULL CHECK(state IN ('pending','completed','released')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pursuk.mock_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES pursuk.users(id), expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON pursuk.mock_sessions(expires_at);
CREATE TABLE IF NOT EXISTS pursuk.conversations (
  user_id text NOT NULL REFERENCES pursuk.users(id), id uuid NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]', choices jsonb NOT NULL DEFAULT '[]', summary_cache jsonb NOT NULL DEFAULT '[]',
  lease_id uuid, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,id), CHECK(jsonb_typeof(messages)='array'), CHECK(jsonb_typeof(choices)='array'), CHECK(jsonb_typeof(summary_cache)='array')
);
CREATE INDEX IF NOT EXISTS conversations_recent ON pursuk.conversations(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS pursuk.imports (source text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now());
INSERT INTO pursuk.schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
