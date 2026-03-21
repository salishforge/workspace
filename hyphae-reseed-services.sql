-- Clear and reseed Hyphae services

-- Clear existing data
DELETE FROM hyphae_service_api_examples;
DELETE FROM hyphae_service_training;
DELETE FROM hyphae_services WHERE service_id IN ('telegram', 'agent-rpc', 'memory');

-- Insert services
INSERT INTO hyphae_services 
(service_id, name, description, version, auth_method, status, category)
VALUES 
  ('telegram', 'Telegram Bot API', 'Send and receive messages via Telegram', '1.0', 'api_key', 'active', 'communication'),
  ('agent-rpc', 'Inter-Agent Coordination', 'Send messages and coordinate with other Hyphae agents', '1.0', 'api_key', 'active', 'coordination'),
  ('memory', 'Shared Memory System', 'Access consolidated team memory and learnings', '1.0', 'none', 'active', 'memory');

-- Insert training for Telegram
INSERT INTO hyphae_service_training
(service_id, system_prompt_section, rate_limits, acceptable_use, restrictions)
VALUES (
  'telegram',
  'You have access to the Telegram service. You can send messages directly to specified Telegram chats using your provisioned API credentials.

Method: sendMessage(chat_id, message)
Parameters:
  - chat_id: The target Telegram chat ID (example: 8201776295)
  - message: Plain text message to send

Response: {ok: true, message_id: <id>}

Rate Limit: 30 messages per minute

Acceptable Uses:
- Operational status updates
- System alerts
- Team notifications
- Coordination messages

Restrictions:
- NO spam or unsolicited messages
- NO automated marketing
- NO bulk messaging without authorization
- Respect rate limits
- Contact John Brooke (8201776295) for critical escalations

Your credentials were issued by Hyphae at registration time. Use them with the Telegram endpoint directly (Hyphae not in the message path after provisioning).',
  '{"messages_per_minute": 30, "daily_quota": 1000}'::jsonb,
  ARRAY['operational_status', 'alerts', 'notifications', 'coordination'],
  ARRAY['no_spam', 'no_marketing', 'no_bulk_unsolicited', 'respect_rate_limits']
);

-- Insert training for Agent-RPC
INSERT INTO hyphae_service_training
(service_id, system_prompt_section, rate_limits, acceptable_use, restrictions)
VALUES (
  'agent-rpc',
  'You have access to Hyphae agent-to-agent coordination. This is your primary mechanism for collaborating with other agents.

Available Methods:

1. agent.sendMessage(from_agent_id, to_agent_id, message, context, priority)
   Send a message to another agent. Async - they will poll for it.
   Parameters:
     - from_agent_id: Your agent ID
     - to_agent_id: Target agent ID
     - message: Plain text message
     - context: JSON object with contextual data
     - priority: "critical", "high", or "normal"
   Response: {success: true, message_id: <uuid>}

2. agent.getMessages(agent_id, limit, status)
   Retrieve pending messages from other agents.
   Parameters:
     - agent_id: Your agent ID
     - limit: Max messages to retrieve (default 10)
     - status: "pending", "delivered", or "processed"
   Response: {messages: [{id, from, message, context, priority, received_at}]}

3. agent.discoverCapabilities(requesting_agent)
   Learn what other agents can do.
   Response: {agents: [{agent_id, capabilities, availability}]}

4. agent.getConversationHistory(agent_1, agent_2, limit)
   Review past exchanges with another agent.

Coordination Workflow:
1. Detect a situation requiring peer input
2. Call agent.sendMessage with full context
3. Poll agent.getMessages every 5-10 seconds
4. Process peer response and act
5. Send follow-up if needed

Rate Limit: 60 calls per minute',
  '{"calls_per_minute": 60}'::jsonb,
  ARRAY['operational_coordination', 'resource_requests', 'escalation', 'status_updates'],
  ARRAY['no_spam', 'no_loops', 'respect_priorities', 'include_context']
);

-- Insert training for Memory
INSERT INTO hyphae_service_training
(service_id, system_prompt_section, rate_limits, acceptable_use, restrictions)
VALUES (
  'memory',
  'You have access to Hyphae shared memory. This system stores team learnings, decisions, and context.

You can:
- Read shared memory to understand past decisions
- Contribute learnings to memory for other agents
- Reference memory in your reasoning

Memory Tiers:
- Hot: Active session notes (last 48 hours)
- Warm: Recent decisions (last 90 days)
- Cold: Archive (older than 90 days)

No authentication required - memory access is always available to all agents.',
  '{}'::jsonb,
  ARRAY['read_shared_context', 'understand_decisions', 'reference_learnings'],
  ARRAY['no_exfiltration', 'respect_privacy']
);

-- Insert API examples for Telegram
INSERT INTO hyphae_service_api_examples
(service_id, method_name, description, example_request, example_response, notes)
VALUES (
  'telegram',
  'sendMessage',
  'Send a message to a Telegram chat',
  '{"chat_id": "8201776295", "message": "Status update: All systems nominal"}'::jsonb,
  '{"ok": true, "message_id": 12345, "timestamp": "2026-03-20T21:30:00Z"}'::jsonb,
  'Use your provisioned API key in Authorization header. Returns message ID on success.'
);

-- Insert API examples for Agent-RPC
INSERT INTO hyphae_service_api_examples
(service_id, method_name, description, example_request, example_response, notes)
VALUES (
  'agent-rpc',
  'agent.sendMessage',
  'Send a coordination message to another agent',
  '{"from_agent_id": "flint", "to_agent_id": "clio", "message": "GPU costs spiked 400%.", "context": {"service": "ml_training", "cost_delta": "+$2400/day"}, "priority": "high"}'::jsonb,
  '{"success": true, "message_id": "b601f869-017e-4537-9ef6-65f7a35d7bba"}'::jsonb,
  'Message is async - agent must poll for responses. Always include contextual data.'
),
(
  'agent-rpc',
  'agent.getMessages',
  'Retrieve pending messages from other agents',
  '{"agent_id": "clio", "limit": 10, "status": "pending"}'::jsonb,
  '{"messages": [{"id": "b601f869-017e", "from": "flint", "message": "GPU costs spiked...", "context": {}, "priority": "high"}]}'::jsonb,
  'Poll every 5-10 seconds. Shows only pending messages unless other status specified.'
);

-- Configure service provider endpoints
INSERT INTO hyphae_credential_providers
(service_id, provider_type, provider_endpoint)
VALUES (
  'telegram',
  'delegate',
  'https://api.telegram.org'
);

INSERT INTO hyphae_credential_providers
(service_id, provider_type, provider_endpoint)
VALUES (
  'agent-rpc',
  'delegate',
  'http://localhost:3100'
);

INSERT INTO hyphae_credential_providers
(service_id, provider_type, provider_endpoint)
VALUES (
  'memory',
  'delegate',
  'http://localhost:3106'
);
