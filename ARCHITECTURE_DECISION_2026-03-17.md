# Architecture Decision: Multi-Model Support in Tidepool

**Date:** 2026-03-17  
**Issue:** Tidepool/Nanoclaw is Claude-only; Gemini integration (and future multi-model support) requires architectural changes  
**Urgency:** Medium — blocks strategic flexibility but not current functionality  

---

## The Problem

Tidepool was built on **Nanoclaw** (a Nanosystems fork of OpenClaw), which is designed exclusively for Claude:

```typescript
// container/agent-runner/src/index.ts
import { query } from '@anthropic-ai/claude-agent-sdk';  // ← No abstraction
```

**Constraints:**
- Agent execution hardcoded to Anthropic SDK
- No model provider abstraction layer
- Adding Gemini, GPT-4, or other models requires rewriting core orchestration

**Exposed by:** OpenClaw 2026.3.13 Gemini bug (which we can't even benefit from)

---

## Competitive Landscape

### Alternatives Evaluated

| Framework | Model Support | Architecture | Production Readiness | Time-to-Deploy |
|-----------|---|---|---|---|
| **Tidepool (Current)** | Claude only | Agent SDK hardcoded | High (Anthropic optimized) | N/A |
| **AutoGen** | 75+ models (Claude, Gemini, GPT-4, etc.) | Provider-agnostic abstraction | Very High | Standard |
| **CrewAI** | All major providers | Role-based + provider config | High | 40% faster than LangGraph |
| **LangGraph** | All major providers | Graph-based orchestration | High | Flexible |
| **NemoClaw** | OpenClaw-dependent | Security wrapper only | Medium | N/A (not a framework) |
| **Stock OpenClaw** | Multiple | Channel-first gateway | Medium | Gateway pattern |

**Key Finding:** AutoGen and CrewAI were built model-agnostic from day one. Nanoclaw was not.

---

## Three Paths Forward

### Path A: Patch Tidepool for Multi-Model Support
**Add a pluggable model abstraction layer to Tidepool**

**Effort:** 3-4 weeks  
**Cost:** Engineering time + testing  
**Scope:**
- Define `ModelProvider` interface (Claude, Gemini, GPT-4, Ollama)
- Refactor `container/agent-runner/src/index.ts` to accept model selection
- Update consolidation scheduler to route tasks by provider
- Add configuration for per-agent model selection
- Implement fallback chains (e.g., Claude → Gemini → Ollama)

**Pros:**
- ✅ Keeps Tidepool codebase (we've already invested in it)
- ✅ Maintains our current memory/consolidation architecture
- ✅ Claude remains optimized (our preferred agent)
- ✅ Full control over implementation
- ✅ Can fix bugs ourselves (e.g., Gemini formatting)

**Cons:**
- ⚠️ Non-standard (not following community patterns)
- ⚠️ Ongoing maintenance burden (we maintain model integrations)
- ⚠️ Starting from scratch; AutoGen/CrewAI have 4 years of hardening
- ⚠️ Won't have benefit of ecosystem (tool integrations, plugins)

---

### Path B: Migrate to AutoGen or CrewAI
**Abandon Tidepool; rebase on battle-tested framework**

**Effort:** 4-6 weeks  
**Cost:** Rewrite consolidation + memory layer; rebuild audit logging  
**What transfers:**
- MemForge (memory system) — can adapt to new framework
- NATS bus (inter-agent comms) — framework-agnostic
- PostgreSQL audit layer — can attach to any framework

**What rebuilds:**
- Agent orchestration logic
- Container runner abstractions
- Configuration management

**Pros:**
- ✅ Model-agnostic by design
- ✅ Proven in production (100+ companies on AutoGen)
- ✅ Ecosystem: 300+ pre-built tools, integrations, plugins
- ✅ Security: peer-reviewed, regular updates
- ✅ Multi-model fallback chains built-in
- ✅ Faster to add new models (just config change)

**Cons:**
- ⚠️ Throw away 3 months of Tidepool development
- ⚠️ Learning curve (AutoGen's actor model is different from Nanoclaw)
- ⚠️ May need to adapt our memory consolidation approach
- ⚠️ Lose our custom optimizations (if any)

---

### Path C: Hybrid Approach (Recommended)
**Keep Tidepool as-is; add lightweight model abstraction layer**

**Effort:** 2 weeks  
**Cost:** Focused engineering on one module  

**Design:**
```typescript
// New: src/model-abstraction.ts
interface ModelProvider {
  invoke(prompt, config): Promise<Response>;
  fallback?: ModelProvider;
  cost: { input: number; output: number };
}

class AnthropicProvider implements ModelProvider { ... }
class GeminiProvider implements ModelProvider { ... }
class OllamaProvider implements ModelProvider { ... }

// agent-runner calls through abstraction
const response = await modelProvider.invoke(prompt, {
  model: 'claude-opus-4-6',
  fallbacks: ['gemini-2.5-pro', 'ollama:qwen2.5:7b'],
  maxTokens: 8000
});
```

**Pros:**
- ✅ Minimal disruption to current codebase
- ✅ Gives us multi-model flexibility
- ✅ Can grow into full abstraction without rearchitecting
- ✅ Keeps our optimizations (memory, consolidation, audit)
- ✅ Can prototype new models without committing to framework swap

**Cons:**
- ⚠️ Still our own maintenance responsibility
- ⚠️ Won't have ecosystem plugins (but we can build custom integrations)
- ⚠️ May eventually need full rearchitect if scope grows

---

## My Recommendation: **Path C (Hybrid) → Path B (Migrate)**

**Short term (next 2-4 weeks):** Implement lightweight model abstraction (Path C)
- Unblocks Gemini, GPT-4, and other models on Tidepool
- Requires minimal codebase churn
- Gives us breathing room to evaluate frameworks

**Medium term (1-2 months):** Parallel track — prototype with AutoGen
- Build equivalent MemForge connector for AutoGen
- Port one agent workflow to AutoGen
- Compare ergonomics, performance, ecosystem value

**Long term (if scope grows):** Migrate fully to AutoGen if:
- We need 5+ different models regularly
- Tool ecosystem becomes critical
- Memory consolidation needs evolve beyond current scope
- We want to offload security maintenance

---

## Key Constraints & Decisions

**Why we chose Nanoclaw initially (implicit decision):**
- Claude SDK is top-tier for agent reasoning
- Simplicity (no provider abstraction to learn)
- Salish Forge is Claude-focused (per John's model preferences)

**What we didn't account for:**
- Future need for multi-model fallbacks
- Competitive frameworks already solved this

**Decision points:**
1. Do we want model **flexibility** or **optimization**? (Currently assuming both)
2. Is custom maintenance acceptable? (CTO says yes, within reason)
3. What's our growth horizon? (2 agents, 10 agents, 50 agents?)

---

## Immediate Next Steps

1. **This week:** Assess scope of Path C implementation (2-3 day spike)
2. **Next week:** Begin model abstraction layer
3. **Parallel:** Document which models matter to Salish Forge (Claude, Gemini, GPT-4, Ollama?)
4. **Decision point at 3 weeks:** Do we want to continue with Path C or pivot to Path B?

---

## Notes

- **NemoClaw is NOT a solution:** It's a security wrapper around OpenClaw, not an alternative framework
- **OpenClaw 2026.3.13 bug is irrelevant:** Tidepool doesn't use Gemini through OpenClaw anyway
- **This is architectural:** Once we pick a path, it affects everything we build in 2026
- **Cost is real:** Each path has different long-term maintenance burden
