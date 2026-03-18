# Hyphae: Agent Federation Platform

**Date:** 2026-03-17  
**Concept:** Central orchestration layer that abstracts platforms (AutoGen, Tidepool, OpenClaw) and services (MemForge, etc.) into a unified network

---

## The Insight

Instead of:
```
AutoGen instance → Standalone MemForge
Tidepool instance → Standalone MemForge
OpenClaw instance → Standalone MemForge

(All separately configured, no coordination)
```

Build:
```
┌─────────────────────────────────────┐
│         Hyphae Federation Layer      │
│  (Service Registry + Orchestration)  │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────┬──────────┬───────┐ │
│  │ MemForge    │ Hyphae   │ Custom│ │
│  │ (Memory)    │ Core     │ Svc   │ │
│  │ Service     │ (Comms)  │       │ │
│  └─────────────┴──────────┴───────┘ │
│         (Service Bus)                │
├─────────────────────────────────────┤
│  Clients:                           │
│  • AutoGen agents                   │
│  • Tidepool agents                  │
│  • OpenClaw assistants              │
│  • Custom frameworks                │
│  • Human users (via API)            │
└─────────────────────────────────────┘
```

**What changes:**
- Hyphae becomes a **central platform**, not just a sidecar service
- Services register with Hyphae
- Clients connect to Hyphae (not directly to services)
- Hyphae handles service discovery, routing, composition
- Heterogeneous frameworks appear as a unified network

---

## Architecture: Three Layers

### Layer 1: Federation Core (Hyphae)
```typescript
// What Hyphae provides:
class HyphaeCore {
  // Service Registry
  registerService(serviceId, serviceType, endpoint, capabilities)
  deregisterService(serviceId)
  discoverService(serviceType): Service[]
  
  // Message Routing
  send(fromAgent, toAgent, message): Promise<Response>
  broadcast(topic, message): Promise<void>
  subscribe(topic, handler): Subscription
  
  // Service Abstraction
  callService(serviceType, method, args): Promise<Result>
  // E.g., callService('memory', 'query', {agent, query})
  //   → Routes to appropriate MemForge instance
  
  // Agent Registry
  registerAgent(agentId, platform, publicKey, capabilities)
  queryAgents(filter): Agent[]
  
  // Audit & Security
  logEvent(actor, action, resource, result)
  enforceCapability(actor, action, resource): boolean
  
  // Service Composition
  composeWorkflow(steps): ComposedWorkflow
  // E.g., query MemForge → transform → send to AutoGen → consolidate
}
```

**Responsibilities:**
- ✅ Service registry (what services exist)
- ✅ Service discovery (where is X service)
- ✅ Routing (send message from A to B)
- ✅ Protocol translation (AutoGen → Tidepool → OpenClaw)
- ✅ Load balancing (if multiple instances exist)
- ✅ Composition (multi-service workflows)
- ✅ Audit logging (all operations)
- ✅ Capability enforcement (who can do what)

### Layer 2: Pluggable Services
```typescript
// Services register with Hyphae

// MemForge Service
class MemForgeService implements HyphaeService {
  serviceType = 'memory'
  capabilities = ['query', 'add', 'consolidate', 'clear']
  
  async query(agentId, searchText) { ... }
  async add(agentId, event) { ... }
  async consolidate(agentId) { ... }
}

// Custom Consolidation Service
class ConsolidationService implements HyphaeService {
  serviceType = 'consolidation'
  capabilities = ['consolidate', 'summarize', 'archive']
  
  async consolidate(agentId, events) { ... }
}

// User Proxy Service (for human feedback)
class UserProxyService implements HyphaeService {
  serviceType = 'human'
  capabilities = ['request_approval', 'ask_question']
  
  async requestApproval(agentId, action) { ... }
}

// Third-party services
class SlackNotificationService implements HyphaeService { ... }
class GitHubActionService implements HyphaeService { ... }
```

**Key pattern:**
- Services implement a standard interface
- Hyphae routes requests based on capability
- Clients never know which service actually handles the request

### Layer 3: Client Adapters
```typescript
// AutoGen Client
class HyphaeAutoGenAdapter {
  constructor(private hyphae: HyphaeClient, private agentId: string) {}
  
  // Implements AutoGen Memory interface
  async add(content): Promise<void> {
    await this.hyphae.callService('memory', 'add', {
      agentId: this.agentId,
      content
    })
  }
  
  // Implements AutoGen Agent interface
  async sendMessage(to: string, message: string): Promise<Response> {
    return this.hyphae.send(this.agentId, to, message)
  }
}

// Tidepool Client
class HyphaeTidepoolAdapter {
  // Uses MemForge + NATS through Hyphae
  async getMemory(agentId) {
    return this.hyphae.callService('memory', 'query', {agentId})
  }
}

// OpenClaw Client
class HyphaeOpenClawAdapter { ... }

// Raw HTTP Client (for external systems)
// POST /hyphae/agents/{agentId}/message
// POST /hyphae/services/memory/query
// GET /hyphae/services/discovery
```

---

## Use Cases Enabled by Federation

### 1. **Multi-Platform Agent Teams**
```
Team = [
  AutoGen analyst (via Hyphae),
  Tidepool researcher (via Hyphae),
  OpenClaw coordinator (via Hyphae)
]

// All agents use same MemForge instance through Hyphae
// All coordinate via Hyphae message bus
// Single audit log for entire team
```

### 2. **Service Composition Workflows**
```
Workflow:
1. Agent A sends message to Agent B
   → Hyphae routes based on Agent B's platform
2. Agent B calls Memory Service (MemForge)
   → Hyphae routes to appropriate MemForge instance
3. Agent B needs consolidation
   → Hyphae finds ConsolidationService, calls it
4. Need human approval
   → Hyphae calls UserProxyService
5. All logged in Hyphae audit
   → Single source of truth for entire workflow
```

### 3. **Scaling Services**
```
// If MemForge becomes a bottleneck:
hyphae.registerService('memforge-2', 'memory', ...)

// Hyphae automatically load-balances
// Clients don't know or care which instance handles their query
```

### 4. **Platform Abstraction**
```typescript
// Client doesn't need to know platform details
const agent = hyphae.getAgent('researcher-01')
// Agent might be AutoGen, Tidepool, or CrewAI
// Client sends messages the same way regardless

await hyphae.send(myAgentId, agent.id, 'analyze this data')
// Hyphae handles protocol translation
```

### 5. **Gradual Migration**
```
// Start with Tidepool
// Add AutoGen agents later
// All work seamlessly together
// Eventually migrate Tidepool agents to AutoGen
// Hyphae handles the transition
```

---

## Implementation Roadmap

### Phase 1: Core Federation (Weeks 1-3)

1. **Service Registry**
   - [ ] Service registration/deregistration
   - [ ] Service discovery API
   - [ ] Health checking (is service alive?)
   - [ ] Capability registry (what can each service do)

2. **Routing & Discovery**
   - [ ] Message routing (A → B via platform adapter)
   - [ ] Service lookup (find X service)
   - [ ] Load balancing (round-robin, least-busy, etc.)
   - [ ] Fallback handling (service down → try replica)

3. **Security & Audit**
   - [ ] Agent authentication (NKeys or similar)
   - [ ] Capability enforcement (agent X can call service Y)
   - [ ] Audit logging (PostgreSQL)
   - [ ] Rate limiting (per-agent)

### Phase 2: Service Integration (Weeks 4-5)

1. **MemForge Integration**
   - [ ] MemForge registers with Hyphae
   - [ ] Query routing through Hyphae
   - [ ] Multi-instance load balancing

2. **Platform Adapters**
   - [ ] AutoGen → Hyphae connector
   - [ ] Tidepool → Hyphae connector
   - [ ] OpenClaw → Hyphae connector

3. **Service Composition**
   - [ ] Workflow definition API
   - [ ] Multi-step service calls
   - [ ] Transaction semantics (ACID where needed)

### Phase 3: Advanced Features (Weeks 6+)

1. **Analytics & Observability**
   - [ ] Service metrics (latency, throughput)
   - [ ] Agent performance tracking
   - [ ] Bottleneck identification

2. **Failover & Resilience**
   - [ ] Service replica discovery
   - [ ] Automatic failover
   - [ ] Circuit breakers

3. **Federation Across Networks**
   - [ ] Multi-datacenter support
   - [ ] Encrypted tunneling between Hyphae instances
   - [ ] Geographic distribution of services

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Hyphae Federation                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │         Hyphae Core (NATS + Routing)               │ │
│  │  • Service Registry                               │ │
│  │  • Message Router                                 │ │
│  │  • Service Discoverer                             │ │
│  │  • Capability Enforcer                            │ │
│  └────────────────────────────────────────────────────┘ │
│                       ↑ ↑ ↓ ↓                            │
│  ┌──────────────┬─────┴─┴─────┬──────────────┐          │
│  │              │              │              │          │
│  ▼              ▼              ▼              ▼          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │MemForge  │ │Custom    │ │User      │ │Async    │    │
│ │Service   │ │Service A │ │Proxy Svc │ │Task Svc │    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │       Client Adapters (Protocol Translation)       │ │
│  │                                                    │ │
│  │  • AutoGen Adapter → (Memory, Agent, Tool APIs)  │ │
│  │  • Tidepool Adapter → (Container Runner API)     │ │
│  │  • OpenClaw Adapter → (Gateway API)              │ │
│  │  • CrewAI Adapter → (Future)                     │ │
│  │  • Raw HTTP/gRPC clients                         │ │
│  └────────────────────────────────────────────────────┘ │
│                       ↑ ↑ ↓ ↓                            │
│  ┌──────────────┬─────┴─┴─────┬──────────────┐          │
│  │              │              │              │          │
│  ▼              ▼              ▼              ▼          │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │AutoGen   │ │Tidepool  │ │OpenClaw  │ │Custom    │    │
│ │Agents    │ │Agents    │ │Agents    │ │Clients   │    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Key Advantages Over Simple Message Bus

| Dimension | Simple Bus | Federation Layer |
|-----------|-----------|---|
| **Service Discovery** | Manual config | Automatic registry |
| **Protocol Translation** | Clients handle | Federation handles |
| **Load Balancing** | None | Built-in (round-robin, etc.) |
| **Capability Checking** | Manual | Enforced by federation |
| **Service Composition** | Build your own | Provided |
| **Audit Trail** | Per-service | Unified audit |
| **Failure Handling** | Clients handle | Automatic failover |
| **Multi-Platform** | Difficult | Natural |
| **Scaling Services** | Manual | Automatic rebalancing |
| **Future Platforms** | Add separately | Plug into federation |

---

## Hyphae vs Simple NATS Bus

**Why not just use NATS directly?**

NATS is excellent but:
- ❌ Requires clients to know service topology
- ❌ No service discovery (you hardcode endpoints)
- ❌ No capability enforcement
- ❌ Protocol translation is client responsibility
- ❌ No load balancing across service instances

**Hyphae adds:**
- ✅ Service registry (self-describing)
- ✅ Automatic discovery
- ✅ Protocol translation (AutoGen ↔ Tidepool ↔ OpenClaw)
- ✅ Load balancing
- ✅ Capability enforcement
- ✅ Composition

**Hyphae uses NATS underneath** but abstracts the complexity.

---

## Repository Structure

```
salishforge/
├── hyphae/ (the federation layer)
│   ├── src/
│   │   ├── core/
│   │   │   ├── service-registry.ts
│   │   │   ├── router.ts
│   │   │   ├── service-discovery.ts
│   │   │   └── capability-enforcer.ts
│   │   ├── adapters/
│   │   │   ├── autogen-adapter.ts
│   │   │   ├── tidepool-adapter.ts
│   │   │   └── openclaw-adapter.ts
│   │   ├── services/
│   │   │   └── service-interface.ts (abstract)
│   │   └── http-server.ts (REST API)
│   ├── examples/
│   │   ├── multi-platform-team.ts
│   │   └── service-composition.ts
│   └── SPEC.md
│
├── memforge/ (memory service)
│   └── (registers with Hyphae)
│
├── tidepool/ (reference implementation)
│   └── (connects through Hyphae)
│
└── examples/
    └── hyphae-federation-demo/
```

---

## Strategic Impact

**Before (Separate Systems):**
- AutoGen instance A (has MemForge instance)
- Tidepool instance B (has MemForge instance)
- OpenClaw instance C (no MemForge)
- No easy way for agents to cross-platform collaborate

**After (Federation):**
- AutoGen agents, Tidepool agents, OpenClaw agents all in one network
- All share the same MemForge (or multiple with auto load-balancing)
- Single audit log, single security model
- Easy to add new platforms or services
- Can migrate agents between platforms without changing them

**This is the infrastructure play.** Hyphae becomes the platform that everything runs on.

---

## Decision Point

This is a significant architectural choice. 

**Option A: Simple Message Bus (Original Hyphae)**
- NATS + NKeys + audit logging
- Services standalone, loosely coupled
- 2-3 weeks to build
- Works well for simple multi-agent setups

**Option B: Federation Layer (This Proposal)**
- Central orchestration + service registry
- Automatic service discovery & routing
- Protocol translation between frameworks
- 4-6 weeks to build
- Enables complex multi-platform ecosystems

**My recommendation: Go with Option B.**

Reasoning:
1. Only 1-2 weeks more effort
2. Future-proofs for multi-platform support
3. Makes Salish Forge IP more defensible (federation layer)
4. Enables the "unified agent network" vision
5. You'll need it eventually anyway

Plus: It aligns with the infrastructure-first thinking that led to MemForge.
