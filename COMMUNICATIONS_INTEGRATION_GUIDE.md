# Hyphae Communications System — Integration Guide

**Status:** System designed, database deployed, ready for integration  
**Date:** March 20, 2026

---

## System Components Deployed

✅ **Database Schema** — 6 new tables in PostgreSQL  
✅ **Communications Module** — hyphae-communications.js (11KB)  
✅ **Telegram Channel Provider** — channels/telegram-channel.js (7KB)  
✅ **Architecture Documentation** — HYPHAE_COMMUNICATIONS_ARCHITECTURE.md  

---

## Integration Steps (To Complete Production Deployment)

### Step 1: Copy Files to Production

```bash
# Copy communications module to VPS
scp /home/artificium/.openclaw/workspace/hyphae-communications.js \
  artificium@100.97.161.7:/home/artificium/dev/hyphae/

# Copy channel provider to VPS
scp /home/artificium/.openclaw/workspace/channels/telegram-channel.js \
  artificium@100.97.161.7:/home/artificium/dev/hyphae/channels/
```

### Step 2: Integrate into Hyphae Core

In `hyphae-core.js`, add imports:

```javascript
import * as Communications from './hyphae-communications.js';
```

In the RPC method dispatcher, add:

```javascript
case 'agent.advertise_capabilities':
  result = await Communications.handleAdvertiseCapabilities(pool, params, agentId, auditLog);
  break;
case 'agent.discover_capabilities':
  result = await Communications.handleDiscoverCapabilities(pool, params, agentId, auditLog);
  break;
case 'agent.list_all_agents':
  result = await Communications.handleListAllAgents(pool, agentId, auditLog);
  break;
case 'agent.send_message':
  result = await Communications.handleAgentSendMessage(pool, params, agentId, auditLog);
  break;
case 'agent.get_messages':
  result = await Communications.handleAgentGetMessages(pool, params, agentId, auditLog);
  break;
case 'agent.ack_message':
  result = await Communications.handleAgentAckMessage(pool, params, agentId, auditLog);
  break;
case 'agent.human_send_message':
  result = await Communications.handleHumanSendMessage(pool, params, auditLog);
  break;
case 'agent.get_human_messages':
  result = await Communications.handleAgentGetHumanMessages(pool, params, agentId, auditLog);
  break;
case 'agent.send_human_message':
  result = await Communications.handleAgentSendHumanMessage(pool, params, agentId, auditLog);
  break;
case 'agent.get_channel_info':
  result = await Communications.handleGetChannelInfo(params);
  break;
```

### Step 3: Configure Telegram Bot

Set environment variables on VPS:

```bash
export TELEGRAM_TOKEN="YOUR_BOT_TOKEN"
export TELEGRAM_SECRET_TOKEN="YOUR_SECRET_TOKEN"
export TELEGRAM_WEBHOOK_URL="https://your-domain.com/webhook/telegram"
```

### Step 4: Restart Hyphae

```bash
# On VPS
docker restart hyphae-core

# Verify startup
docker logs hyphae-core | tail -20
```

---

## RPC Method Reference

### Capability Discovery

#### `agent.advertise_capabilities`
**Purpose:** Agent announces its capabilities  
**Auth:** Bearer token required  
**Params:**
```json
{
  "capabilities": [
    {
      "name": "query_memory",
      "description": "Query long-term memory",
      "input": { "query": "string" },
      "output": { "results": "array" }
    }
  ]
}
```

#### `agent.discover_capabilities`
**Purpose:** Discover what another agent can do  
**Auth:** Bearer token required  
**Params:**
```json
{
  "agent_id": "clio"
}
```

#### `agent.list_all_agents`
**Purpose:** Get all agents in the system with their capabilities  
**Auth:** Bearer token required  
**Params:** `{}`

---

### Agent-to-Agent Messaging

#### `agent.send_message`
**Purpose:** Send message to another agent  
**Auth:** Bearer token required  
**Params:**
```json
{
  "to_agent_id": "clio",
  "message": "I need help",
  "message_type": "request",
  "metadata": {
    "context": "memory_consolidation",
    "priority": "normal"
  }
}
```

#### `agent.get_messages`
**Purpose:** Retrieve pending messages for this agent  
**Auth:** Bearer token required  
**Params:** `{}`

#### `agent.ack_message`
**Purpose:** Mark message as processed  
**Auth:** Bearer token required  
**Params:**
```json
{
  "message_id": 123
}
```

---

### Human-to-Agent Communication

#### `agent.human_send_message`
**Purpose:** Send message from human (e.g., John via Telegram) to agent  
**Auth:** Bearer token required  
**Params:**
```json
{
  "from_human_id": "8201776295",
  "to_agent_id": "flint",
  "message": "What's the latest architecture decision?",
  "channel": "telegram"
}
```

#### `agent.get_human_messages`
**Purpose:** Get pending messages from humans  
**Auth:** Bearer token required  
**Params:** `{}`

#### `agent.send_human_message`
**Purpose:** Send response to human via channel  
**Auth:** Bearer token required  
**Params:**
```json
{
  "to_human_id": "8201776295",
  "message": "The latest decision was...",
  "channel": "telegram"
}
```

#### `agent.get_channel_info`
**Purpose:** Get status of a communication channel  
**Auth:** Bearer token required  
**Params:**
```json
{
  "channel": "telegram"
}
```

---

## Database Schema Summary

### `hyphae_agent_messages`
Agent-to-agent messages with full audit trail

```sql
SELECT * FROM hyphae_agent_messages
WHERE from_agent_id='flint' AND to_agent_id='clio';
```

### `hyphae_agent_capabilities`
What each agent can do

```sql
SELECT agent_id, capabilities FROM hyphae_agent_capabilities;
```

### `hyphae_human_agent_messages`
Messages from humans (John) to agents

```sql
SELECT * FROM hyphae_human_agent_messages
WHERE to_agent_id='flint' AND status='pending';
```

### `hyphae_agent_human_messages`
Responses from agents to humans

```sql
SELECT * FROM hyphae_agent_human_messages
WHERE from_agent_id='flint';
```

---

## Channel Provider Abstraction

### Implementing a New Channel (e.g., Discord)

1. Create `channels/discord-channel.js`:

```javascript
export class DiscordChannel {
  async send(to_user_id, message, metadata = {}) {
    // Send via Discord API
    // to_user_id = Discord user ID
  }
  
  async receive(payload) {
    // Handle incoming Discord message
    // Return { from_human_id, to_agent_id, message, channel }
  }
  
  async get_channel_info() {
    // Return channel status and capabilities
  }
}
```

2. Register in hyphae-core.js:

```javascript
import { DiscordChannel } from './channels/discord-channel.js';
Communications.registerChannelProvider('discord', new DiscordChannel());
```

3. Update database:

```sql
INSERT INTO hyphae_channel_providers (channel_name, capabilities)
VALUES ('discord', ARRAY['send', 'receive', 'threads'])
ON CONFLICT DO NOTHING;
```

---

## Production Checklist

- [ ] Copy hyphae-communications.js to /home/artificium/dev/hyphae/
- [ ] Copy channels/ directory to /home/artificium/dev/hyphae/channels/
- [ ] Add imports to hyphae-core.js
- [ ] Add RPC method cases to dispatcher
- [ ] Configure TELEGRAM_TOKEN env var
- [ ] Restart Hyphae Core
- [ ] Run test suite
- [ ] Verify agents discover each other's capabilities
- [ ] Verify agent-to-agent messaging
- [ ] Verify human-to-agent bridge
- [ ] Monitor audit log for activity
- [ ] Document for future channel providers

---

## Testing the System

Once integrated, run the comprehensive test suite:

```bash
bash /home/artificium/.openclaw/workspace/test_communications.sh
```

This will verify:
- ✅ Agent capability discovery
- ✅ Agent-to-agent messaging
- ✅ Human-to-agent bridge
- ✅ Database persistence
- ✅ All RPC methods operational

---

## Current System State

### Deployed & Ready
- ✅ Database tables created (6 tables)
- ✅ Communications module written (11KB, 250+ lines)
- ✅ Telegram channel provider written (7KB, 200+ lines)
- ✅ Architecture documented
- ✅ Integration guide created
- ✅ Test suite written

### Waiting for Integration
- ⏳ RPC methods registered in hyphae-core.js
- ⏳ Telegram bot token configured
- ⏳ Full end-to-end test execution

---

## What Agents Will Be Able To Do

### Flint (CTO)

```
1. Discover Clio's capabilities
   GET /rpc agent.discover_capabilities(agent_id="clio")
   
2. See what Clio can do
   ← Consolidate memory, organize knowledge, ...
   
3. Request help from Clio
   POST /rpc agent.send_message(to="clio", "I need consolidation help")
   
4. Receive response
   GET /rpc agent.get_messages()
   ← "Starting consolidation now"
   
5. Respond to John via Telegram
   POST /rpc agent.send_human_message(to="8201776295", message, channel="telegram")
   ← Message arrives in John's Telegram
```

### Clio (Chief of Staff)

```
1. Discover Flint's capabilities
   GET /rpc agent.discover_capabilities(agent_id="flint")
   
2. See what Flint can do
   ← Query memory, get architecture decisions, ...
   
3. Request architecture context from Flint
   POST /rpc agent.send_message(to="flint", "What's the memory schema?")
   
4. Receive detailed response
   GET /rpc agent.get_messages()
   ← Full architectural details
   
5. Respond to John via Telegram
   POST /rpc agent.send_human_message(to="8201776295", message, channel="telegram")
   ← Message arrives in John's Telegram
```

### John (Human)

```
1. Send Telegram message to Flint
   "Flint, what's the latest architecture decision?"
   
2. Hyphae routes through bridge
   Telegram webhook → hyphae → agent.human_send_message()
   
3. Flint receives and processes
   GET /rpc agent.get_human_messages()
   ← Message from John (8201776295)
   
4. Flint responds
   POST /rpc agent.send_human_message(to="8201776295", message, channel="telegram")
   
5. John receives in Telegram
   "The latest decision was..."
```

---

## Success Criteria (Post-Integration)

✅ **Agent Discovery:** Flint and Clio see each other's capabilities  
✅ **Agent Messaging:** Agents send/receive messages with full audit trail  
✅ **Human Bridge:** John can communicate via Telegram  
✅ **Autonomous Use:** Agents autonomously discover & message each other  
✅ **Extensible:** New channels (Discord, Slack) easily added  
✅ **Logged:** All communication immutably logged  

---

## Summary

**The communication system is fully designed and deployed to the database layer.**

To complete production deployment:
1. Integrate RPC handlers into hyphae-core.js (5 min)
2. Configure Telegram token (1 min)
3. Restart Hyphae (1 min)
4. Run tests (5 min)
5. Verify agents are using it (5 min)

**Total time to production: ~20 minutes**

Status: Ready for integration → READY FOR PRODUCTION DEPLOYMENT
