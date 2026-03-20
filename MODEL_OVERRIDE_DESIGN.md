# Model Selection Override Design

**Date:** March 20, 2026  
**Status:** Design specification ready for implementation  
**Purpose:** Allow agents to override automated model selection with explicit commands

---

## Requirements

1. **Agent Autonomy:** Agents can request specific models when needed
2. **Cost Control:** Overrides still respect budget limits and policies
3. **Auditability:** All overrides logged with reason and approval status
4. **Admin Control:** Configurable policies for auto-approval vs. manual approval
5. **Fallback:** If override request denied, use automated selection
6. **Persistence:** Can request override for current task or all future tasks

---

## Override Mechanisms

### Mechanism 1: Explicit Command (Simple)

Agent includes command in message:

```
/model claude-opus
```

**How it works:**
1. Bot detects command in message
2. Extracts requested model: `claude-opus`
3. Calls router: `model.request_override(agent_id, service_id, reason)`
4. Router approves/denies based on policy
5. If approved: use requested model
6. If denied: fall back to automatic selection
7. Log decision to audit trail

### Mechanism 2: Inline Request (Complex)

Agent mentions model in natural language:

```
For this task, I need Claude Opus because it has better reasoning for architectural decisions.
```

**How it works:**
1. Bot uses NLP to detect model mentions (claude-opus, gemini-pro, etc.)
2. Extracts intention: model + reason
3. Calls router with override request
4. Same approval flow as explicit command
5. Proceed with selected model

### Mechanism 3: Policy-based Override (Implicit)

Agent request includes context trigger:

```
/urgent
```

**How it works:**
1. Bot detects `/urgent` flag
2. Passes to router: `isUrgent: true`
3. Router's automatic selection promotes Claude Max (priority queue)
4. Higher confidence in model selection
5. No explicit override needed

---

## Implementation: RPC Methods

### New RPC Method: `model.request_override`

```javascript
{
  "method": "model.request_override",
  "params": {
    "agent_id": "flint",
    "service_id": "claude-api-opus",
    "reason": "Complex architectural reasoning required",
    "duration": "single-task",  // or "all-tasks", "1-hour", "24-hours"
    "auto_approve_if": "within_budget"  // or "never", "always"
  },
  "id": 1
}
```

**Response (Approved):**
```javascript
{
  "result": {
    "status": "approved",
    "service_id": "...",
    "key_value": "...",
    "reason_for_approval": "Within budget policy",
    "expires_at": "2026-03-20T20:30:00Z"
  }
}
```

**Response (Denied):**
```javascript
{
  "result": {
    "status": "denied",
    "reason": "Exceeds daily budget for this service",
    "suggested_alternative": "claude-api-sonnet",
    "fallback": "use_automatic_selection"
  }
}
```

### New RPC Method: `model.check_override_policy`

Agent can check what's allowed before requesting:

```javascript
{
  "method": "model.check_override_policy",
  "params": {
    "agent_id": "flint",
    "requested_service": "claude-api-opus"
  },
  "id": 2
}
```

**Response:**
```javascript
{
  "result": {
    "allowed": true,
    "auto_approved": true,
    "estimated_cost": 0.024,
    "current_daily_budget_remaining": 45.23,
    "would_exceed_budget": false
  }
}
```

---

## Bot Integration

### Flint Bot Model Override Handler

```javascript
// Detect and handle override commands
function parseModelCommand(message) {
  // Pattern 1: /model <name>
  const modelMatch = message.match(/\/model\s+(\w+(?:-\w+)*)/i);
  if (modelMatch) {
    return {
      type: 'explicit',
      model: modelMatch[1],
      reason: 'User requested model'
    };
  }
  
  // Pattern 2: /urgent or /priority
  const urgentMatch = message.match(/\/urgent|\/priority|\/asap/i);
  if (urgentMatch) {
    return {
      type: 'flag',
      flag: urgentMatch[0].toLowerCase(),
      isUrgent: true
    };
  }
  
  // Pattern 3: Natural language model mention
  const modelNames = ['claude-opus', 'claude-sonnet', 'gemini-pro', 'gemini-flash'];
  const nlMatch = message.match(new RegExp(`(${modelNames.join('|')})`, 'i'));
  if (nlMatch) {
    return {
      type: 'inline',
      model: nlMatch[1].toLowerCase(),
      reason: 'Model mentioned in context'
    };
  }
  
  return null;
}

// Updated generateResponse with override support
async function generateResponse(userMessage, conversationHistory) {
  try {
    // Check for model override request
    const override = parseModelCommand(userMessage);
    
    let selection;
    if (override) {
      console.log(`[flint-bot] 🔧 Override detected: ${override.type} (${override.model || override.flag})`);
      
      // Request override from router
      selection = await requestModelOverride(
        'flint',
        override.model,
        override.reason,
        override.isUrgent
      );
      
      if (selection.error) {
        console.log(`[flint-bot] Override denied: ${selection.reason}`);
        console.log(`[flint-bot] Falling back to automatic selection`);
        
        // Fall back to automatic selection
        const taskType = classifyTask(userMessage);
        selection = await selectOptimalModel('flint', taskType.type, taskType.complexity, override.isUrgent);
      } else {
        console.log(`[flint-bot] ✅ Override approved: ${selection.service_name}`);
      }
    } else {
      // Standard automatic selection
      const taskType = classifyTask(userMessage);
      selection = await selectOptimalModel('flint', taskType.type, taskType.complexity);
    }
    
    // Rest of generation logic
    const model = inferModel(selection.service_name);
    let response;
    
    if (model.provider === 'anthropic') {
      response = await callClaude('flint', model.name, FLINT_SYSTEM_PROMPT, userMessage, conversationHistory);
    } else {
      response = await callGemini('flint', model.name, FLINT_SYSTEM_PROMPT, userMessage, conversationHistory);
    }
    
    // Report usage
    if (selection.service_id) {
      const tokens = estimateTokens(userMessage, response);
      await reportUsage('flint', selection.service_id, tokens.total);
    }
    
    return response;
  } catch (error) {
    console.error('[flint-bot] Error:', error.message);
    return `Error: ${error.message}`;
  }
}

// Helper: Request model override from router
async function requestModelOverride(agentId, serviceName, reason, isUrgent = false) {
  try {
    // Convert model name to service_id
    const serviceMap = {
      'claude-opus': 'claude-api-opus',
      'claude-sonnet': 'claude-api-sonnet',
      'claude-haiku': 'claude-api-haiku',
      'claude-max': 'claude-max-100',
      'gemini-pro': 'gemini-api-pro',
      'gemini-3.1-pro': 'gemini-api-3-1-pro',
      'gemini-flash': 'gemini-api-flash',
      'ollama': 'ollama-cloud-pro'
    };
    
    const serviceId = serviceMap[serviceName.toLowerCase()];
    if (!serviceId) {
      return { error: `Unknown model: ${serviceName}` };
    }
    
    const response = await fetch('http://localhost:3100/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'model.request_override',
        params: {
          agent_id: agentId,
          service_id: serviceId,
          reason: reason || 'Agent-requested override',
          duration: 'single-task',
          isUrgent
        },
        id: Date.now()
      })
    });
    
    const data = await response.json();
    return data.result || { error: 'No result' };
  } catch (error) {
    console.error(`[${agentId}-bot] Override request failed:`, error.message);
    return { error: error.message };
  }
}
```

---

## Router Implementation

### Add to Model Router RPC Methods

```javascript
const rpcMethods = {
  // ... existing methods ...
  
  'model.request_override': async (params) => {
    const { agent_id, service_id, reason, duration, isUrgent } = params;
    
    // 1. Validate service exists
    const service = await db.query(
      'SELECT * FROM hyphae_model_services WHERE service_id = $1',
      [service_id]
    );
    
    if (service.rows.length === 0) {
      return { error: 'Service not found' };
    }
    
    // 2. Check limit status
    const limitStatus = await getLimitStatus(agent_id, service_id);
    
    // 3. Apply override policy
    const policy = getOverridePolicy(agent_id);
    const approval = evaluateOverridePolicy(policy, limitStatus, duration);
    
    if (!approval.allowed) {
      return {
        error: `Override denied: ${approval.reason}`,
        suggested_alternative: approval.suggestedService
      };
    }
    
    // 4. Get API key
    const key = await getApiKey(agent_id, service_id);
    if (key.error) {
      return { error: 'No approved API key for this service' };
    }
    
    // 5. Log override to audit trail
    await logAudit('override_requested', agent_id, service_id, null, {
      reason,
      duration,
      isUrgent,
      approved: true,
      expiresAt: calculateExpiration(duration)
    });
    
    return {
      status: 'approved',
      service_id,
      key_value: key.key_value,
      endpoint: key.endpoint,
      reason_for_approval: approval.reason,
      expires_at: calculateExpiration(duration)
    };
  },
  
  'model.check_override_policy': async (params) => {
    const { agent_id, requested_service } = params;
    
    const limitStatus = await getLimitStatus(agent_id, requested_service);
    const policy = getOverridePolicy(agent_id);
    const approval = evaluateOverridePolicy(policy, limitStatus);
    
    return {
      allowed: approval.allowed,
      auto_approved: approval.autoApproved,
      would_exceed_budget: limitStatus.status === 'hard_stop',
      estimated_cost: calculateCost(requested_service),
      current_daily_budget_remaining: limitStatus.daily_limit_usd - limitStatus.current_daily_usage_usd
    };
  }
};

// Helper: Get override policy for agent
function getOverridePolicy(agentId) {
  const policies = {
    'flint': {
      allowedModels: ['*'],  // Flint can request any model
      autoApproveWithin: 50,  // Auto-approve if within $50 daily
      requireApprovalAbove: 50,
      neverAllow: []
    },
    'clio': {
      allowedModels: ['claude-max-100', 'gemini-api-pro'],
      autoApproveWithin: 20,
      requireApprovalAbove: 20,
      neverAllow: ['claude-api-opus']
    }
  };
  
  return policies[agentId] || policies['clio'];
}

// Helper: Evaluate if override should be approved
function evaluateOverridePolicy(policy, limitStatus, duration = 'single-task') {
  // Check if service is blocked
  if (limitStatus.status === 'hard_stop') {
    return {
      allowed: false,
      reason: 'Daily limit exceeded for this service',
      autoApproved: false,
      suggestedService: 'gemini-api-flash'  // Fallback
    };
  }
  
  // Check daily remaining
  const dailyRemaining = limitStatus.daily_limit_usd - limitStatus.current_daily_usage_usd;
  
  if (dailyRemaining > policy.autoApproveWithin) {
    return {
      allowed: true,
      reason: `Within auto-approval threshold (${dailyRemaining} remaining)`,
      autoApproved: true
    };
  }
  
  if (dailyRemaining > 0) {
    return {
      allowed: true,
      reason: `Override allowed but approaching limit (${dailyRemaining} remaining)`,
      autoApproved: false,
      requiresApproval: true
    };
  }
  
  return {
    allowed: false,
    reason: 'No daily budget remaining',
    autoApproved: false
  };
}
```

---

## Admin Configuration

### Override Policies (Configurable)

```yaml
override_policies:
  flint:
    # Flint (CTO) has broad authority
    allow_any_model: true
    auto_approve_under: 50  # Auto-approve overrides under $50/day
    require_approval_above: 50
    emergency_override: true  # Can override even if at limit (with notification)
    
  clio:
    # Clio (Chief of Staff) more restricted
    allowed_models: [claude-max-100, gemini-api-pro, claude-api-sonnet]
    blocked_models: [claude-api-opus]  # Not allowed to request
    auto_approve_under: 20
    require_approval_above: 20
    
  new_agents:
    # New agents have minimal override authority
    allow_any_model: false
    allowed_models: [gemini-api-flash, gemini-api-pro]  # Only cheap/mid-tier
    auto_approve_under: 5
    require_approval_above: 5
    blocked_models: [claude-opus, claude-max-100]
```

---

## User Experience Examples

### Example 1: Explicit Model Request

**User says:**
```
/model claude-opus
Write a detailed system architecture for a microservices platform
```

**What happens:**
1. Bot detects `/model claude-opus` command
2. Requests override from router
3. Router checks: Flint, Claude Opus, within auto-approve limit → **APPROVED**
4. Uses Claude Opus for response
5. Logs override: "Agent requested Claude Opus for architecture design"
6. Dashboard shows: "Flint (override) → claude-opus"

**Message sent:**
```
⚡ Flint [Claude Opus - override]:
Here's a detailed microservices architecture...
```

### Example 2: Denied Override

**User says:**
```
/model claude-opus
```

**What happens:**
1. Bot detects override request
2. Router checks: Flint already at $48/day on Claude Opus → LIMIT APPROACHING
3. Router checks policy: requires approval above $50/day → **REQUIRES APPROVAL**
4. Admin receives notification: "Flint requests Claude Opus override (current: $48/day, limit: $50)"
5. If approved: uses Claude Opus
6. If denied: falls back to automatic selection (e.g., Claude Sonnet)

### Example 3: Inline Model Request

**User says:**
```
For this architectural decision, I'd benefit from Claude Opus' reasoning capabilities.
Can you analyze the tradeoffs between monolith and microservices?
```

**What happens:**
1. Bot detects "Claude Opus" in message
2. Extracts: model=claude-opus, reason="reasoning capabilities for architecture analysis"
3. Requests override from router (same flow as explicit command)
4. Proceeds based on approval status

---

## Audit Trail

All overrides logged to database:

```
agent_id | request_type | service_id | status | reason | approved_by | approved_at
----------|--------------|-----------|--------|--------|------------|----------
flint | override | claude-api-opus | approved | Architecture reasoning | system (auto) | 2026-03-20 20:30:00
clio | override | claude-api-opus | denied | Over budget | system | 2026-03-20 20:31:00
flint | override | gemini-api-pro | approved | Cost optimized | system (auto) | 2026-03-20 20:32:00
```

---

## Benefits

✅ **Agent Autonomy:** Agents can request specific models when needed  
✅ **Cost Control:** Overrides still respect budgets and policies  
✅ **Transparency:** Every override logged and visible in dashboard  
✅ **Flexibility:** Different agents have different override authority  
✅ **Safety:** Auto-approval for low-cost overrides, manual for expensive  
✅ **Auditability:** Full trail of "why this model was used"  

---

## Implementation Checklist

- [ ] Add `model.request_override` RPC method to router
- [ ] Add `model.check_override_policy` RPC method
- [ ] Implement override policy evaluation logic
- [ ] Update bot code to detect model commands
- [ ] Add override parsing functions to bots
- [ ] Log overrides to audit trail
- [ ] Update dashboard to show override decisions
- [ ] Add override column to usage logs
- [ ] Test override workflow (approve/deny)
- [ ] Document override commands for users

---

**Status:** Design complete, ready for implementation

Implementation time: ~2-3 hours for full feature (RPC methods + bot integration + dashboard)

