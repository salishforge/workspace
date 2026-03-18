-- OAuth2 Authorization Code Flow Schema — Salish Forge
-- v1.1.0
--
-- Run after oauth2-schema.sql and oauth2-scopes-schema.sql:
--   psql -U oauth2_user -d oauth2 -f schema/oauth2-auth-code-schema.sql
--
-- Tables:
--   oauth2_users               — user accounts (username + scrypt password hash)
--   oauth2_sessions            — browser login sessions (cookie-based, DB-backed)
--   oauth2_authorization_codes — temporary auth codes (10-min TTL)
--   oauth2_user_consents       — remembered user consent per client (30-day TTL)
--
-- Also adds user_id column to oauth2_tokens for user-token association.

\connect oauth2

-- ─── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth2_users (
  user_id        TEXT        PRIMARY KEY,
  username       TEXT        UNIQUE NOT NULL,
  password_hash  TEXT        NOT NULL,    -- scrypt format: "salt:hash"
  scopes         TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Login Sessions ───────────────────────────────────────────────────────────
-- Browser session management without express-session dependency.
-- Session ID is set as a signed HTTP-only cookie.

CREATE TABLE IF NOT EXISTS oauth2_sessions (
  session_id  TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL REFERENCES oauth2_users(user_id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth2_sessions_expires ON oauth2_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth2_sessions_user    ON oauth2_sessions (user_id);

-- ─── Authorization Codes ──────────────────────────────────────────────────────
-- Short-lived single-use codes returned to the client after user consent.
-- Expire after 10 minutes; deleted on first use to prevent reuse.

CREATE TABLE IF NOT EXISTS oauth2_authorization_codes (
  code                  TEXT        PRIMARY KEY,
  client_id             TEXT        NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
  user_id               TEXT        NOT NULL REFERENCES oauth2_users(user_id) ON DELETE CASCADE,
  redirect_uri          TEXT        NOT NULL,
  scope                 TEXT        NOT NULL,
  code_challenge        TEXT,           -- PKCE: SHA-256 of code_verifier in base64url
  code_challenge_method TEXT,           -- "S256" (only supported method)
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth2_codes_expires ON oauth2_authorization_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth2_codes_client  ON oauth2_authorization_codes (client_id, expires_at);

-- ─── User Consents ────────────────────────────────────────────────────────────
-- Track which users have consented to which clients+scopes.
-- Consent is remembered for 30 days; expires_at=NULL means permanent.

CREATE TABLE IF NOT EXISTS oauth2_user_consents (
  user_id       TEXT        NOT NULL REFERENCES oauth2_users(user_id) ON DELETE CASCADE,
  client_id     TEXT        NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
  scope         TEXT        NOT NULL,
  consent_given BOOLEAN     NOT NULL DEFAULT false,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth2_consents_expires ON oauth2_user_consents (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── Token user association ───────────────────────────────────────────────────
-- For authorization_code grant, tokens are associated with a user.
-- client_credentials tokens have user_id = NULL.

ALTER TABLE oauth2_tokens
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES oauth2_users(user_id) ON DELETE SET NULL;

-- ─── Cleanup reminders ────────────────────────────────────────────────────────
-- Run periodically (e.g., daily cron):
--   DELETE FROM oauth2_sessions            WHERE expires_at < NOW();
--   DELETE FROM oauth2_authorization_codes WHERE expires_at < NOW();
--   DELETE FROM oauth2_user_consents       WHERE expires_at < NOW();

-- ─── Grants ───────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON oauth2_users             TO oauth2_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth2_sessions          TO oauth2_user;
GRANT SELECT, INSERT, DELETE         ON oauth2_authorization_codes TO oauth2_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth2_user_consents     TO oauth2_user;
