-- Hyphae Service Registry Schema
-- Tables for service definitions, agent policies, credentials, and audit

-- 1. Service Definitions
CREATE TABLE IF NOT EXISTS hyphae_services (
  service_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0',
  
  -- Authentication method for agents using this service
  auth_method TEXT NOT NULL CHECK (auth_method IN ('api_key', 'oauth', 'certificate', 'none')),
  
  -- Service status (active, deprecated, disabled)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  
  -- Service metadata
  category TEXT,  -- 'communication', 'coordination', 'memory', 'external'
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT service_id_format CHECK (service_id ~ '^[a-z0-9_-]+$')
);

-- 2. Service Training Material (agent education)
CREATE TABLE IF NOT EXISTS hyphae_service_training (
  training_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL REFERENCES hyphae_services(service_id) ON DELETE CASCADE,
  
  -- System prompt section for agents learning this service
  system_prompt_section TEXT NOT NULL,
  
  -- Rate limits (JSON: {messages_per_minute: 30, daily_quota: 1000})
  rate_limits JSONB DEFAULT '{}'::JSONB,
  
  -- Acceptable use examples
  acceptable_use TEXT ARRAY,
  
  -- Restrictions and warnings
  restrictions TEXT ARRAY,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Service API Examples (JSON snippets for agents)
CREATE TABLE IF NOT EXISTS hyphae_service_api_examples (
  example_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL REFERENCES hyphae_services(service_id) ON DELETE CASCADE,
  
  method_name TEXT NOT NULL,
  description TEXT,
  
  -- Example request/response (JSONB)
  example_request JSONB NOT NULL,
  example_response JSONB NOT NULL,
  
  -- Notes for agents
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Agent Service Authorization Policies
CREATE TABLE IF NOT EXISTS hyphae_agent_policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES hyphae_services(service_id) ON DELETE CASCADE,
  
  -- Is access authorized?
  authorized BOOLEAN DEFAULT TRUE,
  
  -- Service-specific rate limit overrides (JSON)
  rate_limit_override JSONB,
  
  -- Quota limits (JSON: {messages_per_day: 100})
  quota JSONB,
  
  -- Restricted channels/operations (arrays)
  restricted_channels TEXT ARRAY,
  restricted_operations TEXT ARRAY,
  
  -- Audit requirements
  require_audit_log BOOLEAN DEFAULT TRUE,
  require_approval_for TEXT ARRAY,  -- operations requiring approval
  
  -- Effective dates
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  valid_until TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(agent_id, service_id),
  CONSTRAINT valid_dates CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- 5. Agent Credentials (encrypted storage)
CREATE TABLE IF NOT EXISTS hyphae_agent_credentials (
  credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES hyphae_services(service_id) ON DELETE CASCADE,
  
  -- Encrypted credential (AES-256-GCM)
  credential_encrypted TEXT NOT NULL,
  
  -- Encryption metadata
  encryption_key_version TEXT,
  encryption_salt TEXT,
  
  -- Credential metadata
  credential_type TEXT NOT NULL,  -- 'api_key', 'token', 'certificate', etc.
  credential_expires TIMESTAMP WITH TIME ZONE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked', 'expired')),
  
  -- Issuance tracking
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  issued_by TEXT,  -- admin who approved
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(agent_id, service_id, status)
);

-- 6. Audit Log (all service usage)
CREATE TABLE IF NOT EXISTS hyphae_service_audit_log (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  service_id TEXT NOT NULL REFERENCES hyphae_services(service_id) ON DELETE CASCADE,
  
  -- Event type
  event_type TEXT NOT NULL,  -- 'credential_issued', 'service_called', 'rate_limit_hit', 'error'
  
  -- What happened
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::JSONB,
  
  -- Outcome
  success BOOLEAN NOT NULL,
  error_message TEXT,
  
  -- Metrics
  duration_ms INT,
  bytes_transferred INT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Agent Service Registration State
CREATE TABLE IF NOT EXISTS hyphae_agent_registrations (
  registration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  agent_name TEXT,
  agent_type TEXT,  -- 'reasoning', 'bot', 'service'
  
  -- Contact info
  contact_email TEXT,
  contact_telegram TEXT,
  contact_metadata JSONB DEFAULT '{}'::JSONB,
  
  -- Master key (encrypted)
  master_key_encrypted TEXT NOT NULL,
  master_key_version TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'active', 'suspended', 'revoked')),
  
  -- Registration tracking
  registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_accessed_at TIMESTAMP WITH TIME ZONE,
  suspended_at TIMESTAMP WITH TIME ZONE,
  suspension_reason TEXT,
  
  CONSTRAINT agent_id_format CHECK (agent_id ~ '^[a-z0-9_-]+$')
);

-- 8. Service Credentials Provider Config (how Hyphae gets credentials from external services)
CREATE TABLE IF NOT EXISTS hyphae_credential_providers (
  provider_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id TEXT NOT NULL REFERENCES hyphae_services(service_id) ON DELETE CASCADE,
  
  -- Provider type
  provider_type TEXT NOT NULL CHECK (provider_type IN ('generate', 'store', 'delegate')),
  
  -- Provider endpoint (if delegating to external service)
  provider_endpoint TEXT,
  
  -- Provider authentication (how Hyphae authenticates to get credentials)
  provider_auth_encrypted TEXT,  -- encrypted master credential
  
  -- Configuration
  config JSONB DEFAULT '{}'::JSONB,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(service_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_registrations_status ON hyphae_agent_registrations(status);
CREATE INDEX IF NOT EXISTS idx_service_status ON hyphae_services(status);
CREATE INDEX IF NOT EXISTS idx_policies_agent ON hyphae_agent_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_credentials_agent ON hyphae_agent_credentials(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_agent ON hyphae_service_audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON hyphae_service_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_agent_service ON hyphae_service_audit_log(agent_id, service_id);
