# Hyphae Performance Measurement Protocol

**How to verify design objectives and establish actual performance baseline.**

## Philosophy

Performance projections are **useful for design decisions** but **not reliable for commitments** until verified by measurement.

Pattern:
1. **Design Objective** → Target latency/throughput (projection)
2. **Measure Actual** → Load test in target environment
3. **Calculate Delta** → Actual vs Objective
4. **Decide** → Pass (objective met), Miss (needs optimization), or Adjust (objective was unrealistic)

## Measurement Lifecycle

### Phase 1: Design (Today)

Document design objectives for all critical paths:
- Cache hit latency
- Database queries
- Cryptographic operations
- Network calls
- Concurrent request handling

Mark clearly: **"OBJECTIVE (unverified)"**

Example from code:
```typescript
// DESIGN OBJECTIVE: Cache hit <50ms (p95)
const cached = this.cache.get(key);
if (cached && !expired) {
  return cached.value; // Target: <50ms
}
```

### Phase 2: Implement (During Development)

Build with measurement in mind:
- Add timing instrumentation
- Log latency percentiles (p50, p95, p99)
- Track resource utilization
- Identify bottlenecks

Example instrumentation:
```typescript
const startTime = Date.now();

const result = await vault.getSecret(name);

const latency = Date.now() - startTime;
metrics.record('vault.get', latency);
```

### Phase 3: Load Test (Pre-Production)

**Test Environment:**
- Same hardware as production (or representative)
- Same database (or production-sized test data)
- Same network topology

**Load Test Scenarios:**

#### Scenario 1: Baseline (No Competition)
```
Single agent, warm cache, measure 100 requests
Objective: Cache hit <50ms
Expected: Should meet objective easily
Purpose: Establish baseline, check instrumentation
```

#### Scenario 2: Load (Expected Traffic)
```
N agents (expected production load) making requests
Objective: All operations meet SLA
Expected: May see some degradation
Purpose: Verify system handles expected load
```

#### Scenario 3: Stress (Beyond Expected)
```
2-3x expected traffic
Objective: Graceful degradation, no crashes
Expected: Performance may degrade, error rate < 5%
Purpose: Identify limits and failure modes
```

### Phase 4: Measurement & Analysis

**Record Results:**

```markdown
## Test: Cache Hit Latency

**Objective:** <50ms (p95)

**Test Setup:**
- Hardware: [specs]
- Data size: [size]
- Concurrent agents: [N]
- Request rate: [req/sec]

**Results:**
- p50: 35ms ✓
- p95: 48ms ✓
- p99: 52ms ✗ (slight miss)
- Max: 120ms

**Status:** ✓ PASS (p95 within objective)

**Analysis:**
- p99 slightly exceeds due to GC pauses
- Consider adjusting SLA to p95, not p99
```

**Calculate Delta:**

```
Operation: vault.get (cache miss)

Design Objective: 100-500ms (p95)
Actual Measured: 245ms (p95)
Delta: -255ms (45% better than worst-case objective)
Status: ✓ PASS (actual within objective band)

Operation: fallback_latency

Design Objective: +300ms per fallback
Actual Measured: +1200ms per fallback
Delta: +900ms (4x slower than objective)
Status: ✗ MISS (needs optimization)
Action: Investigate slow fallback, consider:
  - Connection pooling
  - Parallel fallback attempts
  - Timeout reduction
  - Caching strategy revision
```

### Phase 5: Update & Commit

**Update documentation:**

```markdown
## Performance Baseline (Measured)

| Operation | Objective | Actual | Status |
|-----------|-----------|--------|--------|
| cache.get | <50ms | 48ms (p95) | ✓ |
| vault.get | 100-500ms | 245ms (p95) | ✓ |
| fallback | +300ms | +1200ms | ✗ |

**Measurement Date:** 2026-03-25
**Hardware:** AWS t3.xlarge
**Load:** 100 concurrent agents
**Data:** 1000 secrets, 5-50KB each
```

**SLA Commitments (now valid):**

```
"Vault operations: 95th percentile < 300ms"
(Verified by measurement on 2026-03-25)
```

## What to Measure

### For Secrets Vault

1. **Cache Performance**
   - Hit latency (p50, p95, p99)
   - Miss latency
   - Hit rate % under load
   - Cache size overhead

2. **Database Performance**
   - Single secret read
   - Decrypt overhead
   - List operation (N secrets)
   - Concurrent write behavior
   - Lock contention

3. **Encryption/Decryption**
   - Encrypt latency per size (10B, 1KB, 100KB)
   - Decrypt latency per size
   - CPU utilization
   - Hardware acceleration benefit

### For Registration Protocol

1. **Cryptographic Operations**
   - Ed25519 sign latency
   - Ed25519 verify latency
   - Challenge generation
   - Concurrent operations

2. **Database Operations**
   - Registration record insert
   - Approval update
   - Concurrent registrations

3. **Approval Polling**
   - Poll latency
   - Detection delay (when approved)
   - CPU cost of polling

### For Service API Gateway

1. **Routing**
   - Routing decision time
   - Connector selection
   - Permission check

2. **Primary Path**
   - Single request latency (no retry)
   - Throughput (requests/sec)
   - Concurrent request behavior

3. **Fallback Path**
   - Primary timeout behavior
   - Fallback selection time
   - Fallback execution latency

4. **Caching**
   - Cache hit vs miss latency
   - Cache efficiency (hit rate)
   - Cache memory overhead

## Tools & Instrumentation

### Timing Instrumentation

```typescript
// Option 1: Manual timing
const start = performance.now();
const result = await operation();
const duration = performance.now() - start;
metrics.record(duration);

// Option 2: Decorator
@measure('operation.name')
async operation() { ... }

// Option 3: Wrapping
const timed = measure((fn) => {
  return async (...args) => {
    const start = performance.now();
    const result = await fn(...args);
    metrics.record(performance.now() - start);
    return result;
  };
});
```

### Metrics Collection

Required minimum:
- Operation name
- Latency (milliseconds)
- Timestamp
- Status (success/failure)
- Resource utilization (optional but helpful)

### Percentile Calculation

Collect 1000+ measurements per operation, calculate:
- p50 (median)
- p95 (95th percentile, "acceptable worst case")
- p99 (99th percentile, "outlier")
- Max (worst single case)

Libraries: `hdr-histogram`, `stastistics.js`, or custom

### Load Generation

Options:
- Apache JMeter
- k6 (JavaScript-based)
- wrk (HTTP benchmarking)
- Custom test script in Node.js

Example custom:
```typescript
async function loadTest(concurrency, duration) {
  const agents = Array(concurrency)
    .fill(0)
    .map((_, i) => new Agent(`agent-${i}`));
  
  const startTime = Date.now();
  while (Date.now() - startTime < duration) {
    await Promise.all(
      agents.map(a => a.call('service', 'op', {}))
    );
  }
}
```

## Common Mistakes to Avoid

### 1. Measuring With Unrealistic Load
❌ Wrong: Test with 1 concurrent agent
✅ Right: Test with expected production concurrency

### 2. Not Warming Up
❌ Wrong: Run test immediately (cold cache, cold database)
✅ Right: Warm up system, then measure

### 3. Ignoring Percentiles
❌ Wrong: Report only average latency
✅ Right: Report p50, p95, p99, max

### 4. Not Documenting Conditions
❌ Wrong: "Cache hit is 50ms"
✅ Right: "Cache hit is 50ms (p95) on t3.xlarge with 1000 secrets"

### 5. Committing to Unverified Numbers
❌ Wrong: "SLA: <50ms" (unverified projection)
✅ Right: "SLA: <50ms (verified 2026-03-25, see [measurement report])"

### 6. Not Retesting After Changes
❌ Wrong: Optimize code but don't remeasure
✅ Right: After optimization, retest and measure improvement

## Iteration Cycle

```
Design Objectives
  ↓
Implement with instrumentation
  ↓
Load Test
  ↓
Measure & Analyze
  ↓
Delta exceeds acceptable?
  ├─ NO → Commit measurement, proceed
  └─ YES → Optimize & Retest
```

Repeat as needed.

## Reporting Results

Template:

```markdown
# [System] Performance Measurement

**Date:** YYYY-MM-DD
**Environment:** [Hardware, OS, configuration]
**Duration:** [How long test ran]
**Load:** [Concurrency, request rate]
**Data Size:** [Representative data]

## Results by Operation

### cache.get
- Objective: <50ms (p95)
- Actual: 48ms (p95)
- Status: ✓ PASS

[repeat for each operation]

## Summary
- Objectives met: N/M
- Performance issues: [list]
- Recommendations: [list]

## Measurement Validity
- ✓ Warm cache
- ✓ Production data size
- ✓ Expected concurrency
- ✓ Sustained load (not spike)
```

## When to Re-Measure

Always after:
- Code optimization (verify improvement)
- Database changes (schema, indexing)
- Hardware changes
- Major load increase
- SLA renegotiation

Periodically:
- Every quarter (regression check)
- Before each production release
- After infrastructure changes

## Key Takeaway

**Design objectives are for planning. Measured data is for commitments.**

Until you have measured data, frame all numbers as:
- "Design objective: <50ms"
- "Actual (measured 2026-03-25): 48ms"
- "SLA commitment: <60ms (verified)"

This prevents over-confidence while still providing direction for implementation.

---

**Version:** 1.0  
**Created:** 2026-03-19  
**Purpose:** Establish measurement culture for Hyphae performance
