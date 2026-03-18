# Clio Onboarding Checklist

**Status:** Ready for Clio activation  
**Prerequisites:** All infrastructure tests passing, security audit fixed  
**Timeline:** Ready to proceed once load tests complete

---

## Pre-Activation (Complete Before Bringing Clio Online)

### Infrastructure Readiness
- [x] Health Dashboard deployed and tested
- [x] MemForge deployed and tested
- [x] Hyphae deployed and tested
- [x] NATS running on VPS
- [x] PostgreSQL available
- [x] Audit logging enabled
- [ ] Load tests complete
- [ ] Security findings resolved

### Clio's Container Environment
- [ ] Tidepool-Clio Docker image built
- [ ] Container resource limits set:
  - CPU: 2 cores (limit: 50% host)
  - Memory: 4GB (limit: 8GB burst)
  - Disk: 20GB ephemeral
- [ ] Tidepool-Clio systemd service created
- [ ] Auto-restart policy configured (max 5 retries, 60s delay)
- [ ] Log rotation configured (10MB per file, 5 files)

### Identity & Keys
- [ ] Clio agent ID assigned: `tidepool-clio`
- [ ] NKeys keypair generated (public + private)
- [ ] Public key registered in agent registry
- [ ] Private key securely stored (systemd EnvironmentFile, chmod 600)
- [ ] Clio can authenticate to NATS with NKeys
- [ ] Clio can authenticate to Hyphae with bearer token

### Permissions & Access Control
- [ ] NATS ACLs configured for clio user:
  - Can subscribe: `sf.agent.tidepool-clio.>`
  - Can publish: `sf.agent.tidepool-clio.response`, `sf.service.>`
  - Cannot subscribe: other agents' private channels
- [ ] PostgreSQL user `clio_user` created with minimal permissions:
  - SELECT/INSERT on agents, audit_log tables
  - Access to hot_tier, warm_tier, cold_tier for agent `tidepool-clio` only
- [ ] MemForge accessible with explicit DATABASE_URL
- [ ] Hyphae accessible with bearer token (separate from Flint's token)

### Capability Registry
- [ ] Clio capabilities defined:
  - `code-generation` — can write code
  - `code-review` — can review code
  - `git-push` — can commit/push (branch only, not main)
  - `memory-query` — can read shared memory
  - `memory-write` — can write to shared memory
  - `report-generation` — can create summaries
- [ ] Capabilities stored in capability registry
- [ ] Enforcement points registered (Flint validates before task assignment)

### Communication Setup
- [ ] Flint → Clio messaging tested (via NATS)
- [ ] Clio → Flint messaging tested (via NATS)
- [ ] Heartbeat mechanism verified (30s interval)
- [ ] Message format standardized (JSON schema defined)
- [ ] Error escalation channel defined (Clio → Flint when stuck)

### Memory & Persistence
- [ ] Clio's agent ID created in agents registry (PostgreSQL)
- [ ] Clio has isolated memory namespace (agent_id=`tidepool-clio`)
- [ ] Clio can query MemForge for context
- [ ] Clio can write to MemForge after task completion
- [ ] Multi-agent memory isolation tested (Clio ≠ Flint memory)

### Monitoring & Observability
- [ ] Clio systemd service health check enabled
- [ ] Clio logs captured in journalctl
- [ ] Clio heartbeat visible in audit log
- [ ] Clio CPU/memory monitored
- [ ] Alert configured if Clio unresponsive > 60s
- [ ] Dashboard shows Clio as agent in Health Dashboard

### Disaster Recovery
- [ ] Clio crash recovery procedure documented
- [ ] Container restart works cleanly (no data loss)
- [ ] Graceful shutdown signal handling (SIGTERM → cleanup → exit)
- [ ] Rollback procedure if Clio task fails
- [ ] Manual intervention point if escalation needed

---

## Activation Procedure

### 1. Pre-Flight Checks (30 min)
```bash
# Verify infrastructure
curl http://100.97.161.7:3000/health  # Dashboard
curl http://100.97.161.7:3333/health  # MemForge
curl -H "Authorization: Bearer <token>" http://100.97.161.7:3004/health  # Hyphae

# Verify NATS connectivity
nats -s tidepool.internal sub 'sf.agent.tidepool-clio.>'

# Verify PostgreSQL
psql -h 100.97.161.7 -U postgres -d tidepool -c "SELECT COUNT(*) FROM agents;"
```

### 2. Start Clio
```bash
sudo systemctl start tidepool-clio
sleep 5
sudo systemctl status tidepool-clio
```

### 3. Verify Clio is Alive
```bash
# Check heartbeat in audit log (within 30s)
tail -f /var/log/audit_log.txt | grep tidepool-clio

# Check Clio appears in Health Dashboard
curl http://100.97.161.7:3000/health | grep tidepool-clio
```

### 4. Assign First Task
Simple, low-risk task to Clio:
- Read a specification from MemForge
- Summarize it
- Write summary back to MemForge
- Report completion

**Example Task:**
```json
{
  "task_id": "first-task-001",
  "type": "summarization",
  "spec": "Read docs/README.md and create a 3-sentence summary",
  "agent": "tidepool-clio",
  "deadline": "2026-03-18T01:00:00Z",
  "escalate_on_failure": true
}
```

### 5. Monitor Task Execution
- [ ] Task received by Clio (audit log shows ingress)
- [ ] Clio queries MemForge for context (latency < 500ms)
- [ ] Clio completes task (no errors)
- [ ] Clio publishes result to NATS
- [ ] Flint receives completion message
- [ ] Audit trail complete and consistent

### 6. Validate Output
- Summarization task: review summary quality
- If good → move to next task
- If bad → debug with Clio, adjust, retry

---

## Ongoing Operations

### Daily Checklist
- [ ] Clio heartbeat visible (recent timestamp in audit log)
- [ ] No unhandled errors in Clio logs
- [ ] CPU/memory usage within limits
- [ ] NATS connectivity stable
- [ ] MemForge queries completing in time

### Weekly Review
- [ ] Task success rate > 95%
- [ ] Avg latency tracking (no degradation)
- [ ] Memory growth monitoring (no leaks)
- [ ] Error patterns (classify and fix)
- [ ] Task complexity increasing appropriately

### Monthly Assessment
- [ ] Clio autonomy increasing (less manual intervention)
- [ ] Capability expansion needed?
- [ ] Access control review (least privilege)
- [ ] Security posture (any new threats?)
- [ ] Cost tracking (CPU, network, storage)

---

## Escalation Procedures

### Clio Cannot Complete Task
1. Clio marks task as `blocked` in MemForge
2. Clio publishes escalation message to Flint: `{"task_id": "...", "status": "blocked", "reason": "..."}`
3. Flint responds within 60s or escalates to John
4. Task is either: reassigned, reworked, or cancelled

### Clio Unresponsive (No Heartbeat > 60s)
1. Health Dashboard shows Clio as `degraded`
2. Flint checks Clio logs for errors
3. If recoverable: restart Clio
4. If not: escalate to John, maintain manual operations

### Clio Resource Exhausted
1. Memory usage > 90%: restart Clio
2. Disk usage > 90%: cleanup logs, restart
3. CPU sustained > 80%: investigate slow tasks, optimize

### Clio Security Event
- Unauthorized NATS access attempt → block, alert
- Attempted memory access outside scope → deny, log
- Invalid credential use → rotate keys, investigate

---

## Success Metrics

**Clio is ready for production when:**
- ✅ 100+ tasks completed with 95%+ success rate
- ✅ Avg latency < 500ms per task
- ✅ Zero unhandled crashes
- ✅ Memory stable (no leaks over 24h)
- ✅ Audit trail complete and verified
- ✅ Escalation procedures tested
- ✅ Disaster recovery tested
- ✅ Load tests passing with Clio active

---

## Deactivation (If Needed)

If Clio needs to be taken offline:

```bash
# Graceful shutdown
sudo systemctl stop tidepool-clio

# Verify no running tasks
curl http://100.97.161.7:3000/health | grep tidepool-clio
# Should show status: "dead" or not present

# Archive logs
tar czf clio-logs-$(date +%Y%m%d).tar.gz /var/log/tidepool-clio/

# Remove from agent registry
psql -h 100.97.161.7 -U postgres -d tidepool \
  -c "DELETE FROM agents WHERE id = 'tidepool-clio';"
```

---

## Contact & Support

**Clio Issues → Flint:** Via NATS topic `sf.agent.tidepool-flint.inbox`  
**Critical Issues → John:** Escalate via health dashboard alert  
**Emergency Kill Switch:** `sudo systemctl disable tidepool-clio && sudo systemctl stop tidepool-clio`

