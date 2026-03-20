# Hyphae Model Registry & Cost Optimizer

**Date:** March 20, 2026  
**Version:** 1.0  
**Purpose:** Centralized model cost/performance reference for agent-level model routing decisions

---

## Overview

This registry enables Hyphae to intelligently route agent requests across available LLM/inference backends, optimizing for cost, latency, and task appropriateness. Admin registers services; agents discover and select based on needs and budget.

---

## Service Registry

### **1. Claude Max (Subscriber Account — John Brooke)**

**Type:** Premium Subscription (Multi-agent shared budget)  
**Access Method:** Claude CLI (`claude` command)  
**Billing:** Monthly fixed fee, shared across all agents  
**Best For:** Coding tasks, complex reasoning, high-context work

| Metric | Max 5× | Max 20× |
|--------|--------|---------|
| **Monthly Cost** | $100 | $200 |
| **Usage vs Pro** | 5× | 20× |
| **Messages per 5h window** | ~225 | ~900 |
| **Reset Cycle** | Every 5 hours (rolling) | Every 5 hours (rolling) |
| **Priority Queue** | Yes | Yes |
| **Early Model Access** | Yes | Yes |
| **Output Limits** | High | Very High |

**Characteristics:**
- ✅ Excellent for coding (Claude Code integration)
- ✅ Very deep context handling
- ✅ Priority during peak hours
- ✅ Early access to new models (currently Opus 4.6, Sonnet 4.6)
- ❌ Fixed monthly cost regardless of usage
- ❌ Still has rolling limits (not truly unlimited)
- ❌ Shared across agents (usage tracking critical)

**Rate Limit Behavior:**
- No per-token billing; fixed monthly
- Hit ~900 msgs/5h on Max 20× → must wait 5 hours for next window
- Multiple cycles per day possible (24h ÷ 5h = ~4.8 cycles)

**Recommended Agents:** Flint (coding tasks), Clio (heavy coordination)  
**Budget Tracking:** Yes (watch rolling 5-hour windows)

---

### **2. Claude API (Anthropic Platform)**

**Type:** Pay-per-token API  
**Access Method:** HTTPS REST API  
**Billing:** Per 1,000,000 input/output tokens  
**Best For:** Chat, quick responses, cost-conscious tasks

| Model | Input Cost | Output Cost | Context | Speed |
|-------|-----------|-----------|---------|-------|
| **Claude Opus 4.6** | $15/M tokens | $45/M tokens | 200K | Slow |
| **Claude Sonnet 4.6** | $3/M tokens | $15/M tokens | 200K | Fast |
| **Claude Haiku 4.5** | $0.80/M tokens | $4/M tokens | 200K | Very Fast |

**Cost Examples (Per Task):**
- Typical chat request (1K input, 200 output): 
  - Opus 4.6: $0.024
  - Sonnet 4.6: $0.0048
  - Haiku 4.5: $0.00128
- Long document (100K input, 10K output):
  - Opus 4.6: $1.65
  - Sonnet 4.6: $0.33
  - Haiku 4.5: $0.088

**Characteristics:**
- ✅ Pay-per-use (no wasted budget)
- ✅ No rate limiting per se (pay for overages)
- ✅ Immediate model selection
- ✅ Fine-grained cost tracking
- ❌ Expensive for heavy/long tasks (Opus especially)
- ❌ Latency ~1-3 seconds (acceptable for chat)

**Rate Limits (Anthropic API):**
- Free tier: 5 API requests/min
- Paid tier: Much higher (typically not limiting)
- Concurrent requests: Reasonable (not documented, but ~100s)

**Recommended Agents:** Telegram bots (Flint, Clio for quick chat)  
**Budget Tracking:** Yes (daily/monthly quota possible)

---

### **3. Gemini API (Google)**

**Type:** Pay-per-token (Free tier available)  
**Access Method:** HTTPS REST API (Google AI Studio, Vertex AI)  
**Billing:** Per 1,000,000 input/output tokens (free tier: 2M tokens/day)  
**Best For:** Reasoning tasks, cost-effective fallback

| Model | Input Cost | Output Cost | Context | Speed |
|-------|-----------|-----------|---------|-------|
| **Gemini 3.1 Pro** | $0.075/M tokens | $0.30/M tokens | 1M | Moderate |
| **Gemini 2.5 Pro** | $0.075/M tokens | $0.30/M tokens | 1M | Fast |
| **Gemini 2.5 Flash** | $0.0375/M tokens | $0.15/M tokens | 1M | Very Fast |

**Cost Examples:**
- Typical chat (1K input, 200 output):
  - Gemini 3.1 Pro: $0.00009
  - Gemini 2.5 Flash: $0.0000675
- Long document (100K input, 10K output):
  - Gemini 3.1 Pro: $0.0105
  - Gemini 2.5 Flash: $0.00525

**Free Tier:**
- 2M tokens/day shared across all models
- Rate limit: 1 request per second
- Perfect for low-volume agents

**Characteristics:**
- ✅ Extremely cheap (1/150th cost of Claude Opus)
- ✅ 1M context window (massive)
- ✅ Free tier available (2M tokens/day)
- ✅ Good for reasoning (3.1 Pro)
- ❌ Latency slightly higher (~2-4 sec)
- ❌ Quality varies vs Claude on complex code

**Recommended Agents:** All agents as default/fallback  
**Budget Tracking:** Yes (can set daily spend limit)

---

### **4. MiniMax M2.7 (Local, via Ollama)**

**Type:** Local inference (self-hosted)  
**Access Method:** Ollama API (localhost:11434)  
**Billing:** Free (infrastructure cost only)  
**Best For:** Coding, local-only tasks, cost optimization

| Metric | Value |
|--------|-------|
| **Cost per token** | $0 (amortized infrastructure) |
| **ELO Score** | 1495 (highest open-source) |
| **Code Benchmark (SWE-Bench)** | 80.2% (≈ Claude Opus) |
| **Latency** | ~1-2 sec per token (GPU dependent) |
| **Context** | 32K tokens |
| **Requires** | GPU (NVIDIA recommended) |

**Hardware Requirements:**
- NVIDIA GPU (RTX 3090 / A100 / H100 recommended)
- 16GB+ VRAM
- Local network inference (no internet required)
- Running on aihome (dedicated machine)

**Performance Characteristics:**
- ✅ Genuinely competitive with Claude Opus on coding
- ✅ Zero per-token cost
- ✅ Private (no data leaves your infrastructure)
- ✅ Fast iteration (instant model updates)
- ❌ Latency depends on local GPU
- ❌ Requires maintenance (updates, monitoring)
- ❌ Not good for very long contexts (32K cap)

**Recommended Agents:** All agents for coding tasks (if hardware available)  
**Budget Tracking:** Implicit (amortized hardware cost)

---

## Cost Comparison Matrix

### Per 1M Tokens (Typical Agent Workload)

| Model | Cost | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| **Gemini 2.5 Flash** | $0.1875 | Fastest | Good | Chats, fallback |
| **MiniMax M2.7** | $0 | Good | Excellent (coding) | Local coding |
| **Gemini 2.5 Pro** | $0.375 | Fast | Excellent | Reasoning fallback |
| **Claude Haiku 4.5** | $4.80 | Fast | Good | Quick tasks |
| **Claude Sonnet 4.6** | $18 | Moderate | Excellent | General purpose |
| **Claude Opus 4.6** | $60 | Slow | Best | Complex reasoning |
| **Claude Max (amortized)** | $100-200/month | N/A | Excellent | Shared heavy work |

---

## Daily/Monthly Limits & Quotas

### Claude Max (Subscriber)
- **Daily:** ~4-5 rolling 5-hour windows = ~3,600-4,500 msgs potential
- **Monthly:** Fixed $100 or $200 (no usage limit per se)
- **Per-Agent Cap:** Recommend 500 msgs/day per agent (flexible)
- **Warning Threshold:** 70% of rolling window
- **Hard Stop:** Rolling 5-hour window exhausted

### Claude API (Pay-per-token)
- **Daily Limit:** Optional ($20-50 recommended)
- **Monthly Limit:** Optional ($500-1000 recommended)
- **Per-Agent Cap:** Recommend $5-10/day per agent
- **Warning Threshold:** 70% of daily limit
- **Hard Stop:** Budget exhausted (request rejected)

### Gemini API (Free Tier)
- **Daily Limit:** 2M tokens/day (free)
- **Per-Agent Cap:** ~200K tokens/day per agent
- **Warning Threshold:** 70% of daily limit
- **Hard Stop:** 24h reset

### Gemini API (Paid)
- **Daily Limit:** Optional ($20 recommended)
- **Monthly Limit:** Optional ($600 recommended)
- **Per-Agent Cap:** Recommend $2-5/day per agent
- **Hard Stop:** Budget exhausted

### MiniMax M2.7 (Local)
- **Daily Limit:** None (local infrastructure cost)
- **Per-Agent Cap:** None
- **Monitoring:** GPU utilization, latency
- **Hard Stop:** Local GPU fully saturated (~80% utilization = slow)

---

## Intelligent Routing Algorithm

```javascript
// Core routing decision tree (pseudo-code)

async selectOptimalModel(agent, task, budget) {
  // 1. Check task type
  if (task.type === 'coding') {
    // Try free first, then cheap
    if (canUseLocal('minimax-m2.7')) return 'minimax-m2.7';
    if (hasQuotaToday('claude-max')) return 'claude-max';
    if (hasQuotaToday('claude-api-haiku')) return 'claude-api-haiku';
    return 'gemini-2.5-pro';
  }
  
  // 2. Check task complexity
  if (task.complexity === 'simple') {
    // Gemini is cheapest + fast enough
    if (hasQuota('gemini-free')) return 'gemini-2.5-flash';
    return 'gemini-2.5-pro';
  }
  
  // 3. Check time sensitivity
  if (task.isUrgent) {
    // Use fastest available
    if (hasQuota('claude-max')) return 'claude-max';
    return 'claude-api-sonnet';  // Next fastest
  }
  
  // 4. Default: Balance cost & quality
  if (task.complexity === 'moderate') {
    if (hasQuotaToday('claude-max')) return 'claude-max';
    if (hasQuotaToday('claude-api-sonnet')) return 'claude-api-sonnet';
    return 'gemini-2.5-pro';
  }
  
  // 5. Complex reasoning: Use best available
  if (task.complexity === 'hard') {
    if (hasQuotaToday('claude-max')) return 'claude-max';
    if (hasQuotaToday('claude-api-opus')) return 'claude-api-opus';
    return 'gemini-3.1-pro';  // Reasoning fallback
  }
  
  // Fallback
  return 'gemini-2.5-flash';  // Always available, cheap
}
```

---

## Agent Budget Allocation (Recommended)

### Per-Agent Daily Quotas

**Flint (CTO — Heavy Coding)**
- Claude Max: 800 msgs/5h (primary)
- Claude API Haiku: $2/day (fallback)
- MiniMax M2.7: Unlimited local
- Gemini: Fallback (free tier)

**Clio (Chief of Staff — Coordination)**
- Claude Max: 500 msgs/5h
- Claude API Sonnet: $1/day
- Gemini 2.5 Pro: $0.50/day
- **No local model** (text-heavy, not code)

**Telegram Bots (Flint/Clio Chat)**
- Claude API Sonnet: $1-2/day each (chat responses)
- Gemini 2.5 Flash: Unlimited free tier
- **NO Claude Max** (interactive, not heavy)

**New Agents (Future)**
- Start: Gemini free tier only
- Upgrade: After 30 days usage pattern analysis
- Max access: Requires CEO/CTO approval

---

## Monitoring & Alerts

### Daily Dashboard (Hyphae tracks)
```
Claude Max Budget:
  ├─ Current 5h window usage: 567/900 (63%)
  ├─ Previous windows: 89%, 75%, 82% (trends)
  └─ Alert if: >80% of rolling window

Claude API Spend:
  ├─ Today: $2.34 / $20 budget
  ├─ YTD: $47.23 / $500 budget
  └─ Alert if: >70% of daily

Gemini API Spend:
  ├─ Today: 1.2M / 2M tokens (free)
  ├─ YTD: $15 / $600 budget
  └─ Alert if: >70% of any limit

MiniMax M2.7:
  ├─ GPU utilization: 45%
  ├─ Avg latency: 1.2 sec/token
  └─ Alert if: >80% utilization
```

### Weekly Report
- Total spend across all services
- Cost per agent
- Model selection distribution
- Savings from optimizations

---

## Service Registration Workflow (Hyphae)

```
1. Admin Registers Service
   ├─ Name: "Claude Max"
   ├─ Type: "coding" | "reasoning" | "chat"
   ├─ Endpoint: URL or CLI command
   ├─ Auth: API key or credentials
   ├─ Budget: Monthly cap
   └─ Approval: Required

2. Agent Requests Integration
   ├─ "I need coding capability"
   ├─ Hyphae shows available: Claude Max, Claude API, MiniMax, Gemini
   ├─ Agent selects service
   └─ Admin reviews + approves

3. Post-Approval
   ├─ Hyphae generates auth token (scoped)
   ├─ Agent receives: endpoint, credentials, rate limits
   ├─ Usage logging begins
   └─ Daily alerts on budget

4. Ongoing
   ├─ Track per-agent spend
   ├─ Alert on unusual patterns
   ├─ Annual review of allocations
   └─ Replenish or adjust
```

---

## Hyphae Configuration Template

```yaml
# hyphae-services.yaml
services:
  claude-max:
    type: "subscription"
    models: ["claude-opus-4-6", "claude-sonnet-4-6"]
    access: "claude-cli"
    billing: "fixed-monthly"
    monthly_cost: 200
    monthly_budget_msgs: 4500  # 5 windows × 900 msgs
    per_agent_daily_limit: 800
    escalation_threshold: 0.80  # Alert at 80%
    
  claude-api:
    type: "pay-per-token"
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]
    access: "https-rest"
    billing: "per-token"
    monthly_budget: 1000  # USD
    per_agent_daily_limit: 5  # USD
    escalation_threshold: 0.70
    
  gemini-api:
    type: "pay-per-token"
    models: ["gemini-3-1-pro", "gemini-2-5-pro", "gemini-2-5-flash"]
    access: "https-rest"
    billing: "per-token"
    monthly_budget: 600  # USD
    per_agent_daily_limit: 20  # tokens
    free_tier_limit: 2000000  # 2M/day
    escalation_threshold: 0.70
    
  minimax-m2.7:
    type: "local-inference"
    models: ["minimax-m2.7"]
    access: "ollama-api"
    billing: "free"
    hardware: "aihome-gpu"
    gpu_utilization_threshold: 0.80
    per_agent_daily_limit: null  # unlimited
```

---

## Initial Agent Allocations (John Brooke Account)

| Agent | Claude Max | Claude API | Gemini Free | MiniMax | Monthly Est. |
|-------|----------|-----------|-------------|---------|-------------|
| Flint Bot | 800 msgs/5h | $2/day | Unlimited | Yes | $200 (Max) + $60 (API) |
| Clio Bot | 500 msgs/5h | $1/day | Unlimited | No | $200 (Max) + $30 (API) |
| Flint Coding | 1000 msgs/5h | $3/day | Unlimited | Yes | Included above + local |
| Clio Coord | 700 msgs/5h | $2/day | Unlimited | No | Included above |
| New Agents | Upon approval | $5/day each | Unlimited | Case-by-case | +$150/month per agent |

**Total Estimated:** $200 (Claude Max) + ~$200 (Claude API) + $0 (Gemini free) + $0 (local) = **$400/month**

---

## Next Steps: Implementation

1. ✅ Create this registry in Hyphae database
2. ⏳ Build Hyphae service registration UI (admin)
3. ⏳ Implement intelligent routing in agent SDKs
4. ⏳ Set up daily budget alerts + reporting
5. ⏳ Train agents on model selection strategy
6. ⏳ Monthly review of allocations and optimization

---

**Document Version:** 1.0  
**Last Updated:** March 20, 2026  
**Maintained By:** Flint (CTO)  
**Review Cycle:** Monthly

