# Hyphae: Universal Agent Coordination Platform

**Status:** Strategic Vision (March 18, 2026 21:38 PDT)  
**Owner:** Flint, CTO  
**Audience:** Salish Forge team + community developers  

---

## Vision

**Salish Forge is building the most advanced agent coordination platform on Earth.**

We are NOT building another agent framework. We are building the nervous system that lets **any agent framework** (nanoclaw, OpenClaw, AutoGen, CrewAI, Anthropic SDK, OpenAI SDK, etc.) work together seamlessly.

**The Platform:**
- Hyphae: Service discovery + multi-region federation
- MemForge: Semantic memory + shared reasoning context
- OAuth2: Identity + capability-based security
- Dashboard: Observability + distributed tracing

**The Pitch:**
> "Any agent. Any framework. One platform."

---

## Why This Matters

### Current Agent Ecosystem Problem

**Reality:** There are 50+ agent frameworks.
- nanoclaw (Anthropic community)
- OpenClaw (OpenClaw team)
- AutoGen (Microsoft)
- CrewAI (CrewAI)
- Anthropic SDK (direct API)
- OpenAI SDK (direct API)
- Gemini SDK
- LangChain agents
- LlamaIndex agents
- ... and many more

**The Problem:** They don't talk to each other.

You pick ONE framework and you're locked in. If you want agents built with different frameworks to work together, you're stuck building custom integration code.

**What Salish Forge Solves:** Framework-agnostic agent coordination.

### Why We're Positioned to Win

1. **We already built it framework-agnostic**
   - Hyphae works with ANY HTTP service
   - MemForge works with ANY agent
   - OAuth2 works with ANY framework
   - Dashboard works with ANY agent

2. **We already have adapters**
   - AutoGen adapter (done)
   - CrewAI adapter (done)
   - nanoclaw adapter (to build)
   - OpenClaw adapter (to build)
   - Template for more (easy to add)

3. **We're not competing with frameworks**
   - Not trying to be the best nanoclaw replacement
   - We make ALL frameworks better by letting them work together
   - Community-aligned (promotes nanoclaw, OpenClaw, etc.)

4. **Network effects**
   - More frameworks = more valuable
   - More agents = more valuable
   - More integrations = higher moat
   - This is defensible in a way a fork never can be

---

## Strategic Architecture

### The Four Pillars

```
┌─────────────────────────────────────────────────┐
│         ANY Agent Framework                     │
│  (nanoclaw, OpenClaw, AutoGen, CrewAI, etc.)   │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┼──────────┬──────────┐
        │          │          │          │
        ↓          ↓          ↓          ↓
    ┌────────┐ ┌─────────┐ ┌──────┐ ┌─────────┐
    │ Hyphae │ │ MemForge│ │OAuth2│ │Dashboard│
    │Service │ │Semantic │ │Ident │ │Observab.│
    │Registry│ │ Memory  │ │& Sec │ │& Tracing│
    └────────┘ └─────────┘ └──────┘ └─────────┘
        │          │          │          │
        └──────────┴──────────┴──────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ↓                     ↓
   PostgreSQL          Vector DB (pgvector)
   (Persistence)       (Semantic Search)
```

### Pillar 1: Hyphae (Service Discovery + Federation)

**What it does:**
- Agents register services (name, version, capabilities, endpoint)
- Agents discover other services by capability
- Agents call each other via Hyphae routing
- Multi-region federation (us-west, us-east, eu, etc.)
- Automatic failover (<30s RTO, <100ms replication lag)

**Example:**
```
Agent A (nanoclaw): "I need a researcher"
  ↓ (query Hyphae)
Hyphae: "Agent B (OpenClaw) is a researcher at http://..."
  ↓
Agent A calls Agent B
  ↓
Agent B returns results
  ↓
Agent A continues
```

**Current Status:**
- ✅ Basic service registry (hyphae/services.ts)
- ✅ Multi-region federation (hyphae/multi-region.ts)
- ⏳ Service discovery API (need to formalize)
- ⏳ Agent-to-agent RPC (need to implement)

### Pillar 2: MemForge (Semantic Memory + Shared Context)

**What it does:**
- All agents store their discoveries in MemForge
- Semantic search across all agent memories
- Relationship graphs (concept A connects to B, C, D)
- Tiered memory (hot/warm/cold)
- Privacy controls (who can read what)

**Example:**
```
Agent A discovers: "Carbon fiber has tensile strength of 1.6 GPa"
  ↓ (stores in MemForge)
MemForge: Vector embedding + metadata

Agent C later queries: "What materials have high strength?"
  ↓ (semantic search)
MemForge: "Agent A discovered carbon fiber (match score: 0.89)"
  ↓
Agent C builds on Agent A's discovery
```

**Current Status:**
- ✅ Basic memory storage (hot/warm/cold tiers)
- ✅ PostgreSQL backend with pgvector
- ⏳ Multi-agent semantic search
- ⏳ Privacy controls + RBAC
- ⏳ Relationship graphs

### Pillar 3: OAuth2 (Identity + Capability-Based Security)

**What it does:**
- Every agent has an OAuth2 identity
- Scopes define what agent can do (memforge:read, hyphae:admin, etc.)
- Fine-grained RBAC (not all agents can do everything)
- Audit trail (every call is logged with WHO did WHAT)

**Example:**
```
Agent A requests: Call Agent B
  ↓ (OAuth2 validation)
"Does Agent A have scope hyphae:call-agents?"
  ↓
YES → Allow. Log: "A called B at 21:42:03"
NO → Deny. Log: "A attempted unauthorized call to B"
```

**Current Status:**
- ✅ OAuth2 server (RFC 6749 compliant)
- ✅ JWT tokens (RS256)
- ✅ Scope-based RBAC
- ✅ Audit logging
- ⏳ Agent-specific scopes (not just user scopes)

### Pillar 4: Dashboard (Observability + Distributed Tracing)

**What it does:**
- See all agents in the mesh (status, capacity, health)
- Follow a task across multiple agents (distributed trace)
- Performance metrics (latency, success rates, errors)
- Alert on failures
- Service dependency graph

**Example:**
```
Task: User asks Question
  ↓ → Agent A (researcher) — 120ms
  ↓ → Agent B (analyzer) — 340ms
  ↓ → Agent C (writer) — 210ms
  ↓ → Agent D (reviewer) — 160ms
Total: 830ms, all succeeded, A:user scope, B:data scope, C:write scope, D:review scope
```

**Current Status:**
- ✅ Prometheus metrics
- ✅ Grafana dashboard template
- ⏳ Distributed tracing (trace a task across agents)
- ⏳ Service dependency graphs
- ⏳ Alert rules for agent failures

---

## What We Build Over 4 Weeks

### Week 1: Hyphae Service Contract (Foundation)

**Goal:** Formalize how agents talk to each other

**Deliverables:**
1. **Service Registration Protocol (Spec)**
   - What metadata agents provide when registering
   - HTTP endpoints for registration/deregistration
   - Health check requirements
   - Example: nanoclaw agent registration JSON

2. **Service Discovery API (Spec + Implementation)**
   ```
   GET /api/services?capability=researcher&region=us-west
   →
   [
     {
       agentId: "agent-123",
       name: "OpenClaw Researcher",
       endpoint: "http://100.97.161.7:3006",
       capabilities: ["research", "analysis"],
       healthStatus: "healthy",
       capacity: 0.4 (40% utilized)
     },
     ...
   ]
   ```

3. **Agent-to-Agent RPC Protocol (Spec)**
   - How Agent A calls Agent B
   - Request format (method, params, timeout)
   - Response format (result, error, traceId)
   - Error handling (timeout, not found, denied)

**Success Criteria:**
- ✅ Protocol docs complete and reviewed
- ✅ Hyphae API endpoints implement spec
- ✅ Example calls working (curl tested)

### Week 2: Multi-Framework Examples (Proof of Concept)

**Goal:** Show Hyphae works with ANY framework

**Deliverables:**
1. **Nanoclaw Integration Example**
   - nanoclaw agent that:
     - Registers with Hyphae on startup
     - Discovers other agents
     - Calls them via RPC
   - Full code + documentation
   - Can be copied as template for other nanoclaw users

2. **OpenClaw Integration Example**
   - Same as nanoclaw but using OpenClaw
   - Shows framework diversity works

3. **Multi-Agent Coordination Demo**
   - Agent A (nanoclaw): "Research this topic"
   - Agent B (OpenClaw): "I'm a researcher, here's what I found"
   - Agent C (AutoGen): "I'll synthesize those findings"
   - Agent D (OpenClaw): "I'll review the synthesis"
   - Publicly available, reproducible

**Success Criteria:**
- ✅ All 3 examples run without modification
- ✅ Complete documentation (setup, run, extend)
- ✅ GitHub-ready (code + README)

### Week 3: Distributed Transactions + Memory (Advanced)

**Goal:** Enable multi-agent workflows and shared reasoning

**Deliverables:**
1. **Saga Pattern Library**
   - Distributed transactions across agents
   - Compensation on failure
   - Idempotent operations
   - Example: "Research, analyze, and write" saga

2. **Multi-Agent Memory Sharing**
   - Agents store discoveries in MemForge
   - Other agents can discover related concepts
   - Relationship graphs show connections
   - Privacy controls (agent A can read/write, agent B read-only)

3. **Distributed Tracing**
   - Follow a task through all agents
   - See: Agent A → B → C → D (with timings)
   - Identify bottlenecks
   - Error visibility (where did it fail?)

**Success Criteria:**
- ✅ Saga transactions complete with no data loss
- ✅ Memory sharing enables new capabilities (agents learn from each other)
- ✅ Traces show full path + timing

### Week 4: Documentation + Open Source (Go Public)

**Goal:** Make Hyphae the standard for agent coordination

**Deliverables:**
1. **Architecture Documentation**
   - Complete spec for service contract
   - Integration guides (per framework)
   - Security model (OAuth2, RBAC, audit)
   - Multi-region architecture

2. **Integration Templates**
   - Template for adding new framework adapter
   - Template for new agent registration
   - Template for new capability type
   - Copy-paste ready

3. **Community Governance**
   - How to contribute adapters
   - How to propose new protocols
   - Security requirements
   - Code review process

4. **Marketing (Framework Communities)**
   - Announce Hyphae to:
     - nanoclaw community
     - OpenClaw community
     - AutoGen community
     - CrewAI community
     - LangChain/LlamaIndex communities
   - Position as: "Make your agents work with others"

**Success Criteria:**
- ✅ docs.salishforge.io has full architecture
- ✅ GitHub has integration guides + templates
- ✅ Community responds with interest/PRs

---

## Technical Priorities (This Week)

### Priority 1: Agent Registration Protocol
**Owner:** Flint  
**Duration:** 2 days  
**Deliverable:** Spec + Hyphae API endpoints

What agents send when registering:
```json
{
  "agentId": "agent-123",
  "name": "OpenClaw Research Agent",
  "framework": "openclaw",
  "version": "1.2.0",
  "capabilities": [
    {
      "name": "research",
      "description": "Research a topic thoroughly",
      "params": ["topic: string", "depth: 'shallow'|'deep'"],
      "returns": "research_report: string"
    },
    {
      "name": "analyze",
      "description": "Analyze data or documents",
      "params": ["data: string"],
      "returns": "analysis: object"
    }
  ],
  "endpoint": "http://agent-123.internal:3006",
  "healthCheckPath": "/health",
  "region": "us-west",
  "oauth2_client_id": "client-456",
  "auth_required": true
}
```

### Priority 2: Service Discovery API
**Owner:** Flint  
**Duration:** 2 days  
**Deliverable:** Working API endpoints

```
GET /api/services
  → All services

GET /api/services?capability=researcher
  → All researchers

GET /api/services?capability=researcher&region=us-west
  → Researchers in us-west

GET /api/services/{agentId}
  → Details for specific agent

GET /api/services/{agentId}/capabilities/{capabilityName}
  → Details for specific capability
```

### Priority 3: Agent-to-Agent RPC
**Owner:** Flint  
**Duration:** 3 days  
**Deliverable:** Working RPC protocol + client library

```
// Caller (any framework)
const result = await hyphae.call({
  targetAgent: "agent-123",
  capability: "research",
  params: { topic: "quantum computing", depth: "deep" },
  timeout: 30000,
  traceId: "trace-789"
});

// What happens:
// 1. Hyphae looks up agent-123 via service discovery
// 2. Validates caller has "hyphae:call-agents" scope
// 3. Makes HTTP POST to agent-123 endpoint
// 4. Includes OAuth2 token
// 5. Waits for response (async friendly)
// 6. Logs call in audit trail
// 7. Returns result or error
```

### Priority 4: nanoclaw Integration Example
**Owner:** Flint  
**Duration:** 3 days  
**Deliverable:** Runnable example + docs

Nanoclaw agent that:
1. On startup: Registers with Hyphae
2. Every minute: Heartbeat to Hyphae (still alive)
3. When task arrives: Check Hyphae for other agents
4. Call relevant agent via Hyphae.call()
5. Process result
6. Return to user

---

## Success Metrics

### By End of Week 1
- ✅ Service registration protocol documented
- ✅ Service discovery API working
- ✅ RPC protocol specified
- ✅ Hyphae endpoints tested

### By End of Week 2
- ✅ nanoclaw example running
- ✅ OpenClaw example running
- ✅ 2-agent demo working (A calls B)
- ✅ All code on GitHub
- ✅ Documentation complete

### By End of Week 3
- ✅ Saga transactions working
- ✅ Memory sharing across agents proven
- ✅ Distributed trace visible in Dashboard
- ✅ 3-4 agent demo complete

### By End of Week 4
- ✅ Full documentation published
- ✅ Integration templates available
- ✅ Community responded (interest/PRs)
- ✅ Ready for beta release announcement

---

## What We're NOT Doing

- ❌ Building another agent framework (use nanoclaw/OpenClaw)
- ❌ Maintaining Tidepool fork (deprecated)
- ❌ Creating vendor lock-in (framework-agnostic by design)
- ❌ Over-engineering (start simple, scale later)

---

## Competitive Advantages

| vs. | We Have | They Don't |
|-----|---------|-----------|
| NATS | Service discovery, semantic memory, RBAC | Just message bus |
| Kubernetes | Agent-aware, semantic routing, shared context | General-purpose orchestration |
| OpenAI Swarm | Framework-agnostic, multi-region, persistent memory | OpenAI SDK only |
| LangChain | Agent coordination, federation, observability | Just a library |
| Manual integration | Standards-based, automatic failover, audit trail | None of these |

---

## Positioning Statement

**Salish Forge:** The universal coordination platform for AI agents.

- **What we do:** Let any agent (built with any framework) discover, authenticate with, and call any other agent.
- **Why it matters:** Agents built with different frameworks can now work together seamlessly.
- **Who it's for:** Teams building multi-agent systems, whether they use nanoclaw, OpenClaw, AutoGen, CrewAI, or anything else.
- **Why you should use us:** We don't lock you into a framework. We make your framework better by letting it work with others.

---

## Timeline

| Week | Deliverable | Owner | Status |
|------|-------------|-------|--------|
| 1 | Service contract spec + API | Flint | In progress |
| 2 | nanoclaw + OpenClaw examples | Flint | Queued |
| 3 | Sagas + distributed tracing | Flint | Queued |
| 4 | Docs + community launch | Flint + team | Queued |

---

## Go/No-Go Criteria

**This succeeds if:**
- ✅ 2 agents from different frameworks call each other successfully
- ✅ Agents can discover each other without hardcoding addresses
- ✅ Memory is shared (semantic search works)
- ✅ Errors are handled gracefully
- ✅ Community shows interest

**This fails if:**
- ❌ Only works with one framework
- ❌ Requires hardcoding agent addresses
- ❌ Performance is worse than direct agent calls
- ❌ Adds complexity without benefit

---

**Status:** READY TO EXECUTE 🚀

**Next Step:** Implement Priority 1 (Agent Registration Protocol) this week.

