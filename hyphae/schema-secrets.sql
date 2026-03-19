-- Hyphae Secrets Management Schema

-- Core secrets table (encrypted values)
CREATE TABLE IF NOT EXISTS hyphae_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  value_encrypted TEXT NOT NULL,
  service VARCHAR(100) NOT NULL DEFAULT 'system',
  expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  updated_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_secrets_name ON hyphae_secrets(name);
CREATE INDEX IF NOT EXISTS idx_secrets_service ON hyphae_secrets(service);
CREATE INDEX IF NOT EXISTS idx_secrets_expires ON hyphae_secrets(expires_at);

-- Audit trail for all secret access
CREATE TABLE IF NOT EXISTS hyphae_secrets_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  service VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL, -- 'set', 'get', 'deleted', 'cached', 'provider:*'
  status VARCHAR(20) DEFAULT 'success', -- 'success', 'failed', 'not_found'
  error_message TEXT,
  accessed_by VARCHAR(255),
  accessed_at TIMESTAMP DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_secrets_audit_name ON hyphae_secrets_audit(secret_name);
CREATE INDEX IF NOT EXISTS idx_secrets_audit_service ON hyphae_secrets_audit(service);
CREATE INDEX IF NOT EXISTS idx_secrets_audit_timestamp ON hyphae_secrets_audit(accessed_at);

-- Registered secrets providers (external services)
CREATE TABLE IF NOT EXISTS hyphae_secrets_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  provider_type VARCHAR(100) NOT NULL, -- '1password', 'azure-keyvault', 'aws-secretsmanager', 'hashicorp-vault'
  config JSONB NOT NULL, -- Provider-specific config (encrypted if needed)
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 100, -- Lower = higher priority
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_health_check TIMESTAMP,
  health_status VARCHAR(20) DEFAULT 'unknown' -- 'healthy', 'degraded', 'offline'
);

CREATE INDEX IF NOT EXISTS idx_providers_name ON hyphae_secrets_providers(name);
CREATE INDEX IF NOT EXISTS idx_providers_type ON hyphae_secrets_providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_providers_active ON hyphae_secrets_providers(is_active);

-- Secret access policies
CREATE TABLE IF NOT EXISTS hyphae_secrets_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  agent_id VARCHAR(255) NOT NULL,
  permission VARCHAR(50) NOT NULL, -- 'read', 'write', 'delete', 'admin'
  expires_at TIMESTAMP,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  FOREIGN KEY (secret_name) REFERENCES hyphae_secrets(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_policy_secret ON hyphae_secrets_access_policies(secret_name);
CREATE INDEX IF NOT EXISTS idx_access_policy_agent ON hyphae_secrets_access_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_access_policy_expires ON hyphae_secrets_access_policies(expires_at);

-- Secret rotation history
CREATE TABLE IF NOT EXISTS hyphae_secrets_rotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  rotated_at TIMESTAMP DEFAULT NOW(),
  old_value_hash VARCHAR(255), -- SHA256 hash of old value
  new_value_hash VARCHAR(255), -- SHA256 hash of new value
  rotated_by VARCHAR(255),
  reason VARCHAR(255),
  success BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_rotation_secret ON hyphae_secrets_rotation(secret_name);
CREATE INDEX IF NOT EXISTS idx_rotation_timestamp ON hyphae_secrets_rotation(rotated_at);
