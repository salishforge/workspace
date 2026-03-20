-- Hyphae Model Router Service - Database Schema
-- March 20, 2026
-- PostgreSQL 14+

-- Table 1: Service Registry (all available LLM services)
CREATE TABLE IF NOT EXISTS hyphae_model_services (
  service_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name VARCHAR(64) NOT NULL UNIQUE,
  service_type VARCHAR(32) NOT NULL,           -- "subscription" | "pay-per-token"
  provider VARCHAR(32) NOT NULL,               -- "anthropic", "google", "ollama"
  billing_model VARCHAR(32) NOT NULL,          -- "fixed-monthly" | "pay-per-token"
  monthly_cost DECIMAL(10, 2),                 -- NULL if pay-per-token
  api_endpoint VARCHAR(256) NOT NULL,
  auth_method VARCHAR(32) NOT NULL,            -- "bearer-token" | "api-key"
  api_key_encrypted TEXT,                      -- Encrypted service API key
  api_key_nonce TEXT,                          -- Encryption nonce
  is_active BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT true,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_model_services_active ON hyphae_model_services(is_active);
CREATE INDEX idx_model_services_provider ON hyphae_model_services(provider);

-- Table 2: API Key Lifecycle Management
CREATE TABLE IF NOT EXISTS hyphae_model_api_keys (
  key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(64) NOT NULL,
  service_id UUID NOT NULL REFERENCES hyphae_model_services(service_id) ON DELETE CASCADE,
  
  -- Key material (AES-256-GCM encrypted)
  key_value_encrypted TEXT NOT NULL,
  key_nonce TEXT NOT NULL,
  
  -- Approval workflow
  status VARCHAR(32) DEFAULT 'pending',        -- "pending" | "approved" | "rejected" | "revoked"
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by VARCHAR(64),                     -- Admin agent/user ID
  approved_at TIMESTAMPTZ,
  approval_reason TEXT,
  rejection_reason TEXT,
  
  -- Lifecycle
  is_active BOOLEAN DEFAULT true,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  rotated_from_key_id UUID,
  
  -- Usage tracking
  first_use_at TIMESTAMPTZ,
  last_use_at TIMESTAMPTZ,
  total_requests BIGINT DEFAULT 0,
  total_tokens_used BIGINT DEFAULT 0,
  estimated_cost_incurred DECIMAL(10, 4) DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(agent_id, service_id),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'))
);

CREATE INDEX idx_model_keys_agent ON hyphae_model_api_keys(agent_id);
CREATE INDEX idx_model_keys_service ON hyphae_model_api_keys(service_id);
CREATE INDEX idx_model_keys_status ON hyphae_model_api_keys(status);
CREATE INDEX idx_model_keys_active ON hyphae_model_api_keys(is_active);
CREATE INDEX idx_model_keys_requested_at ON hyphae_model_api_keys(requested_at DESC);

-- Table 3: Per-Agent Limit Tracking
CREATE TABLE IF NOT EXISTS hyphae_model_limits (
  limit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(64) NOT NULL,
  service_id UUID NOT NULL REFERENCES hyphae_model_services(service_id) ON DELETE CASCADE,
  
  -- Limit configuration
  daily_limit_usd DECIMAL(10, 2),              -- NULL = no daily limit
  monthly_limit_usd DECIMAL(10, 2),            -- NULL = no monthly limit
  hourly_limit_usd DECIMAL(10, 2),             -- NULL = no hourly limit
  rolling_window_hours INT,                    -- e.g., 5 for Claude Max
  rolling_window_limit BIGINT,                 -- Tokens per rolling window
  
  -- Current usage
  current_daily_usage_usd DECIMAL(10, 4) DEFAULT 0,
  current_monthly_usage_usd DECIMAL(10, 4) DEFAULT 0,
  current_hourly_usage_usd DECIMAL(10, 4) DEFAULT 0,
  current_rolling_usage_tokens BIGINT DEFAULT 0,
  
  -- Reset timing
  daily_reset_at TIMESTAMPTZ,
  monthly_reset_at TIMESTAMPTZ,
  hourly_reset_at TIMESTAMPTZ,
  rolling_reset_at TIMESTAMPTZ,
  
  -- Alerts & enforcement
  alert_threshold DECIMAL(3, 2) DEFAULT 0.70,  -- Alert at 70%
  hard_stop_threshold DECIMAL(3, 2) DEFAULT 1.0,  -- Block at 100%
  last_alert_sent_at TIMESTAMPTZ,
  alerts_sent_count INT DEFAULT 0,
  
  is_blocked BOOLEAN DEFAULT false,
  blocked_reason VARCHAR(256),
  blocked_at TIMESTAMPTZ,
  
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(agent_id, service_id)
);

CREATE INDEX idx_model_limits_agent ON hyphae_model_limits(agent_id);
CREATE INDEX idx_model_limits_service ON hyphae_model_limits(service_id);
CREATE INDEX idx_model_limits_reset ON hyphae_model_limits(daily_reset_at, monthly_reset_at);

-- Table 4: Immutable Usage Log
CREATE TABLE IF NOT EXISTS hyphae_model_usage_log (
  usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(64) NOT NULL,
  service_id UUID NOT NULL REFERENCES hyphae_model_services(service_id) ON DELETE RESTRICT,
  api_key_id UUID REFERENCES hyphae_model_api_keys(key_id) ON DELETE SET NULL,
  
  -- Request details
  task_type VARCHAR(32),                       -- "coding", "chat", "reasoning", etc.
  task_complexity VARCHAR(32),                 -- "simple", "moderate", "hard"
  task_urgency VARCHAR(32),                    -- "low", "normal", "high", "critical"
  
  -- Model selection
  model_selected VARCHAR(64),
  routing_reason VARCHAR(256),                 -- Why this model was chosen
  
  -- Usage metrics
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  estimated_cost DECIMAL(10, 6),
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  latency_ms INT,
  
  -- Status
  status VARCHAR(32) DEFAULT 'completed',      -- "pending" | "completed" | "failed" | "blocked"
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX idx_usage_agent (agent_id, created_at DESC),
  INDEX idx_usage_service (service_id, created_at DESC),
  INDEX idx_usage_task (task_type, created_at DESC),
  INDEX idx_usage_time (created_at DESC)
);

-- Write-only audit log (immutable via trigger)
CREATE TABLE IF NOT EXISTS hyphae_model_audit_log (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type VARCHAR(64) NOT NULL,            -- "key_requested", "key_approved", "key_revoked", "limit_exceeded", etc.
  actor_id VARCHAR(64),                        -- Admin or system
  target_agent_id VARCHAR(64) NOT NULL,
  target_service_id UUID REFERENCES hyphae_model_services(service_id) ON DELETE SET NULL,
  target_key_id UUID REFERENCES hyphae_model_api_keys(key_id) ON DELETE SET NULL,
  
  details JSONB NOT NULL,
  metadata JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX idx_audit_action (action_type),
  INDEX idx_audit_agent (target_agent_id),
  INDEX idx_audit_time (created_at DESC)
);

-- Trigger: Auto-reset daily limits at UTC midnight
CREATE OR REPLACE FUNCTION reset_daily_limits()
RETURNS VOID AS $$
BEGIN
  UPDATE hyphae_model_limits
  SET 
    current_daily_usage_usd = 0,
    daily_reset_at = NOW() + INTERVAL '1 day',
    is_blocked = false,
    blocked_reason = NULL,
    blocked_at = NULL,
    updated_at = NOW()
  WHERE daily_reset_at <= NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger: Prevent deletion from audit log (write-only)
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log is write-only, deletions not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_delete_prevention
BEFORE DELETE ON hyphae_model_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_delete();

-- Initial service registrations
INSERT INTO hyphae_model_services (
  service_name, service_type, provider, billing_model, monthly_cost,
  api_endpoint, auth_method, admin_notes
) VALUES
(
  'claude-max-100',
  'subscription',
  'anthropic',
  'fixed-monthly',
  100.00,
  'https://api.anthropic.com/v1/messages',
  'bearer-token',
  'Claude Max 5x tier: ~225 msgs per 5h rolling window'
),
(
  'claude-api-sonnet',
  'pay-per-token',
  'anthropic',
  'pay-per-token',
  NULL,
  'https://api.anthropic.com/v1/messages',
  'api-key',
  'Claude Sonnet 4.6: $3/M input, $15/M output'
),
(
  'claude-api-haiku',
  'pay-per-token',
  'anthropic',
  'pay-per-token',
  NULL,
  'https://api.anthropic.com/v1/messages',
  'api-key',
  'Claude Haiku 4.5: $0.80/M input, $4/M output'
),
(
  'claude-api-opus',
  'pay-per-token',
  'anthropic',
  'pay-per-token',
  NULL,
  'https://api.anthropic.com/v1/messages',
  'api-key',
  'Claude Opus 4.6: $15/M input, $45/M output'
),
(
  'gemini-api-flash',
  'pay-per-token',
  'google',
  'pay-per-token',
  NULL,
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  'api-key',
  'Gemini 2.5 Flash: $0.04/M input, $0.15/M output, 1M context'
),
(
  'gemini-api-pro',
  'pay-per-token',
  'google',
  'pay-per-token',
  NULL,
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
  'api-key',
  'Gemini 2.5 Pro: $0.075/M input, $0.30/M output, 1M context'
),
(
  'gemini-api-3-1-pro',
  'pay-per-token',
  'google',
  'pay-per-token',
  NULL,
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-1-pro:generateContent',
  'api-key',
  'Gemini 3.1 Pro: $0.075/M input, $0.30/M output, better reasoning'
),
(
  'ollama-cloud-pro',
  'subscription',
  'ollama',
  'fixed-monthly',
  20.00,
  'https://api.ollama.com/v1/generate',
  'bearer-token',
  'Ollama Cloud Pro: $20/mo, 3 concurrent models, includes MiniMax M2.7'
)
ON CONFLICT (service_name) DO NOTHING;

-- Summary
SELECT 
  COUNT(*) as total_services,
  COUNT(*) FILTER (WHERE service_type = 'subscription') as subscription_services,
  COUNT(*) FILTER (WHERE service_type = 'pay-per-token') as pay_per_token_services
FROM hyphae_model_services;
