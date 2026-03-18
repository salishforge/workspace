# Tidepool Stabilization Checklist

**Purpose:** Get Tidepool to production-ready state before introducing multi-agent control (John + Clio)

**Current Status:** v0.1.0 (experimental)  
**Target:** v0.5.0 (stable, multi-agent-ready)  
**Timeline:** 3-4 weeks

---

## Why Stabilize First?

Two autonomous agents (John + Clio) coordinating requires:
- ✅ Reliable agent execution (no silent failures)
- ✅ Guaranteed message delivery (NATS working properly)
- ✅ Memory consolidation actually working (not just theoretically)
- ✅ Audit logging that you can trust (for debugging coordination failures)
- ✅ Clear error reporting (so agents can understand what went wrong)
- ✅ Observable behavior (metrics, monitoring)

**Without this:** Agent failures cascade. Agent 1 makes decision based on corrupted memory. Agent 2 makes decision based on different corrupted memory. Coordination impossible.

---

## Stability Requirements

### 1. Agent Execution (Container Runner)
- [ ] Agent startup reliable (no container creation races)
- [ ] Agent shutdown graceful (clean NATS unsubscribe, file cleanup)
- [ ] Timeout handling (agent hangs → container killed cleanly)
- [ ] Output parsing robust (no sentinel marker collisions)
- [ ] Error handling (malformed stdin, broken pipes, etc.)
- [ ] Resource limits enforced (CPU, memory, disk)
- [ ] Concurrency tested (5+ agents running simultaneously)

**How to verify:**
- Chaos test: Kill random containers mid-execution
- Load test: Spin up 10 agents, send 100 messages
- Stress test: Run agents for 24 hours continuously

### 2. NATS Bus
- [ ] NATS server running in production (systemd service)
- [ ] NKeys deployed and working (not just documented)
- [ ] ACLs enforced (agent X cannot subscribe to agent Y's topics)
- [ ] TLS enabled (encrypted in-flight messages)
- [ ] Message persistence (messages don't disappear)
- [ ] Monitoring (NATS metrics exposed, alerting configured)
- [ ] Recovery (NATS crash → automatic restart, message replay)

**How to verify:**
- Kill NATS server; verify agents reconnect
- Network partition test; verify message ordering preserved
- Simulate publisher failure; verify subscribers detect it

### 3. MemForge Memory System
- [ ] Hot tier ingestion working (events → warm_tier)
- [ ] Warm tier retrieval working (FTS search returns correct results)
- [ ] Cold tier archival working (old memories → cold_tier)
- [ ] Consolidation scheduler running (autonomous triggers)
- [ ] Consolidation agent producing summaries (not just running)
- [ ] Memory query latency acceptable (<100ms for typical query)
- [ ] Multi-agent memory isolation (agent A can't see agent B's memory)

**How to verify:**
- Add 1000 events to hot tier → verify consolidation triggers
- Query hot/warm/cold tiers → verify retrieval works
- Two agents with same event → verify isolation

### 4. Audit Logging
- [ ] All NATS messages logged (source, dest, timestamp, content hash)
- [ ] All memory operations logged (add, query, consolidate)
- [ ] All container lifecycle events logged (spawn, exit, timeout)
- [ ] All errors logged with context (not just error message)
- [ ] Log queries performant (can search 1M events in <1s)
- [ ] Log integrity guaranteed (can't be tampered with)

**How to verify:**
- Replay last 24 hours of logs; reconstruct full system state
- Audit log search: find all messages between agents X and Y
- Verify log completeness: no missing events

### 5. Error Handling & Recovery
- [ ] Transient failures handled (retry with backoff)
- [ ] Permanent failures detected (circuit breaker pattern)
- [ ] Cascading failures prevented (failure isolation)
- [ ] Recovery procedures documented (how to recover from X failure)
- [ ] Error messages clear (not cryptic, tell you how to fix)
- [ ] Errors don't corrupt state (atomic operations)

**How to verify:**
- Inject failures: drop NATS messages, kill MemForge, fill disk
- Verify system recovers or fails cleanly (not silently corrupted)

### 6. Observability
- [ ] Logging comprehensive (debug logs available for tracing)
- [ ] Metrics collected (agent execution time, memory queries, NATS latency)
- [ ] Traces possible (can follow a request through the system)
- [ ] Alerting configured (high latency, failed agents, NATS down)
- [ ] Dashboard available (system health at a glance)

**How to verify:**
- Missing agent log entry → can you find it in any service?
- Slow query → can you identify which component is slow?
- Agent X unresponsive → can you see where it's stuck?

---

## Phase 1: Core Stability (Week 1-2)

### Week 1: Agent Execution
- [ ] Review container-runner.ts for race conditions
- [ ] Add comprehensive error handling
- [ ] Test with 10+ concurrent agents
- [ ] Document all failure modes
- [ ] Add health checks (agent liveness)

### Week 2: NATS Deployment
- [ ] Deploy NKeys setup (currently blocked per Sprint 2)
- [ ] Enable TLS
- [ ] Deploy ACLs
- [ ] Systemd service hardening
- [ ] NATS monitoring setup

---

## Phase 2: Memory System (Week 2-3)

### Week 2: Consolidation Verification
- [ ] Run consolidation agent continuously for 72 hours
- [ ] Verify memory queries return correct results
- [ ] Benchmark query latency
- [ ] Test with 1000+ agents (or agent-like) memory entries
- [ ] Verify tier transitions (hot → warm → cold)

### Week 3: Multi-Agent Memory Isolation
- [ ] Create 3+ test agents
- [ ] Each agent adds 100+ events
- [ ] Verify agent A cannot see agent B's memory
- [ ] Verify consolidation is per-agent
- [ ] Performance test (parallel memory queries from 5 agents)

---

## Phase 3: Audit & Observability (Week 3-4)

### Week 3: Audit Logging
- [ ] All NATS messages logged
- [ ] All MemForge operations logged
- [ ] Container lifecycle logged
- [ ] Log integrity test (can't modify logs)
- [ ] Log query performance test

### Week 4: Error Handling & Recovery
- [ ] Document all error modes
- [ ] Implement circuit breakers
- [ ] Test recovery (kill service, verify restart)
- [ ] Test cascading failure prevention
- [ ] Document runbooks (how to recover from X)

---

## Acceptance Criteria

### Before Clio Involvement

Tidepool must pass these tests:

1. **24-hour continuous operation**
   - Spawn 5 test agents
   - Each agent processes 100 messages/hour
   - Zero message loss
   - Zero memory corruption
   - All operations audited

2. **Failure recovery**
   - Kill NATS server → agents reconnect, no message loss
   - Kill MemForge → agents queue requests, resume when back
   - Kill container-runner → existing agents continue, new agents fail gracefully
   - Disk full → errors logged, no state corruption

3. **Performance**
   - Agent message latency: <500ms
   - Memory query latency: <100ms
   - Consolidation time: <5s per agent (for 100 events)
   - Audit log query: <1s for 1M events

4. **Observability**
   - Every error in logs with context
   - Can trace message from source to destination
   - Can identify bottlenecks (which component is slow)
   - System health visible from dashboard

5. **Multi-agent readiness**
   - 3+ agents running simultaneously, no interference
   - Each agent has isolated memory
   - Inter-agent communication reliable
   - Coordination possible (agent A waits for response from agent B)

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Silent message loss** | CRITICAL | Audit log; verify count |
| **Memory corruption** | CRITICAL | Atomic operations; integrity checks |
| **Cascading failures** | HIGH | Circuit breakers; isolation |
| **Performance degradation** | MEDIUM | Metrics; SLOs |
| **Operator confusion** | MEDIUM | Clear error messages; runbooks |

---

## Success Metrics

When you can answer "YES" to all:

- [ ] Have you run 5 agents concurrently for 24+ hours without data loss?
- [ ] Have you killed NATS mid-operation and verified recovery?
- [ ] Have you queried memory from the same agent before/after consolidation and seen consistent results?
- [ ] Have you traced a message from agent A to agent B through the entire system?
- [ ] Can you identify the bottleneck (which component is slow) from metrics?
- [ ] Have you documented the recovery procedure for each failure mode?
- [ ] Would you trust this system with Clio's coordination decisions?

If YES to all: **Safe for multi-agent control.**

---

## Timeline

**Total: 3-4 weeks**

- Week 1: Agent execution + NATS deployment
- Week 2: Memory system consolidation + isolation
- Week 3: Audit logging + error handling
- Week 4: Stabilization + acceptance testing

**After: Ready for Clio's involvement**

---

## What Success Looks Like

> John and Clio coordinate on a task. John makes a decision based on agent state. Clio receives the message. Clio's decision relies on that information. System completes task. All operations audited. Neither agent worried about data loss or corruption.

That's the goal.
