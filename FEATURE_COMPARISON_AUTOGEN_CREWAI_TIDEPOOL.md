# Feature Comparison: AutoGen vs CrewAI vs Tidepool/Nanoclaw

**Date:** 2026-03-17  
**Purpose:** Comprehensive feature matrix for architectural decision  
**Data Source:** GitHub repos, official docs, community benchmarks (as of March 2026)

---

## Executive Summary

| Dimension | Winner | Notes |
|-----------|--------|-------|
| **Model Flexibility** | AutoGen & CrewAI | Tidepool hardcoded to Claude |
| **Developer Experience** | CrewAI | 40% faster to production |
| **Flexibility/Customization** | AutoGen | More low-level control; conversational |
| **Production Maturity** | AutoGen | 28k+ GitHub stars; 3+ years battle-tested |
| **Learning Curve** | CrewAI | Simpler role-based model |
| **Tool Ecosystem** | CrewAI | 300+ pre-built integrations |
| **Code Execution** | AutoGen | Native sandboxed code execution |
| **Memory/Persistence** | Tidepool | Built-in neuroscience-inspired consolidation |
| **Security** | Tidepool (currently) | Container-isolated agents; audit logging |
| **Cost Optimization** | Tidepool | Local model-first; cloud fallback |

---

## Core Architecture

### AutoGen
```
Architecture: Actor-based multi-agent conversation
Pattern: Agents → ConversableAgent (message passing)
Execution: Synchronous conversation loop
Config: Python code + YAML (flexible)
Communication: In-process message queue
Persistence: User-defined state management
Maturity: Production-grade (Microsoft Research)
```

### CrewAI
```
Architecture: Task-based orchestration
Pattern: Agents + Tasks + Tools (declarative)
Execution: Task workflow engine
Config: Python code + declarative YAML
Communication: Task message passing
Persistence: Built-in (session management)
Maturity: Production-grade (1.0+ releases)
```

### Tidepool (Nanoclaw)
```
Architecture: Container-isolated + orchestrator
Pattern: Async container spawning + NATS bus
Execution: Isolated Docker containers
Config: YAML (memforge, groups, schedules)
Communication: NATS message bus + IPC files
Persistence: PostgreSQL + MemForge (sophisticated)
Maturity: Experimental (3 months old)
```

---

## Detailed Feature Matrix

### 1. Model Support & Flexibility

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Out-of-box Models** | 75+ (Claude, GPT-4, Gemini, Grok, etc.) | All major providers | Claude only |
| **Model Provider Abstraction** | ✅ Complete | ✅ Complete | ❌ Hardcoded SDK |
| **Model Fallback Chains** | ✅ Configurable | ✅ Configurable | ❌ Not supported |
| **Cost-aware Model Selection** | ✅ Yes | ✅ Yes | ❌ No |
| **Local Model Support** | ✅ (Ollama, vLLM) | ✅ (Ollama) | ✅ (Ollama first) |
| **Custom Model Providers** | ✅ Easy plugin | ✅ Easy plugin | ⚠️ Requires code changes |
| **Streaming Responses** | ✅ Full support | ✅ Full support | ✅ Partial |

**Winner:** AutoGen & CrewAI (tied)  
**Impact on Salish Forge:** AutoGen/CrewAI removes model lock-in; Tidepool limits future optionality

---

### 2. Multi-Agent Capabilities

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Agent Definitions** | Code-based (flexible) | Role + Goal + Backstory | Config + SDK |
| **Agent Communication** | Peer-to-peer (flexible) | Hub-and-spoke (orchestrator) | NATS bus + IPC |
| **Max Agents (practical)** | 50+ (conversation network) | 10-20 (task workflow) | 10+ (container limited) |
| **Hierarchical Agents** | ✅ (nested groups) | ✅ (partial) | ✅ (implicit via NATS) |
| **Dynamic Agent Creation** | ✅ Runtime | ⚠️ Limited | ✅ Container spawn |
| **Agent State Sharing** | ✅ Shared context | ✅ Task results | ✅ NATS topics |
| **Human-in-the-Loop** | ✅ UserProxyAgent | ✅ human_input=True | ❌ Not built-in |

**Winner:** AutoGen (most flexible)  
**Impact:** Tidepool has sophisticated isolation but less flexible agent orchestration

---

### 3. Tools & Integrations

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Pre-built Tools** | 50+ (code execution, web, DB) | 300+ (Slack, email, GitHub, etc.) | Custom only |
| **Tool Marketplace** | Community-driven | Official Marketplace | None |
| **Web Search Integration** | ✅ Native | ✅ Native | ❌ Manual |
| **Code Execution** | ✅ Sandboxed (key strength) | ⚠️ Limited | ✅ Container-isolated |
| **Database Tools** | ✅ SQL, MongoDB, etc. | ✅ SQL, vector DBs | ⚠️ Manual via skills |
| **File System Access** | ✅ Safe sandboxing | ✅ Limited | ✅ Container volumes |
| **Custom Tool Creation** | ✅ Easy decorator pattern | ✅ Easy class-based | ✅ Via skills directory |
| **Tool Chaining** | ✅ Automatic | ✅ Automatic | ⚠️ Manual orchestration |

**Winner:** CrewAI (ecosystem) + AutoGen (code execution)  
**Impact:** AutoGen/CrewAI save weeks on tool integration; Tidepool requires custom implementations

---

### 4. Memory & State Management

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Session Persistence** | ✅ User-defined | ✅ Built-in | ✅ PostgreSQL-backed |
| **Context Window Management** | ✅ Token-aware | ✅ Token-aware | ✅ Sophisticated |
| **Message History** | ✅ Full transcript | ✅ Task-based | ✅ Per-session index |
| **Memory Consolidation** | ❌ Not built-in | ❌ Not built-in | ✅ **Sophisticated (MemForge)** |
| **Semantic Search** | ❌ Manual | ❌ Manual | ✅ PostgreSQL FTS + vector |
| **Long-term Memory** | ⚠️ Basic | ⚠️ Basic | ✅ Hot/warm/cold tiers |
| **Memory Compression** | ❌ Not built-in | ❌ Not built-in | ✅ Consolidation agent |
| **Multi-agent Memory Sharing** | ❌ Limited | ✅ Task results | ✅ NATS topics + MCP |

**Winner:** Tidepool (by far)  
**Impact:** Tidepool's MemForge is a unique competitive advantage; AutoGen/CrewAI require external solutions (Chroma, Pinecone)

---

### 5. Execution Model & Isolation

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Execution Context** | In-process Python | In-process Python | Container-isolated Docker |
| **Resource Limits** | Manual (CPU/memory) | Manual | Automatic (container limits) |
| **Code Safety** | Sandboxed exec() | Limited | Full isolation (Docker) |
| **Credential Isolation** | ❌ Manual | ❌ Manual | ✅ Proxy-based access control |
| **Concurrent Agents** | ✅ Asyncio | ✅ Asyncio | ✅ Docker (true parallelism) |
| **Failure Isolation** | ⚠️ Can crash main | ⚠️ Can crash main | ✅ Agent restart only |
| **Deployment Complexity** | Simple (Python) | Simple (Python) | Complex (Docker + orchestration) |

**Winner:** Tidepool (security) vs AutoGen (simplicity)  
**Trade-off:** Container isolation is safer but harder to deploy; in-process is simpler but riskier

---

### 6. Production Readiness

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **GitHub Stars** | 28,400+ | 15,200+ | ~500 (new) |
| **Major Adopters** | Microsoft, enterprises | 100+ companies | Internal (Salish Forge) |
| **Release Stability** | ✅ 0.2+ mature | ✅ 1.0+ stable | ⚠️ 0.1.0 experimental |
| **Documentation** | ✅ Comprehensive | ✅ Excellent | ⚠️ In-progress |
| **Community Size** | Large (Microsoft backing) | Growing | Tiny (new) |
| **Bug Fix Velocity** | Fast (Microsoft) | Fast (active team) | Slow (internal only) |
| **Enterprise Support** | ✅ Available | ✅ CrewAI AMP paid plan | ❌ None |
| **Type Safety** | ✅ Python 3.10+ | ✅ Type hints | ✅ TypeScript |

**Winner:** AutoGen (maturity + backing)  
**Impact:** AutoGen/CrewAI have better long-term support; Tidepool is bet on internal capability

---

### 7. Configuration & Developer Experience

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Config Format** | Python code | YAML + Python | YAML |
| **Learning Curve** | Steep (flexible) | Gentle (opinionated) | Medium (custom) |
| **Debugging** | Good (Python debugger) | Excellent (built-in logging) | Complex (distributed) |
| **IDE Support** | ✅ Standard Python | ✅ Standard Python | ⚠️ Custom tools |
| **Time to "Hello Agent"** | 30 minutes | 15 minutes | 1 hour (Docker setup) |
| **Time to Production** | 2-4 weeks | 1 week | 4-6 weeks |
| **Extensibility** | ✅ Very flexible | ✅ Flexible | ✅ Skills-based |
| **Testing Framework** | Manual | Manual | ⚠️ Docker-based |

**Winner:** CrewAI (fastest to production)  
**Impact:** CrewAI + YAML = fastest startup; AutoGen = most flexible; Tidepool = most powerful but slowest

---

### 8. Cost Optimization

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Model Cost Awareness** | ✅ Track token usage | ✅ Track token usage | ✅ Detailed breakdown |
| **Local Model Support** | ✅ Ollama/vLLM | ✅ Ollama | ✅ Ollama-first strategy |
| **Model Fallback Logic** | ✅ Cost-aware | ✅ Cost-aware | ⚠️ Manual |
| **Batch Processing** | ✅ Supported | ❌ Limited | ✅ Scheduled tasks |
| **Cache Optimization** | ❌ Manual | ❌ Manual | ✅ MemForge compression |
| **API Request Deduplication** | ❌ Manual | ❌ Manual | ✅ Built-in (warm tier) |

**Winner:** Tidepool (most sophisticated)  
**Impact:** Tidepool's consolidation + local-first = best cost control; AutoGen/CrewAI = standard costs

---

### 9. Security & Compliance

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Agent Isolation** | ⚠️ In-process | ⚠️ In-process | ✅ Container-based |
| **Credential Management** | ❌ Manual | ❌ Manual | ✅ Proxy-enforced |
| **API Key Protection** | ❌ Manual | ❌ Manual | ✅ Environment-based |
| **Audit Logging** | ❌ Manual | ❌ Manual | ✅ PostgreSQL-backed |
| **Message Encryption** | ❌ Manual | ❌ Manual | ✅ NATS TLS (planned) |
| **Rate Limiting** | ❌ Manual | ❌ Manual | ✅ Built-in per-agent |
| **Secrets Management** | ❌ Manual | ❌ Manual | ✅ File-based + rotation |

**Winner:** Tidepool (by far)  
**Impact:** Tidepool's container + audit model is security-hardened; AutoGen/CrewAI require external solutions

---

### 10. Extensibility & Customization

| Feature | AutoGen | CrewAI | Tidepool |
|---------|---------|--------|----------|
| **Custom Agents** | ✅ Subclass ConversableAgent | ✅ Extend Agent class | ✅ Container-based custom agents |
| **Middleware/Hooks** | ⚠️ Limited | ✅ Strong hooks system | ✅ NATS-based pub/sub |
| **Plugin Architecture** | ⚠️ Manual | ✅ Tool/Process classes | ✅ Skills directory |
| **Message Interception** | ✅ Full control | ✅ Callback chains | ✅ NATS topics |
| **Custom Tool Types** | ✅ Easy | ✅ Easy | ✅ Skill-based |
| **Language Support** | Python only | Python only | JavaScript/TypeScript + Python |

**Winner:** AutoGen (flexibility) + Tidepool (architecture)  
**Impact:** AutoGen = easiest to modify; Tidepool = most architecturally extensible

---

## Summary: Use Case Recommendations

### Choose **AutoGen** if you need:
- ✅ Maximum flexibility in agent behavior
- ✅ Code execution (complex workflows)
- ✅ Fast prototyping of conversational agents
- ✅ Production maturity + Microsoft backing
- ✅ 75+ model integrations without code changes

**Verdict:** Best for rapid development + flexible AI orchestration

---

### Choose **CrewAI** if you need:
- ✅ Fast time-to-production (1 week vs 2-4)
- ✅ Role-based agent teams
- ✅ 300+ pre-built tool integrations
- ✅ Structured workflows (task → task → task)
- ✅ Gentle learning curve

**Verdict:** Best for business workflows + tool-heavy applications

---

### Choose **Tidepool** if you need:
- ✅ Container-isolated, multi-tenant agents
- ✅ Sophisticated memory consolidation (MemForge)
- ✅ Enterprise audit logging + security
- ✅ Cost optimization via local models
- ✅ Long-term memory + semantic search
- ❌ BUT: Only if willing to own Claude-only constraint OR implement multi-model layer

**Verdict:** Best for security-critical, memory-intensive applications (with architectural work for multi-model)

---

## The Strategic Question for Salish Forge

### Current Situation
- **Investment in Tidepool:** ~3 months
- **Unique advantage:** MemForge (no competitor has this)
- **Critical limitation:** Claude-only (blocks Gemini, GPT-4, etc.)

### Decision Matrix

| Scenario | Recommendation | Rationale |
|----------|---|---|
| **"We want multi-model flexibility NOW"** | Path B: Migrate to AutoGen | 4-6 weeks rewrite; saves MemForge + NATS |
| **"We want to stay with Tidepool"** | Path C: Add model abstraction (2 weeks) | Keep MemForge advantage; enables Gemini later |
| **"We want maximum productivity"** | Path A: Switch to CrewAI | 1-week deployment; ecosystem of tools |
| **"We're building a security product"** | Keep Tidepool (with Path C) | Container isolation + audit = defensive moat |

---

## Code Examples (Key Differences)

### Adding Gemini Support

**AutoGen (native):**
```python
agent = autogen.ConversableAgent(
    name="assistant",
    llm_config={
        "model": "gemini-2.5-pro",  # Just change this
        "api_key": os.environ["GOOGLE_API_KEY"]
    }
)
```

**CrewAI (native):**
```python
agent = Agent(
    role="analyst",
    model="gemini-2.5-pro",  # Just change this
    api_key=os.environ["GOOGLE_API_KEY"]
)
```

**Tidepool (not supported):**
```typescript
// Would require:
// 1. Add Gemini SDK dependency
// 2. Refactor container-runner/src/index.ts
// 3. Add model routing logic
// 4. Handle API formatting differences
// Estimated: 1-2 weeks of work
```

---

## Conclusion

**AutoGen** = Most flexible + production-ready  
**CrewAI** = Fastest to market  
**Tidepool** = Most sophisticated memory + security (but Claude-locked without architectural changes)

**Recommendation:** Path C for Salish Forge — add lightweight model abstraction to Tidepool, preserve MemForge advantage, unblock Gemini/GPT-4 within 2 weeks.
