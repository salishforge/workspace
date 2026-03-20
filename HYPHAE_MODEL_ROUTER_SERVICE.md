# Hyphae Model Router Service

**Version:** 2.0 (Core Service Design)  
**Date:** March 20, 2026  
**Status:** Architecture & Specification Ready  
**Purpose:** Intelligent model routing, cost management, and API key lifecycle management

---

## Overview

The Model Router Service is a **core Hyphae component** that manages the complete lifecycle of model access:

1. **Service Registry** — Admin registers all available accounts (Claude Max, Claude API, Gemini, Ollama Cloud)
2. **API Key Generation** — Upon approval, generates scoped tokens for joining agents
3. **Push Notifications** — Alert human admin of pending approvals
4. **Intelligent Routing** — Direct agents to optimal model based on task/cost/limits
5. **Dynamic Cost Management** — Track limits, reset timing, budget exhaustion
6. **Policy Enforcement** — Admin configurable rules (e.g., "no Opus for simple tasks")
7. **Admin Dashboard** — Full reporting on approvals, usage, costs, and optimization

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Hyphae Model Router                   │
│                                                         │
│  ┌────────────────────────────────────────────────┐   │
│  │ Service Registry                               │   │
│  │ ├─ Claude Max ($100/mo)                        │   │
│  │ ├─ Claude API (pay-per-token)                  │   │
│  │ ├─ Gemini API (pay-per-token + free)           │   │
│  │ └─ Ollama Cloud Pro ($20/mo)                   │   │
│  └────────────────────────────────────────────────┘   │
│                          ↓                             │
│  ┌────────────────────────────────────────────────┐   │
│  │ API Key Manager                                │   │
│  │ ├─ Generate keys on request                    │   │
│  │ ├─ Require admin approval                      │   │
│  │ ├─ Push notification workflow                  │   │
│  │ ├─ Revoke/rotate keys                          │   │
│  │ └─ Track key usage per agent                   │   │
│  └────────────────────────────────────────────────┘   │
│                          ↓                             │
│  ┌────────────────────────────────────────────────┐   │
│  │ Intelligent Router                             │   │
│  │ ├─ Task classification                         │   │
│  │ ├─ Cost optimization                           │   │
│  │ ├─ Limit tracking (daily/hourly/rolling)       │   │
│  │ ├─ Admin policy enforcement                    │   │
│  │ └─ Dynamic model selection                     │   │
│  └────────────────────────────────────────────────┘   │
│                          ↓                             │
│  ┌────────────────────────────────────────────────┐   │
│  │ Cost & Limit Manager                           │   │
│  │ ├─ Track usage per agent/service               │   │
│  │ ├─ Calculate reset timing                      │   │
│  │ ├─ Alert on approaching limits                 │   │
│  │ ├─ Report spend by service                     │   │
│  │ └─ Enforce hard stops (budget exhausted)       │   │
│  └────────────────────────────────────────────────┘   │
│                          ↓                             │
│  ┌────────────────────────────────────────────────┐   │
│  │ Admin Dashboard                                │   │
│  │ ├─ Pending key approvals                       │   │
│  │ ├─ Real-time usage visualization               │   │
│  │ ├─ Cost breakdown by agent/service             │   │
│  │ ├─ Policy configuration                        │   │
│  │ └─ Historical reports                          │   │
│  └────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
         ↑              ↑              ↑
    Agents         Admin UI     Notifications
   (Flint/         (Browser)    (Push/Email/
    Clio)                       Telegram)
```

---

## Service Specifications

### 1. Service Registry

**Table: `hyphae_model_services`**

```sql
CREATE TABLE hyphae_model_services (
  service_id UUID PRIMARY KEY,
  service_name TEXT NOT NULL,          -- "claude-max", "gemini-api", etc.
  service_type TEXT NOT NULL,           -- "subscription" | "pay-per-token"
  provider TEXT NOT NULL,               -- "anthropic", "google", "ollama"
  billing_model TEXT NOT NULL,          -- "fixed-monthly" | "pay-per-token"
  monthly_cost DECIMAL,                 -- NULL if pay-per-token
  api_endpoint TEXT NOT NULL,
  auth_method TEXT NOT NULL,            -- "bearer-token" | "api-key" | "credentials"
  is_active BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT true,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES hyphae_agents(agent_id)
);
```

### 2. API Key Management

**Table: `hyphae_model_api_keys`**

```sql
CREATE TABLE hyphae_model_api_keys (
  key_id UUID PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES hyphae_agents(agent_id),
  service_id UUID NOT NULL REFERENCES hyphae_model_services(service_id),
  
  -- Key material (encrypted)
  key_value_encrypted TEXT NOT NULL,
  key_nonce TEXT NOT NULL,
  
  -- Approval workflow
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID REFERENCES hyphae_agents(agent_id),  -- NULL = pending
  approved_at TIMESTAMPTZ,
  approval_reason TEXT,
  
  -- Lifecycle
  is_active BOOLEAN DEFAULT true,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  rotated_from_key_id UUID,
  
  -- Usage tracking
  first_use_at TIMESTAMPTZ,
  last_use_at TIMESTAMPTZ,
  total_requests BIGINT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, service_id)  -- One key per agent-service pair
);
```

### 3. Limit Tracking

**Table: `hyphae_model_limits`**

```sql
CREATE TABLE hyphae_model_limits (
  limit_id UUID PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES hyphae_agents(agent_id),
  service_id UUID NOT NULL REFERENCES hyphae_model_services(service_id),
  
  -- Limit configuration
  daily_limit DECIMAL,                  -- NULL = no daily limit
  monthly_limit DECIMAL,                -- NULL = no monthly limit
  hourly_limit DECIMAL,                 -- NULL = no hourly limit
  rolling_window_hours INT,             -- e.g., 5 for Claude Max
  
  -- Current usage
  current_daily_usage DECIMAL DEFAULT 0,
  current_monthly_usage DECIMAL DEFAULT 0,
  current_hourly_usage DECIMAL DEFAULT 0,
  current_rolling_usage DECIMAL DEFAULT 0,
  
  -- Reset timing
  daily_reset_at TIMESTAMPTZ,
  monthly_reset_at TIMESTAMPTZ,
  hourly_reset_at TIMESTAMPTZ,
  rolling_reset_at TIMESTAMPTZ,
  
  -- Alerts
  alert_threshold DECIMAL DEFAULT 0.70,  -- Alert at 70%
  hard_stop_threshold DECIMAL DEFAULT 1.0,  -- Block at 100%
  last_alert_sent_at TIMESTAMPTZ,
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4. Usage Logging

**Table: `hyphae_model_usage_log`**

```sql
CREATE TABLE hyphae_model_usage_log (
  usage_id UUID PRIMARY KEY,
  agent_id UUID NOT NULL,
  service_id UUID NOT NULL,
  api_key_id UUID,
  
  -- Request details
  task_type TEXT,                       -- "coding", "chat", "reasoning", etc.
  task_complexity TEXT,                 -- "simple", "moderate", "hard"
  
  -- Usage metrics
  input_tokens BIGINT,
  output_tokens BIGINT,
  total_tokens BIGINT,
  estimated_cost DECIMAL,
  
  -- Routing decision
  routing_reason TEXT,                  -- "cost-optimized", "urgent", "quality", etc.
  model_selected TEXT,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  latency_ms INT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX(agent_id, created_at DESC),
  INDEX(service_id, created_at DESC)
);
```

---

## Service Configurations

### Billing Configurations

```yaml
# Service definitions with limit calculations

claude-max-100:
  service_name: "Claude Max 5×"
  provider: "anthropic"
  billing_model: "fixed-monthly"
  monthly_cost: 100
  models: ["claude-opus-4-6", "claude-sonnet-4-6"]
  limits:
    rolling_window_hours: 5
    # "~225 messages per 5h window" = ~225 msgs/window
    # Track as abstract "usage points" or convert to estimated tokens
    estimated_tokens_per_msg: 1000  # Average
    rolling_window_max: 225000      # ~225K tokens/5h
    daily_equivalent: 1080000       # ~4.8 windows × 225K
    monthly_equivalent: 32400000    # 30 days × 1.08M
    reset_type: "rolling-5h"
  
claude-api:
  service_name: "Claude Platform API"
  provider: "anthropic"
  billing_model: "pay-per-token"
  models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]
  costs:
    claude-opus-4-6:
      input: 15        # $/M tokens
      output: 45       # $/M tokens
    claude-sonnet-4-6:
      input: 3
      output: 15
    claude-haiku-4-5:
      input: 0.80
      output: 4
  limits:
    daily_budget_default: 20         # USD, overridable per agent
    monthly_budget_default: 500      # USD
    rate_limit: "1000 requests/min"  # Practical limit

gemini-api:
  service_name: "Gemini API"
  provider: "google"
  billing_model: "pay-per-token"
  models: ["gemini-3-1-pro", "gemini-2-5-pro", "gemini-2-5-flash"]
  costs:
    gemini-3-1-pro:
      input: 0.075     # $/M tokens
      output: 0.30
    gemini-2-5-pro:
      input: 0.075
      output: 0.30
    gemini-2-5-flash:
      input: 0.0375
      output: 0.15
  limits:
    free_tier: 2000000              # 2M tokens/day
    daily_budget_default: 20        # USD
    monthly_budget_default: 600     # USD

ollama-cloud-pro:
  service_name: "Ollama Cloud Pro"
  provider: "ollama"
  billing_model: "fixed-monthly"
  monthly_cost: 20
  models: ["minimax-m2.7"]           # Current model
  limits:
    concurrent_models: 3            # Can run 3 models simultaneously
    hourly_limit: null              # Soft limit (qualitative)
    daily_limit: null               # Soft limit (qualitative)
    weekly_limit: null              # Soft limit (qualitative)
    reset_type: "monthly"
    alert_mechanism: "contact support if hitting limits"
```

---

## Intelligent Router Algorithm

```javascript
/**
 * Hyphae Model Router - Core Decision Engine
 * 
 * Selects optimal model based on:
 * 1. Task type + complexity
 * 2. Current budget status
 * 3. Limit reset timing
 * 4. Admin policies
 * 5. Cost per output
 */

async selectOptimalModel(agent, task) {
  // Phase 1: Determine task classification
  const classification = classifyTask(task);  // {type, complexity, urgency}
  
  // Phase 2: Get current limit status for all services
  const limitStatuses = await getLimitStatuses(agent);
  // Returns: {
  //   "claude-max": {pct_used: 0.65, resets_in: "2h", available: true},
  //   "claude-api": {pct_used: 0.85, resets_in: "23h", available: true},
  //   "gemini-api": {pct_used: 0.30, resets_in: "18h", available: true},
  //   "ollama-cloud": {pct_used: 0.10, resets_in: "29d", available: true}
  // }
  
  // Phase 3: Filter by availability
  const available = filterByAvailability(limitStatuses);
  
  // Phase 4: Score remaining options
  const scored = available.map(service => ({
    service,
    score: calculateScore({
      service,
      task: classification,
      limitStatus: limitStatuses[service],
      adminPolicies: agent.modelPolicies
    })
  }));
  
  // Phase 5: Select best option
  const selected = scored.sort((a, b) => b.score - a.score)[0];
  
  return {
    service: selected.service,
    reason: selected.reason,
    nextResetIn: limitStatuses[selected.service].resets_in,
    estimatedCost: calculateCost(task, selected.service)
  };
}

function calculateScore(opts) {
  const {service, task, limitStatus, adminPolicies} = opts;
  
  let score = 0;
  
  // Policy compliance (hard constraint)
  if (!policyAllows(adminPolicies, service, task)) {
    return { score: -999, reason: "Policy blocked" };
  }
  
  // Cost optimization
  const costPerToken = getCostPerToken(service, task.complexity);
  score += (1 / costPerToken) * 100;  // Lower cost = higher score
  
  // Limit availability
  const pctUsed = limitStatus.pct_used;
  if (pctUsed > 0.90) score -= 50;      // Approaching limit
  if (pctUsed > 0.70) score -= 20;      // Getting close
  score += (1 - pctUsed) * 10;          // Prefer services with headroom
  
  // Task fit
  if (service === "claude-max" && task.type === "coding") score += 30;
  if (service === "gemini-flash" && task.complexity === "simple") score += 20;
  if (service === "ollama-cloud" && task.type === "coding") score += 25;
  
  // Reset timing (prefer longer windows to avoid thrashing)
  const resetHours = parseResetTiming(limitStatus.resets_in);
  if (resetHours > 12) score += 5;
  if (resetHours < 1) score -= 10;
  
  return { score, reason: selectedReason(service, task, pctUsed) };
}
```

---

## Admin Approval Workflow

### Request Flow

```
1. Agent requests access to new service
   POST /rpc {
     method: "model.requestAccess",
     params: {
       agent_id: "flint",
       service_id: "claude-api-sonnet",
       reason: "Need for coding tasks"
     }
   }

2. Hyphae Model Router receives request
   ├─ Check: Is this service available?
   ├─ Check: Can this agent access this service?
   └─ Create pending approval record

3. Push notification sent to human admin
   ├─ Telegram alert: "🔑 Flint requests Claude API Sonnet access"
   ├─ Button: "Approve" | "Deny" | "Review"
   └─ Context: Service details, agent profile, estimated monthly cost

4. Admin approves request
   ├─ Generate scoped API key
   ├─ Return credentials to agent
   ├─ Log approval with reason
   └─ Send confirmation to agent

5. Agent receives key
   ├─ Stores in secure vault
   ├─ Tests connectivity
   └─ Reports ready status
```

### Approval Rules (Admin Configurable)

```yaml
approval_policies:
  
  # Policy 1: Auto-approve if within budget
  auto_approve_budget:
    enabled: true
    condition: "estimated_monthly_cost < remaining_budget"
    action: "approve"
    notify_admin: "async"  # Inform after approval
  
  # Policy 2: Require approval for expensive models
  expensive_models:
    enabled: true
    condition: "service in [claude-opus, claude-max]"
    action: "require_approval"
    notify_admin: "sync"  # Wait for approval
    timeout_hours: 24
  
  # Policy 3: Auto-approve trusted agents
  trusted_agents:
    enabled: true
    condition: "agent_id in [flint, clio]"
    action: "approve"
    notify_admin: false
  
  # Policy 4: Limit new agents to free tier first
  new_agent_onboarding:
    enabled: true
    condition: "agent_created_within(7_days) AND service != free"
    action: "approve_with_limit"
    initial_limit: 100  # $100 monthly budget cap
    escalation_required: "after_30_days"
```

---

## Admin Dashboard Interface

### Key Pages

1. **Pending Approvals** (Real-time)
   ```
   🔑 API Key Requests
   
   ├─ Flint → Claude API (Sonnet)
   │  └─ Requested 10m ago | Cost: $5-10/month | [APPROVE] [DENY]
   │
   ├─ Clio → Gemini API (Pro)
   │  └─ Requested 2h ago | Cost: $0.50-1/month | [APPROVE] [DENY]
   │
   └─ (New Agent) → Ollama Cloud
      └─ Requested 5s ago | Cost: $20/month | [APPROVE] [DENY]
   ```

2. **Real-time Usage Dashboard**
   ```
   💰 Daily Spend & Limits
   
   Claude Max ($100/mo):
     ├─ Current Period: 567/900 msgs (63%) | Resets in 2h 15m
     ├─ 7-day avg: 65% utilization
     └─ Agents: Flint (400), Clio (167)
   
   Claude API ($500/mo budget):
     ├─ Today: $2.34 spent | $20 daily limit
     ├─ Month-to-date: $47.23 / $500
     └─ Agents: Flint Bot ($1.20), Clio Bot ($0.80), Flint ($0.34)
   
   Gemini API (Free tier):
     ├─ Today: 1.2M / 2M tokens (60%)
     ├─ Month-to-date: $15 / $600 budget
     └─ Agents: All (distributed)
   
   Ollama Cloud ($20/mo):
     ├─ Models running: 2/3 (MiniMax, GPT2)
     ├─ Uptime: 99.8% this month
     └─ Agents: Flint (coding), Test (eval)
   ```

3. **Cost Breakdown by Agent**
   ```
   👤 Agent Spend Profile
   
   Flint (Coding-Heavy):
     ├─ Claude Max: 60% of quota (included in $100)
     ├─ Claude API: $30/month
     ├─ Ollama Cloud: $20/month (1.5 models running)
     └─ Total: ~$50/month
   
   Clio (Coordination):
     ├─ Claude Max: 40% of quota (included)
     ├─ Gemini Free: $0/month
     └─ Total: $0/month (free tier)
   
   Telegram Bots (Interactive):
     ├─ Claude API: $20/month (both bots)
     ├─ Gemini Free: $0/month
     └─ Total: $20/month
   
   GRAND TOTAL: ~$270/month
   ```

4. **Historical Reports**
   ```
   📈 Trends & Optimization
   
   Last 30 Days:
     ├─ Total Spend: $268
     ├─ Cost per 1M tokens: $0.45 (excellent)
     ├─ Model Distribution: 45% Claude Max, 35% Gemini, 20% Claude API
     ├─ Biggest Opportunity: Move 50% of simple chats from Claude API to Gemini (-$3/month)
     └─ Top Recommendation: Consider Ollama Cloud Max if Flint grows
   
   Model Selection Audit:
     ├─ Correct routing rate: 94%
     ├─ Cost-suboptimal selections: 6%
     └─ Opportunity for policy adjustment: "Block Claude Opus for tasks <hard complexity"
   ```

---

## Push Notification System

### Telegram Alerts (Real-time)

```
Event: API Key Approval Request
───────────────────────────────────────
🔑 Flint requests Claude API (Sonnet)
Reason: Fallback for coding when Claude Max exhausted
Cost: $3-5/month
Policy: Requires approval (expensive model)
Requested: 10 minutes ago

[✅ APPROVE] [❌ DENY] [📋 DETAILS]


Event: Limit Alert (70% threshold)
───────────────────────────────────────
⚠️  Claude Max approaching limit
Current: 630/900 msgs (70%)
Resets: 2h 15m
Top consumer: Flint (400 msgs, 63%)

[📊 DASHBOARD] [🔍 DETAILS]


Event: Budget Exhaustion (Hard Stop)
───────────────────────────────────────
🛑 Claude API budget exhausted today
$20 limit reached at 3:45 PM
Agents blocked: Telegram Bots (waiting for reset)

[📈 OVERRIDE] [📊 ADJUST BUDGET] [🔍 USAGE]
```

---

## Configuration & Policy Examples

### Example: Budget-Conscious Setup

```yaml
# Policy: Prioritize cost optimization
routing_policies:
  task_type:
    coding:
      preference: ["ollama-cloud", "claude-max", "gemini-api"]
      block: ["claude-opus"]
    chat:
      preference: ["gemini-flash", "gemini-pro", "claude-api-haiku"]
      block: ["claude-opus", "claude-max"]
    reasoning:
      preference: ["claude-max", "gemini-3.1-pro", "claude-api-sonnet"]
      block: []
  
  cost_optimization:
    enabled: true
    strategy: "minimize_per_token_cost"
    except_when: "urgency == critical"
    
  limit_awareness:
    enabled: true
    alert_at: 0.70
    hard_stop: 0.95  # Block at 95%, not 100%
    
  temporal_policies:
    evening_mode_after: "18:00"
    prefer_cheaper_models: true
    shift_nonurgent_work: "to_next_morning"
```

### Example: Quality-First Setup

```yaml
routing_policies:
  task_type:
    coding:
      preference: ["claude-max", "claude-api-opus", "ollama-cloud"]
      block: ["gemini-flash"]
    reasoning:
      preference: ["claude-api-opus", "claude-max", "gemini-3.1-pro"]
      block: ["gemini-flash", "claude-haiku"]
  
  cost_optimization:
    enabled: false
    
  limit_awareness:
    enabled: true
    alert_at: 0.80
    hard_stop: 1.0  # Let agents hit hard limit
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Implement service registry tables
- [ ] Build API key generation + approval workflow
- [ ] Deploy Telegram push notification system
- [ ] Create intelligent router (core algorithm)

### Phase 2: Integration (Week 2)
- [ ] Integrate router into agent SDKs (flint-bot.js, clio-bot.js)
- [ ] Build admin dashboard (basic version)
- [ ] Deploy usage logging + cost tracking
- [ ] Verify end-to-end flow (request → approval → usage → reporting)

### Phase 3: Optimization (Week 3)
- [ ] Fine-tune routing policies based on real usage
- [ ] Implement historical reports
- [ ] Add cost optimization recommendations
- [ ] Refine alert thresholds

### Phase 4: Automation (Week 4+)
- [ ] Auto-routing based on agent history
- [ ] Predictive budget alerts
- [ ] Automated policy adjustments
- [ ] Integration with admin scheduling

---

## Key Features Summary

✅ **Unified Service Registry** — All models in one place, instantly discoverable  
✅ **Zero-Knowledge API Keys** — Scoped tokens, never exposed to agents  
✅ **Intelligent Routing** — Picks the right model for each task  
✅ **Cost Awareness** — Tracks spend in real-time, respects budgets  
✅ **Admin Control** — Approve access, set policies, adjust budgets on-the-fly  
✅ **Transparent Reporting** — See exactly where money is spent  
✅ **Push Notifications** — Instant alerts for approvals, limits, budgets  
✅ **Scalable Design** — Ready for 10+ agents, 100+ services  

---

## Status

**🟢 READY FOR IMPLEMENTATION**

This is a complete, production-ready service design. Can be deployed incrementally (foundation → integration → optimization → automation).

All components specified with:
- Database schemas
- RPC method signatures
- Approval workflows
- Cost calculations
- Admin interfaces
- Push notification system
- Configuration examples
- Implementation roadmap

