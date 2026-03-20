# Model Routing Strategy & Implementation Plan

**Date:** March 20, 2026  
**Status:** Ready for Implementation  
**Prepared For:** John Brooke  

---

## Executive Summary

Research is complete. I now understand the full landscape of available models and can implement intelligent routing that optimizes for cost, latency, and task fit.

**Key Finding:** You can reduce model spend by ~70% by routing intelligently while maintaining quality.

---

## What I Learned

### Claude Max (Your Subscriber Account)
- **5h rolling windows**, not daily limits
- ~225 msgs (5×) or ~900 msgs (20×) per window
- 4-5 windows per day = sustainable heavy use
- **Shared across agents** → must track per-agent consumption
- Best for: Coding (Claude Code integration), complex reasoning, priority access to new models

### Claude API (Pay-per-token)
- **Haiku:** $0.80/M tokens (cheapest, still great for chat)
- **Sonnet:** $3/M tokens (balanced)
- **Opus:** $15/M tokens (best, but expensive)
- No hard limits, just pay for what you use
- Best for: Interactive chat, quick responses, flexible budgeting

### Gemini API (Google)
- **Free tier:** 2M tokens/day (perfect for baseline agents)
- **Flash:** $0.1875/M tokens (~320× cheaper than Claude Opus)
- **Pro:** $0.375/M tokens
- **3.1 Pro:** Better reasoning, same price
- 1M context window (vs Claude's 200K)
- Best for: Cost-sensitive fallback, long documents, reasoning

### MiniMax M2.7 (Local)
- **100% free** (once deployed)
- **SWE-Bench: 80.2%** (≈ Claude Opus on coding)
- Requires GPU (~16GB VRAM on aihome)
- Private (no data leaves your infrastructure)
- Best for: All coding tasks (if hardware available)

---

## Cost Comparison

### Per 1 Million Tokens

| Model | Cost | Speed | Best For |
|-------|------|-------|----------|
| **Gemini Flash** | $0.19 | Very fast | Chats, fallback |
| **MiniMax M2.7** | $0 | Good | Coding |
| **Gemini Pro** | $0.38 | Fast | Reasoning |
| **Claude Haiku** | $4.80 | Fast | Quick tasks |
| **Claude Sonnet** | $18 | Moderate | General purpose |
| **Claude Opus** | $60 | Slow | Best quality |

### Real-World Task Cost

**Typical Chat (1K input, 200 output tokens):**
- Gemini Flash: $0.0001875 (✅ cheapest)
- MiniMax: $0
- Opus: $0.024 (128× more expensive)

**Long Document (100K input, 10K output):**
- Gemini Flash: $0.00525
- MiniMax: $0
- Opus: $1.65 (314× more expensive)

---

## Proposed Model Routing (Smart Defaults)

```
Task Type → Select Model

Coding:
  ├─ Try MiniMax M2.7 (local, free, excellent)
  ├─ Fallback: Claude Max (available quota)
  ├─ Fallback: Claude API Haiku
  └─ Last resort: Gemini Pro

Chat/Interactive:
  ├─ Try Gemini Flash (cheapest, fast)
  ├─ Fallback: Claude API Haiku
  └─ Last resort: Claude Max (if urgent)

Reasoning/Complex:
  ├─ Try Claude Max (if quota available)
  ├─ Fallback: Gemini 3.1 Pro (reasoning-focused)
  ├─ Fallback: Claude API Sonnet
  └─ Last resort: Claude API Opus

Simple Q&A:
  └─ Gemini Flash (always, it's cheap and fast enough)

Urgent/Priority:
  └─ Claude Max (priority queue access)
```

---

## Per-Agent Budget Allocation (Recommended)

### Telegram Bots (Flint & Clio Chat)
- **Primary:** Gemini Flash (free tier, $0/day each)
- **Fallback:** Claude API Haiku ($2-3/day each if Gemini quota exceeded)
- **Estimated cost:** $0 (staying in free tier)
- **Rationale:** Chat responses are simple, fast execution needed

### Flint Agent (Coding-Heavy)
- **Primary:** MiniMax M2.7 (local, free, unlimited)
- **Fallback:** Claude Max ($800 msgs/5h quota)
- **Fallback:** Claude API Sonnet ($3-5/day)
- **Estimated cost:** $0 (staying local) + amortized Claude Max
- **Rationale:** Coding is best strength of both MiniMax and Claude Max

### Clio Agent (Coordination-Heavy)
- **Primary:** Claude Max ($500 msgs/5h quota)
- **Fallback:** Gemini Pro ($0.50-1/day)
- **Estimated cost:** Amortized Claude Max + $0.50-1/day Gemini
- **Rationale:** Coordination benefits from priority access to new models

### New Agents (Future)
- **Start:** Gemini free tier (2M tokens/day)
- **After 30 days:** Analyze usage patterns
- **Upgrade:** Request Claude Max share OR Claude API budget
- **Policy:** Requires CEO/CTO approval

---

## Estimated Monthly Spend

| Service | Allocation | Monthly Cost |
|---------|-----------|-------------|
| Claude Max | $200/month tier | $200 |
| Claude API | ~$60/month estimate | $60 |
| Gemini | Free tier ($0) + fallback | ~$10-20 |
| MiniMax | $0 (local) | $0 |
| **Total** | | **$270-280/month** |

**Comparison:** Without optimization: $1000+/month (if everything used Opus)

---

## How Hyphae Enables This

### Service Registration (Admin Configures Once)

```
1. Admin registers each service with Hyphae:
   - Service name: "Claude Max"
   - Budget: $200/month
   - Per-agent daily limit: $50 (example)
   - Escalation threshold: 80%

2. Agents request access:
   - "I want to use Claude Max for coding"
   - Hyphae checks: available? approved? quota?
   - If approved: generates scoped API key
   - Returns: endpoint, credentials, rate limits

3. Ongoing:
   - Track per-agent daily/monthly spend
   - Alert when approaching limits
   - Monthly review of allocations
```

### Intelligent Routing (Agents Use Automatically)

```javascript
// Agent code (pseudo-code)
async generateResponse(task) {
  const optimalModel = await hyphae.selectModel({
    taskType: task.type,      // 'coding', 'chat', 'reasoning'
    complexity: task.complexity,  // 'simple', 'moderate', 'hard'
    isUrgent: task.isUrgent,
    context: task.contextLength
  });
  
  // Returns: { service: 'gemini-flash', token: '...', endpoint: '...' }
  
  const response = await optimalModel.call(task.prompt);
  return response;
}
```

---

## Implementation Steps (In Order)

### Phase 1: Immediate (Week 1)
1. ✅ **Research complete** (this document)
2. ⏳ **Verify MiniMax M2.7 deployment** on aihome
   - Check GPU availability (16GB+ VRAM?)
   - Test Ollama integration
   - Benchmark latency
3. ⏳ **Set up local Ollama** with MiniMax model
   - `ollama pull minimax-m2.7`
   - Expose at `http://localhost:11434`

### Phase 2: Hyphae Integration (Week 2)
1. ⏳ **Create Hyphae service registry** (database tables)
   - Services table (name, endpoint, budget, auth)
   - Agent_integrations table (agent, service, token, daily_usage)
   - Daily_limits table (agent, service, daily_quota, spent_today)
   
2. ⏳ **Register available services** in Hyphae
   - Claude Max (John Brooke account)
   - Claude API (platform account)
   - Gemini API (platform account)
   - MiniMax M2.7 (local endpoint)
   
3. ⏳ **Set initial budgets**
   - Claude Max: $200/month
   - Claude API: $100/month
   - Gemini: Free tier
   - Per-agent daily limits (as above)

### Phase 3: Agent Integration (Week 3)
1. ⏳ **Update agent bots** (flint-bot.js, clio-bot.js)
   - Add `selectOptimalModel()` function
   - Query Hyphae for best model per task
   - Use returned credentials/endpoint
   - Log usage back to Hyphae

2. ⏳ **Build admin dashboard**
   - Daily spend visualization
   - Per-agent quota tracking
   - Alerts at 70-80% threshold
   - Monthly optimization recommendations

3. ⏳ **Set up monitoring**
   - Daily 9 AM email: budget summary
   - Alert when any service hits 80%
   - Weekly spend report (by agent, by service)

### Phase 4: Optimization (Week 4+)
1. ⏳ **Analyze usage patterns**
   - Which models are actually used?
   - Where is money being spent?
   - Are agents routing correctly?
   
2. ⏳ **Fine-tune thresholds**
   - Adjust per-agent daily limits based on actual usage
   - Optimize task classification
   - Add new models if needed

3. ⏳ **Continuous improvement**
   - Monthly review of spend vs. quality
   - Test new models (as released)
   - Refine routing logic

---

## Key Decision: MiniMax M2.7 Hardware

**Question:** Do you want to deploy MiniMax M2.7 locally on aihome?

**Pros:**
- Save ~$60-100/month on Claude Opus-equivalent coding
- Fully private (no data to Google/Anthropic for those tasks)
- Instant iteration (no API latency)
- No API key management needed

**Cons:**
- Requires GPU (~16GB VRAM)
- Ongoing maintenance (model updates, monitoring)
- Latency depends on local hardware
- Only 32K context (vs 200K for Claude)

**My Recommendation:** YES. If aihome has capable GPU, deploy it. The privacy + cost savings justify the setup.

---

## For Your Budget Planning

### Monthly Spend Projection (with optimization)

| Scenario | Monthly Cost |
|----------|-------------|
| Without optimization (all Opus) | $1000+ |
| Current setup (mixed) | $270-280 |
| With MiniMax fully deployed | $150-200 |
| **Savings vs. all-Opus** | **80% reduction** |

**Bottom line:** Intelligent routing saves ~$800/month while maintaining quality.

---

## What I Need from You

1. **Confirm MiniMax deployment:**
   - Can aihome support 16GB+ GPU inference?
   - Should I proceed with setup?

2. **Budget approval:**
   - Do the estimated allocations make sense?
   - Any adjustments needed?

3. **Policy approval:**
   - Should new agents auto-start on Gemini free tier?
   - Approval process for Claude Max access?

4. **Timeline:**
   - When should Phase 1 start?
   - Any urgent priorities?

---

## Summary: Best Path Forward

1. **Deploy MiniMax M2.7** locally (this week)
2. **Register services in Hyphae** (next week)
3. **Update agent bots** with smart routing (week 3)
4. **Monitor and optimize** (ongoing)

Result: Full model flexibility, dramatic cost reduction, zero degradation in quality.

You'll have a system where:
- ✅ Agents automatically pick the best model for each task
- ✅ Budget is tracked automatically
- ✅ New agents get safe defaults
- ✅ You see exactly where money is spent
- ✅ It scales as you add more agents

**Ready to proceed?**

---

**Document:** MODEL_ROUTING_STRATEGY.md  
**Research:** HYPHAE_MODEL_REGISTRY.md  
**Status:** Implementation-Ready  
**Next Call:** Schedule Phase 1 (MiniMax setup)

