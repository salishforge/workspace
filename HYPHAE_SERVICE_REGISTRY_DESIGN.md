# Hyphae Service Registry & Auto-Integration Design

**Objective:** Enable services (like MemForge) to self-register with Hyphae, advertise capabilities, and have agents auto-discover and transparently use them without explicit configuration.

**Pattern:** Service Mesh with Intelligent Routing

---

## Architecture

### 1. Service Registry (In Hyphae Core)

**Table: `hyphae_service_registry`**
```sql
CREATE TABLE hyphae_service_registry (
  service_id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  service_type TEXT NOT NULL, -- 'memory', 'compute', 'storage', 'analytics'
  version TEXT NOT NULL,
  status TEXT NOT NULL, -- 'registering', 'ready', 'degraded', 'offline'
  
  -- Service Capabilities (JSON array of capability objects)
  capabilities JSONB NOT NULL,
  -- Example: [
  --   { id: "query", method: "memory.query", requires_auth: true },
  --   { id: "store", method: "memory.store", requires_auth: true }
  -- ]
  
  -- Service Metadata
  api_endpoint TEXT NOT NULL,
  api_protocol TEXT NOT NULL, -- 'json-rpc', 'http', 'grpc'
  api_version TEXT,
  
  -- Requirements & Dependencies
  requires JSONB DEFAULT '[]',
  -- Example: [
  --   { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
  --   { type: 'database', connection_string: '...' }
  -- ]
  
  -- Health & Metrics
  health_check_url TEXT,
  health_check_interval INT DEFAULT 30,
  last_health_check TIMESTAMPTZ,
  healthy BOOLEAN DEFAULT false,
  consecutive_failures INT DEFAULT 0,
  
  -- Registration Metadata
  registered_at TIMESTAMPTZ DEFAULT now(),
  registered_by TEXT, -- agent_id or 'system'
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '24 hours',
  
  -- Agent Integration Hooks
  on_register_hook TEXT, -- JavaScript to run when service registered
  on_agent_discover_hook TEXT, -- Notify service when agent discovers it
  
  UNIQUE(service_name, version)
);

CREATE INDEX idx_service_status ON hyphae_service_registry(status, service_type);
CREATE INDEX idx_service_health ON hyphae_service_registry(healthy, last_health_check DESC);
```

---

### 2. Service Announcement Protocol

**RPC Methods (Hyphae Core exposes):**

#### `services.register` — Service announces itself
```json
{
  "jsonrpc": "2.0",
  "method": "services.register",
  "params": {
    "service_id": "memforge-consolidation",
    "service_name": "MemForge Consolidation",
    "service_type": "memory",
    "version": "1.0.0",
    "api_endpoint": "http://localhost:3003",
    "api_protocol": "json-rpc",
    "capabilities": [
      {
        "id": "consolidate",
        "method": "consolidation.run",
        "description": "Run sleep-cycle consolidation",
        "requires_auth": false
      },
      {
        "id": "status",
        "method": "consolidation.status",
        "description": "Get consolidation status"
      }
    ],
    "requires": [
      { "type": "encryption_key", "env_var": "MEMFORGE_ENCRYPTION_KEY" },
      { "type": "database", "connection_string_env": "MEMFORGE_DB_URL" }
    ],
    "health_check_url": "http://localhost:3003/health"
  },
  "id": 1
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "service_id": "memforge-consolidation",
    "registered": true,
    "registration_token": "service-token-uuid",
    "expires_at": "2026-03-21T01:56:00Z",
    "heartbeat_interval": 30,
    "next_heartbeat_by": "2026-03-20T02:26:00Z"
  },
  "id": 1
}
```

#### `services.heartbeat` — Service stays alive
```json
{
  "method": "services.heartbeat",
  "params": {
    "service_id": "memforge-consolidation",
    "registration_token": "...",
    "status": "ready",
    "metrics": {
      "uptime_seconds": 3600,
      "requests_handled": 1500,
      "current_memory_mb": 256
    }
  }
}
```

#### `services.deregister` — Service goes offline
```json
{
  "method": "services.deregister",
  "params": {
    "service_id": "memforge-consolidation",
    "registration_token": "...",
    "reason": "maintenance"
  }
}
```

---

### 3. Agent Discovery & Integration

**RPC Methods (Agents call Hyphae):**

#### `services.discover` — Agent asks "what services available?"
```json
{
  "method": "services.discover",
  "params": {
    "agent_id": "flint",
    "filters": {
      "service_type": "memory",
      "healthy": true,
      "required_capabilities": ["query", "store"]
    }
  }
}
```

**Response:**
```json
{
  "result": {
    "services": [
      {
        "service_id": "memforge",
        "service_name": "MemForge Tiered Memory",
        "service_type": "memory",
        "api_endpoint": "http://localhost:3003",
        "api_protocol": "json-rpc",
        "capabilities": [
          { "id": "query", "method": "memory.query" },
          { "id": "store", "method": "memory.store" },
          { "id": "hotTier", "method": "memory.getHotTier" }
        ],
        "health_status": "healthy",
        "latency_ms": 45,
        "availability_percent": 99.8
      }
    ]
  }
}
```

#### `services.integrate` — Agent registers to use a service
```json
{
  "method": "services.integrate",
  "params": {
    "agent_id": "flint",
    "service_id": "memforge",
    "integration_type": "direct", // or 'routed' (via Hyphae)
    "capabilities_needed": ["query", "store"]
  }
}
```

**Response:**
```json
{
  "result": {
    "integrated": true,
    "integration_config": {
      "service_endpoint": "http://localhost:3003",
      "agent_authorization": "Bearer flint-memforge-token",
      "routing_via_hyphae": false,
      "caching_enabled": true,
      "retry_policy": "exponential_backoff"
    },
    "next_heartbeat": "2026-03-20T02:00:00Z"
  }
}
```

---

### 4. Transparent Routing (Service Gateway)

When agents use Hyphae routing (instead of direct), Hyphae handles:

```typescript
async function routeToService(agentId: string, serviceName: string, method: string, params: any) {
  // 1. Verify agent can access service
  const service = await registry.getService(serviceName);
  if (!service || !service.healthy) {
    throw new Error(`Service ${serviceName} unavailable`);
  }

  // 2. Verify agent has capability
  const integration = await registry.getIntegration(agentId, serviceName);
  if (!integration || !integration.hasCapability(method)) {
    throw new Error(`Agent not authorized for ${serviceName}.${method}`);
  }

  // 3. Add request metadata (auth, tracing, retry logic)
  const request = {
    method,
    params,
    _meta: {
      agent_id: agentId,
      request_id: uuid(),
      timestamp: now(),
      routed_via_hyphae: true
    }
  };

  // 4. Forward to service (with circuit breaker)
  const circuit = getCircuitBreaker(serviceName);
  try {
    const response = await callPlugin(service.api_endpoint, request, 5000);
    circuit.recordSuccess();
    auditLog('service_call_success', agentId, serviceName, { method });
    return response;
  } catch (error) {
    circuit.recordFailure();
    auditLog('service_call_failure', agentId, serviceName, { method, error: error.message });
    
    if (circuit.shouldOpen()) {
      sendPriorityInterrupt(agentId, serviceName); // Service unavailable
    }
    
    throw error;
  }
}
```

---

### 5. MemForge Integration (First Example)

**MemForge announces itself on startup:**

```javascript
// In consolidation_agent.js
async function registerWithHyphae() {
  const registration = {
    service_id: 'memforge-consolidation',
    service_name: 'MemForge Consolidation',
    service_type: 'memory',
    version: '1.0.0',
    api_endpoint: process.env.MEMFORGE_RPC_URL || 'http://localhost:3003',
    api_protocol: 'json-rpc',
    capabilities: [
      { id: 'consolidate', method: 'consolidation.run', description: 'Run sleep cycle' },
      { id: 'status', method: 'consolidation.status', description: 'Get status' },
      { id: 'lastRun', method: 'consolidation.lastRun', description: 'Get last run time' }
    ],
    requires: [
      { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
      { type: 'database', connection_string_env: 'MEMFORGE_DB_URL' }
    ],
    health_check_url: 'http://localhost:3003/health'
  };

  const response = await fetchHyphaeRPC('services.register', registration);
  global.HYPHAE_REGISTRATION_TOKEN = response.registration_token;
  
  // Start heartbeat
  setInterval(async () => {
    await fetchHyphaeRPC('services.heartbeat', {
      service_id: 'memforge-consolidation',
      registration_token: global.HYPHAE_REGISTRATION_TOKEN,
      status: 'ready',
      metrics: {
        uptime_seconds: process.uptime(),
        consolidations_run: global.CONSOLIDATION_COUNT,
        last_run_duration_ms: global.LAST_RUN_DURATION
      }
    });
  }, 30000); // Every 30 seconds
}
```

**Retrieval service registers separately:**

```javascript
// In memory_retrieval.js
async function registerWithHyphae() {
  const registration = {
    service_id: 'memforge-retrieval',
    service_name: 'MemForge Retrieval',
    service_type: 'memory',
    version: '1.0.0',
    api_endpoint: process.env.MEMFORGE_RETRIEVAL_URL || 'http://localhost:3004',
    api_protocol: 'http',
    capabilities: [
      { id: 'queryByText', method: 'GET /query', description: 'Full-text search' },
      { id: 'getHotTier', method: 'GET /hot-tier', description: 'Get hot memory' },
      { id: 'getWarmTier', method: 'GET /warm-tier', description: 'Get warm memory' },
      { id: 'getColdTier', method: 'GET /cold-tier', description: 'Get cold archive' },
      { id: 'cacheStats', method: 'GET /cache-stats', description: 'Cache performance' }
    ],
    requires: [
      { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
      { type: 'database', connection_string_env: 'MEMFORGE_DB_URL' }
    ],
    health_check_url: 'http://localhost:3004/health'
  };

  // Same registration flow
  const response = await fetchHyphaeRPC('services.register', registration);
  global.HYPHAE_REGISTRATION_TOKEN = response.registration_token;
  startHeartbeat();
}
```

**Agents auto-discover and integrate:**

```javascript
// In Flint agent startup
async function initializeMemorySystem() {
  // Discover available memory services
  const services = await callHyphaeRPC('services.discover', {
    agent_id: 'flint',
    filters: {
      service_type: 'memory',
      healthy: true,
      required_capabilities: ['queryByText', 'getHotTier']
    }
  });

  if (services.length === 0) {
    console.warn('No memory service available, using in-memory only');
    return;
  }

  const memforgeService = services[0]; // First healthy service

  // Integrate with the service
  const integration = await callHyphaeRPC('services.integrate', {
    agent_id: 'flint',
    service_id: memforgeService.service_id,
    integration_type: 'routed', // Route through Hyphae for security
    capabilities_needed: ['queryByText', 'getHotTier']
  });

  // Now all memory queries automatically go through Hyphae → MemForge
  global.MEMORY_SERVICE = {
    endpoint: integration.integration_config.service_endpoint,
    auth_token: integration.integration_config.agent_authorization,
    cached: integration.integration_config.caching_enabled
  };

  console.log('✓ Connected to MemForge via Hyphae');
}
```

---

## Implementation Phases

### Phase 1: Hyphae Service Registry (3-4 hours)
1. Add `hyphae_service_registry` table
2. Implement `services.register` RPC method
3. Implement `services.heartbeat` RPC method
4. Implement `services.deregister` RPC method
5. Add health check polling
6. Add service discovery query

### Phase 2: Agent Discovery & Integration (2-3 hours)
1. Implement `services.discover` RPC method
2. Implement `services.integrate` RPC method
3. Add integration persistence table
4. Add auto-retry on service unavailability

### Phase 3: Transparent Routing (2-3 hours)
1. Add service gateway in Hyphae router
2. Route service calls through circuit breaker
3. Add request metadata (tracing, auth)
4. Add priority interrupt for service failures

### Phase 4: MemForge Integration (2 hours)
1. Update consolidation_agent.js to register
2. Update memory_retrieval.js to register
3. Create MemForge RPC endpoints
4. Test agent discovery + auto-integration

---

## Benefits

✅ **Services self-describe** — No hardcoded agent configs  
✅ **Agents auto-discover** — No restarts needed when services come online  
✅ **Transparent routing** — Agents don't need to know service URLs  
✅ **Security** — All routing goes through Hyphae (one auth point)  
✅ **Resilience** — Circuit breaker per service  
✅ **Scalability** — Services can be added/removed dynamically  
✅ **Extensibility** — Any new service uses same protocol  
✅ **Observability** — Full audit trail, metrics, health checks  

---

## Timeline

- **Tonight (Option 1):** All 4 phases (9-12 hours, autonomous)
- **Tonight → Tomorrow (Option 2):** Phases 1-2 (5-7 hours), defer routing + MemForge to tomorrow
- **Tomorrow (Option 3):** All phases after morning sleep

---

## Next: Your Decision

Should I:
1. **Execute all 4 phases tonight** (full service mesh)
2. **Do phases 1-2 tonight, 3-4 tomorrow** (incremental)
3. **Wait for morning** (fresh start, lower risk)

Recommend Option 2 — Get registry + discovery working tonight, add routing + MemForge in morning when fresh.

Your call. 🚀
