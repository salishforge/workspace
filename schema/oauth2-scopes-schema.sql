-- OAuth2 RBAC Schema — Scope Definitions & Client Scope Assignments
-- v1.1.0 — Salish Forge
--
-- Run after oauth2-schema.sql:
--   psql -U oauth2_user -d oauth2 -f schema/oauth2-scopes-schema.sql
--
-- Tables:
--   oauth2_scope_definitions  — canonical list of valid scopes
--   oauth2_client_scopes      — normalized client ↔ scope assignments
--   oauth2_auth_denials       — audit log for authorization failures

\connect oauth2

-- ─── Scope definitions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth2_scope_definitions (
  scope       TEXT        PRIMARY KEY,
  description TEXT        NOT NULL,
  restricted  BOOLEAN     NOT NULL DEFAULT false,  -- restricted scopes require manual approval
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Predefined scopes: service:action hierarchy
INSERT INTO oauth2_scope_definitions (scope, description, restricted) VALUES
  ('memforge:read',  'Read access to MemForge memory API',           false),
  ('memforge:write', 'Write access to MemForge memory API',          false),
  ('hyphae:read',    'Read access to Hyphae service registry',       false),
  ('hyphae:admin',   'Full admin access to Hyphae service registry', true),
  ('system:admin',   'System-level admin access (metrics, config)',  true)
ON CONFLICT (scope) DO NOTHING;

-- ─── Client scope assignments ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth2_client_scopes (
  client_id   TEXT        NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
  scope_name  TEXT        NOT NULL REFERENCES oauth2_scope_definitions(scope) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, scope_name)
);

CREATE INDEX IF NOT EXISTS idx_oauth2_client_scopes_client ON oauth2_client_scopes (client_id);

-- Seed default client scopes (aligned with oauth2-seed.js clients)
-- dashboard: can read memory + access system metrics
INSERT INTO oauth2_client_scopes (client_id, scope_name) VALUES
  ('dashboard', 'memforge:read'),
  ('dashboard', 'system:admin')
ON CONFLICT DO NOTHING;

-- memforge: full memory access
INSERT INTO oauth2_client_scopes (client_id, scope_name) VALUES
  ('memforge', 'memforge:read'),
  ('memforge', 'memforge:write')
ON CONFLICT DO NOTHING;

-- hyphae: service registry management
INSERT INTO oauth2_client_scopes (client_id, scope_name) VALUES
  ('hyphae', 'hyphae:read'),
  ('hyphae', 'hyphae:admin')
ON CONFLICT DO NOTHING;

-- ─── Authorization denials audit log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth2_auth_denials (
  id             BIGSERIAL   PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id      TEXT,
  token_scope    TEXT,
  required_scope TEXT        NOT NULL,
  path           TEXT,
  method         TEXT,
  ip             TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth2_auth_denials_ts     ON oauth2_auth_denials (ts DESC);
CREATE INDEX IF NOT EXISTS idx_oauth2_auth_denials_client ON oauth2_auth_denials (client_id, ts DESC);

-- ─── Grants ───────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, DELETE ON oauth2_scope_definitions TO oauth2_user;
GRANT SELECT, INSERT, DELETE ON oauth2_client_scopes     TO oauth2_user;
GRANT SELECT, INSERT         ON oauth2_auth_denials      TO oauth2_user;
GRANT USAGE, SELECT ON SEQUENCE oauth2_auth_denials_id_seq TO oauth2_user;
