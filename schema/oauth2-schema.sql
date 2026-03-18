-- OAuth2 Database Schema — Salish Forge
-- RFC 6749 Client Credentials Flow
--
-- Run as postgres superuser:
--   psql -U postgres -f oauth2-schema.sql
--
-- Creates database, user, and tables.
-- Client secrets are seeded via scripts/oauth2-seed.js (requires Node.js).

-- ─── Database & User ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'oauth2_user') THEN
    CREATE ROLE oauth2_user WITH LOGIN PASSWORD 'oauth2_salish_2026';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'oauth2') THEN
    CREATE DATABASE oauth2 OWNER oauth2_user;
  END IF;
END
$$;

\connect oauth2

-- Grant schema usage
GRANT ALL ON SCHEMA public TO oauth2_user;

-- ─── oauth2_clients ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth2_clients (
  client_id          TEXT        PRIMARY KEY,
  client_secret_hash TEXT        NOT NULL,
  scopes             TEXT        NOT NULL DEFAULT 'read',
  description        TEXT,
  active             BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── oauth2_tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth2_tokens (
  id                 BIGSERIAL   PRIMARY KEY,
  access_token       TEXT        NOT NULL UNIQUE,
  refresh_token      TEXT        NOT NULL UNIQUE,
  client_id          TEXT        NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
  scopes             TEXT        NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  revoked            BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_access  ON oauth2_tokens (access_token)  WHERE revoked = false;
CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_refresh ON oauth2_tokens (refresh_token) WHERE revoked = false;
CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_expires ON oauth2_tokens (expires_at)    WHERE revoked = false;

-- ─── Grants ───────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON oauth2_clients TO oauth2_user;
GRANT SELECT, INSERT, UPDATE ON oauth2_tokens  TO oauth2_user;
GRANT USAGE, SELECT ON SEQUENCE oauth2_tokens_id_seq TO oauth2_user;

-- ─── Maintenance: clean up expired/revoked tokens ────────────────────────────
-- Run periodically: DELETE FROM oauth2_tokens WHERE expires_at < NOW() - INTERVAL '1 day' AND revoked = true;
