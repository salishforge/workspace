-- Hyphae Communications System Schema
-- Agent-to-agent messaging, capability discovery, and human-to-agent bridge

-- ═══════════════════════════════════════════════════════════════════
-- Agent-to-Agent Messages
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_agent_messages (
  id SERIAL PRIMARY KEY,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'request',  -- request, response, notification, broadcast
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',        -- pending, processed, archived
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT valid_message_type CHECK (message_type IN ('request', 'response', 'notification', 'broadcast')),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processed', 'archived')),
  FOREIGN KEY (from_agent_id) REFERENCES hyphae_agent_identities(agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (to_agent_id) REFERENCES hyphae_agent_identities(agent_id) ON DELETE RESTRICT
);

CREATE INDEX idx_agent_messages_to ON hyphae_agent_messages(to_agent_id, status);
CREATE INDEX idx_agent_messages_from ON hyphae_agent_messages(from_agent_id, created_at);
CREATE INDEX idx_agent_messages_status ON hyphae_agent_messages(status, created_at);

-- ═══════════════════════════════════════════════════════════════════
-- Agent Capabilities
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_agent_capabilities (
  agent_id TEXT PRIMARY KEY,
  capabilities JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_capabilities_updated ON hyphae_agent_capabilities(updated_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- Human-to-Agent Messages (incoming from external channels)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_human_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_human_id TEXT NOT NULL,  -- External user ID (e.g., Telegram chat ID, Slack user ID)
  to_agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'telegram',  -- telegram, discord, slack, whatsapp, etc.
  status TEXT DEFAULT 'pending',    -- pending, delivered, processed, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT valid_channel CHECK (channel IN ('telegram', 'discord', 'slack', 'whatsapp', 'email', 'http')),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'delivered', 'processed', 'failed')),
  FOREIGN KEY (to_agent_id) REFERENCES hyphae_agent_identities(agent_id) ON DELETE RESTRICT
);

CREATE INDEX idx_human_agent_messages_to ON hyphae_human_agent_messages(to_agent_id, status);
CREATE INDEX idx_human_agent_messages_human ON hyphae_human_agent_messages(from_human_id);
CREATE INDEX idx_human_agent_messages_channel ON hyphae_human_agent_messages(channel, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- Agent-to-Human Messages (responses back to external channels)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_agent_human_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id TEXT NOT NULL,
  to_human_id TEXT NOT NULL,  -- External user ID
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'telegram',
  status TEXT DEFAULT 'pending',   -- pending, sent, delivered, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  CONSTRAINT valid_channel CHECK (channel IN ('telegram', 'discord', 'slack', 'whatsapp', 'email', 'http')),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  FOREIGN KEY (from_agent_id) REFERENCES hyphae_agent_identities(agent_id) ON DELETE RESTRICT
);

CREATE INDEX idx_agent_human_messages_to ON hyphae_agent_human_messages(to_human_id, status);
CREATE INDEX idx_agent_human_messages_from ON hyphae_agent_human_messages(from_agent_id, created_at DESC);
CREATE INDEX idx_agent_human_messages_channel ON hyphae_agent_human_messages(channel, status);

-- ═══════════════════════════════════════════════════════════════════
-- Channel Configuration (registered providers)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_channel_providers (
  channel_name TEXT PRIMARY KEY,
  status TEXT DEFAULT 'available',  -- available, disabled, error
  configuration JSONB DEFAULT '{}',
  last_health_check TIMESTAMPTZ,
  capabilities TEXT[] DEFAULT ARRAY[]::text[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO hyphae_channel_providers (channel_name, capabilities) VALUES
  ('telegram', ARRAY['send', 'receive', 'format_html'])
ON CONFLICT (channel_name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Message Conversation Threads (tracks agent-agent conversations)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hyphae_conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_ids TEXT[] NOT NULL,  -- Array of agent IDs in conversation
  topic TEXT,
  initiated_by TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- active, closed, archived
  created_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  CONSTRAINT valid_status CHECK (status IN ('active', 'closed', 'archived')),
  FOREIGN KEY (initiated_by) REFERENCES hyphae_agent_identities(agent_id) ON DELETE RESTRICT
);

CREATE INDEX idx_conversation_threads_agents ON hyphae_conversation_threads USING GIN (agent_ids);
CREATE INDEX idx_conversation_threads_status ON hyphae_conversation_threads(status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- Message Immutability (optional audit trigger)
-- ═══════════════════════════════════════════════════════════════════

-- Prevent accidental deletion of critical message tables
-- (soft delete via status field is preferred)

CREATE OR REPLACE FUNCTION prevent_message_deletion() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Message deletion not allowed. Use status=archived instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_delete_agent_messages
  BEFORE DELETE ON hyphae_agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION prevent_message_deletion();

CREATE TRIGGER no_delete_human_agent_messages
  BEFORE DELETE ON hyphae_human_agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION prevent_message_deletion();

CREATE TRIGGER no_delete_agent_human_messages
  BEFORE DELETE ON hyphae_agent_human_messages
  FOR EACH ROW
  EXECUTE FUNCTION prevent_message_deletion();

-- ═══════════════════════════════════════════════════════════════════
-- View: Agent Communication Summary
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW hyphae_agent_communication_summary AS
SELECT
  agent_id,
  COUNT(CASE WHEN role = 'sender' THEN 1 END) as messages_sent,
  COUNT(CASE WHEN role = 'receiver' THEN 1 END) as messages_received,
  MAX(CASE WHEN role = 'sender' THEN created_at END) as last_sent_at,
  MAX(CASE WHEN role = 'receiver' THEN created_at END) as last_received_at,
  COUNT(DISTINCT CASE WHEN role = 'sender' THEN to_agent_id END) as unique_agents_communicated_with
FROM (
  SELECT from_agent_id as agent_id, to_agent_id, created_at, 'sender' as role
  FROM hyphae_agent_messages
  UNION ALL
  SELECT to_agent_id, from_agent_id, created_at, 'receiver'
  FROM hyphae_agent_messages
) msg_data
GROUP BY agent_id;

-- ═══════════════════════════════════════════════════════════════════
-- Grant permissions for Hyphae process user
-- ═══════════════════════════════════════════════════════════════════

-- Assume 'hyphae_writer' role exists from main schema
GRANT INSERT, SELECT, UPDATE ON hyphae_agent_messages TO hyphae_writer;
GRANT INSERT, SELECT, UPDATE ON hyphae_agent_capabilities TO hyphae_writer;
GRANT INSERT, SELECT, UPDATE ON hyphae_human_agent_messages TO hyphae_writer;
GRANT INSERT, SELECT, UPDATE ON hyphae_agent_human_messages TO hyphae_writer;
GRANT INSERT, SELECT, UPDATE ON hyphae_conversation_threads TO hyphae_writer;
GRANT SELECT ON hyphae_channel_providers TO hyphae_writer;

-- ═══════════════════════════════════════════════════════════════════
-- Initialization
-- ═══════════════════════════════════════════════════════════════════

-- Add initial agents if not already present
-- (Assumes hyphae_agent_identities table exists)

-- This is just documentation; actual agent setup happens at runtime
-- INSERT INTO hyphae_agent_identities (agent_id, public_key_ed25519, encryption_key_id)
-- VALUES 
--   ('flint', '<ed25519-pub-key>', '<key-id>'),
--   ('clio', '<ed25519-pub-key>', '<key-id>')
-- ON CONFLICT (agent_id) DO NOTHING;
