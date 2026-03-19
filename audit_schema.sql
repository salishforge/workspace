-- Audit Log for Inter-Agent Communication (NATS + MCP)
-- Retention Policy: Raw payload kept for 90 days, then archive to cold storage.
-- This table is append-only; no agent can modify or delete entries.

CREATE TABLE agent_communication_audit (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    sender_id VARCHAR(256) NOT NULL,
    recipient_id VARCHAR(256) NOT NULL,
    action_type VARCHAR(50) NOT NULL,      -- e.g., 'tool_call', 'message_send', 'nats_publish'
    capability_requested VARCHAR(256),     -- e.g., 'query_memory', 'deploy.code', 'system.reboot'
    status_code INTEGER NOT NULL,          -- HTTP or internal result code (200, 403, 500, etc.)
    response_time_ms INTEGER,              -- Latency in milliseconds (for performance monitoring)
    content_hash VARCHAR(64),              -- SHA-256 hash of the payload for integrity checking
    security_result VARCHAR(50) NOT NULL,  -- 'VALID', 'INVALID', 'IGNORED', 'DENIED'
    raw_payload JSONB                      -- Full request/response for debugging (archived after 90 days)
);

-- Index for fast lookups by agent interaction
CREATE INDEX idx_audit_sender_recipient ON agent_communication_audit (sender_id, recipient_id, timestamp DESC);

-- Index for audit queries by timestamp (for retention/archival)
CREATE INDEX idx_audit_timestamp ON agent_communication_audit (timestamp DESC);

-- Retention policy (enforced by application logic):
-- - raw_payload: archived to cold storage after 90 days, null in this table
-- - Full audit record: retained for 1 year minimum (regulatory/security review)