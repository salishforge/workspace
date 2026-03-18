# Incident Response Playbook

**Version:** 1.0  
**Created:** 2026-03-18  
**Purpose:** Step-by-step procedures for responding to incidents

---

## Severity Levels

| Level | Impact | Response Time | Who | Examples |
|-------|--------|---------------|-----|----------|
| **P1 — Critical** | Service down or data loss | Immediate | CTO + On-Call | All services down, data corruption, security breach |
| **P2 — High** | Service degraded | <30 min | On-Call | One service slow, elevated error rate |
| **P3 — Medium** | Limited impact | <2 hours | On-Call | Single user issue, minor perf degradation |
| **P4 — Low** | Cosmetic/informational | <24 hours | Backlog | Documentation typo, minor alert |

---

## INCIDENT 1: All Services Down

**Severity:** P1 — Critical

### Detection

```bash
# Health checks failing
curl http://localhost:3000/health
# Connection refused

curl http://localhost:3333/health
# Connection refused

curl http://localhost:3004/health
# Connection refused
```

### Immediate Response (First 5 min)

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Check systemd status
sudo systemctl status health-dashboard memforge hyphae

# 3. Restart all services
sudo systemctl restart health-dashboard memforge hyphae

# 4. Wait 10 seconds
sleep 10

# 5. Verify
sudo systemctl status health-dashboard memforge hyphae

# If still down: Check logs
sudo journalctl -u health-dashboard -n 100 --no-pager
sudo journalctl -u memforge -n 100 --no-pager
sudo journalctl -u hyphae -n 100 --no-pager
```

### Diagnosis

**Common Causes:**

1. **Port conflict**
   ```bash
   sudo ss -tulpn | grep -E "3000|3333|3004"
   # Solution: Kill conflicting process
   sudo fuser -k 3000/tcp 3333/tcp 3004/tcp
   ```

2. **PostgreSQL down**
   ```bash
   sudo systemctl status postgresql
   # Solution: Start PostgreSQL
   sudo systemctl start postgresql
   ```

3. **Out of disk**
   ```bash
   df -h
   # Solution: Clean logs, temp files
   sudo journalctl --vacuum-time=7d
   ```

4. **Out of memory**
   ```bash
   free -h
   # Solution: Kill non-essential processes, restart services
   ```

5. **Network connectivity**
   ```bash
   ping 8.8.8.8
   # Solution: Check firewall, network config
   ```

### Recovery Steps

```bash
# 1. Identify root cause from logs
sudo journalctl -u memforge -n 200 | grep -i error

# 2. Fix the root cause (see Common Causes above)

# 3. Restart services in order
sudo systemctl restart postgresql  # Dependency
sleep 2
sudo systemctl restart memforge    # Depends on PG
sleep 1
sudo systemctl restart health-dashboard
sudo systemctl restart hyphae

# 4. Verify health
curl -s http://localhost:3000/health | jq .
curl -s http://localhost:3333/health | jq .
curl -s http://localhost:3004/health | jq .

# 5. Monitor for 5 minutes
for i in {1..5}; do
  echo "Check $i: $(curl -s http://localhost:3333/health | jq .status)"
  sleep 60
done
```

### Escalation

If services still down after restart:
1. Gather diagnostics:
   ```bash
   sudo journalctl -u memforge -n 500 > /tmp/memforge.log
   ps aux > /tmp/processes.log
   df -h > /tmp/disk.log
   free -h > /tmp/memory.log
   ```

2. Email CTO: flint@salishforge.com with logs

---

## INCIDENT 2: MemForge Down, Others Running

**Severity:** P2 — High

### Detection

```bash
curl http://localhost:3333/health
# Connection refused or 500 error
```

### Response

```bash
# 1. Check status
sudo systemctl status memforge

# 2. Check logs (last 100 lines)
sudo journalctl -u memforge -n 100 --no-pager

# 3. Common issues:
#    a) DATABASE_URL not set
#       → Check /home/artificium/memforge/.env
#    b) Port in use
#       → sudo fuser -k 3333/tcp
#    c) Database down
#       → sudo systemctl status postgresql

# 4. Restart
sudo systemctl restart memforge

# 5. Verify
curl -s http://localhost:3333/health | jq .
```

### If Restart Fails

```bash
# Check database connection
psql -U postgres -d tidepool -c "SELECT 1;"

# If error: "database does not exist"
# → Restore from backup (see BACKUP_RECOVERY below)

# If error: "password authentication failed"
# → Check .env DATABASE_URL credentials

# Manual start to see actual error
cd /home/artificium/memforge
DATABASE_URL=postgres://... node dist/server.js
# Watch for specific error message
```

---

## INCIDENT 3: High Memory Usage / Memory Leak

**Severity:** P2 — High (if persistent) / P3 — Medium (if temporary)

### Detection

```bash
# Check process memory
ps aux | grep node | grep -v grep
# If RSS > 500MB: investigate

# Monitor over time
watch -n 5 'ps aux | grep node'
```

### Response

```bash
# 1. Identify which service
ps aux | grep node

# 2. Get baseline
BASELINE=$(ps aux | grep memforge | grep node | awk '{print $6}')
echo "Current memory: ${BASELINE}K"

# 3. Monitor for 30 min
for i in {1..30}; do
  CURRENT=$(ps aux | grep memforge | grep node | awk '{print $6}')
  echo "$(date): ${CURRENT}K (trend: +/- $(($CURRENT - $BASELINE))K)"
  sleep 60
done

# 4. If memory growing > 10MB/min: likely memory leak
```

### Recovery

**Option A: Restart Service**
```bash
sudo systemctl restart memforge
# Services auto-restart, clean memory
```

**Option B: Identify Memory Leak (Dev)**
```bash
# Requires heap snapshots and analysis
# Not typical ops procedure
```

---

## INCIDENT 4: Database Connection Error

**Severity:** P1 if blocking all requests, P2 if partial

### Detection

```bash
# Test connection manually
psql -h localhost -U postgres -d tidepool -c "SELECT 1;"

# Or check via MemForge health
curl http://localhost:3333/health
# Will show database error
```

### Response

```bash
# 1. Check PostgreSQL running
sudo systemctl status postgresql

# 2. If not running: start it
sudo systemctl start postgresql
sleep 5

# 3. Check connection pool
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# 4. If too many connections (>30)
# Kill idle connections
psql -U postgres << SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND state_change < now() - interval '5 minutes';
SQL

# 5. Restart affected services
sudo systemctl restart memforge health-dashboard
```

---

## INCIDENT 5: High Error Rate

**Severity:** P2 — High

### Detection

```bash
# Check error rate in logs
sudo journalctl -u memforge | grep -i error | wc -l

# Or via metrics (if Prometheus running)
curl http://localhost:3000/metrics | grep http_requests_total
```

### Response

```bash
# 1. Identify error patterns
sudo journalctl -u memforge -n 200 | grep -i error | head -10

# 2. Common causes:
#    - Invalid client request (bad JSON, missing fields)
#    - Service overload (rate limiting)
#    - Database unavailable
#    - External service down

# 3. Check recent changes
git log --oneline -5

# 4. If caused by recent change
git revert <commit>
npm run build
sudo systemctl restart memforge

# 5. Monitor error rate
watch -n 10 'sudo journalctl -u memforge -n 100 | grep -i error | wc -l'
```

---

## INCIDENT 6: Rate Limiting Triggered

**Severity:** P3 — Medium (temporary) / P2 — High (if persistent)

### Detection

```bash
# Check Hyphae logs for rate limit errors
sudo journalctl -u hyphae | grep -i "rate limit\|429"

# Or test directly
for i in {1..20}; do
  curl -s http://localhost:3004/services | wc -l &
done
wait
# Should see some 429 responses
```

### Response

```bash
# 1. Identify source of traffic
# Check logs for client IP

# 2. Options:
#    a) Temporary: Wait (rate limit resets per minute)
#    b) Permanent: Whitelist client IP if legitimate
#    c) Optimize: Reduce request volume from client

# 3. If legitimate use case needing high volume:
# Edit Hyphae rate limiting config
# Current: 10 req/min per IP
# Increase if needed: RATE_LIMIT_PER_MIN=50

# 4. Deploy change
sudo systemctl restart hyphae
```

---

## INCIDENT 7: Unexpected Data Loss

**Severity:** P1 — Critical

### Immediate Response (STOP EVERYTHING)

```bash
# 1. STOP MemForge
sudo systemctl stop memforge

# 2. STOP other services that write to DB
sudo systemctl stop health-dashboard hyphae

# 3. ISOLATE database
# Don't run migrations or schema changes

# 4. Gather evidence
sudo journalctl -u memforge -n 500 > /tmp/incident-memforge.log
pg_dump tidepool > /tmp/incident-tidepool.sql

# 5. Email CTO immediately
mail -s "🚨 CRITICAL: Data loss incident" flint@salishforge.com << EOF
DATA LOSS DETECTED

Timeline:
- Detection: $(date)
- Services stopped: MemForge (MEMFORGE_STOPPED), Others (RUNNING)
- Last backup: $(ls -ltr /backups/*.sql.gz | tail -1)

Evidence:
- Logs: /tmp/incident-memforge.log
- Database dump: /tmp/incident-tidepool.sql

DO NOT RESTART until CTO approves recovery plan.
EOF
```

### Recovery (CTO Decision Required)

**Option A: Restore from Backup**
```bash
# Only if CTO approves

# Stop all services
sudo systemctl stop memforge health-dashboard hyphae

# Restore from backup
pg_restore -d tidepool /backups/tidepool_20260318.sql.gz

# Verify data
psql -d tidepool -c "SELECT COUNT(*) FROM hot_tier;"

# Restart services
sudo systemctl start memforge health-dashboard hyphae

# Monitor closely
sudo journalctl -u memforge -f
```

---

## INCIDENT 8: Security Breach Suspected

**Severity:** P1 — Critical

### Immediate Response (DO NOT LOG IN)

```bash
# 1. ISOLATE VPS
# Remove all access except serial console (if available)

# 2. From SAFE MACHINE, gather evidence without logging in
# Use serial console or out-of-band access only

# 3. Email CTO + CEO
mail -s "🚨 SECURITY: Breach suspected" \
  -c "john@salishforge.com" flint@salishforge.com << EOF
POTENTIAL SECURITY BREACH

Description:
- Unauthorized access detected
- Suspicious activity observed
- [describe specifics]

Actions taken:
- VPS isolated
- No further logins allowed

Next steps:
- Forensic analysis
- Security review
- Credential reset
EOF

# 4. Preserve evidence
# Don't restart, don't change anything
```

---

## Communication Template

When escalating incidents:

```
INCIDENT REPORT

Severity: [P1/P2/P3/P4]
Time Detected: [TIMESTAMP]
Service Affected: [SERVICE]
Impact: [BRIEF DESCRIPTION]

Detection Method:
[HOW INCIDENT WAS FOUND]

Initial Diagnosis:
[ROOT CAUSE IF KNOWN]

Actions Taken:
[STEPS ALREADY TRIED]

Current Status:
[RUNNING/DOWN/DEGRADED]

Escalation Required: [YES/NO]
```

---

## On-Call Checklist

- [ ] Have SSH key for VPS access
- [ ] Have access to incident contact list
- [ ] Know how to check systemd status
- [ ] Know how to check PostgreSQL
- [ ] Know how to view logs
- [ ] Know how to restart services
- [ ] Know how to reach CTO
- [ ] Have runbook printed/accessible
- [ ] Know backup location and recovery procedure

---

**Owner:** Operations  
**Last Updated:** 2026-03-18  
**Version:** 1.0

