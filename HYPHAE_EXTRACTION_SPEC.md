# Hyphae Federation Platform — Extraction & Release Spec

**Goal:** Create Hyphae as standalone agent federation/orchestration service  
**Repository:** `salishforge/hyphae` (new)  
**Type:** npm package + service + framework adapters

---

## Core Concept

Hyphae is the **federation layer** that:
- Manages service registry (what services exist, where, what they do)
- Routes messages between agents & services
- Translates protocols (AutoGen ↔ Tidepool ↔ OpenClaw)
- Enforces capabilities (who can do what)
- Logs all operations
- Scales services automatically

Agents don't know each other's platform. Hyphae abstracts it away.

---

## Repository Structure

```
salishforge/hyphae/
├── src/
│   ├── index.ts                         # Main export
│   ├── types.ts                         # Interfaces
│   │
│   ├── core/
│   │   ├── hyphae-server.ts             # Main server (NATS + HTTP)
│   │   ├── service-registry.ts          # Service discovery & registration
│   │   ├── message-router.ts            # Route messages between agents/services
│   │   ├── capability-enforcer.ts       # Verify permissions before action
│   │   ├── protocol-translator.ts       # Convert between protocol formats
│   │   └── load-balancer.ts             # Distribute across service instances
│   │
│   ├── services/
│   │   ├── service-interface.ts         # Abstract service (for extensions)
│   │   ├── builtin-services.ts          # Registry, health, metrics
│   │   └── external-service-client.ts   # Wrapper for external services (MemForge, etc.)
│   │
│   ├── api/
│   │   ├── nats-bridge.ts               # NATS pub/sub integration
│   │   ├── rest-api.ts                  # Express.js REST endpoints
│   │   ├── grpc-server.ts               # Optional: gRPC for performance
│   │   └── websocket-server.ts          # Optional: WebSocket for real-time
│   │
│   ├── adapters/
│   │   ├── autogen-adapter.ts           # AutoGen integration
│   │   ├── tidepool-adapter.ts          # Tidepool integration
│   │   ├── openclaw-adapter.ts          # OpenClaw integration
│   │   └── adapter-interface.ts         # Abstract adapter pattern
│   │
│   ├── security/
│   │   ├── nkeys-auth.ts                # NKeys authentication
│   │   ├── acl-enforcer.ts              # ACL policy enforcement
│   │   ├── rate-limiter.ts              # Token bucket rate limiting
│   │   └── secrets-manager.ts           # Credential management
│   │
│   ├── observability/
│   │   ├── audit-logger.ts              # Event logging (all operations)
│   │   ├── metrics-collector.ts         # Prometheus metrics
│   │   ├── tracing.ts                   # OpenTelemetry
│   │   └── health-check.ts              # Service health monitoring
│   │
│   └── utils/
│       ├── message-encoder.ts           # Serialize/deserialize
│       ├── errors.ts                    # Error types
│       └── config-loader.ts             # Configuration management
│
├── tests/
│   ├── unit/
│   │   ├── service-registry.test.ts
│   │   ├── message-router.test.ts
│   │   ├── acl-enforcer.test.ts
│   │   └── protocol-translator.test.ts
│   │
│   └── integration/
│       ├── autogen-integration.test.ts
│       ├── tidepool-integration.test.ts
│       ├── multi-platform.test.ts
│       └── federation-e2e.test.ts
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml (with NATS)
│   └── .dockerignore
│
├── examples/
│   ├── standalone-federation.ts         # Run Hyphae alone
│   ├── with-memforge.ts                 # Hyphae + MemForge
│   ├── autogen-agents.ts                # AutoGen agents using Hyphae
│   ├── mixed-platform.ts                # AutoGen + Tidepool + custom
│   └── service-composition.ts           # Multi-step workflows
│
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md                  # Detailed design
│   ├── API.md                           # REST/NATS API reference
│   ├── DEPLOYMENT.md                    # How to deploy
│   ├── ADAPTERS.md                      # How to add a framework adapter
│   ├── SECURITY.md                      # NKeys, ACLs, capabilities
│   └── CONTRIBUTING.md
│
├── adapters/                            # Could be separate repos
│   ├── autogen-hyphae/
│   ├── crewai-hyphae/
│   └── README.md
│
├── .github/
│   └── workflows/
│       ├── test.yml
│       ├── release.yml
│       └── docker-publish.yml
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── LICENSE
```

---

## Core API (TypeScript Interface)

```typescript
// src/index.ts

// Service Registry
export interface ServiceDescriptor {
  id: string;
  type: string;  // 'memory', 'consolidation', 'human', custom
  version: string;
  capabilities: string[];  // ['query', 'add', 'consolidate']
  endpoint: {
    type: 'nats' | 'http' | 'grpc';
    address: string;
  };
  health?: HealthStatus;
  metadata?: Record<string, any>;
}

export interface AgentDescriptor {
  id: string;
  platform: 'autogen' | 'tidepool' | 'openclaw' | 'custom';
  publicKey: string;  // NKeys public key
  capabilities: string[];  // What this agent can do
  metadata?: Record<string, any>;
}

// Message Routing
export interface HyphaeMessage {
  id: string;
  from: string;  // Agent or service ID
  to: string;    // Agent or service ID
  action: string;  // 'query', 'consolidate', 'request', etc.
  payload: any;
  timestamp: ISO8601;
}

export interface RoutingResult {
  delivered: boolean;
  timestamp: ISO8601;
  latency_ms: number;
  error?: string;
}

// Service Composition
export interface WorkflowStep {
  service: string;  // Service type to call
  action: string;
  input: any;
  onSuccess: WorkflowStep[];  // Next steps
  onError: WorkflowStep[];     // Error recovery
}

export interface Workflow {
  id: string;
  steps: WorkflowStep[];
  async execute(context: any): Promise<any>
}

// Main API
export class HyphaeServer {
  // Service Management
  async registerService(descriptor: ServiceDescriptor): Promise<void>
  async deregisterService(serviceId: string): Promise<void>
  async discoverServices(type: string): Promise<ServiceDescriptor[]>
  async getService(serviceId: string): Promise<ServiceDescriptor>
  
  // Agent Management
  async registerAgent(descriptor: AgentDescriptor): Promise<void>
  async queryAgents(filter?: any): Promise<AgentDescriptor[]>
  async getAgent(agentId: string): Promise<AgentDescriptor>
  
  // Messaging
  async send(message: HyphaeMessage): Promise<RoutingResult>
  async callService(serviceType: string, action: string, args: any): Promise<any>
  
  // Subscription (async iterator pattern)
  subscribe(topic: string): AsyncIterator<HyphaeMessage>
  
  // Workflow Composition
  async composeWorkflow(steps: WorkflowStep[]): Promise<Workflow>
  async executeWorkflow(workflow: Workflow, context: any): Promise<any>
  
  // Lifecycle
  async start(): Promise<void>
  async stop(): Promise<void>
  async health(): Promise<HealthStatus>
}

export function createHyphaeServer(config: HyphaeConfig): HyphaeServer
export const hyphaeServer: HyphaeServer
```

---

## REST API Contract

```
// Service Discovery
GET /services
  Output: ServiceDescriptor[]

GET /services/:type
  Output: ServiceDescriptor[] (filtered by type)

GET /services/:id
  Output: ServiceDescriptor

POST /services
  Input: ServiceDescriptor
  Output: { registered: true, id: string }

DELETE /services/:id
  Output: { deregistered: true }

// Agent Discovery
GET /agents
  Output: AgentDescriptor[]

GET /agents/:id
  Output: AgentDescriptor

POST /agents
  Input: AgentDescriptor
  Output: { registered: true, id: string }

// Messaging
POST /message
  Input: { from: string, to: string, action: string, payload: any }
  Output: RoutingResult

POST /services/:serviceType/:action
  Input: { payload: any }
  Output: Service response (varies by service)

// Workflows
POST /workflows/execute
  Input: { steps: WorkflowStep[], context: any }
  Output: Workflow execution result

// System
GET /health
  Output: { status: 'healthy' | 'degraded', services: { type: status } }

GET /metrics
  Output: Prometheus metrics

GET /audit?agentId=X&limit=100
  Output: AuditLogEntry[]
```

---

## NATS Topics Convention

```
// Agent-to-agent communication
sf.agent.{agentId}.inbox         (messages for this agent)
sf.agent.{agentId}.response      (responses from this agent)
sf.agent.{agentId}.heartbeat     (periodic status)

// Service communication
sf.service.{serviceType}.request  (requests to service)
sf.service.{serviceType}.response (responses from service)

// Broadcast
sf.broadcast.notification         (system notifications)
sf.broadcast.alert               (alerts/errors)

// Audit
sf.audit.{actionType}            (all audit events)
```

---

## Configuration

```typescript
// config.ts

export interface HyphaeConfig {
  // NATS
  nats: {
    servers?: string[];  // Default: ['nats://localhost:4222']
    auth?: {
      type: 'nkeys' | 'basic';
      credentials?: string;
    };
    tls?: {
      enabled: boolean;
      cert?: string;
      key?: string;
    };
  };
  
  // HTTP REST API
  api?: {
    port?: number;
    host?: string;
    corsOrigin?: string;
  };
  
  // Service Discovery
  discovery?: {
    heartbeatInterval_seconds?: number;
    deadServiceTimeout_seconds?: number;
  };
  
  // Security
  security?: {
    nkeys?: {
      enabled: boolean;
      seedPath?: string;
    };
    acls?: {
      enabled: boolean;
      policyPath?: string;
    };
    rateLimit?: {
      enabled: boolean;
      requestsPerMinute?: number;
    };
  };
  
  // Observability
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
  };
  
  audit?: {
    enabled: boolean;
    backend: 'postgresql' | 'nats' | 'file';
    postgresql?: {
      connectionString: string;
    };
  };
  
  metrics?: {
    enabled: boolean;
    port?: number;
  };
}
```

---

## Framework Adapters

### AutoGen Adapter Example

```typescript
// adapters/autogen-adapter.ts

import { Agent as AutoGenAgent } from 'autogen';
import { HyphaeClient } from '@salishforge/hyphae';

export class HyphaeAutoGenAgent extends AutoGenAgent {
  private hyphae: HyphaeClient;
  private agentId: string;
  
  constructor(hyphae: HyphaeClient, agentId: string, config: any) {
    super(config);
    this.hyphae = hyphae;
    this.agentId = agentId;
  }
  
  async send_message(to: string, message: string): Promise<any> {
    // Use Hyphae to send message
    return this.hyphae.send({
      from: this.agentId,
      to,
      action: 'message',
      payload: { text: message }
    });
  }
  
  async callService(serviceType: string, action: string, args: any): Promise<any> {
    // Use Hyphae to call service
    return this.hyphae.callService(serviceType, action, args);
  }
}

// Usage:
const hyphae = new HyphaeClient(config);
const agent = new HyphaeAutoGenAgent(hyphae, 'my-autogen-agent', {});
```

### Tidepool Adapter (Bridge)

```typescript
// adapters/tidepool-adapter.ts

// Tidepool runs in container with built-in NATS connection
// Adapter wraps Tidepool's container output, sends via Hyphae

export class HyphaeTidepoolBridge {
  async registerAgent(agentId: string): Promise<void> {
    // Register Tidepool instance with Hyphae
  }
  
  async handleMessage(msg: HyphaeMessage): Promise<void> {
    // Forward NATS message to Tidepool container
  }
  
  async reportStatus(agentId: string): Promise<void> {
    // Send heartbeat + metrics to Hyphae
  }
}
```

---

## Failure Modes & Recovery

```typescript
// Built-in resilience

class HyphaeServer {
  // Automatic service discovery
  // If service doesn't respond in 30s → marked dead
  // If service responds again → re-enabled
  
  // Load balancing
  // Multiple instances of same service → round-robin
  // Failed instance → skip to next
  
  // Circuit breaker
  // Service failing 3x → stop sending requests for 60s
  // After cooldown → try again
  
  // Audit everything
  // Every message routed (success or failure) → logged to PostgreSQL
  // Can replay history for debugging
}
```

---

## Deployment Options

### Option 1: Standalone (with NATS)

```yaml
# docker-compose.yml
version: '3.8'

services:
  nats:
    image: nats:latest
    ports:
      - "4222:4222"

  hyphae:
    build: .
    environment:
      NATS_SERVERS: nats://nats:4222
      API_PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - nats
```

### Option 2: npm Module

```bash
npm install @salishforge/hyphae
```

```typescript
import { createHyphaeServer } from '@salishforge/hyphae';

const hyphae = createHyphaeServer({
  nats: { servers: ['nats://localhost:4222'] },
  api: { port: 3000 }
});

await hyphae.start();
```

---

## Tests (Acceptance Criteria)

```typescript
describe('Hyphae Federation', () => {
  describe('Service Discovery', () => {
    // Register service → discoverable via API
    // Deregister service → no longer discoverable
    // Multiple instances → all listed
  });
  
  describe('Message Routing', () => {
    // Agent A sends to Agent B → B receives
    // Protocol translation works (AutoGen → Tidepool)
    // Failed agent → message queued, retry when ready
  });
  
  describe('Capability Enforcement', () => {
    // Agent without 'write' capability → request rejected
    // Agent with capability → request allowed
  });
  
  describe('Service Composition', () => {
    // Multi-step workflow executes correctly
    // Error in step 2 → step 3 error handler runs
  });
  
  describe('Multi-Platform', () => {
    // AutoGen agent communicates with Tidepool agent
    // Both use same MemForge backend
    // Coordination seamless
  });
  
  describe('Audit Logging', () => {
    // All messages logged with timestamp
    // Can query audit log by agent/service/time
    // Audit log complete (no missing messages)
  });
  
  describe('Resilience', () => {
    // Service down → circuit breaker engages
    // Service recovers → circuit breaker resets
    // NATS fails → reconnect works
  });
});
```

---

## Package.json

```json
{
  "name": "@salishforge/hyphae",
  "version": "0.1.0",
  "description": "Agent federation platform - service discovery, routing, and orchestration",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./adapters": {
      "import": "./dist/adapters/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "docker:build": "docker build -t salishforge/hyphae .",
    "docker:run": "docker-compose up"
  },
  "dependencies": {
    "nats": "^2.29.0",
    "express": "^5.0.0",
    "pino": "^9.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^4.0.0",
    "tsx": "^4.0.0"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/salishforge/hyphae"
  }
}
```

---

## README (Short Version)

```markdown
# Hyphae

Federation platform for AI agents and services.

Hyphae enables:
- **Service Discovery**: Services register themselves, agents find them
- **Message Routing**: Send messages between agents on different platforms
- **Protocol Translation**: AutoGen, Tidepool, OpenClaw agents work together
- **Capability Enforcement**: ACLs and security
- **Observability**: Audit all operations

## Quick Start

```bash
docker-compose up  # Starts NATS + Hyphae
```

```typescript
import { createHyphaeServer } from '@salishforge/hyphae';

const hyphae = createHyphaeServer({
  nats: { servers: ['nats://localhost:4222'] }
});

await hyphae.start();
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Adding Framework Adapters](docs/ADAPTERS.md)

## License

MIT
```

---

## GitHub Setup

When you create the repos:

1. Both repos have full MIT licenses
2. Both have `.github/workflows/` for CI/CD
3. Both are TypeScript (not JavaScript)
4. Both have comprehensive test coverage
5. Both have detailed documentation
6. Add to organization (salishforge)

---

## Timeline to First Working Version

These are detailed specs, not estimates. Implementation order:

1. **MemForge first** (less dependencies)
   - Extract from Tidepool
   - Test standalone
   - Deploy as service

2. **Hyphae second** (depends on understanding MemForge)
   - Build core (registry, router)
   - Add NATS integration
   - Add REST API

3. **Adapters third** (plug in after core works)
   - AutoGen adapter
   - Tidepool bridge
   - More as needed

Once both exist as separate repos, can integrate with dashboard test.
