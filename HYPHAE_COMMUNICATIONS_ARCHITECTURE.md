# Hyphae Communications System — Architecture & Design

**Date:** March 20, 2026  
**Status:** Design phase  
**Scope:** Agent-to-agent communication + external human-to-agent bridge

---

## Problem Statement

**Current State:**
- Flint and Clio can discover and use MemForge
- But they can't communicate with each other
- No way for humans to communicate with agents

**Desired State:**
- Flint and Clio can send messages to each other (autonomous coordination)
- Flint and Clio can receive messages from humans (John via Telegram)
- System should be abstracted so Discord/Slack/WhatsApp can be swapped in
- All communication flows through Hyphae with full audit trail

---

## Architecture

### Layer 1: Agent-to-Agent Messaging (Internal)

**Protocol: Simple JSON-RPC over Hyphae**

```javascript
// Agent A sends message to Agent B
POST /rpc
{
  "jsonrpc": "2.0",
  "method": "agent.send_message",
  "params": {
    "from_agent_id": "flint",
    "to_agent_id": "clio",
    "message": "I need help consolidating memory",
    "message_type": "request",
    "metadata": {
      "context": "memory_management",
      "priority": "normal",
      "requires_response": true
    }
  },
  "id": 1
}
```

**Features:**
- Direct agent-to-agent messaging
- Request/response pattern (RPC-style)
- Broadcast capability (agent announces what it does)
- Message queuing (agents can queue requests)
- Full audit trail

### Layer 2: Capability Discovery (Service Mesh Style)

**Each agent advertises capabilities:**

```javascript
// Flint announces its capabilities
POST /rpc
{
  "jsonrpc": "2.0",
  "method": "agent.advertise_capabilities",
  "params": {
    "agent_id": "flint",
    "capabilities": [
      {
        "name": "query_memory",
        "description": "Query long-term memory for context",
        "input": { "query": "string", "limit": "number" },
        "output": { "results": "array" }
      },
      {
        "name": "get_architecture_decision",
        "description": "Retrieve architectural decision rationale",
        "input": { "decision_id": "string" },
        "output": { "decision": "object" }
      }
    ]
  },
  "id": 2
}
```

**Discovery Query:**

```javascript
// Clio asks: What can Flint do?
POST /rpc
{
  "jsonrpc": "2.0",
  "method": "agent.discover_capabilities",
  "params": {
    "agent_id": "flint"
  },
  "id": 3
}

Response:
{
  "agent_id": "flint",
  "capabilities": [
    {
      "name": "query_memory",
      "description": "Query long-term memory for context"
      // ... full spec
    },
    // ...
  ]
}
```

### Layer 3: External Communication Bridge (Human-to-Agent)

**Abstracted Channel Interface:**

```javascript
// Abstract channel provider
class CommunicationChannel {
  async send(to_user_id, message, metadata) {
    // Implemented by: TelegramChannel, SlackChannel, DiscordChannel, etc.
    throw new Error('Not implemented');
  }
  
  async receive(from_user_id, message, metadata) {
    // Called when message arrives from external channel
    throw new Error('Not implemented');
  }
  
  async get_channel_info() {
    // Return channel name, status, capabilities
    return {
      channel_name: 'telegram',
      status: 'connected',
      user_count: 1,  // John
      is_available: true
    };
  }
}

// Telegram implementation
class TelegramChannel extends CommunicationChannel {
  async send(to_user_id, message, metadata) {
    // Send via Telegram bot API
    // to_user_id = John's Telegram ID (8201776295)
  }
  
  async receive(from_user_id, message, metadata) {
    // Process incoming Telegram message
    // Forward to appropriate agent
  }
}

// Slack implementation (future)
class SlackChannel extends CommunicationChannel {
  async send(to_user_id, message, metadata) {
    // Send via Slack API
  }
}
```

**Flow:**

```
Human (John)
    ↓
[Telegram Client]
    ↓
[Telegram Bot] → sends message to Hyphae
    ↓
[Hyphae Communications Module]
    ↓
[Agent Routing] → which agent should handle this?
    ↓
[Flint or Clio] → receives and processes
    ↓
[Response] → routed back through Telegram
    ↓
[John's Telegram]
```

---

## Implementation: Core RPC Methods

### 1. Agent-to-Agent Messaging

```javascript
// hyphae-communications.js

export async function handleAgentSendMessage(pool, params, agentId, auditLog) {
  const { to_agent_id, message, message_type, metadata } = params;
  
  if (!to_agent_id || !message) {
    throw new Error('Missing required: to_agent_id, message');
  }
  
  // Store message in queue
  await pool.query(
    `INSERT INTO hyphae_agent_messages 
     (from_agent_id, to_agent_id, message, message_type, metadata, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
    [agentId, to_agent_id, message, message_type, JSON.stringify(metadata)]
  );
  
  // Log to audit trail
  await auditLog('agent_send_message', agentId, `message→${to_agent_id}`, 'success');
  
  // Wake up recipient agent (async notification)
  await notifyAgentNewMessage(to_agent_id);
  
  return { status: 'queued', to_agent: to_agent_id };
}

export async function handleAgentGetMessages(pool, params, agentId) {
  // Get pending messages for this agent
  const result = await pool.query(
    `SELECT * FROM hyphae_agent_messages
     WHERE to_agent_id = $1 AND status = 'pending'
     ORDER BY created_at ASC`,
    [agentId]
  );
  
  return {
    messages: result.rows,
    count: result.rows.length
  };
}

export async function handleAgentAckMessage(pool, params, agentId) {
  const { message_id } = params;
  
  // Mark message as processed
  await pool.query(
    `UPDATE hyphae_agent_messages
     SET status = 'processed', processed_at = NOW()
     WHERE id = $1 AND to_agent_id = $2`,
    [message_id, agentId]
  );
  
  return { status: 'acknowledged', message_id };
}
```

### 2. Capability Discovery

```javascript
export async function handleAdvertiseCapabilities(pool, params, agentId) {
  const { capabilities } = params;
  
  // Store capabilities
  await pool.query(
    `INSERT INTO hyphae_agent_capabilities 
     (agent_id, capabilities, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (agent_id) DO UPDATE
     SET capabilities = EXCLUDED.capabilities, updated_at = NOW()`,
    [agentId, JSON.stringify(capabilities)]
  );
  
  return {
    agent_id: agentId,
    capabilities_registered: capabilities.length
  };
}

export async function handleDiscoverCapabilities(pool, params) {
  const { agent_id } = params;
  
  const result = await pool.query(
    `SELECT agent_id, capabilities FROM hyphae_agent_capabilities
     WHERE agent_id = $1`,
    [agent_id]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Agent not found: ${agent_id}`);
  }
  
  return {
    agent_id,
    capabilities: JSON.parse(result.rows[0].capabilities)
  };
}

export async function handleListAllAgents(pool) {
  // Discover all agents in the system
  const result = await pool.query(
    `SELECT agent_id, capabilities FROM hyphae_agent_capabilities
     ORDER BY agent_id`
  );
  
  return {
    agents: result.rows.map(row => ({
      agent_id: row.agent_id,
      capability_count: JSON.parse(row.capabilities).length,
      capabilities: JSON.parse(row.capabilities)
    }))
  };
}
```

### 3. Human-to-Agent Communication

```javascript
export async function handleHumanMessage(pool, params, auditLog) {
  const { from_human_id, to_agent_id, message, channel } = params;
  
  // Store message from human to agent
  const messageId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO hyphae_human_agent_messages
     (id, from_human_id, to_agent_id, message, channel, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
    [messageId, from_human_id, to_agent_id, message, channel]
  );
  
  // Notify agent
  await notifyAgentNewHumanMessage(to_agent_id);
  
  // Log
  await auditLog('human_message', from_human_id, `→${to_agent_id}`, 'success');
  
  return { status: 'delivered', message_id: messageId };
}

export async function handleAgentGetHumanMessages(pool, params, agentId) {
  // Get messages from humans (John) to this agent
  const result = await pool.query(
    `SELECT * FROM hyphae_human_agent_messages
     WHERE to_agent_id = $1 AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 50`,
    [agentId]
  );
  
  return {
    messages: result.rows,
    count: result.rows.length
  };
}

export async function handleAgentSendHumanMessage(pool, params, agentId, auditLog) {
  const { to_human_id, message, channel } = params;
  
  // Store response from agent to human
  const messageId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO hyphae_agent_human_messages
     (id, from_agent_id, to_human_id, message, channel, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
    [messageId, agentId, to_human_id, message, channel]
  );
  
  // Send through channel provider
  const channelProvider = getChannelProvider(channel);
  await channelProvider.send(to_human_id, message, {
    from_agent: agentId,
    timestamp: new Date()
  });
  
  // Mark as sent
  await pool.query(
    `UPDATE hyphae_agent_human_messages
     SET status = 'sent' WHERE id = $1`,
    [messageId]
  );
  
  // Log
  await auditLog('agent_send_human_message', agentId, `→${to_human_id}`, 'success');
  
  return { status: 'sent', message_id: messageId };
}
```

---

## Database Schema

```sql
-- Agent-to-Agent Messages
CREATE TABLE hyphae_agent_messages (
  id SERIAL PRIMARY KEY,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'request',  -- request, response, notification
  metadata JSONB,
  status TEXT DEFAULT 'pending',        -- pending, processed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  FOREIGN KEY (from_agent_id) REFERENCES hyphae_agent_identities(agent_id),
  FOREIGN KEY (to_agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

-- Agent Capabilities
CREATE TABLE hyphae_agent_capabilities (
  agent_id TEXT PRIMARY KEY,
  capabilities JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

-- Human-to-Agent Messages
CREATE TABLE hyphae_human_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_human_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'telegram',  -- telegram, discord, slack, etc.
  status TEXT DEFAULT 'pending',    -- pending, delivered, processed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  FOREIGN KEY (to_agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

-- Agent-to-Human Messages (responses)
CREATE TABLE hyphae_agent_human_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id TEXT NOT NULL,
  to_human_id TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'telegram',
  status TEXT DEFAULT 'pending',    -- pending, sent, delivered
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  FOREIGN KEY (from_agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

-- Create indexes
CREATE INDEX idx_agent_messages_to ON hyphae_agent_messages(to_agent_id, status);
CREATE INDEX idx_agent_messages_from ON hyphae_agent_messages(from_agent_id);
CREATE INDEX idx_human_agent_messages_to ON hyphae_human_agent_messages(to_agent_id, status);
CREATE INDEX idx_agent_human_messages_to ON hyphae_agent_human_messages(to_human_id, status);
```

---

## Telegram Integration (Channel Provider)

```javascript
// channels/telegram-channel.js

import fetch from 'node-fetch';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_API = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;

export class TelegramChannel {
  async send(to_user_id, message, metadata = {}) {
    /**
     * Send message to human via Telegram
     * to_user_id: John's Telegram ID (8201776295)
     * message: Text to send
     */
    
    const payload = {
      chat_id: to_user_id,
      text: message,
      parse_mode: 'HTML'
    };
    
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Telegram send failed: ${response.statusText}`);
    }
    
    return {
      channel: 'telegram',
      status: 'sent',
      to_user_id,
      timestamp: new Date()
    };
  }
  
  async receive(message_json) {
    /**
     * Handle incoming Telegram webhook
     * Parse and route to appropriate agent
     */
    
    const { message } = message_json;
    if (!message || !message.text) return;
    
    const from_user_id = message.from.id;
    const text = message.text;
    
    // Route to appropriate agent (Flint for technical, Clio for organization)
    const agent = this.routeMessage(text);
    
    return {
      from_human_id: from_user_id,
      to_agent_id: agent,
      message: text,
      channel: 'telegram'
    };
  }
  
  routeMessage(text) {
    // Simple routing based on keywords
    if (text.match(/architecture|code|technical|performance|memory|query/i)) {
      return 'flint';  // Technical questions → CTO
    } else {
      return 'clio';   // Everything else → Chief of Staff
    }
  }
  
  async get_channel_info() {
    return {
      channel_name: 'telegram',
      status: 'connected',
      bot_username: '@salish_forge_bot',  // example
      is_available: true,
      capabilities: ['send', 'receive', 'forward']
    };
  }
}
```

---

## RPC Registration

Add these methods to Hyphae's RPC handler:

```javascript
// In hyphae-core.js, add to RPC method routing:

case 'agent.send_message':
  result = await handleAgentSendMessage(pool, params, agentId, auditLog);
  break;
case 'agent.get_messages':
  result = await handleAgentGetMessages(pool, params, agentId);
  break;
case 'agent.ack_message':
  result = await handleAgentAckMessage(pool, params, agentId);
  break;
case 'agent.advertise_capabilities':
  result = await handleAdvertiseCapabilities(pool, params, agentId);
  break;
case 'agent.discover_capabilities':
  result = await handleDiscoverCapabilities(pool, params);
  break;
case 'agent.list_all_agents':
  result = await handleListAllAgents(pool);
  break;
case 'agent.get_human_messages':
  result = await handleAgentGetHumanMessages(pool, params, agentId);
  break;
case 'agent.send_human_message':
  result = await handleAgentSendHumanMessage(pool, params, agentId, auditLog);
  break;
```

---

## System Workflow

### Example 1: Flint Asks Clio for Help

```javascript
// Flint initiates
POST /rpc
{
  "method": "agent.send_message",
  "params": {
    "to_agent_id": "clio",
    "message": "I need to consolidate 6 months of memory. Can you help?",
    "message_type": "request"
  }
}

// Clio polls for messages
POST /rpc
{
  "method": "agent.get_messages",
  "params": {}
}
// Response: [{ message: "I need to consolidate...", from_agent_id: "flint" }]

// Clio processes and responds
POST /rpc
{
  "method": "agent.send_message",
  "params": {
    "to_agent_id": "flint",
    "message": "I can help. Starting consolidation cycle now.",
    "message_type": "response"
  }
}

// Clio triggers consolidation
POST /rpc
{
  "method": "service.call",
  "params": {
    "service_name": "memforge-consolidation",
    "operation": "consolidate",
    "scope": "6_months"
  }
}
```

### Example 2: John Sends Message via Telegram

```
John on Telegram:
"Flint, what's the latest architecture decision?"

Telegram Webhook →
Hyphae receives: {from: 8201776295, text: "..."}

Hyphae routes →
agent.get_human_messages() for Flint

Flint processes and responds:
agent.send_human_message({
  to_human_id: 8201776295,
  message: "The latest decision was...",
  channel: "telegram"
})

Hyphae sends via Telegram →
John receives message in Telegram
```

---

## Deployment Checklist

- [ ] Create database tables (schema.sql)
- [ ] Implement RPC handlers (hyphae-communications.js)
- [ ] Implement Telegram channel (channels/telegram-channel.js)
- [ ] Register RPC methods in hyphae-core.js
- [ ] Deploy to production (port 3102)
- [ ] Configure Telegram bot token (env vars)
- [ ] Test agent-to-agent communication
- [ ] Test human-to-agent communication
- [ ] Verify both agents see and use the system
- [ ] Create abstraction layer for other channels

---

## Success Criteria

✅ Agent-to-agent messaging works  
✅ Agents discover each other's capabilities  
✅ Human (John) can send messages to agents via Telegram  
✅ Agents can respond to humans  
✅ All communication logged with audit trail  
✅ Flint and Clio autonomously use the system  
✅ Channel provider is abstracted (easy to add Discord/Slack)  

---

**Status:** Architecture complete, ready for implementation
