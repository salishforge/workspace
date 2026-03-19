# Hyphae Universal Service API

**Unified abstraction layer:** Agents access all external services through a single, standard Hyphae API. Hyphae determines which backend to use.

## Core Concept

**Before:**
```typescript
// Agents need different code for different backends
const onepassword = new OnePasswordClient(config);
const apiKey = await onepassword.getSecret('key');

// Need different code for Azure
const azure = new AzureKeyVaultClient(config);
const apiKey = await azure.getSecret('key');

// Need different code for AWS
const aws = new AWSSecretsClient(config);
const apiKey = await aws.getSecret('key');
```

**After:**
```typescript
// Agents use ONE interface for all backends
const hyphae = new HyphaeServiceClient(url, agentId);
const apiKey = await hyphae.getSecret('key');

// Hyphae routes to: core vault, 1Password, Azure, or AWS
// Agent doesn't care which
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Agent (Flint, Clio, Sub-agents)               │
│  ┌──────────────────────────────────────────┐  │
│  │  HyphaeServiceClient                     │  │
│  │  - getSecret(name)                       │  │
│  │  - query(sql)                            │  │
│  │  - put(key, data)                        │  │
│  │  - http(method, path)                    │  │
│  └──────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────┘
                     │
                     │ Standard RPC call:
                     │ {service, operation, params}
                     │
         ┌───────────▼──────────────┐
         │   Hyphae Service API      │
         │   (Universal Gateway)     │
         │                           │
         │  1. Verify agent (active) │
         │  2. Check permissions     │
         │  3. Determine backend     │
         │  4. Route request         │
         │  5. Cache results         │
         │  6. Audit log             │
         └───────────┬──────────────┘
                     │
        ┌────────────┼────────────┬────────────┬────────────┐
        │            │            │            │            │
   ┌────▼──┐ ┌──────▼──┐ ┌──────▼──┐ ┌──────▼──┐ ┌───────▼─┐
   │ Core  │ │1Password│ │  Azure  │ │   AWS   │ │PostgreSQL
   │ Vault │ │ Vault   │ │Key Vault│ │ Secrets │ │Database
   │       │ │         │ │         │ │ Manager │ │
   └───────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
   (Built-in)(Team     )(Azure-native)(AWS-native)(Database)
             Vault)
```

## Service Model

Every service implements the same interface:

```typescript
interface IServiceConnector {
  name: string;                    // 'core-vault', '1password', 'azure-keyvault'
  type: string;                    // 'secrets', 'database', 'storage', 'http'
  isAvailable(): Promise<boolean>; // Health check
  execute(operation, params): Promise<any>; // Execute operation
  supportsOperation(operation): boolean; // Can this connector do it?
}
```

## Standard Request/Response

**All agents use this (same for all services):**

```typescript
// REQUEST (agent → Hyphae)
{
  sourceAgent: 'flint',
  service: 'secrets',      // Which service type
  operation: 'get',        // Which operation
  params: {                // Operation-specific params
    name: 'gemini.api_key',
    service: 'system'
  },
  context: {
    traceId: '...',
    timeout: 30000,
    retryPolicy: 'exponential'
  }
}

// RESPONSE (Hyphae → agent)
{
  success: true,
  result: 'sk-...',        // The actual value
  metadata: {
    sourceBackend: '1password',  // Which backend served this
    latency: 245,                // How long it took
    backendStatus: 'success'
  },
  traceId: '...'
}
```

**Error Response:**
```typescript
{
  success: false,
  error: 'Connector 1password is not available',
  traceId: '...',
  metadata: {
    sourceBackend: 'gateway',
    latency: 5
  }
}
```

## Built-in Services

### secrets
```typescript
// Get secret
await hyphae.call('secrets', 'get', {
  name: 'database.password',
  service: 'system'
});

// Set secret
await hyphae.call('secrets', 'set', {
  name: 'api.key',
  value: 'sk-...',
  service: 'flint',
  expiresInHours: 24
});

// List secrets
await hyphae.call('secrets', 'list', {
  service: 'system'
});

// Delete secret
await hyphae.call('secrets', 'delete', {
  name: 'expired.key',
  service: 'system'
});
```

### database
```typescript
// Query
await hyphae.call('database', 'query', {
  sql: 'SELECT * FROM users WHERE id = $1',
  values: [123]
});

// Execute
await hyphae.call('database', 'execute', {
  sql: 'UPDATE users SET status = $1 WHERE id = $2',
  values: ['active', 123]
});

// Transaction
await hyphae.call('database', 'transaction', {
  operations: [
    { sql: 'INSERT INTO logs ...', values: [...] },
    { sql: 'UPDATE status ...', values: [...] }
  ]
});
```

### storage
```typescript
// Get object
await hyphae.call('storage', 'get', {
  key: 'deployments/latest.json'
});

// Put object
await hyphae.call('storage', 'put', {
  key: 'deployments/v1.0.0.json',
  data: { version: '1.0.0', ... }
});

// Delete object
await hyphae.call('storage', 'delete', {
  key: 'old-deployment.json'
});

// List objects
await hyphae.call('storage', 'list', {
  prefix: 'deployments/'
});
```

### http (generic)
```typescript
// Make HTTP request through Hyphae
await hyphae.call('http', 'request', {
  method: 'POST',
  path: '/chat.postMessage',
  body: { channel: '#alerts', text: '...' },
  query: { ts: '123456' },
  headers: { 'X-Custom': 'value' }
});
```

## Routing & Backend Selection

### Primary Routing
```typescript
// Configuration
const secretsGetRoute = {
  service: 'secrets',
  operation: 'get',
  primaryConnector: 'core-vault',     // Try this first
  fallbackConnectors: [               // If primary fails
    '1password',
    'azure-keyvault',
    'aws-secrets'
  ],
  retryPolicy: {
    maxAttempts: 3,
    backoffMs: 1000
  },
  caching: {
    enabled: true,
    ttl: 3600  // 1 hour
  }
};
```

### Dynamic Routing
```typescript
// Route based on request parameters
const route = {
  service: 'secrets',
  operation: 'get',
  primaryConnector: 'core-vault',
  routingRules: [
    {
      condition: (params) => params.external === true,
      connector: '1password'
    },
    {
      condition: (params) => params.environment === 'production',
      connector: 'aws-secrets'
    },
    {
      condition: (params) => params.region === 'azure-east',
      connector: 'azure-keyvault'
    }
  ]
};

// Request with routing hint
await hyphae.call('secrets', 'get', {
  name: 'api.key',
  external: true  // Routes to 1password
});
```

## Connector Types

### Built-in Connectors

| Connector | Type | Operations | Best For |
|-----------|------|-----------|----------|
| **core-vault** | secrets | get, set, list, delete | Internal secrets |
| **1password** | secrets | get, set, list | Team vaults, BiDi |
| **azure-keyvault** | secrets | get, set, list | Azure ecosystems |
| **aws-secrets** | secrets | get, set, list | AWS ecosystems |
| **postgresql** | database | query, execute, transaction | Relational data |
| **s3-storage** | storage | get, put, delete, list | File/object storage |
| **http-api** | http | request | Any REST API |

### Custom Connectors

Implement `IServiceConnector`:

```typescript
export class CustomConnector implements IServiceConnector {
  name = 'my-service';
  type = 'custom';

  async isAvailable(): Promise<boolean> {
    // Health check
    return true;
  }

  async execute(operation: string, params: Record<string, any>): Promise<any> {
    switch (operation) {
      case 'my_operation':
        return await this.doSomething(params);
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }

  supportsOperation(operation: string): boolean {
    return ['my_operation', 'my_other_op'].includes(operation);
  }

  private async doSomething(params: any): Promise<any> {
    // Your implementation
  }
}

// Register
serviceAPI.registerConnector(new CustomConnector());
```

## Usage Examples

### Example 1: Agent doesn't need to know backend

```typescript
// Flint gets secret (could be from core vault or 1Password)
class FlintAgent {
  async initialize() {
    const hyphae = new HyphaeServiceClient(
      'http://localhost:3100',
      'flint'
    );

    // Same call regardless of backend
    const apiKey = await hyphae.getSecret('gemini.api_key');

    // Hyphae determines:
    // 1. Is Flint active? Check.
    // 2. Does Flint have permission? Check.
    // 3. Is 'gemini.api_key' in core vault? YES → use core vault
    //    (or could be routed to 1Password if configured)
    // 4. Cache for 1 hour
    // 5. Return result
    // 6. Audit log: flint accessed gemini.api_key via core-vault
  }
}
```

### Example 2: Same agent code, different backends

```typescript
// Flint uses same code
// Hyphae routes to different backends based on config

// In development
// Primary: core-vault
// Fallback: (none)

// In staging
// Primary: core-vault
// Fallback: azure-keyvault (for testing)

// In production
// Primary: 1password (team vaults)
// Fallback: core-vault (if 1password down)

// Agent code stays identical
const secret = await hyphae.getSecret('api.key');
```

### Example 3: Sub-agent database access

```typescript
class TaskProcessor {
  async process() {
    const hyphae = new HyphaeServiceClient(
      'http://localhost:3100',
      'task-processor-1'
    );

    // Query database
    const tasks = await hyphae.query(
      'SELECT * FROM tasks WHERE status = $1',
      ['pending']
    );

    // Update results
    for (const task of tasks) {
      await hyphae.query(
        'UPDATE tasks SET status = $1, completed_at = NOW() WHERE id = $2',
        ['completed', task.id]
      );
    }
  }
}

// Hyphae:
// 1. Verifies task-processor-1 is active
// 2. Checks it has database.query permission
// 3. Routes to postgresql connector
// 4. Executes query with timeout
// 5. Returns results
// 6. Audits all access
```

## Capability Discovery

Agents can discover what's available:

```typescript
const hyphae = new HyphaeServiceClient(url, 'flint');

// What services are available?
const services = await hyphae.getAvailableServices();
console.log(services);
// Output:
// [
//   { service: 'secrets', operation: 'get', primaryConnector: 'core-vault', ... },
//   { service: 'secrets', operation: 'set', primaryConnector: 'core-vault', ... },
//   { service: 'database', operation: 'query', primaryConnector: 'postgresql', ... },
//   { service: 'storage', operation: 'get', primaryConnector: 's3-storage', ... },
//   ...
// ]

// What's the service status?
const status = await hyphae.getServiceStatus();
console.log(status);
// Output:
// {
//   connectors: {
//     'core-vault': { available: true, type: 'secrets' },
//     '1password': { available: true, type: 'secrets' },
//     'azure-keyvault': { available: false, type: 'secrets' },
//     'postgresql': { available: true, type: 'database' },
//     ...
//   }
// }
```

## Permissions & Isolation

Each agent has service permissions:

```sql
-- Clio can access all services
INSERT INTO hyphae_service_access_policies
  (agent_id, service_name, permission)
VALUES ('clio', 'secrets', 'read');

-- Sub-agent can only query (not execute/update)
INSERT INTO hyphae_service_access_policies
  (agent_id, service_name, permission)
VALUES ('task-processor-1', 'database', 'query');

-- Time-limited access for audit
INSERT INTO hyphae_service_access_policies
  (agent_id, service_name, permission, expires_at)
VALUES ('temp-agent', 'secrets', 'read', NOW() + INTERVAL '24 hours');
```

## Audit Trail

All service access is logged:

```sql
SELECT
  source_agent,
  service_name,
  operation,
  connector_used,
  status,
  latency_ms,
  requested_at
FROM hyphae_service_requests
WHERE source_agent = 'flint'
ORDER BY requested_at DESC;

-- Output:
-- flint    secrets    get    core-vault     success  12   2026-03-19 10:05:30
-- flint    secrets    set    core-vault     success  8    2026-03-19 10:05:45
-- flint    database   query  postgresql     success  45   2026-03-19 10:06:01
-- flint    storage    put    s3-storage     success  234  2026-03-19 10:06:15
```

## Caching Strategy

Hyphae caches results per route:

```typescript
// Secrets cache 1 hour
// Database queries: no cache (always fresh)
// Storage gets: 5 minute cache
// HTTP requests: 0 cache (always fresh)

// Cache key = sourceAgent + service + operation + params hash

// If cached and not expired → return immediately
// If cache miss → call backend, cache result, return
// Cache auto-expires after TTL
```

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Cache hit | <50ms | Hash lookup + return |
| Core vault access | 100-500ms | PostgreSQL + decryption |
| External service | 300-2000ms | Depends on backend (network, auth) |
| Gateway overhead | 10-50ms | Verification, routing, logging |
| Fallback attempt | +300-2000ms | Per fallback tried |

**Optimization:**
- Caching dramatically reduces database round-trips
- Retry policy with exponential backoff prevents cascade failures
- Parallel fallback attempts (future optimization)

## Error Handling

```typescript
// Primary connector fails, fallback succeeds
try {
  const secret = await hyphae.getSecret('key');
  // If primary fails, Hyphae tries fallbacks
  // Agent doesn't need to know about fallbacks
} catch (error) {
  // All backends failed
  console.error('All secret backends unavailable:', error);
}
```

## Next Steps

1. **Integration:** Add to Hyphae Core RPC handlers
2. **Expand Connectors:** Implement specific SDKs (currently stubs)
3. **Advanced Routing:** Load balancing, circuit breakers
4. **Observability:** Distributed tracing, metrics
5. **Security:** mTLS between Hyphae and external services

---

**Version:** 1.0
**Status:** Architecture Complete, Ready for Implementation
**Last Updated:** 2026-03-19
