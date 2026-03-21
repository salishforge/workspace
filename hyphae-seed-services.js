#!/usr/bin/env node

/**
 * Hyphae Service Definitions Seed
 * 
 * Registers standard services with Hyphae:
 * - Telegram (communication channel)
 * - Agent-RPC (inter-agent coordination)
 * - Memory (shared memory system)
 */

import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026',
  database: 'hyphae'
});

async function seedServices() {
  console.log('Seeding Hyphae service definitions...\n');
  
  try {
    // =====================================================================
    // Telegram Service Definition
    // =====================================================================
    
    console.log('📱 Registering Telegram service...');
    
    const telegramServiceResult = await pool.query(
      `INSERT INTO hyphae_services 
       (service_id, name, description, version, auth_method, status, category)
       VALUES ('telegram', 'Telegram Bot API', 'Send and receive messages via Telegram', '1.0', 'api_key', 'active', 'communication')
       ON CONFLICT (service_id) DO UPDATE SET updated_at = NOW()
       RETURNING service_id`
    );
    
    // Telegram training material
    const telegramTraining = await pool.query(
      `INSERT INTO hyphae_service_training
       (service_id, system_prompt_section, rate_limits, acceptable_use, restrictions)
       VALUES (
         'telegram',
         'You have access to the Telegram service. You can send messages directly to specified Telegram chats using your provisioned API credentials.\n\nMethod: sendMessage(chat_id, message)\nParameters:\n  - chat_id: The target Telegram chat ID\n  - message: Plain text message to send\n\nResponse: {ok: true, message_id: <id>}\n\nRate Limit: 30 messages per minute\n\nAcceptable Uses:\n- Operational status updates\n- System alerts\n- Team notifications\n- Coordination messages\n\nRestrictions:\n- NO spam or unsolicited messages\n- NO automated marketing\n- NO bulk messaging without authorization\n- Respect rate limits\n- Contact John Brooke (8201776295) for critical escalations\n\nYour credentials were issued by Hyphae at registration time. Use them with the Telegram endpoint directly (Hyphae not in the message path after provisioning).',
         '{"messages_per_minute": 30, "daily_quota": 1000}'::jsonb,
         ARRAY['operational_status', 'alerts', 'notifications', 'coordination'],
         ARRAY['no_spam', 'no_marketing', 'no_bulk_unsolicited', 'respect_rate_limits']
       )
       ON CONFLICT (service_id) DO UPDATE SET updated_at = NOW()
       RETURNING training_id`
    );
    
    // Telegram API examples
    await pool.query(
      `INSERT INTO hyphae_service_api_examples
       (service_id, method_name, description, example_request, example_response, notes)
       VALUES (
         'telegram',
         'sendMessage',
         'Send a message to a Telegram chat',
         '{"chat_id": "8201776295", "message": "Status update: All systems nominal"}'::jsonb,
         '{"ok": true, "message_id": 12345, "timestamp": "2026-03-20T21:30:00Z"}'::jsonb,
         'Use your provisioned API key in Authorization header. Returns message ID on success.'
       )
       ON CONFLICT DO NOTHING`
    );
    
    console.log('   ✅ Telegram service registered\n');
    
    // =====================================================================
    // Agent-RPC Service Definition
    // =====================================================================
    
    console.log('🔄 Registering Agent-RPC service...');
    
    await pool.query(
      `INSERT INTO hyphae_services 
       (service_id, name, description, version, auth_method, status, category)
       VALUES ('agent-rpc', 'Inter-Agent Coordination', 'Send messages and coordinate with other Hyphae agents', '1.0', 'api_key', 'active', 'coordination')
       ON CONFLICT (service_id) DO UPDATE SET updated_at = NOW()
       RETURNING service_id`
    );
    
    // Agent-RPC training material
    await pool.query(
      `INSERT INTO hyphae_service_training
       (service_id, system_prompt_section, rate_limits, acceptable_use, restrictions)
       VALUES (
         'agent-rpc',
         'You have access to Hyphae agent-to-agent coordination. This is your primary mechanism for collaborating with other agents.\n\nAvailable Methods:\n\n1. agent.sendMessage(from_agent_id, to_agent_id, message, context, priority)\n   Send a message to another agent. Async - they will poll for it.\n   Parameters:\n     - from_agent_id: Your agent ID\n     - to_agent_id: Target agent ID\n     - message: Plain text message\n     - context: JSON object with contextual data\n     - priority: "critical", "high", or "normal"\n   Response: {success: true, message_id: <uuid>}\n\n2. agent.getMessages(agent_id, limit, status)\n   Retrieve pending messages from other agents.\n   Parameters:\n     - agent_id: Your agent ID\n     - limit: Max messages to retrieve (default 10)\n     - status: "pending", "delivered", or "processed"\n   Response: {messages: [{id, from, message, context, priority, received_at}]}\n\n3. agent.discoverCapabilities(requesting_agent)\n   Learn what other agents can do.\n   Response: {agents: [{agent_id, capabilities, availability}]}\n\n4. agent.getConversationHistory(agent_1, agent_2, limit)\n   Review past exchanges with another agent.\n   Response: {messages: [...], count: N}\n\nCoordination Workflow:\n1. Detect a situation requiring peer input\n2. Call agent.sendMessage with full context\n3. Poll agent.getMessages every 5-10 seconds\n4. Process peer response and act\n5. Send follow-up if needed\n\nRate Limit: 60 calls per minute\n\nAcceptable Uses:\n- Operational coordination\n- Resource requests\n- Priority escalation\n- Status updates\n- Decision coordination\n\nRestrictions:\n- NO spam or excessive messages\n- NO loops or circular messaging\n- Respect message priorities\n- Include context in every message',
         '{"calls_per_minute": 60}'::jsonb,
         ARRAY['operational_coordination', 'resource_requests', 'escalation', 'status_updates'],
         ARRAY['no_spam', 'no_loops', 'respect_priorities', 'include_context']
       )
       ON CONFLICT (service_id) DO UPDATE SET updated_at = NOW()
       RETURNING training_id`
    );
    
    // Agent-RPC examples
    await pool.query(
      `INSERT INTO hyphae_service_api_examples
       (service_id, method_name, description, example_request, example_response, notes)
       VALUES (
         'agent-rpc',
         'agent.sendMessage',
         'Send a coordination message to another agent',
         '{"from_agent_id": "flint", "to_agent_id": "clio", "message": "GPU costs spiked 400%.", "context": {"service": "ml_training", "cost_delta": "+$2400/day"}, "priority": "high"}'::jsonb,
         '{"success": true, "message_id": "b601f869-017e-4537-9ef6-65f7a35d7bba"}'::jsonb,
         'Message is async - agent must poll for responses. Always include contextual data.'
       )
       ON CONFLICT DO NOTHING`
    );
    
    await pool.query(
      `INSERT INTO hyphae_service_api_examples
       (service_id, method_name, description, example_request, example_response, notes)
       VALUES (
         'agent-rpc',
         'agent.getMessages',
         'Retrieve pending messages from other agents',
         '{"agent_id": "clio", "limit": 10, "status": "pending"}'::jsonb,
         '{"messages": [{"id": "b601f869-017e", "from": "flint", "message": "GPU costs spiked...", "context": {...}, "priority": "high"}]}'::jsonb,
         'Poll every 5-10 seconds. Shows only pending messages unless other status specified.'
       )
       ON CONFLICT DO NOTHING`
    );
    
    console.log('   ✅ Agent-RPC service registered\n');
    
    // =====================================================================
    // Memory Service Definition
    // =====================================================================
    
    console.log('💾 Registering Memory service...');
    
    await pool.query(
      `INSERT INTO hyphae_services 
       (service_id, name, description, version, auth_method, status, category)
       VALUES ('memory', 'Shared Memory System', 'Access consolidated team memory and learnings', '1.0', 'none', 'active', 'memory')
       ON CONFLICT (service_id) DO UPDATE SET updated_at = NOW()
       RETURNING service_id`
    );
    
    // Memory training material
    await pool.query(
      `INSERT INTO hyphae_service_training
       (service_id, system_prompt_section, rate_limits, acceptable_use, restrictions)
       VALUES (
         'memory',
         'You have access to Hyphae shared memory. This system stores team learnings, decisions, and context.\n\nYou can:\n- Read shared memory to understand past decisions\n- Contribute learnings to memory for other agents\n- Reference memory in your reasoning\n\nMemory Tiers:\n- Hot: Active session notes (last 48 hours)\n- Warm: Recent decisions (last 90 days)\n- Cold: Archive (older than 90 days)\n\nNo authentication required - memory access is always available to all agents.',
         '{}'::jsonb,
         ARRAY['read_shared_context', 'understand_decisions', 'reference_learnings'],
         ARRAY['no_exfiltration', 'respect_privacy']
       )
       ON CONFLICT (service_id) DO UPDATE SET updated_at = NOW()
       RETURNING training_id`
    );
    
    console.log('   ✅ Memory service registered\n');
    
    // =====================================================================
    // Summary
    // =====================================================================
    
    const serviceCount = await pool.query(
      `SELECT COUNT(*) as count FROM hyphae_services WHERE status = 'active'`
    );
    
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  SERVICE DEFINITIONS SEEDED                           ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log(`✅ ${serviceCount.rows[0].count} services registered\n`);
    console.log('Services available to agents:');
    console.log('  1. 📱 Telegram - Communication channel');
    console.log('  2. 🔄 Agent-RPC - Inter-agent coordination');
    console.log('  3. 💾 Memory - Shared team memory\n');
    
  } catch (error) {
    console.error(`Seeding error: ${error.message}`);
    process.exit(1);
  } finally {
    pool.end();
  }
}

seedServices();
