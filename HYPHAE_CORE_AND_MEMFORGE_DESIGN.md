# Hyphae Core + MemForge: Resilient Multi-Agent Platform Design

**Status:** Comprehensive architecture integrating actual MemForge implementation  
**MemForge Location:** `/home/artificium/.openclaw/workspace/nanoclaw-fork/memforge/`  
**MemForge Status:** Functional implementation (ingest, consolidation, retrieval complete)  
**Research:** Multi-agent consistency problems, memory failures, circuit breaker patterns, graceful degradation  
**Date:** March 19, 2026

---

## Critical Update

This document was initially a theoretical design. Upon research, we discovered **Flint, Clio, and John already designed and built MemForge** with:
- Tiered memory (hot/warm/cold with temporal branching)
- Sleep-cycle consolidation (neuroscience-inspired, 9 steps)
- Years-long institutional memory (not days)
- Role-based filtering for multi-agent systems

**This design now references the actual MemForge implementation**, not a generic memory layer.

See **MEMFORGE_VS_SOLUTIONS.md** for detailed comparison with Mem0, Bedrock, and other industry solutions.

---

## The Problem: Why Multi-Agent Systems Fail

### Real-World Failures (Observed 2025-2026)

1. **Centralized Memory Consistency Breaks When:**
   - Agent goes offline mid-operation
   - Memory service becomes unstable or slow
   - Agents get inconsistent views of shared context
   - One agent's update doesn't propagate before another agent decides

2. **Context Window Limitations:**
   - Memory consistency, role adherence, procedural integrity suffer
   - Agents lose track of their role in multi-step workflows
   - Inconsistent decisions when context is truncated

3. **Plugin Failures Cascade:**
   - One plugin fails, whole system degrades
   - No fallback to core functionality
   - Agents left in undefined state

4. **Hard Dependencies Kill Reliability:**
   - If training plugin fails, agents don't know how to behave
   - If memory plugin fails, agents operate without learning
   - If validation plugin fails, bad decisions propagate

### What the Field Has Learned

**From Computer Architecture (Resurfacing in AI):**
- Bandwidth (how fast can agents share context?)
- Hierarchy (local cache vs shared memory vs persistent storage)
- Caching (stale data consistency model)
- Consistency models (eventual, strong, causal)

**From Distributed Systems (Now Applied to AI):**
- Circuit breaker patterns (detect failure fast, fail gracefully)
- Graceful degradation (serve cache, simplify behavior, fallback to defaults)
- Bulkheads (isolate failures)
- Explicit timeouts (don't wait forever)

**From Multi-Agent Research (2025):**
- Explicit protocols for cache sharing and memory access required
- Role-filtered memory (not all agents see all data)
- Versioning (agents need to understand which version of context they're working with)
- Principled consistency models (explicit guarantees, not ad-hoc)

---

## New Architecture: Hyphae Core + Memforge + Resilience

### Separation of Concerns

**HYPHAE CORE** (Immutable, Self-Contained, Minimal)
```
├─ Agent Registry (who can act?)
├─ Zero-Trust Registration
├─ Secret Vault (encrypted at rest)
├─ Service Router (coordinates requests)
├─ Priority Interrupt System (alert agents of failures)
├─ Circuit Breaker Engine (detect plugin failures)
├─ Fallback Policies (what to do when plugins fail)
├─ Audit Log (immutable record of everything)
└─ Communication Bus (agents ↔ core, agents ↔ plugins)
```

**MEMFORGE** (Separate Persistence Tier, Pluggable Storage)
```
├─ Memory Substrate (hybrid storage)
│  ├─ Vector Store (semantic memory, fast lookup)
│  ├─ Graph Store (relationships between concepts)
│  ├─ Relational Store (structured data)
│  └─ Time Series (temporal context, decisions over time)
│
├─ Consistency Layer (guarantees for shared memory)
│  ├─ Version Control (which version of context?)
│  ├─ Causal Ordering (what happened before what?)
│  └─ Role-Based Access Control (who sees what?)
│
├─ Cache Hierarchy
│  ├─ L1: Agent-Local Cache (private working memory)
│  ├─ L2: Workgroup Cache (shared within team, ~seconds stale)
│  └─ L3: Persistent Storage (authoritative source, eventual consistency)
│
└─ Fallback Memory (when primary fails)
   └─ Last-Known-Good state (agents can operate on cached state)
```

**RESILIENCE LAYER** (Observes Failures, Initiates Recovery)
```
├─ Health Monitoring (is each service healthy?)
├─ Failure Detection (did something break?)
├─ Circuit Breaker State Machine (Closed → Open → Half-Open)
├─ Fallback Routing (what to do when primary fails)
├─ Priority Interrupt Protocol (notify agents immediately)
├─ Graceful Degradation (serve stale cache, use simpler models, disable non-essential features)
└─ Recovery Orchestration (when can we try again?)
```

**PLUGINS** (Optional, Replaceable, Can Fail)
```
├─ Training System (can be locked out if compromised)
├─ Reasoning Engine (can be replaced with simpler fallback)
├─ Validation (can be disabled if stuck)
├─ Tool Registry (can be restricted per security alert)
├─ Service Connectors (can be circuit-broken individually)
└─ Monitoring (can be disabled if consuming too much)
```

---

## Hyphae Core: The Baseline Fabric

### Core Must Do (Minimal, Self-Contained)

**1. Agent Registry & Identity**
```
- Agent A is who?
- What zero-trust proof do they have?
- What is their encryption key?
- Are they currently allowed to operate?
- Can their capabilities be revoked instantly?
```

**2. Secret Vault (Encrypted Storage)**
```
- Store secrets at rest with AES-256-GCM
- Accessible only to authorized agents
- One encryption key per agent (enables instant revocation)
- No external dependencies (core can work even if all plugins fail)
- Audit every access
```

**3. Service Router**
```
- Agent wants to call a service
- Core checks: Is this agent authorized?
- Core routes to: Plugin (if healthy) or Fallback (if plugin failed)
- Core logs: Who called what, success/failure
```

**4. Communication Bus**
```
- Agent → Core: Service requests, decision logs
- Core → Agent: Responses, configuration, alerts
- Core → Agent: PRIORITY INTERRUPT (capability X is no longer available)
- Agent ↔ Agent: Via Core (never direct connection in untrusted environment)
```

**5. Circuit Breaker Engine**
```
State Machine: Closed (working) → Open (failed) → Half-Open (testing)

For each plugin:
  - Track success/failure rate
  - Open circuit after N failures in M seconds
  - When open: route to fallback, alert operators
  - Periodically test recovery (half-open)
  - Close only after successful recovery
```

**6. Priority Interrupt System**
```
Event: Training plugin becomes unavailable
Reaction:
  1. Core detects failure (circuit opens)
  2. Core sends PRIORITY INTERRUPT to all agents:
     {
       "type": "CAPABILITY_UNAVAILABLE",
       "capability": "training-system",
       "timestamp": "2026-03-19T11:15:00Z",
       "fallback": "Use last-known-good training configuration",
       "impact": "Agents will NOT receive updated config changes"
     }
  3. Agents immediately stop requesting from training plugin
  4. Agents use cached/fallback behavior
  5. System remains operational
```

**7. Audit Log (Immutable)**
```
- Every request logged (who, what, when, result)
- Cannot be deleted or modified (write-once)
- Enables incident investigation
- Proves compliance
```

**8. Fallback Policies**
```
For each failure scenario, core has explicit fallback:
  - If training plugin fails: Use last-known-good config
  - If memory plugin fails: Use in-memory cache + warn agents
  - If validation plugin fails: Skip validation (agents proceed with caution)
  - If tool plugin fails: Disable that tool, alert agents
  - If reasoning plugin fails: Use simple plan-execute (no reasoning trace)
```

### What Core Does NOT Do

❌ Complex reasoning (that's a plugin)  
❌ Persistent memory (that's Memforge)  
❌ Tool execution (that's a plugin)  
❌ Business logic (that's a plugin)  
❌ Anything that can be disabled  

### Core Deployment

```
Hyphae Core Docker Image:
├─ Binary (compiled, no dependencies)
├─ Configuration (just role mappings, vault location)
├─ SQLite (embedded, no separate DB needed)
└─ No external services required

Hyphae Core starts:
→ Initializes vault (local key derivation)
→ Loads agent registry (from config)
→ Initializes circuit breakers (all closed)
→ Listens for agent connections
→ READY (even if all plugins are down)
```

---

## MemForge: The Persistence Tier (Actual Implementation)

**Separate from Hyphae Core.** Production implementation in `/nanoclaw-fork/memforge/`.  
Can be replaced. Can fail. Gracefully.

### The Tiered Memory Model (Years-Long, Not Days)

**HOT TIER (Working Memory, ~3K tokens)**
```
Loaded every session:
  - Agent identity and core values
  - Current priorities
  - Active context
  - Critical guardrails

Stored: In-memory, generated fresh each session
Access: Loaded from MemForge hot_tier table
Durability: Regenerated nightly from consolidation
Consistency: Fresh (updated after sleep cycle)
Source: MemForge distillation (Step 8 of consolidation)
```

**EPISODIC BUFFER (Append-Only Event Log)**
```
Recorded during waking hours:
  - All tool calls
  - All decisions
  - All learnings
  - All observations

Stored: MemForge episodic_buffer table
Access: Append-only (no modifications)
Durability: Persists during entire session
Consistency: Immutable (ordered by timestamp)
Clearing: After sleep cycle → moved to cold_archive
Purpose: Raw material for consolidation
```

**VECTOR STORE (Semantic Memory)**
```
Embeddings of consolidated concepts:
  - Semantic similarity search
  - Embedding-based triggering
  - Cost-controlled (local Ollama or API)

Stored: PostgreSQL pgvector extension
Access: Via memory_retrieval.js (hybrid search)
Durability: Persists across sessions
Consistency: Updated during consolidation (Step 7)
Fallback: Keyword search (pg_trgm) if vector unavailable
Performance: <50ms lookup, >90% recall
```

**GRAPH STORE (Associative Memory, Temporal Branching)**
```
Nodes = entities/concepts
Edges = relationships with temporal bounds

Key Innovation: Temporal Branching
  - When belief changes: valid_until old edge, add new edge
  - Never delete (history preserved)
  - Query "what did you believe on date X?" is answerable
  - Query "when did you change mind about X?" is answerable

Stored: PostgreSQL Apache AGE or adjacency tables
Access: Graph traversal (1-2 hops enrichment)
Durability: Permanent (never deleted)
Consistency: Updated during consolidation (Step 6)
Example: Agent believes X, changes to NOT_X on date Y
  - Both beliefs stored with temporal bounds
  - Causality preserved (what changed and when)
```

**TEMPORAL LOG (Causal Sequencing)**
```
Ordered sequence of significant events:
  - What happened when
  - Causality relationships
  - Decision sequence analysis

Stored: MemForge temporal_log table
Access: Time-series queries, "what led to X?" traversal
Durability: Complete history
Consistency: Immutable once written
Purpose: Answer "what sequence of events caused this decision?"
```

**COLD ARCHIVE (Forever Preservation)**
```
All raw episodic records preserved:
  - Never deleted (only archived)
  - Indexed for rare deep-dive queries
  - Complete audit trail

Stored: MemForge cold_archive table
Access: Full-text search (rare queries only)
Durability: Permanent, immutable
Consistency: Write-once (moved from episodic_buffer)
Purpose: Historical audit trail, compliance, investigation
Timeline: Episodic → Archive after each sleep cycle
```

### MemForge Consolidation: The Nine-Step Sleep Cycle

**Runs nightly (02:00 UTC default). Neuroscience-inspired consolidation.**

Each step is a separate LLM call (controlled budget, different models per step).

```
EPISODIC BUFFER (today's raw events)
         │
         ▼
[CONSOLIDATION AGENT - 9 STEPS]

Step 1: ENTITY EXTRACTION
   Input: All events from today
   Output: List of entities (who/what appeared?)
   Model: Claude Haiku (fast, cheap)
   Tokens: ~100

Step 2: RELATIONSHIP INFERENCE
   Input: Entities from Step 1
   Output: How are they connected?
   Model: Claude Haiku
   Tokens: ~150

Step 3: CONTRADICTION DETECTION
   Input: Inferred relationships
   Output: Any conflicts with existing graph?
   Model: Claude Haiku
   Tokens: ~100

Step 4: TEMPORAL SEQUENCING
   Input: Events + contradictions
   Output: Ordered causality sequence
   Model: Claude Haiku
   Tokens: ~120

Step 5: IMPORTANCE SCORING
   Input: All events, their significance
   Output: Hot/warm/cold tier routing decisions
   Model: Claude Haiku
   Tokens: ~100

Step 6: GRAPH UPDATE
   Input: Entities, relationships, importance
   Action: Create/update nodes and edges
   Temporal Branching: Close old edges, open new ones (if contradictions)
   Storage: Apache AGE or adjacency tables
   Result: Permanent knowledge graph with history

Step 7: VECTOR UPDATE
   Input: Consolidated concepts
   Action: Embed with pgvector
   Model: Local Ollama (nomic-embed-text) or API
   Storage: MemForge vector_store (pgvector)
   Result: Semantic searchable memory

Step 8: HOT TIER DISTILLATION
   Input: Entire knowledge graph
   Output: Compressed 3K-token working memory for next session
   Model: Claude Haiku
   Tokens: ~150
   Storage: MemForge hot_tier table
   Also generates: CLAUDE.md (for SDK/session startup)

Step 9: ARCHIVE EPISODIC BUFFER
   Action: Move raw episodic_buffer → cold_archive
   Action: Clear episodic_buffer for next session
   Result: Fresh buffer ready for tomorrow

CONSOLIDATED MEMORY (ready for next session)
```

**Budget Control:**
- Max tokens per consolidation: Configurable (default: 2000)
- Budget exceeded? Stop consolidation, retry tomorrow
- Cost tracking: Per-step token accounting
- Average cost: ~$0.10/night (Claude Haiku pricing)

**Failure Handling:**
- Step fails? Skip it, continue to next
- Partial consolidation still improves memory
- Full retry next night if budget exceeded
- No "all or nothing" semantics

**Timeline:**
```
18:00 - Agent ends work, episodic buffer full
02:00 - Sleep cycle begins
02:01 - Step 1-5: Analysis (~500 tokens)
02:10 - Step 6: Graph update (~0 tokens, just DB writes)
02:11 - Step 7: Vector embedding (~200 tokens)
02:15 - Step 8: Hot tier distillation (~150 tokens)
02:20 - Step 9: Archive buffer (~0 tokens)
02:20 - Done. Hot tier ready for 06:00 agent startup.
```

---

### Role-Based Memory Filtering

**Not all agents see all memory.**

```
Agent Flint (CTO):
  - Sees: All organizational memory (full audit trail)
  - Sees: All decisions, approvals, security alerts
  - Sees: Sub-agent memories (as parent)

Agent Clio (Chief of Staff):
  - Sees: Organizational memory (strategy level)
  - Sees: Coordination logs
  - Doesn't see: Engineering details, code reviews

Sub-Agent worker-1 (spawned by Flint):
  - Sees: Only task-specific context
  - Sees: Flint's shared knowledge (parent's filtered view)
  - Doesn't see: Other agents' memories
  - Doesn't see: Organizational audit trail

Sub-Sub-Agent debugger-1 (spawned by worker-1):
  - Sees: Only task sub-context
  - Sees: Parent's (worker-1) filtered view
  - Doesn't see: Anything else
```

**Enforced at every access:**
```
Agent: "Query: What are our code review standards?"
MemForge:
  1. Verify agent identity + encryption key
  2. Check agent's roles (cto? engineer? worker?)
  3. Query graph/vector store with role filter
  4. Return only authorized items
  5. Log access: WHO accessed WHAT MEMORY from WHERE
  6. Return results with source transparency
```

**Implementation (Actual MemForge):**
- See `memory_retrieval.js` line ~150: `queryByText(agentId, roles=[])`
- Role filtering applied at SQL level (not post-fetch)
- Results include role_filtered flag (transparency)

### Consistency Guarantees

**Three Levels of Consistency:**

**Strong Consistency (for critical decisions)**
```
Agent writes: "Code review approved by Flint"
Memforge:
  1. Write to persistent storage (L3)
  2. Wait for confirmation
  3. Update cache (L2)
  4. Notify other agents (L2 updates)
  5. Return "Done" to agent

No other agent will see stale version.
Cost: Higher latency (~500ms)
Use: Approvals, resource allocations, security decisions
```

**Eventual Consistency (for learning)**
```
Agent writes: "Pattern X is inefficient, use Y instead"
Memforge:
  1. Update local cache (L2) immediately
  2. Return "Done" to agent (fast)
  3. Asynchronously persist to L3
  4. Eventually propagate to other agents' L2 caches

Other agents might see old version for up to 30 seconds.
Cost: Lower latency (~50ms)
Use: Learned patterns, observations, preferences
```

**Version-Aware (agents know what version they're using)**
```
Agent reads: "Approved prompt for code review"
Memforge returns:
  {
    "content": "Review the code...",
    "version": "3.2",
    "timestamp": "2026-03-19T11:00:00Z",
    "authoritative": true
  }

Agent: "I'm working with version 3.2 of the prompt"
If agent acts on stale version, audit shows it.
```

### Memforge API: Role-Filtered, Versioned

```typescript
// Agent queries memory with their context
await memforge.query({
  scope: 'workgroup',
  question: 'What are our code review standards?',
  agentId: 'flint',
  roles: ['cto', 'audit'],
  version: 'latest' // or '3.1' for specific version
})

// Returns: 
{
  results: [
    {
      category: 'policy',
      content: '1. Two-agent approval required...',
      version: '3.2',
      timestamp: '2026-03-19T11:00:00Z',
      authoritative: true,
      role_filtered: 'cto'
    }
  ],
  cache_status: 'hit', // or 'miss' if had to fetch from L3
  consistency: 'strong'
}

// Agent stores new learning
await memforge.store({
  scope: 'workgroup',
  category: 'pattern',
  key: 'async_validation_order',
  content: 'Test in this order: unit → integration → e2e',
  agentId: 'flint',
  consistency: 'eventual' // Learning, can be async
})
```

### Memforge Backend Plugins

Memforge itself is backed by pluggable storage:

```
hyphae-plugin-memforge-postgresql/ (default)
  - Relational: structured decisions, approvals
  - Vector: semantic search (embedding-based)
  - Graph: relationships between concepts
  - Time-series: decisions over time

hyphae-plugin-memforge-redis/ (high-speed cache)
  - L2 cache layer
  - < 50ms latency
  - In-memory (survives pod restart, not full cluster failure)

hyphae-plugin-memforge-mongodb/ (document-flexible)
  - Flexible schema for new memory types
  - Good for unstructured learning
  - Can be added by teams without schema migration

hyphae-plugin-memforge-dynamodb/ (AWS-native)
  - For organizations running on AWS
  - Serverless scaling
  - Low ops burden
```

If one backend fails:
```
Memforge: PostgreSQL failed
Fallback: Serve from Redis cache
Agents: Get eventual consistent view (might be stale)
System: Continues operating
Action: Alert operators, start recovery
```

---

## Resilience: The Circuit Breaker System

### Three States for Every Plugin

```
CLOSED (Working)
  ↓
  Requests flow: Agent → Plugin → Response
  Monitor: Track success rate
  Threshold: If error rate > 5% in 60 seconds → Open
  
OPEN (Failed)
  ↓
  Requests blocked: Agent → Fallback response
  Monitor: No requests sent to plugin
  Timeout: After 30 seconds → Half-Open
  Action: Priority Interrupt sent to all agents
  
HALF-OPEN (Testing Recovery)
  ↓
  Requests limited: Try plugin with 1 request
  Success: → CLOSED (recovery worked)
  Failure: → OPEN (still broken)
```

### Example: Training Plugin Fails

```
Time 0:00 - Training plugin healthy
  Agents: Getting training configs normally
  Circuit: CLOSED

Time 0:05 - Training plugin starts failing
  10% of requests timeout
  Circuit breaker monitors...

Time 0:15 - Failure rate exceeds 5%
  Circuit breaker: OPEN
  Action 1: Stop sending requests to training plugin
  Action 2: Send PRIORITY INTERRUPT to all agents:
    "Training system unavailable. Using cached config."
  Action 3: Enable fallback (serve last-known-good config)
  Action 4: Alert operators
  
  Result: Agents immediately adapt, system keeps running

Time 0:30 - Try recovery
  Circuit: HALF-OPEN
  Action: Send 1 test request to training plugin
  Result: Plugin responds correctly
  Circuit: CLOSED
  
  If still failing:
  Circuit: OPEN again
  Fallback continues until fixed
```

### Graceful Degradation: Layers of Fallback

**Plugin Fails → Fallback Responses:**

```
Training Plugin Fails:
  Primary: Get org config from plugin
  Fallback 1: Use cached org config (last 24 hours)
  Fallback 2: Use defaults (role-based, minimal training)
  
Memory Plugin Fails:
  Primary: Query persistent storage
  Fallback 1: Search L2 cache (in-memory, might be stale)
  Fallback 2: Return empty (agent operates without memory)
  
Validation Plugin Fails:
  Primary: Validate against org rules
  Fallback 1: Skip validation (agent can proceed)
  Fallback 2: Manual approval required
  
Reasoning Plugin Fails:
  Primary: ReAct reasoning (full traces)
  Fallback 1: Simple plan-execute (no traces)
  Fallback 2: Execute immediately (no planning)
```

### Priority Interrupt Protocol

**When a capability becomes unavailable:**

```
PRIORITY INTERRUPT Packet:
{
  "type": "CAPABILITY_UNAVAILABLE",
  "severity": "HIGH",
  "timestamp": "2026-03-19T11:15:23.456Z",
  "capability_name": "training-system",
  "reason": "Circuit opened: error rate 15%",
  "fallback": {
    "type": "cached_config",
    "stale_after_seconds": 86400,
    "last_updated": "2026-03-18T11:00:00Z"
  },
  "affected_agents": ["flint", "clio", "worker-1", "worker-2"],
  "next_retry": "2026-03-19T11:15:53.456Z",
  "operator_alert_sent": true,
  "recovery_status": "OPEN"
}

Delivery:
  1. Out-of-band (priority channel, not normal RPC)
  2. Delivered to EVERY affected agent immediately
  3. Agents must acknowledge within 5 seconds
  4. If no acknowledge: escalate to operator override
  
Agent Response:
  1. Acknowledge: "I got it"
  2. Stop using training plugin
  3. Use fallback (cached config)
  4. Log: "Using fallback training due to capability unavailability"
  5. Continue operating
```

### Security Lockdown: Instant Revocation

**If a plugin is compromised (security alert):**

```
Operator: "Lock out hyphae-plugin-training-system due to CVE-2026-0152"
Hyphae Core:
  1. Open circuit for training plugin (OPEN, stay open)
  2. Send PRIORITY INTERRUPT to all agents
  3. All future requests → fallback immediately
  4. Agents cannot use plugin (even if it recovers)
  5. Log: "Training plugin revoked by operator"

Effect:
  - Immediate
  - No agent restart needed
  - System keeps running
  - Plugin can be replaced or updated
  - Agents notified and adapted automatically
```

---

## Fallback Policies: What to Do When Things Break

### Explicit Policies for Each Failure

**Define in core config:**

```yaml
fallback_policies:
  training_plugin:
    # Use last-known-good config
    use_cache: true
    cache_age_max: 86400 # 24 hours
    notify_agents: true
    severity: high
    
  memory_plugin:
    # Use in-memory cache, warn about staleness
    use_cache: true
    cache_age_max: 300 # 5 minutes
    notify_agents: true
    severity: high
    
  validation_plugin:
    # Continue without validation (risky, but keeps system alive)
    skip: true
    notify_agents: true
    require_manual_approval: true
    severity: medium
    
  reasoning_plugin:
    # Fall back to simpler reasoning
    fallback_type: simple_plan_execute
    notify_agents: true
    severity: low
```

### Monitoring Thresholds

```yaml
circuit_breaker_thresholds:
  # Open circuit if:
  - error_rate_percent: 5           # 5%+ errors
    window_seconds: 60              # in last 60 seconds
  - latency_p95_ms: 2000            # or p95 latency > 2s
    window_seconds: 60
  - timeout_rate_percent: 3         # or > 3% timeouts
    window_seconds: 60
    
  # Try recovery after:
  half_open_delay_seconds: 30
  
  # Declare recovered if:
  half_open_success_rate: 80        # 4 of 5 requests succeed
```

---

## Implementation: Core Services

### Hyphae Core (Minimal Binary)

```typescript
// Agent registration
interface AgentIdentity {
  agentId: string;
  encryptionKeyId: string; // per-agent key
  roles: string[];
  capabilities: string[];
  revokedAt?: timestamp;
}

// Service router
interface ServiceRouter {
  route(agentId, serviceName, request) {
    if (isRevoked(agentId)) return Error("REVOKED");
    
    if (circuitBreaker.isOpen(serviceName)) {
      return getFallback(serviceName, request);
    }
    
    // Try plugin
    let response;
    try {
      response = callPlugin(serviceName, request, 2000ms); // 2s timeout
      circuitBreaker.recordSuccess(serviceName);
      return response;
    } catch (e) {
      circuitBreaker.recordFailure(serviceName);
      if (circuitBreaker.shouldOpen(serviceName)) {
        notifyAgents(priorityInterrupt(serviceName));
      }
      return getFallback(serviceName, request);
    }
  }
}

// Circuit breaker
interface CircuitBreaker {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastOpenedAt: timestamp;
  
  recordSuccess(): void;
  recordFailure(): void;
  shouldOpen(): boolean;
  shouldAttemptRecovery(): boolean;
}

// Audit logger
interface AuditLog {
  agentId: string;
  serviceName: string;
  request: object;
  response: object;
  status: 'success' | 'failure' | 'fallback';
  timestamp: timestamp;
  latency_ms: number;
  
  // Write-once, cannot be modified
  append(entry): void;
}
```

### Key RPC Endpoints (Core Only)

```typescript
// Health check
/health → { core: healthy, plugins: {...}, memory: {...} }

// Service requests
/rpc/call → Route to plugin or fallback

// Priority interrupts (inbound from core → agents)
/interrupt/receive → Agent receives capability unavailability alert

// Agent registration
/register → Zero-trust protocol, issue encryption key

// Vault operations
/vault/get → Retrieve secret (encrypted, per-agent key)
/vault/set → Store secret
/vault/audit → Get vault access log

// Circuit breaker status
/status/circuits → State of each plugin's circuit

// Operator commands
/operator/revoke-plugin → Lock out plugin immediately
/operator/revoke-agent → Lock out agent immediately
/operator/force-recovery → Test recovery manually
```

---

## Failure Recovery: The Operator Loop

### Scenario: Memory Plugin Becomes Unstable

```
T+0s:    Memory plugin starts failing (timeout, slow queries)
T+30s:   Error rate 8%, circuit opens
T+30s:   Core sends PRIORITY INTERRUPT to all agents
T+30s:   Agents acknowledge, switch to fallback (in-memory cache)
T+30s:   Core alerts operators (Slack, PagerDuty)

Operator sees alert:
  - Memory plugin is unavailable
  - System is operating on cached memory (eventual consistent)
  - Next recovery attempt at T+60s
  - Recommended action: Check memory DB health

Operator investigates:
  - Memory DB is high load (50% CPU, connection pool full)
  - Identifies: Memory queries are unoptimized (N+1 problem)
  - Decision: Restart memory pod with fix, or lock out plugin and use simpler backend

Option A: Restart with fix
  T+60s:   Circuit: HALF-OPEN, try 1 request
  T+60s:   Memory plugin responds normally
  T+60s:   Circuit: CLOSED
  T+61s:   Core sends CAPABILITY_RESTORED interrupt to agents
  T+61s:   Agents resume using memory plugin

Option B: Switch backend
  Operator: hyphae operator disable-plugin memforge-postgresql
  T+61s:   Core opens circuit, disables plugin
  Operator: hyphae operator enable-plugin memforge-redis
  T+62s:   Redis backend initialized
  T+62s:   Core routes memory requests to Redis
  T+62s:   System operates on Redis (higher latency than Postgres, but operational)
```

---

## Why This Design Works

### 1. Hyphae Core Never Fails

Because it does almost nothing:
- No external dependencies
- No database queries (uses SQLite)
- No plugin calls (just routing)
- No complex logic

If core fails: restart it (it boots in seconds). Everything else waits.

### 2. Plugins Can Fail Without Killing System

Circuit breaker + fallback:
- Plugin fails → circuit opens
- Agents notified immediately
- Fallback response served
- System continues

No agent is left guessing or hanging. Everyone knows what's happening.

### 3. Memory Failures Are Graceful

Hybrid hierarchy (L1/L2/L3):
- L1 (local cache): Always works
- L2 (workgroup cache): Survives L3 failure
- L3 (persistent): Falls back to L2 if unavailable

No single memory failure takes down the system.

### 4. Security Lockdown Is Instant

Revoke via core:
```
Operator: hyphae operator revoke-plugin training-system
T+0s: Core blocks all requests to training plugin
T+0s: PRIORITY INTERRUPT sent to all agents
T+1s: Agents stop using training plugin
T+1s: System is secure
```

No need to restart agents or redeploy. Immediate.

### 5. Operators Have Visibility

Everything logged to audit trail:
- Who asked for what
- Which plugin handled it (or fallback did)
- How long it took
- Success or failure

Incident investigation: read the audit log.

---

## Memforge as Separate Service

Memforge is NOT Hyphae Core. It's a separate service:

```
Hyphae Core: 
  - Lightweight (50MB container)
  - No external deps (except Memforge optionally)
  - Can run standalone
  
Memforge:
  - Memory infrastructure
  - Pluggable backends
  - Optional (if down, core uses cached/null fallback)
  
Relationship:
  - Hyphae Core talks to Memforge via REST/RPC
  - Memforge failure: circuit opens
  - Agents use in-memory fallback
  - System keeps running
```

---

## Timeline: What Stays, What Gets Redesigned

### What Stays (Don't Touch)
✅ Core plugin architecture (Tier 1/2/3)  
✅ Training system as plugin (replaceable)  
✅ Service connectors as plugins  
✅ Reasoning engines as plugins  

### What Gets Redesigned
🔄 Memory system → Memforge (separate, hybrid, role-filtered)  
🔄 Fallback policies → Explicit circuit breaker config  
🔄 Resilience → Priority interrupt + graceful degradation  
🔄 Core → Minimal, immutable, never fails  
🔄 Role-based memory → Enforced at every access  

### New Files to Create

1. **HYPHAE_CORE_BASELINE.md** — Core services only
2. **MEMFORGE_DESIGN.md** — Memory layer + hybrid caching + role filtering
3. **RESILIENCE_CIRCUIT_BREAKER.md** — Circuit breaker system + fallback policies
4. **PRIORITY_INTERRUPT_PROTOCOL.md** — How agents are notified of failures
5. Updated **HYPHAE_ARCHITECTURE_ROADMAP.md** — Resequence phases around core resilience

---

## Research Integration

### Problems Addressed

**"Centralized memory consistency difficult when agents go offline"** → Solved by L1/L2/L3 cache hierarchy + eventual consistency

**"Hardware architecture lessons (bandwidth, hierarchy, caching, consistency)"** → Explicitly implemented in Memforge layers

**"Memory needs vectors, graphs, relational, temporal working together"** → Memforge backend integrates all types

**"Context window limitations impair consistency and role adherence"** → Memforge enforces role filtering + versioning

**"Explicit protocols for cache sharing and memory access needed"** → Defined in Memforge API + circuit breaker rules

**"Graceful degradation (serve cache, disable features)"** → Circuit breaker + fallback policies

**"Not all agents should see all memory"** → Role-based filtering at every access

---

**Version:** 1.0  
**Status:** Complete architecture redesign, ready for implementation  
**Next:** Create three detailed design documents (Core, Memforge, Resilience)
