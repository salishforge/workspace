# Architectural Decision: Standalone Platform Infrastructure

**Date:** 2026-03-17  
**Proposal:** Decouple MemForge + NATS/Comms as framework-agnostic platform services  
**Strategic Implication:** Convert Salish Forge from "Tidepool platform" to "Memory + Comms platform"  
**Value:** Sell/license the infrastructure independently; plug into any agent framework

---

## The Insight

Instead of:
```
Tidepool (Nanoclaw fork)
├── MemForge (internal)
├── NATS/Comms (internal)
└── Agents (internal)
```

Build:
```
Salish Forge Platform (standalone infrastructure)
├── MemForge (reusable service)
├── NATS Bus + IAM (reusable infrastructure)
└── Adapters
    ├── AutoGen Connector (Memory plugin)
    ├── Tidepool Connector (already exists)
    ├── CrewAI Connector (Memory plugin)
    └── Future frameworks

Salish Forge Products (built ON the platform)
├── Tidepool (reference implementation)
├── Custom agents
└── Customer deployments
```

---

## Current State: Already Mostly Decoupled

### MemForge Architecture (Existing)
```
/nanoclaw-fork/memforge/
├── package.json (standalone Node.js project)
├── SPEC.md (API specification)
├── mcp/server.js (MCP interface)
├── retrieval/ (query API)
├── consolidation/ (consolidation logic)
├── schema/ (PostgreSQL schemas)
├── systemd/ (service management)
└── ingest/ (event ingestion)

Current interface:
- REST API (via MCP server or direct HTTP)
- PostgreSQL backend
- Consolidation scheduler (autonomous)
- Event stream ingestion
```

**Status:** ~75% decoupled. Needs:
- Clean REST API definition
- Service discovery/routing
- Multi-tenancy support (per-agent isolation)
- Documentation

### NATS/Comms Architecture (Being Built)
```
Current status (per Sprint 2):
- NATS server deployed
- Bridge services partially built
- NKeys + ACLs designed but not deployed
- MCP as interim message layer

Current interface:
- NATS topics (sf.agent.{agent}.*)
- PostgreSQL audit logging
- MCP message tool (temporary)
```

**Status:** ~50% designed. Needs:
- Service/bridge implementation
- Key management infrastructure
- Rate limiting enforcement
- Documentation

---

## Proposed Platform Architecture

### 1. MemForge Service (Extract to Standalone)

**Repository:** `salishforge/memforge` (new)

```typescript
// API Surface
GET /memory/{agent}/query?q=search_text&limit=10
  → Returns ranked memories from warm/cold tier

POST /memory/{agent}/events
  → Ingest event for hot/warm/cold processing

POST /memory/{agent}/consolidate
  → Trigger consolidation (manual trigger)

GET /memory/{agent}/status
  → Return memory usage, consolidation state

DELETE /memory/{agent}
  → Clear agent's memory (dangerous!)

// Internal APIs (for adapters)
Class MemoryProvider {
  async add(agentId, content): Promise<void>
  async query(agentId, query): Promise<MemoryResult[]>
  async update_context(agentId, context): Promise<UpdateResult>
  async clear(agentId): Promise<void>
  async consolidate(agentId, mode): Promise<ConsolidationResult>
}
```

**Characteristics:**
- Multi-tenant (per-agent memory isolation)
- PostgreSQL-backed
- Hot/warm/cold tier management
- Autonomous consolidation scheduler
- Accessible via REST + gRPC + SDK

---

### 2. NATS/IAM Service (Extract to Standalone)

**Repository:** `salishforge/comms-infrastructure` (new)

```typescript
// Service surface
NATS Server
├── Topics: sf.agent.{agentId}.request|response|event|rpc
├── Auth: NKeys (per-agent key pairs)
├── ACLs: Per-topic capability whitelists
├── Audit: PostgreSQL event log (all messages)
└── Rate Limit: Token bucket per agent

IAM Layer
├── Agent registry (agents → public keys)
├── Capability registry (agent → allowed actions)
├── Audit logger (PostgreSQL)
└── TLS/encryption enforcement

// SDK
Class AgentComms {
  async request(to: string, action: string, payload): Promise<Response>
  async publish(topic: string, message): Promise<void>
  async subscribe(topic: string): AsyncIterator<Message>
  async register(agentId, publicKey, capabilities): Promise<void>
}
```

**Characteristics:**
- Multi-tenant message bus
- NKeys-based authentication
- Capability-based authorization
- Comprehensive audit logging
- Production-grade security

---

### 3. Framework Adapters (Per-Framework Integration)

#### AutoGen Memory Adapter
```typescript
// /salishforge/adapters/autogen-memory
import { Memory, MemoryContent } from 'autogen';
import { MemoryProvider } from '@salishforge/memforge';

export class MemForgeMemory implements Memory {
  constructor(private memforge: MemoryProvider, private agentId: string) {}
  
  async add(content: MemoryContent): Promise<void> {
    // Forward to MemForge hot_tier ingestion
    await this.memforge.add(this.agentId, content);
  }
  
  async query(query: string): Promise<MemoryQueryResult> {
    // Forward to MemForge retrieval API
    const results = await this.memforge.query(this.agentId, query);
    return {
      entries: results.map(r => ({ content: r.content, score: r.score }))
    };
  }
  
  async update_context(modelContext): Promise<UpdateContextResult> {
    // Inject memories into AutoGen's context
    const relevant = await this.memforge.query(this.agentId, 
      extractSemanticContext(modelContext));
    return injectIntoContext(modelContext, relevant);
  }
}

// Usage:
const memory = new MemForgeMemory(memforgeClient, 'my-agent');
const agent = new AssistantAgent({ ..., memory });
```

#### Tidepool Connector
```typescript
// Already mostly implemented; expose as clean contract
import { MemoryProvider } from '@salishforge/memforge';
import { CommsProvider } from '@salishforge/comms-infrastructure';

export class TidepoolAgent {
  constructor(
    private memory: MemoryProvider,
    private comms: CommsProvider,
    private agentId: string
  ) {}
  
  // Use platform services directly
}
```

#### CrewAI Integration (Future)
```typescript
// Similar pattern: implement CrewAI's memory interface
// using MemForge backend
```

---

## Implementation Roadmap

### Phase 1: Service Extraction (Weeks 1-2)
**Goal:** Separate MemForge + NATS into standalone, documented services

1. **MemForge Service**
   - [ ] Move to `salishforge/memforge` repo
   - [ ] Define REST API contract (OpenAPI spec)
   - [ ] Docker containerization
   - [ ] Multi-tenancy validation (per-agent isolation)
   - [ ] Documentation + examples
   - [ ] Service health checks

2. **NATS/IAM Service**
   - [ ] Move to `salishforge/comms-infrastructure` repo
   - [ ] Deploy NKeys + ACL system
   - [ ] Implement audit logger
   - [ ] Implement rate limiting
   - [ ] Docker containerization
   - [ ] Documentation + examples

### Phase 2: Framework Adapters (Weeks 3-4)
**Goal:** Build pluggable connectors for each framework

1. **AutoGen Memory Adapter**
   - [ ] Implement Memory protocol
   - [ ] Integration tests with AutoGen
   - [ ] Benchmark memory efficiency
   - [ ] Documentation

2. **Tidepool Connector Refresh**
   - [ ] Use platform services instead of internal copies
   - [ ] Remove duplicate code
   - [ ] Testing + migration

3. **CrewAI Adapter** (optional, future)
   - [ ] Implement if demand exists

### Phase 3: Integration Testing (Week 5)
**Goal:** Verify platform works across frameworks

1. **Build test suite**
   - [ ] Multi-agent scenarios (2-3 agents per framework)
   - [ ] Memory consolidation under load
   - [ ] NATS communication reliability
   - [ ] Audit logging completeness

2. **Performance baseline**
   - [ ] Latency: memory query, NATS message, consolidation
   - [ ] Throughput: concurrent messages, bulk ingest
   - [ ] Cost: PostgreSQL storage, network traffic

### Phase 4: Productization (Weeks 6-8)
**Goal:** Ready for external use

1. **Documentation**
   - [ ] Architecture guide
   - [ ] API reference
   - [ ] Deployment guide
   - [ ] Adapter guide (how to add new frameworks)

2. **Licensing & Legal**
   - [ ] Confirm MIT licensing is correct
   - [ ] Add contribution guidelines
   - [ ] Security policy

3. **Release**
   - [ ] v1.0 of MemForge
   - [ ] v1.0 of Comms Infrastructure
   - [ ] Public GitHub repos

---

## Repository Structure (New)

```
salishforge/
├── memforge/ (npm, TypeScript)
│   ├── src/
│   │   ├── memory-provider.ts (main API)
│   │   ├── consolidation.ts
│   │   ├── retrieval.ts
│   │   └── schema/ (PostgreSQL)
│   ├── rest-server.ts (HTTP server for external use)
│   ├── SPEC.md (API specification)
│   └── adapters/ (reference implementations)
│
├── comms-infrastructure/ (npm, TypeScript)
│   ├── src/
│   │   ├── nats-server.ts
│   │   ├── iam.ts (agent registry + capability checking)
│   │   ├── audit-logger.ts
│   │   └── rate-limiter.ts
│   ├── systemd/ (service files)
│   └── SPEC.md
│
├── adapters/ (separate repos per framework)
│   ├── autogen-memory/ (npm)
│   ├── crewai-memory/ (future)
│   └── other-framework/ (future)
│
├── tidepool/ (Salish Forge's reference implementation)
│   └── Uses MemForge + Comms as external services
│
└── examples/ (reference deployments)
    ├── standalone-memforge/ (bare MemForge + PostgreSQL)
    ├── autogen-with-memforge/ (AutoGen agents + platform)
    ├── tidepool-full-stack/ (complete Salish system)
    └── etc.
```

---

## Strategic Advantages

### 1. **Independence from Framework Choices**
- **Current risk:** "If Tidepool fails, we lose MemForge"
- **New benefit:** MemForge works with AutoGen, CrewAI, LangGraph, etc.
- **Optionality:** Can migrate frameworks without losing memory system

### 2. **Reusability & Revenue**
- **Salish Forge's core product:** Not agents, but memory + coordination infrastructure
- **Licensing opportunity:** Sell/license MemForge + Comms to other builders
- **Integration points:** Every new framework is a TAM expansion

### 3. **Cleaner Architecture**
- **Separation of concerns:** Framework orchestration ≠ memory management
- **Testability:** Services can be tested independently
- **Scalability:** Each service can scale independently
- **Operational clarity:** Each component has clear responsibility

### 4. **Longer-term Flexibility**
- **Today:** Build on Tidepool + AutoGen simultaneously
- **Tomorrow:** Switch frameworks without touching memory layer
- **Next:** Add CrewAI, LangGraph, or future frameworks trivially

### 5. **IP/Moat**
- **MemForge with consolidation** = proprietary advantage
- **NATS/IAM + audit logging** = security moat
- **Together:** Defensible platform that multiple frameworks depend on

---

## Implementation Effort

| Component | Current State | Extraction Effort | Adapter Effort | Total |
|-----------|---|---|---|---|
| **MemForge** | ~80% done | 1-2 weeks (docs + REST API) | 1 week (AutoGen) | 2-3 weeks |
| **NATS/IAM** | ~50% designed | 2-3 weeks (build bridges + deploy) | 0 (reuse NATS) | 2-3 weeks |
| **Total** | — | 3-5 weeks | 1 week | **4-6 weeks** |

---

## Comparison: Standalone vs Integrated

| Dimension | Integrated (Current Path) | Standalone (This Path) |
|-----------|---|---|
| **Framework Lock-in** | High (Tidepool-only) | None (pluggable) |
| **Reusability** | Low | High |
| **Operational Complexity** | Lower | Higher (more services) |
| **Time to Multi-Framework** | 2-3 weeks per framework | 1 week per framework |
| **Revenue Potential** | Single product | Platform + products |
| **Long-term Defensibility** | Medium | High |

---

## Decision Point

### **Option A: Integrated Approach** (Current)
- AutoGen + MemForge adapter (2-3 weeks)
- Keep Tidepool as reference
- Simpler ops, single deployment

**Pros:** Faster to market  
**Cons:** Lock-in risk, limited reusability

### **Option B: Standalone Platform** (This Proposal) ⭐ Recommended
- Extract MemForge + Comms (4-6 weeks)
- Build AutoGen adapter
- Use Tidepool as one reference implementation among many

**Pros:** Maximum flexibility, IP moat, licensing opportunity  
**Cons:** More infrastructure to maintain

---

## Recommendation

**Pursue Option B (Standalone Platform).**

**Rationale:**
1. **You've already built 80% of it** — MemForge is mostly decoupled
2. **Future-proofs the company** — Not bet on single framework
3. **Longer payoff horizon** — MemForge becomes a platform product
4. **Only 4-6 weeks more** — Small cost for large optionality
5. **Opens revenue model** — Can license/sell the infrastructure

**Timeline:**
- **Weeks 1-2:** Extract MemForge + Comms to standalone repos
- **Weeks 3-4:** Build AutoGen adapter + Tidepool connector refresh
- **Week 5:** Integration testing + performance validation
- **Weeks 6-8:** Documentation + public release

**After that:** Tidepool becomes a reference implementation. AutoGen becomes another option. Future frameworks plug in trivially.

This is the infrastructure play. The framework is incidental.
