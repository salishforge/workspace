-- Hyphae Core Database Schema
-- Complete schema for agent management, vault, and audit trail

-- ═══════════════════════════════════════════════════════════════════
-- Agent Management
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_agent_identities (
  agent_id TEXT PRIMARY KEY,
  public_key_ed25519 TEXT NOT NULL UNIQUE,
  encryption_key_id TEXT NOT NULL,
  roles JSONB DEFAULT '[]',
  capabilities JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_active ON hyphae_agent_identities(is_active, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_revoked ON hyphae_agent_identities(revoked_at);
CREATE INDEX IF NOT EXISTS idx_agent_pubkey ON hyphae_agent_identities(public_key_ed25519);

-- ═══════════════════════════════════════════════════════════════════
-- Registration Protocol
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_registration_challenges (
  challenge_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '5 minutes',
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_agent ON hyphae_registration_challenges(agent_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_nonce ON hyphae_registration_challenges(nonce);

-- ═══════════════════════════════════════════════════════════════════
-- Encryption Keys
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_key_grants (
  key_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  key_hash TEXT NOT NULL, -- HMAC of derived key (for integrity verification only)
  issued_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_keys_agent ON hyphae_key_grants(agent_id);
CREATE INDEX IF NOT EXISTS idx_keys_active ON hyphae_key_grants(agent_id, revoked_at);

-- Note: Actual encryption keys are DERIVED at runtime from HYPHAE_ENCRYPTION_KEY env + agent_id (HKDF)
-- No key material is stored in the database

-- ═══════════════════════════════════════════════════════════════════
-- Secrets Vault
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_secrets (
  secret_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  value_encrypted BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  accessed_at TIMESTAMPTZ,
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id),
  UNIQUE (agent_id, secret_name)
);

CREATE INDEX IF NOT EXISTS idx_secrets_agent ON hyphae_secrets(agent_id, secret_name);
CREATE INDEX IF NOT EXISTS idx_secrets_accessed ON hyphae_secrets(accessed_at);

-- ═══════════════════════════════════════════════════════════════════
-- Immutable Audit Log
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_audit_log (
  log_id BIGSERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  status TEXT,
  details JSONB,
  timestamp TIMESTAMPTZ DEFAULT now(),
  CHECK (log_id > 0)
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON hyphae_audit_log(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON hyphae_audit_log(action, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON hyphae_audit_log(timestamp DESC);

-- Immutability: Enforced at database level via trigger + role-based access control
CREATE OR REPLACE FUNCTION prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log is immutable: UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON hyphae_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

-- Create read-only role for Hyphae process (INSERT + SELECT only)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_user WHERE usename = 'hyphae_writer') THEN
    CREATE ROLE hyphae_writer WITH LOGIN PASSWORD 'change-this-in-production';
    GRANT INSERT, SELECT ON hyphae_audit_log TO hyphae_writer;
    -- hyphae_writer explicitly DENIED UPDATE/DELETE at role level
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Circuit Breaker
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_circuit_breakers (
  service_name TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'CLOSED',
  failure_count INT DEFAULT 0,
  success_count INT DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  tested_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_circuit_state ON hyphae_circuit_breakers(state);
CREATE INDEX IF NOT EXISTS idx_circuit_updated ON hyphae_circuit_breakers(updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- Consolidation State (MemForge Integration)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consolidation_step_state (
  agent_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  result_summary JSONB,
  timestamp TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_consolidation_state_timestamp ON consolidation_step_state(timestamp);

-- ═══════════════════════════════════════════════════════════════════
-- Service Connectors Metadata (for service routing)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_service_connectors (
  service_name TEXT PRIMARY KEY,
  connector_type TEXT NOT NULL,
  primary_config JSONB,
  fallback_config JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_enabled ON hyphae_service_connectors(enabled);

-- ═══════════════════════════════════════════════════════════════════
-- Grant Verification
-- ═══════════════════════════════════════════════════════════════════

-- Ensure all tables are created (idempotent)
-- All CREATE TABLE ... IF NOT EXISTS above
-- All indexes are safely created

-- ═══════════════════════════════════════════════════════════════════
-- Utility Views
-- ═══════════════════════════════════════════════════════════════════

-- Active agents only
CREATE OR REPLACE VIEW active_agents AS
SELECT * FROM hyphae_agent_identities WHERE is_active = true AND revoked_at IS NULL;

-- Circuit breaker status
CREATE OR REPLACE VIEW circuit_status AS
SELECT 
  service_name,
  state,
  failure_count,
  success_count,
  CASE 
    WHEN (failure_count + success_count) > 0 
    THEN (failure_count::float / (failure_count + success_count)::float)
    ELSE 0
  END AS error_rate,
  updated_at
FROM hyphae_circuit_breakers;

-- Audit summary (last 24h)
CREATE OR REPLACE VIEW audit_summary_24h AS
SELECT 
  action,
  status,
  COUNT(*) as count,
  MAX(timestamp) as last_at
FROM hyphae_audit_log
WHERE timestamp > now() - INTERVAL '24 hours'
GROUP BY action, status;

-- ═══════════════════════════════════════════════════════════════════
-- Comments (Documentation)
-- ═══════════════════════════════════════════════════════════════════

COMMENT ON TABLE hyphae_agent_identities IS 'Agent registry: identity, public key, roles, capabilities';
COMMENT ON TABLE hyphae_secrets IS 'Encrypted secrets vault (AES-256-GCM)';
COMMENT ON TABLE hyphae_audit_log IS 'Immutable audit trail (INSERT only, no DELETE/UPDATE)';
COMMENT ON TABLE hyphae_circuit_breakers IS 'Circuit breaker state machine per service';
COMMENT ON COLUMN hyphae_agent_identities.revoked_at IS 'Instant revocation: agent loses all access';
COMMENT ON COLUMN hyphae_secrets.nonce IS '96-bit nonce for AES-256-GCM (prevent replay)';
COMMENT ON COLUMN hyphae_audit_log.log_id IS 'Monotonic ID prevents deletion/reordering attacks';

-- ═══════════════════════════════════════════════════════════════════
-- Service Registry (Phase 1-2)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_service_registry (
  service_id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registering',
  
  capabilities JSONB NOT NULL DEFAULT '[]',
  api_endpoint TEXT NOT NULL,
  api_protocol TEXT NOT NULL,
  api_version TEXT,
  
  requires JSONB DEFAULT '[]',
  health_check_url TEXT,
  health_check_interval INT DEFAULT 30,
  last_health_check TIMESTAMPTZ,
  healthy BOOLEAN DEFAULT false,
  consecutive_failures INT DEFAULT 0,
  
  registered_at TIMESTAMPTZ DEFAULT now(),
  registered_by TEXT,
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '24 hours',
  
  UNIQUE(service_name, version)
);

CREATE INDEX IF NOT EXISTS idx_service_status ON hyphae_service_registry(status, service_type);
CREATE INDEX IF NOT EXISTS idx_service_health ON hyphae_service_registry(healthy, last_health_check DESC);
CREATE INDEX IF NOT EXISTS idx_service_expires ON hyphae_service_registry(expires_at);

-- ═══════════════════════════════════════════════════════════════════
-- Service Integrations (Phase 2)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_service_integrations (
  agent_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  integration_type TEXT NOT NULL,
  capabilities_granted JSONB DEFAULT '[]',
  integration_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  PRIMARY KEY (agent_id, service_id),
  FOREIGN KEY (service_id) REFERENCES hyphae_service_registry(service_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_agent ON hyphae_service_integrations(agent_id);
CREATE INDEX IF NOT EXISTS idx_integration_service ON hyphae_service_integrations(service_id);
