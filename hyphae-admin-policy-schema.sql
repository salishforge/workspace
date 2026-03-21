/**
 * Hyphae Admin Policy Database Schema
 * 
 * Stores policy configuration, decision logs, and audit trails
 * for the System Administrator Agent
 */

-- Policy Configuration Table
CREATE TABLE IF NOT EXISTS hyphae_admin_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,  -- "system-admin", "rescue", etc.
  mode TEXT NOT NULL CHECK (mode IN ('basic', 'advanced')),
  
  -- BASIC MODE SETTINGS
  basic_mode_setting TEXT CHECK (basic_mode_setting IN 
    ('human_approves_all', 'agent_autonomy_except_financial_security', 'full_autonomy_within_budget')),
  basic_daily_budget_usd NUMERIC(10,2),
  basic_escalation_threshold_usd NUMERIC(10,2),
  basic_security_escalation BOOLEAN DEFAULT true,
  
  -- ADVANCED MODE SETTINGS (JSON for flexibility)
  advanced_policy JSONB,  -- Contains detailed policy per decision category
  
  -- LEARNING & MODEL
  learning_enabled BOOLEAN DEFAULT true,
  learning_model TEXT DEFAULT 'ollama:local',  -- 'ollama:local', 'gemini', 'anthropic', 'custom'
  learning_model_api_key TEXT,  -- Encrypted, separate from Hyphae secrets
  require_approval_for_learning_changes BOOLEAN DEFAULT false,
  
  -- RESCUE AGENT CONFIG
  rescue_mode TEXT DEFAULT 'embedded',
  rescue_recovery_procedure TEXT DEFAULT 'factory_reset',
  rescue_notify_on_trigger BOOLEAN DEFAULT true,
  
  -- METADATA
  created_by TEXT NOT NULL,  -- Admin user ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_budget CHECK (basic_daily_budget_usd >= 0)
);

-- Policy Version History
CREATE TABLE IF NOT EXISTS hyphae_admin_policy_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  policy_version_id UUID NOT NULL REFERENCES hyphae_admin_policies(id),
  
  previous_policy JSONB NOT NULL,
  new_policy JSONB NOT NULL,
  
  change_reason TEXT,  -- Why was this changed?
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  git_commit_hash TEXT,  -- Optional: link to git commit
  
  rollback_to_id UUID REFERENCES hyphae_admin_policy_history(id),  -- If this is a rollback
  
  CONSTRAINT policy_history_order CHECK (changed_at >= (
    SELECT changed_at FROM hyphae_admin_policy_history 
    WHERE agent_id = hyphae_admin_policy_history.agent_id 
    ORDER BY changed_at DESC LIMIT 1
  ))
);

-- Decision Log (Every decision made by System Admin Agent)
CREATE TABLE IF NOT EXISTS hyphae_admin_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,  -- "system-admin"
  
  decision_category TEXT NOT NULL,  -- service_recovery, policy_adaptation, credential_rotation, etc.
  decision_required BOOLEAN NOT NULL,  -- Was human approval needed?
  
  policy_boundary TEXT NOT NULL,  -- Which policy ruled this? (from policy config)
  
  input_data JSONB NOT NULL,  -- What did agent observe?
  decision_reasoning JSONB NOT NULL,  -- Why did agent decide this?
  decision_action TEXT NOT NULL,  -- What did agent do/recommend?
  
  -- OUTCOME TRACKING
  outcome_status TEXT CHECK (outcome_status IN 
    ('pending', 'executed', 'approved', 'rejected', 'escalated', 'failed')),
  outcome_result JSONB,  -- What actually happened?
  
  -- HUMAN INTERACTION
  human_approval_required BOOLEAN DEFAULT false,
  human_approved_by TEXT,  -- Admin user ID
  human_approval_reasoning TEXT,
  human_approved_at TIMESTAMPTZ,
  
  human_rejected_by TEXT,
  human_rejection_reasoning TEXT,
  human_rejected_at TIMESTAMPTZ,
  
  -- LEARNING
  learning_applied BOOLEAN DEFAULT false,
  learning_confidence NUMERIC(3,2) CHECK (learning_confidence BETWEEN 0 AND 1),
  
  -- METADATA
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cost_impact_usd NUMERIC(10,2),
  execution_time_ms INTEGER,
  
  INDEX idx_decision_agent (agent_id),
  INDEX idx_decision_category (decision_category),
  INDEX idx_decision_time (created_at DESC),
  INDEX idx_pending_approval (human_approval_required, outcome_status)
);

-- Learning Records (What did the agent learn?)
CREATE TABLE IF NOT EXISTS hyphae_admin_learning_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  
  pattern_description TEXT NOT NULL,  -- "API rate limit surge when cost exceeds $X"
  pattern_condition JSONB NOT NULL,  -- Conditions that trigger this pattern
  pattern_frequency INTEGER,  -- How many times observed?
  
  solution_action TEXT NOT NULL,  -- "Upgrade to Claude Max for 1 hour"
  solution_confidence NUMERIC(3,2) CHECK (solution_confidence BETWEEN 0 AND 1),  -- Success rate
  solution_cost_usd NUMERIC(10,2),
  
  -- ORIGIN
  learned_from_decision_id UUID REFERENCES hyphae_admin_decision_log(id),
  learned_from_incident TEXT,
  
  -- APPLICABILITY
  applicable_scenarios JSONB,  -- When should this be used?
  contraindications JSONB,  -- When should this NOT be used?
  
  -- VALIDATION
  successful_applications INTEGER DEFAULT 0,
  failed_applications INTEGER DEFAULT 0,
  validation_score NUMERIC(3,2),
  
  -- METADATA
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  disabled BOOLEAN DEFAULT false,
  
  INDEX idx_learning_pattern (pattern_description),
  INDEX idx_learning_confidence (solution_confidence DESC)
);

-- Audit Log (Write-only for compliance)
CREATE TABLE IF NOT EXISTS hyphae_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  action_type TEXT NOT NULL,  -- policy_change, decision_made, learning_applied, escalation, etc.
  actor_id TEXT NOT NULL,  -- agent_id or admin_user_id
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system_admin_agent', 'rescue_agent', 'human_admin')),
  
  resource_type TEXT,  -- what was acted upon (policy, decision, learning, service, etc.)
  resource_id UUID,
  
  action_details JSONB NOT NULL,
  
  -- SECURITY
  ip_address INET,
  user_agent TEXT,
  
  -- COMPLIANCE
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  is_sensitive BOOLEAN DEFAULT false,
  
  -- IMMUTABLE (enforced by trigger)
  INDEX idx_audit_actor (actor_id),
  INDEX idx_audit_type (action_type),
  INDEX idx_audit_time (timestamp DESC)
);

-- Create immutable audit log trigger
CREATE OR REPLACE FUNCTION prevent_audit_modification() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    RAISE EXCEPTION 'Audit log is immutable - no modifications allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable
BEFORE DELETE OR UPDATE ON hyphae_admin_audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Indexes for performance
CREATE INDEX idx_policy_agent ON hyphae_admin_policies(agent_id);
CREATE INDEX idx_policy_history_agent ON hyphae_admin_policy_history(agent_id, changed_at DESC);
CREATE INDEX idx_decision_agent_time ON hyphae_admin_decision_log(agent_id, created_at DESC);
CREATE INDEX idx_decision_pending ON hyphae_admin_decision_log(outcome_status) WHERE outcome_status = 'escalated';
CREATE INDEX idx_learning_pattern_hash ON hyphae_admin_learning_log(pattern_description);

-- Summary view for dashboard
CREATE OR REPLACE VIEW hyphae_admin_summary AS
SELECT
  'decisions_pending_approval' as metric,
  COUNT(*)::TEXT as value
FROM hyphae_admin_decision_log
WHERE human_approval_required AND outcome_status IN ('pending', 'escalated')
UNION ALL
SELECT
  'total_decisions_today',
  COUNT(*)::TEXT
FROM hyphae_admin_decision_log
WHERE created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'cost_today_usd',
  COALESCE(SUM(cost_impact_usd)::TEXT, '0')
FROM hyphae_admin_decision_log
WHERE created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT
  'learning_patterns_active',
  COUNT(*)::TEXT
FROM hyphae_admin_learning_log
WHERE disabled = false;
