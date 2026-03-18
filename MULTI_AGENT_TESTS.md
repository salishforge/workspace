# Multi-Agent Coordination Tests

**Purpose:** Validate Tidepool-Clio and Tidepool-Flint can coordinate autonomously via NATS + MemForge

**Status:** Ready to execute once infrastructure stabilized

---

## Prerequisites

Before bringing Clio online:
- ✅ Health Dashboard deployed
- ✅ MemForge deployed
- ✅ Hyphae deployed
- ✅ NATS running
- ✅ PostgreSQL with agents table
- ✅ Audit logging working
- ⏳ Security audit complete (in progress)

---

## Scenario 1: Simple Message Passing

**Objective:** Verify NATS message delivery between agents

```
Flint (OpenClaw) → sends task to Tidepool-Flint
Tidepool-Flint → executes task
Tidepool-Flint → publishes result to NATS
Flint → receives result
```

**Expected:**
- Message delivered in <1s
- No message loss
- Audit log captures full path

**Test Steps:**
1. Send simple task: `curl -X POST sf.agent.tidepool-flint.inbox -m "test message"`
2. Verify Tidepool-Flint receives (check logs)
3. Verify response published to `sf.agent.flint.inbox`
4. Check audit log: full transaction visible

---

## Scenario 2: Memory Sharing Between Agents

**Objective:** Both agents can query and update shared memory

```
Tidepool-Flint → add event to MemForge (agent: "shared-task-1")
Tidepool-Clio → query same agent's memory
Tidepool-Clio → see Flint's events
```

**Expected:**
- Clio sees Flint's memory events
- Multi-agent isolation holds (Clio can't see private Flint memory)
- Consolidation includes both agents' events

**Test Steps:**
1. Flint adds event: `POST /memory/shared-task-1/add {"content":"flint event"}`
2. Clio queries: `GET /memory/shared-task-1/query?q=flint`
3. Verify result includes Flint's event
4. Clio adds event: `POST /memory/shared-task-1/add {"content":"clio event"}`
5. Consolidate: `POST /memory/shared-task-1/consolidate`
6. Verify warm_tier has both events

---

## Scenario 3: Task Coordination (Flint → Clio)

**Objective:** Flint assigns work to Clio, Clio executes, returns result

```
Flint: "Clio, implement feature X"
  → Package task with spec
  → Send via NATS
  → Store task ID in MemForge

Clio receives task
  → Query MemForge for task context
  → Implement feature
  → Store result in MemForge
  → Send completion message to Flint

Flint receives completion
  → Query MemForge for results
  → Verify quality
  → Publish results
```

**Expected:**
- Task queued and persisted
- Clio receives and executes
- Result queryable via MemForge
- Audit trail complete

**Test Implementation:**
Create feature branch in salishforge/dashboard:
1. Implement health dashboard enhancements (Clio's task)
2. Clio reads spec from MemForge
3. Clio commits code to feature branch
4. Clio publishes completion to Flint
5. Flint reviews and merges

---

## Scenario 4: Conflict Resolution

**Objective:** Both agents make conflicting decisions, system handles gracefully

```
Task: Deploy service X

Flint: "Deploy to staging"
  → Writes decision to MemForge: deployment.decision = "staging"

Clio: "Deploy to prod (budget permitting)"
  → Reads MemForge: decision already set to "staging"
  → Clio accepts Flint's decision
  → Publishes: "Staging deployment confirmed"

Result: Single source of truth (MemForge) prevents conflicts
```

**Expected:**
- First-write-wins or explicit locking
- Clear audit trail of decision process
- No resource conflicts

---

## Scenario 5: Error Handling & Recovery

**Objective:** Test graceful failure and recovery

### Sub-case A: Clio crashes mid-task
```
Clio starts implementing feature
Clio crashes (or goes offline)
Flint detects no heartbeat (> 30s)
Flint marks Clio as "degraded"
Flint can either:
  - Wait for Clio to recover
  - Reassign task to alternate agent
  - Escalate to human
```

**Expected:**
- No data loss
- Clear status visibility
- Graceful degradation

### Sub-case B: MemForge unavailable
```
Clio tries to query MemForge
MemForge is down
Clio catches error, retries with backoff
After N retries, Clio escalates to Flint
Flint handles escalation
```

**Expected:**
- Timeouts not indefinite
- Retry backoff implemented
- Clear error messages

---

## Scenario 6: Concurrent Operations

**Objective:** Both agents work on different tasks simultaneously

```
Flint → Task A to Clio
Flint → Task B to Tidepool-Flint
Clio executes Task A (5 min)
Flint executes Task B (2 min)
Flint finishes first, reports result
Clio finishes later, reports result
Both results queryable
```

**Expected:**
- No interference between tasks
- No resource contention
- Independent timelines

---

## Test Execution Checklist

### Before Clio Comes Online
- [ ] Security audit complete (no critical issues)
- [ ] All three services healthy
- [ ] NATS bridge working
- [ ] PostgreSQL audit table populated
- [ ] Health Dashboard showing all agents

### Scenario 1 (Message Passing)
- [ ] Deploy test harness
- [ ] Send test message
- [ ] Verify receipt
- [ ] Check audit log
- [ ] Document latency

### Scenario 2 (Memory Sharing)
- [ ] Add test events from both agents
- [ ] Query from opposite agent
- [ ] Verify isolation
- [ ] Test consolidation

### Scenario 3 (Task Coordination)
- [ ] Define sample task (feature to implement)
- [ ] Package task → MemForge
- [ ] Clio executes task
- [ ] Verify result quality
- [ ] Audit trail review

### Scenario 4 (Conflict Resolution)
- [ ] Simulate conflicting decisions
- [ ] Verify consistency mechanism
- [ ] Review decision log
- [ ] Confirm single source of truth

### Scenario 5 (Error Handling)
- [ ] Kill Clio mid-operation
- [ ] Verify Flint detects failure
- [ ] Restart Clio
- [ ] Verify recovery
- [ ] No data corruption

### Scenario 6 (Concurrency)
- [ ] Launch multiple tasks
- [ ] Monitor resource usage
- [ ] Verify independence
- [ ] Measure latencies

---

## Success Criteria

All scenarios pass if:
1. **Reliability:** Zero message loss, all messages accounted for in audit log
2. **Consistency:** Memory queries return expected values, isolation holds
3. **Performance:** Message latency < 1s, query latency < 500ms
4. **Observability:** All operations visible in audit log
5. **Error Handling:** Failures detected and logged, recovery automatic or escalated
6. **Scalability:** No degradation with concurrent tasks

---

## Instrumentation

### NATS Monitoring
```bash
# Monitor messages
nats sub 'sf.agent.>'
```

### MemForge Monitoring
```bash
# Query agent memory
curl http://100.97.161.7:3333/memory/tidepool-clio/stats

# Query agent memory events  
curl http://100.97.161.7:3333/memory/tidepool-clio/query?q=task
```

### PostgreSQL Audit
```sql
SELECT * FROM audit_log
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC
LIMIT 100;
```

### Systemd Logs
```bash
sudo journalctl -u health-dashboard -f
sudo journalctl -u memforge -f
sudo journalctl -u hyphae -f
```

---

## Timeline

**Week 1:** Scenario 1-2 (messaging + memory)  
**Week 2:** Scenario 3-4 (task coordination + conflicts)  
**Week 3:** Scenario 5-6 (errors + concurrency)  
**Week 4:** Sustained load (24-hour soak test)

---

## Clio Onboarding Checklist

Once multi-agent tests pass:
- [ ] Clio CPU/memory allocation verified
- [ ] Clio NKeys key pair generated
- [ ] Clio registered as agent in registry
- [ ] Clio ACLs configured (what can she access)
- [ ] Clio backup/recovery procedure documented
- [ ] Escalation procedures defined (when to wake Flint, when to pause)
- [ ] First task assigned (low-risk, well-scoped)

