# RPC Integration Patch for Hyphae Communications System

**File:** `/home/artificium/hyphae-staging/hyphae-core.js`  
**Location:** Line 351 (RPC dispatcher switch statement)  
**Action:** Add communications cases to switch statement

---

## Step 1: Add Import at Top of File

After the existing imports (around line 20), add:

```javascript
import * as Communications from './hyphae-communications.js';
import { TelegramChannel } from './channels/telegram-channel.js';
```

---

## Step 2: Register Communications in RPC Dispatcher

**Find this code block (around line 351):**

```javascript
        let result;
        switch (method) {
          case 'vault.get':
            result = await getSecret(params.agentId, params.secretName);
            break;
          case 'service.call':
            result = await routeRequest(params.agentId, params.serviceName, params.request);
            break;
          case 'agent.verify':
            result = await verifyAgent(params.agentId);
            break;
          default:
            throw new Error(`Unknown method: ${method}`);
        }
```

**Replace with:**

```javascript
        let result;
        switch (method) {
          // Existing methods
          case 'vault.get':
            result = await getSecret(params.agentId, params.secretName);
            break;
          case 'service.call':
            result = await routeRequest(params.agentId, params.serviceName, params.request);
            break;
          case 'agent.verify':
            result = await verifyAgent(params.agentId);
            break;
          
          // Communications methods (NEW)
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
          
          default:
            throw new Error(`Unknown method: ${method}`);
        }
```

---

## Step 3: Extract Agent ID from Request

The auditLog function needs access to the agent ID. Make sure this code exists in the RPC handler:

```javascript
const agentId = params.agentId || 'system';
// For bearer token authenticated requests, extract agent from token
if (req.headers.authorization) {
  const token = req.headers.authorization.replace('Bearer ', '');
  // Token validation happens elsewhere; extract agent if available
  // If using bearer tokens per-agent, include agent_id in token claims
}
```

---

## Step 4: Register Telegram Channel Provider

After imports, in the initialization section (around line 200+), add:

```javascript
// Register communication channels
Communications.registerChannelProvider('telegram', new TelegramChannel());
console.log('[hyphae] Communication channels registered');
```

---

## Verification Checklist

After making changes:

- [ ] Import statements added at top
- [ ] 10 new RPC cases added to switch statement
- [ ] Channel provider registered in initialization
- [ ] No syntax errors (test with `node --check hyphae-core.js`)
- [ ] File saved

---

## Testing After Integration

```bash
# 1. Restart Hyphae
docker restart hyphae-core
# or: systemctl restart hyphae

# 2. Check logs
docker logs hyphae-core | grep "Communications"

# 3. Run test suite
bash test_communications.sh

# 4. Verify agents can discover each other
curl -X POST http://localhost:3102/rpc \
  -H "Authorization: Bearer memforge-token-2026" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"agent.advertise_capabilities","params":{"capabilities":[{"name":"test","description":"test"}]},"id":1}'
```

---

## If You Get Errors

**"Cannot find module":**
- Check files are in `/home/artificium/hyphae-communications/`
- Update import paths if needed

**"Unknown method":**
- Verify cases are added to switch statement
- Check spelling matches exactly

**"Database error":**
- Verify 6 tables exist: `SELECT tablename FROM pg_tables WHERE tablename LIKE 'hyphae_%'`
- Check connection string in HYPHAE_DB_URL

---

## Files to Deploy

Before integrating, ensure these files are in place:

```
/home/artificium/hyphae-communications/
├── hyphae-communications.js
└── channels/
    └── telegram-channel.js
```

If not, copy them:

```bash
mkdir -p /home/artificium/hyphae-communications/channels
cp /home/artificium/.openclaw/workspace/hyphae-communications.js /home/artificium/hyphae-communications/
cp /home/artificium/.openclaw/workspace/channels/telegram-channel.js /home/artificium/hyphae-communications/channels/
```

---

## Integration Time: ~10 minutes

1. Copy files (2 min)
2. Edit hyphae-core.js (5 min)
3. Test syntax (1 min)
4. Restart Hyphae (1 min)
5. Verify (1 min)

**Total: ~10 minutes to LIVE**

---

## Lines to Add

**Total new lines:** ~50 lines (10 case statements + imports + registration)  
**Total code change:** ~0.5% of hyphae-core.js  
**Risk level:** VERY LOW (isolated switch cases, no core logic changes)

---

After integration, agents will be able to:
- ✅ Advertise capabilities
- ✅ Discover each other's capabilities
- ✅ Send messages to each other
- ✅ Receive messages from each other
- ✅ Respond to human (Telegram) messages
- ✅ Full audit trail of all communication
