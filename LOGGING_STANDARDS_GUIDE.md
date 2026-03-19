# Hyphae Logging Standards Guide

**Status:** Implementation guide  
**Version:** 1.0  
**Date:** March 18, 2026  
**Audience:** Application developers (both human and AI)

---

## Quick Start

### Human Developer: Emit AI-Native Logs

```typescript
// Old way (don't do this)
logger.error(
  `Agent ${agent} failed to call ${target} for ${capability}. ` +
  `Timeout after ${duration}ms. Error: ${error}`
);

// New way (do this)
logger.error({
  code: "RPC_TIMEOUT",
  source_agent: agent,
  target_agent: target,
  capability: capability,
  status: "timeout",
  metrics: { duration_ms: duration },
  context_id: context.id,
  tags: ["timeout", "rpc"]
});
```

### AI Developer: Read and Analyze AI-Native Logs

```typescript
// Old way (expensive)
const logs = await getFullLogs();  // 300 tokens per log
const incidents = await llm.analyze(logs);  // Parse narrative

// New way (cheap)
const compactLogs = await getCompactLogs();  // 15 tokens per log
const patterns = await matchPatterns(compactLogs);  // No LLM
const incidents = patterns.length > 0 
  ? patterns 
  : await llm.analyze(compactLogs);  // Only if pattern doesn't match
```

---

## Core Logging Codes

### Naming Convention: CATEGORY_EVENT

**Categories:**
- `RPC_*` — Remote procedure calls (RPC_TIMEOUT, RPC_FAILED, RPC_REJECTED)
- `CLOCK_*` — Time synchronization (CLOCK_DESYNC, CLOCK_INVALID)
- `SERVICE_*` — Service lifecycle (SERVICE_REGISTERED, SERVICE_DOWN)
- `AUTH_*` — Authentication/authorization (AUTH_FAILED, AUTH_DENIED)
- `SAGA_*` — Distributed transactions (SAGA_TIMEOUT, SAGA_FAILED)
- `TRACE_*` — Distributed tracing (TRACE_ERROR, TRACE_TIMEOUT)
- `RESOURCE_*` — Resource exhaustion (RESOURCE_OOM, RESOURCE_CPU)
- `NETWORK_*` — Network issues (NETWORK_TIMEOUT, NETWORK_UNREACHABLE)
- `CONFIG_*` — Configuration (CONFIG_INVALID, CONFIG_MISSING)

### Error Code Taxonomy

```
RPC_TIMEOUT              — Remote call exceeded deadline
RPC_FAILED               — Remote call returned error
RPC_REJECTED             — Call rejected before execution (auth, validation)
RPC_CANCELLED            — Call cancelled by caller
RPC_NOT_FOUND            — Target service not found

CLOCK_DESYNC             — Agent clock too far from ground truth
CLOCK_INVALID            — Timestamp validation failed
CLOCK_DRIFT              — Clock drifting over time

SERVICE_REGISTERED       — Agent successfully registered with Hyphae
SERVICE_DEREGISTERED     — Agent deregistered
SERVICE_UNHEALTHY        — Health check failed
SERVICE_REMOVED          — Service removed due to issues

AUTH_FAILED              — Authentication failed (wrong credentials)
AUTH_DENIED              — Authorization failed (insufficient scope)
AUTH_EXPIRED             — Token/session expired
AUTH_REVOKED             — Credentials revoked

SAGA_TIMEOUT             — Distributed transaction timeout
SAGA_FAILED              — Transaction step failed
SAGA_COMPENSATING        — Compensation in progress
SAGA_COMPENSATION_FAILED — Compensation failed

RESOURCE_OOM             — Out of memory
RESOURCE_CPU_HIGH        — CPU usage high
RESOURCE_EXHAUSTED       — Generic resource exhaustion

NETWORK_TIMEOUT          — Network operation timeout
NETWORK_UNREACHABLE      — Destination unreachable
NETWORK_LATENCY_HIGH     — High network latency detected

CONFIG_INVALID           — Configuration validation failed
CONFIG_MISSING           — Required configuration missing
```

---

## How to Emit Good Logs

### Rule 1: Use Codes, Not Narratives

**BAD:**
```typescript
logger.error({
  message: "Failed to RPC call analyzer agent from researcher. Timeout."
});
```
**Why:** Message is narrative (expensive for AI), not structured.

**GOOD:**
```typescript
logger.error({
  code: "RPC_TIMEOUT",
  source_agent: "researcher",
  target_agent: "analyzer",
  operation: "rpc_call"
});
```
**Why:** Compact, structured, ~15 tokens vs 100 tokens.

---

### Rule 2: Include Required Fields

Every log must include:
- `code` — Machine-readable error code
- `timestamp` — From timekeeper (not Date.now())
- `level` — DEBUG | INFO | WARN | ERROR | CRITICAL
- `status` — success | partial | failed | timeout | rejected

At least one actor:
- `source_agent` — Who initiated the action
- `target_agent` — Who received the action (if applicable)

```typescript
// Minimal log (always include these)
logger.error({
  code: "RPC_TIMEOUT",
  timestamp: timekeeper.now().unix,
  level: "ERROR",
  status: "timeout",
  source_agent: "researcher",
  target_agent: "analyzer"
});
```

---

### Rule 3: Add Operation Context

What was happening?

```typescript
logger.error({
  code: "RPC_TIMEOUT",
  
  // What operation?
  operation: "rpc_call",
  capability: "research",
  
  // What happened?
  status: "timeout",
  
  // How long did it take?
  metrics: {
    duration_ms: 31234
  },
  
  // Which agents?
  source_agent: "researcher",
  target_agent: "analyzer"
});
```

---

### Rule 4: Use Tags for Quick Filtering

Tags help AI quickly categorize logs without parsing narrative.

```typescript
logger.error({
  code: "RPC_TIMEOUT",
  status: "timeout",
  source_agent: "researcher",
  target_agent: "analyzer",
  
  // Add tags for filtering
  tags: [
    "timeout",           // Error category
    "rpc",               // Operation type
    "network",           // Likely cause
    "degraded"           // System state
  ]
});
```

**Common tags:**
- By cause: timeout, network, auth, resource, config, clock
- By severity: critical, warning, degradation
- By system: rpc, saga, service, trace, auth
- By state: degraded, recovering, healthy, unhealthy

---

### Rule 5: Reference Contexts, Don't Duplicate

If you need to include detailed info, create a context and reference it.

**BAD:**
```typescript
logger.error({
  code: "RPC_TIMEOUT",
  source_agent: "researcher",
  target_agent: "analyzer",
  request_params: {topic: "quantum computing", depth: "deep"},
  request_size_bytes: 2384,
  response_size_bytes: null,
  network_latency_ms: 28500,
  // ... 20 more fields
});
```
**Why:** Bloated, expensive to parse, duplicates data.

**GOOD:**
```typescript
// 1. Create context in MemForge
const context = await memforge.createLogContext({
  error_type: "RPC_TIMEOUT",
  details: {
    request_params: {topic: "quantum computing", depth: "deep"},
    request_size_bytes: 2384,
    network_latency_ms: 28500,
    // ... detailed info
  }
});

// 2. Log reference to context
logger.error({
  code: "RPC_TIMEOUT",
  source_agent: "researcher",
  target_agent: "analyzer",
  status: "timeout",
  metrics: { duration_ms: 31234 },
  context_id: context.id  // ← Reference, not duplication
});
```
**Why:** Compact log, details loaded only when needed, AI reads 15 tokens instead of 500.

---

### Rule 6: Include Metrics (Numeric, Not Narrative)

Metrics should be numeric and labeled, not descriptive strings.

**BAD:**
```typescript
logger.error({
  code: "RPC_TIMEOUT",
  message: "Call took about 31 seconds, was expecting 30 seconds"
});
```
**Why:** Narrative, hard for AI to parse, no units.

**GOOD:**
```typescript
logger.error({
  code: "RPC_TIMEOUT",
  metrics: {
    duration_ms: 31234,      // Numeric with unit
    limit_ms: 30000,
    excess_ms: 1234
  }
});
```
**Why:** Queryable, machine-readable, unambiguous.

---

### Rule 7: Pattern IDs for Known Issues

If this matches a known pattern, include the pattern ID.

```typescript
const metrics = await timekeeper.validateAgentClockSync(agent);

if (metrics.status === 'critical') {
  logger.error({
    code: "CLOCK_DESYNC",
    source_agent: agent,
    status: "failed",
    metrics: { clock_offset_ms: metrics.averageOffset },
    pattern_match: "pat-clock-drift",    // ← Known pattern
    tags: ["clock", "sync", "degraded"]
  });
}
```

---

## Code Examples

### Example 1: RPC Timeout

```typescript
// In hyphae/services-v2.ts

async call(sourceAgent, targetAgent, capability, params, options = {}) {
  const timePoint = timekeeper.now();
  const rpcId = crypto.randomUUID();
  const startTime = timePoint.unix;
  
  try {
    const targetService = this.getService(targetAgent);
    
    if (!targetService) {
      // Log service not found
      this.logger.error({
        code: "SERVICE_NOT_FOUND",
        timestamp: timePoint.unix,
        level: "ERROR",
        status: "rejected",
        
        operation: "rpc_call",
        source_agent: sourceAgent,
        target_agent: targetAgent,
        capability: capability,
        
        tags: ["service", "discovery", "critical"]
      });
      
      return { success: false, error: "Service not found" };
    }
    
    // Make RPC call with timeout
    const deadline = timePoint.unix + (options.timeout || 30000);
    
    const response = await axios.post(
      `${targetService.endpoint}/rpc`,
      { sourceAgent, targetAgent, capability, params, timestamp: timePoint.unix },
      { timeout: options.timeout || 30000 }
    );
    
    const duration = timekeeper.now().unix - startTime;
    
    // Log success
    this.logger.info({
      code: "RPC_SUCCESS",
      timestamp: timekeeper.now().unix,
      level: "INFO",
      status: "success",
      
      operation: "rpc_call",
      source_agent: sourceAgent,
      target_agent: targetAgent,
      capability: capability,
      
      metrics: {
        duration_ms: duration,
        network_latency_ms: response.data.duration || 0
      },
      
      trace_id: rpcId,
      tags: ["rpc", "success"]
    });
    
    return { success: true, result: response.data };
    
  } catch (error) {
    const duration = timekeeper.now().unix - startTime;
    
    // Determine error code
    let code = "RPC_FAILED";
    let tags = ["rpc", "error"];
    
    if (error.code === 'ECONNREFUSED') {
      code = "NETWORK_UNREACHABLE";
      tags.push("network");
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      code = "RPC_TIMEOUT";
      tags.push("timeout");
    }
    
    // Create detailed context
    const context = await memforge.createLogContext({
      error_type: code,
      details: {
        request_params: params,
        error_message: error.message,
        network_latency_ms: error.response?.data?.latency || null,
        source_clock_offset_ms: this.registry.getService(sourceAgent)?.clockOffset,
        target_clock_offset_ms: this.registry.getService(targetAgent)?.clockOffset
      }
    });
    
    // Log error (compact, references context)
    this.logger.error({
      code: code,
      timestamp: timekeeper.now().unix,
      level: "ERROR",
      status: "failed",
      
      operation: "rpc_call",
      source_agent: sourceAgent,
      target_agent: targetAgent,
      capability: capability,
      
      metrics: {
        duration_ms: duration
      },
      
      context_id: context.id,
      trace_id: rpcId,
      tags: tags
    });
    
    return { success: false, error: error.message };
  }
}
```

---

### Example 2: Clock Synchronization

```typescript
// In hyphae/timekeeper.ts

syncAgentClock(request) {
  const timePoint = this.now();
  const offset = timePoint.unix - request.localTime;
  
  if (Math.abs(offset) > this.clockTolerance) {
    // Clock too far off - log and reject
    this.logger.error({
      code: "CLOCK_DESYNC",
      timestamp: timePoint.unix,
      level: "ERROR",
      status: "rejected",
      
      source_agent: request.agentId,
      operation: "registration",
      
      metrics: {
        clock_offset_ms: offset,
        tolerance_ms: this.clockTolerance,
        excess_ms: Math.abs(offset) - this.clockTolerance
      },
      
      tags: ["clock", "sync", "registration", "critical"],
      
      pattern_match: "pat-clock-drift"
    });
    
    return {
      status: 'error',
      message: `Clock desync: ${Math.abs(offset)}ms (tolerance: ${this.clockTolerance}ms)`
    };
  }
  
  // Clock is good - log and initialize metrics
  this.logger.info({
    code: "CLOCK_SYNCHRONIZED",
    timestamp: timePoint.unix,
    level: "INFO",
    status: "success",
    
    source_agent: request.agentId,
    operation: "registration",
    
    metrics: {
      clock_offset_ms: offset
    },
    
    tags: ["clock", "sync", "registration"]
  });
  
  return {
    status: 'success',
    offset: offset
  };
}
```

---

### Example 3: Saga Compensation

```typescript
// In hyphae/saga.ts

async compensate(execution, sagaDef) {
  const succeededSteps = execution.steps
    .filter(s => s.status === 'succeeded')
    .reverse();
  
  for (const stepExec of succeededSteps) {
    const stepDef = sagaDef.steps.find(s => s.stepId === stepExec.stepId);
    
    if (!stepDef || !stepDef.compensationCapability) {
      // No compensation defined
      this.logger.info({
        code: "SAGA_NO_COMPENSATION",
        timestamp: timekeeper.now().unix,
        level: "INFO",
        status: "partial",
        
        operation: "saga_execution",
        source_agent: execution.initiatorAgent,
        target_agent: stepExec.agentId,
        capability: stepDef.compensationCapability,
        
        context_id: `saga-${execution.executionId}`,
        tags: ["saga", "compensation", "skipped"]
      });
      continue;
    }
    
    try {
      stepExec.status = 'compensating';
      
      this.logger.info({
        code: "SAGA_COMPENSATING",
        timestamp: timekeeper.now().unix,
        level: "INFO",
        status: "in_progress",
        
        operation: "saga_compensation",
        source_agent: execution.initiatorAgent,
        target_agent: stepExec.agentId,
        capability: stepDef.compensationCapability,
        
        tags: ["saga", "compensation", "in-progress"]
      });
      
      const result = await this.registry.call(
        execution.initiatorAgent,
        stepExec.agentId,
        stepDef.compensationCapability,
        stepDef.compensationParams,
        { timeout: stepDef.timeout }
      );
      
      if (result.success) {
        stepExec.status = 'compensated';
        
        this.logger.info({
          code: "SAGA_COMPENSATED",
          timestamp: timekeeper.now().unix,
          level: "INFO",
          status: "success",
          
          operation: "saga_compensation",
          source_agent: execution.initiatorAgent,
          target_agent: stepExec.agentId,
          capability: stepDef.compensationCapability,
          
          tags: ["saga", "compensation", "success"]
        });
      } else {
        throw new Error(`Compensation failed: ${result.error}`);
      }
    } catch (error) {
      this.logger.error({
        code: "SAGA_COMPENSATION_FAILED",
        timestamp: timekeeper.now().unix,
        level: "CRITICAL",
        status: "failed",
        
        operation: "saga_compensation",
        source_agent: execution.initiatorAgent,
        target_agent: stepExec.agentId,
        capability: stepDef.compensationCapability,
        
        tags: ["saga", "compensation", "failed", "critical"],
        
        pattern_match: "pat-saga-failure"
      });
    }
  }
}
```

---

## For AI Developers: Reading These Logs

### Query Pattern 1: Find All RPC Timeouts

```typescript
// Cheap: query compact logs
const timeouts = await db.query(
  'SELECT * FROM hyphae_logs WHERE code = ? AND timestamp > ?',
  ['RPC_TIMEOUT', Date.now() - 3600000]
);  // ~15 tokens per log

// If you need details:
for (const log of timeouts) {
  if (needsDetails) {
    const context = await memforge.getLogContext(log.context_id);
    // Now you have full context (5KB, ~5000 tokens)
  }
}
```

### Query Pattern 2: Find Logs Matching Pattern

```typescript
// Find all logs matching "clock drift" pattern
const clockDriftLogs = await db.query(
  'SELECT * FROM hyphae_logs WHERE pattern_id = ?',
  ['pat-clock-drift']
);

// Analyze without AI (all info already in pattern DB)
const pattern = await db.getPattern('pat-clock-drift');
const suggestions = pattern.resolution.steps;  // Immediate remediation

// Only use LLM if pattern confidence low
if (confidence < 0.7) {
  const context = await memforge.getLogContexts(...);
  await llm.analyze(context);  // Expensive, but only when needed
}
```

### Query Pattern 3: Incident Correlation

```typescript
// Find all related logs for a trace
const relatedLogs = await db.query(
  'SELECT * FROM hyphae_logs WHERE trace_id = ?',
  [traceId]
);

// Build incident narrative from structured data
const incident = {
  trace_id: traceId,
  initiator: relatedLogs[0].source_agent,
  timeline: relatedLogs.sort((a, b) => a.timestamp - b.timestamp),
  error_codes: [...new Set(relatedLogs.map(l => l.code))],
  affected_agents: [...new Set(relatedLogs.map(l => [l.source_agent, l.target_agent]).flat())],
  probable_cause: relatedLogs.find(l => l.pattern_match)?.pattern_match,
};

// Get recommended actions from pattern
const pattern = await db.getPattern(incident.probable_cause);
return {
  incident,
  suggested_actions: pattern.resolution.steps,
  estimated_time: pattern.resolution.estimated_resolution_minutes
};
```

---

## Best Practices

### 1. Use Timekeeper for All Timestamps

```typescript
// WRONG
logger.error({ code: "RPC_TIMEOUT", timestamp: Date.now() });

// RIGHT
const timePoint = timekeeper.now();
logger.error({ code: "RPC_TIMEOUT", timestamp: timePoint.unix });
```

### 2. Add Metrics When Available

```typescript
logger.error({
  code: "RPC_TIMEOUT",
  metrics: {
    duration_ms: actualDuration,
    limit_ms: timeoutLimit,
    network_latency_ms: latency,
    agent_capacity_percent: capacity
  }
});
```

### 3. Use Tags for Fast Filtering

```typescript
logger.error({
  code: "RPC_TIMEOUT",
  tags: [
    "timeout",      // What happened
    "rpc",          // Which subsystem
    "network"       // Likely cause
  ]
});
```

### 4. Create Context Only for Complex Data

```typescript
// Simple error: inline
logger.error({
  code: "SERVICE_NOT_FOUND",
  source_agent: agent,
  target_agent: target
});

// Complex error: use context
const context = await memforge.createLogContext({
  error_type: "RPC_TIMEOUT",
  details: {
    request_params: params,
    response_time: responseTime,
    network_details: {...}
  }
});

logger.error({
  code: "RPC_TIMEOUT",
  context_id: context.id,
  source_agent: agent,
  target_agent: target
});
```

### 5. Match Known Patterns

```typescript
const metrics = await timekeeper.validateAgentClockSync(agent);

if (metrics.status === 'critical') {
  logger.error({
    code: "CLOCK_DESYNC",
    pattern_match: "pat-clock-drift",  // ← Include if known
    source_agent: agent,
    metrics: { clock_offset_ms: metrics.averageOffset }
  });
}
```

---

## Checklist for Good Logs

- [ ] Every log has a `code` (machine-readable, not narrative)
- [ ] `timestamp` comes from `timekeeper.now()` (not Date.now())
- [ ] `source_agent` is always included
- [ ] `status` is one of: success | partial | failed | timeout | rejected
- [ ] Metrics are numeric with units (duration_ms, not "duration: ~31 seconds")
- [ ] Complex details are in context, not inline
- [ ] Tags are included for filtering
- [ ] Pattern ID included if it matches a known pattern
- [ ] No narrative text (let dashboards generate summaries)
- [ ] Log is <200 bytes (compact for efficient analysis)

---

## Summary

**AI-native logging:**
- ✅ Uses error codes (not narratives)
- ✅ Includes structured metrics
- ✅ References contexts (not duplication)
- ✅ Adds tags for filtering
- ✅ Matches known patterns
- ✅ Timestamps from ground truth
- ✅ ~15 tokens per log (vs 300 traditional)
- ✅ 93% cost savings for AI analysis

**This makes observability affordable and effective for multi-agent systems.**

