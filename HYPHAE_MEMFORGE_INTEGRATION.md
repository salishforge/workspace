# Phase 4: MemForge Integration with Hyphae Service Registry

**Objective:** Enable MemForge to self-register with Hyphae and agents to auto-discover/integrate

**Status:** Ready for implementation (after Phase 1-2 complete)

---

## Implementation Steps

### Step 1: Add MemForge RPC Endpoints

**File:** `/nanoclaw-fork/memforge/consolidation/consolidation_agent.js`

**Add these RPC endpoints:**

```javascript
// At startup
const HYPHAE_RPC_URL = process.env.HYPHAE_RPC_URL || 'http://localhost:3102';
const HYPHAE_BEARER_TOKEN = process.env.HYPHAE_BEARER_TOKEN || 'memforge-token-default';

// Register with Hyphae on startup
async function registerWithHyphae() {
  try {
    const registration = {
      jsonrpc: '2.0',
      method: 'services.register',
      params: {
        service_id: 'memforge-consolidation',
        service_name: 'MemForge Consolidation',
        service_type: 'memory',
        version: '1.0.0',
        api_endpoint: process.env.MEMFORGE_RPC_URL || 'http://localhost:3003',
        api_protocol: 'json-rpc',
        capabilities: [
          { id: 'consolidate', method: 'consolidation.run', description: 'Run sleep-cycle consolidation' },
          { id: 'status', method: 'consolidation.status', description: 'Get consolidation status' },
          { id: 'lastRun', method: 'consolidation.lastRun', description: 'Get last run timestamp' }
        ],
        requires: [
          { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
          { type: 'database', connection_string_env: 'MEMFORGE_DB_URL' }
        ],
        health_check_url: 'http://localhost:3003/health'
      },
      id: 'register-consolidation'
    };

    const response = await fetchHyphaeRPC(registration);
    global.HYPHAE_REGISTRATION_TOKEN = response.result.registration_token;
    console.log('[memforge] ✓ Registered with Hyphae');

    // Start heartbeat
    startHeartbeat();
  } catch (error) {
    console.warn(`[memforge] Failed to register with Hyphae: ${error.message}`);
    // Continue anyway (Hyphae optional, MemForge works standalone)
  }
}

async function startHeartbeat() {
  setInterval(async () => {
    try {
      await fetchHyphaeRPC({
        jsonrpc: '2.0',
        method: 'services.heartbeat',
        params: {
          service_id: 'memforge-consolidation',
          registration_token: global.HYPHAE_REGISTRATION_TOKEN,
          status: 'ready',
          metrics: {
            uptime_seconds: process.uptime(),
            consolidations_run: global.CONSOLIDATION_COUNT || 0,
            last_run_duration_ms: global.LAST_RUN_DURATION || 0
          }
        },
        id: 'heartbeat-' + Date.now()
      });
    } catch (error) {
      console.warn(`[memforge] Heartbeat failed: ${error.message}`);
    }
  }, 30000); // Every 30 seconds
}

async function fetchHyphaeRPC(rpcRequest) {
  const response = await fetch(HYPHAE_RPC_URL + '/rpc', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + HYPHAE_BEARER_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(rpcRequest)
  });

  if (!response.ok) {
    throw new Error(`Hyphae returned ${response.status}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result;
}
```

**Call at startup:**
```javascript
// In main() function
await registerWithHyphae(); // Non-blocking, continues if fails
```

---

### Step 2: Memory Retrieval Service Registration

**File:** `/nanoclaw-fork/memforge/retrieval/memory_retrieval.js`

**Add similar registration:**

```javascript
async function registerWithHyphae() {
  try {
    const registration = {
      jsonrpc: '2.0',
      method: 'services.register',
      params: {
        service_id: 'memforge-retrieval',
        service_name: 'MemForge Retrieval',
        service_type: 'memory',
        version: '1.0.0',
        api_endpoint: process.env.MEMFORGE_RETRIEVAL_URL || 'http://localhost:3004',
        api_protocol: 'http-rest',
        capabilities: [
          { id: 'queryByText', method: 'GET /query', description: 'Full-text semantic search' },
          { id: 'getHotTier', method: 'GET /hot-tier', description: 'Get hot memory' },
          { id: 'getWarmTier', method: 'GET /warm-tier', description: 'Get warm memory' },
          { id: 'getColdTier', method: 'GET /cold-tier', description: 'Get cold archive' },
          { id: 'cacheStats', method: 'GET /cache-stats', description: 'Cache performance metrics' }
        ],
        requires: [
          { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
          { type: 'database', connection_string_env: 'MEMFORGE_DB_URL' }
        ],
        health_check_url: 'http://localhost:3004/health'
      },
      id: 'register-retrieval'
    };

    const response = await fetchHyphaeRPC(registration);
    global.HYPHAE_REGISTRATION_TOKEN = response.result.registration_token;
    console.log('[memforge] ✓ Retrieval service registered with Hyphae');

    startHeartbeat();
  } catch (error) {
    console.warn(`[memforge] Retrieval registration failed: ${error.message}`);
  }
}
```

---

### Step 3: Agent Auto-Discovery & Integration

**File:** Where agents initialize (Flint/Clio startup)

```javascript
// On agent startup
async function initializeMemorySystem() {
  console.log('[agent] Discovering memory services...');

  try {
    // 1. Discover available memory services
    const discovery = await callHyphaeRPC({
      jsonrpc: '2.0',
      method: 'services.discover',
      params: {
        agent_id: process.env.AGENT_ID || 'agent-unknown',
        filters: {
          service_type: 'memory',
          healthy: true,
          required_capabilities: ['queryByText', 'getHotTier']
        }
      },
      id: 'discover-memory'
    });

    const services = discovery.result.services || [];
    if (services.length === 0) {
      console.log('[agent] No memory service available');
      return;
    }

    // 2. Integrate with first available service
    const memforgeService = services.find(s => s.service_name.includes('MemForge'));
    if (!memforgeService) {
      console.log('[agent] MemForge not available');
      return;
    }

    const integration = await callHyphaeRPC({
      jsonrpc: '2.0',
      method: 'services.integrate',
      params: {
        agent_id: process.env.AGENT_ID,
        service_id: memforgeService.service_id,
        integration_type: 'routed', // Route through Hyphae for security
        capabilities_needed: ['queryByText', 'getHotTier', 'getWarmTier']
      },
      id: 'integrate-memforge'
    });

    // 3. Store integration config for later use
    global.MEMORY_SERVICE = {
      service_id: memforgeService.service_id,
      endpoint: integration.result.integration_config.service_endpoint,
      auth_token: integration.result.integration_config.agent_authorization,
      routed_via_hyphae: true,
      caching_enabled: integration.result.integration_config.caching_enabled
    };

    console.log(`[agent] ✓ Connected to ${memforgeService.service_name} via Hyphae`);

  } catch (error) {
    console.warn(`[agent] Memory system initialization failed: ${error.message}`);
    // Agent continues without memory (degraded mode)
  }
}

// Later, when agent needs to query memory
async function queryMemory(queryText, agentId) {
  if (!global.MEMORY_SERVICE) {
    console.warn('[agent] Memory service not available');
    return [];
  }

  try {
    // Query goes through Hyphae if routed_via_hyphae=true
    const endpoint = global.MEMORY_SERVICE.routed_via_hyphae
      ? 'http://localhost:3102/rpc'
      : global.MEMORY_SERVICE.endpoint;

    const request = global.MEMORY_SERVICE.routed_via_hyphae
      ? {
          jsonrpc: '2.0',
          method: 'services.call', // Hyphae gateway method
          params: {
            service_id: global.MEMORY_SERVICE.service_id,
            method: 'queryByText',
            params: { agentId, queryText }
          }
        }
      : {
          method: 'GET /query',
          params: { agentId, queryText }
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + global.MEMORY_SERVICE.auth_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`Memory service returned ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    console.warn(`[agent] Memory query failed: ${error.message}`);
    return [];
  }
}
```

---

## Testing Checklist

- [ ] MemForge consolidation service starts and calls `services.register`
- [ ] MemForge retrieval service starts and calls `services.register`
- [ ] Both services appear in `hyphae_service_registry` table
- [ ] Services send heartbeats every 30 seconds
- [ ] Hyphae health check polls both services successfully
- [ ] Agent calls `services.discover` and gets MemForge back
- [ ] Agent calls `services.integrate` and gets integration config
- [ ] Agent can query memory through Hyphae gateway
- [ ] Circuit breaker opens if MemForge becomes unavailable
- [ ] Agent receives priority interrupt when circuit opens
- [ ] Agent switches to degraded mode (in-memory only)
- [ ] Agent automatically re-integrates when MemForge comes back online

---

## Environment Variables Required

```bash
# MemForge Services
MEMFORGE_ENCRYPTION_KEY=...
MEMFORGE_DB_URL=postgresql://...
MEMFORGE_RPC_URL=http://localhost:3003
MEMFORGE_RETRIEVAL_URL=http://localhost:3004

# Hyphae Integration
HYPHAE_RPC_URL=http://localhost:3102
HYPHAE_BEARER_TOKEN=memforge-token-2026

# Agent
AGENT_ID=flint  # or clio
```

---

## Expected Flow

```
1. MemForge starts
   ├─ consolidation service: POST /rpc { method: 'services.register' }
   └─ retrieval service: POST /rpc { method: 'services.register' }

2. Hyphae receives registrations
   ├─ Creates rows in hyphae_service_registry
   ├─ Starts health check polling
   └─ Responds with registration_token

3. MemForge sends heartbeats
   ├─ Every 30s: POST /rpc { method: 'services.heartbeat' }
   └─ Hyphae updates last_health_check, healthy=true

4. Agent starts (Flint/Clio)
   ├─ Calls: POST /rpc { method: 'services.discover' }
   ├─ Gets back: [memforge-consolidation, memforge-retrieval]
   ├─ Calls: POST /rpc { method: 'services.integrate' }
   └─ Gets back: integration_config with auth_token

5. Agent queries memory
   ├─ Calls: POST /rpc { method: 'services.call', service_id: 'memforge-retrieval' }
   ├─ Hyphae routes to MemForge (with circuit breaker)
   └─ Returns results

6. If MemForge goes down
   ├─ Hyphae health check fails 3x
   ├─ Service marked unhealthy (healthy=false)
   ├─ Circuit breaker opens
   ├─ Agent receives priority interrupt
   ├─ Agent falls back to in-memory mode
   └─ Auto-recovery when MemForge comes back
```

---

## Status

- ✅ Specification complete
- ⏳ Awaiting Phase 1-2 completion
- ⏳ Phase 3 (routing layer) in progress
- ⏳ Phase 4 implementation ready (after phase 1-2 done)

---

**Expected Timeline:**
- Phase 1-2: Complete in ~2-3 hours (sub-agents)
- Phase 3: Complete in ~1-2 hours (me)
- Phase 4: Complete in ~1-2 hours (me)
- **Total: ~4-6 hours from now (ready by morning)**
