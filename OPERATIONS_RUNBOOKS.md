# Operations Runbooks — Salish Forge Platform

**Purpose:** Step-by-step procedures for common operational tasks  
**Audience:** Operations team, on-call engineers, system administrators

---

## Table of Contents

1. Daily Operations
2. Backup & Restore
3. Failover & Recovery
4. Scaling & Performance
5. Troubleshooting
6. Incident Response

---

## RUNBOOK 1: Daily Health Check

**Purpose:** Verify all services are healthy and operational  
**Frequency:** Daily (or per shift)  
**Time Required:** 5 minutes  
**Owner:** Operations

### Steps

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Check systemd services
sudo systemctl status health-dashboard memforge hyphae

# Expected: all "active (running)"
# If not: Run RUNBOOK 6 (Service Recovery)

# 3. Check service health endpoints
echo "Dashboard:"
curl -s http://localhost:3000/health | jq .

echo "MemForge:"
curl -s http://localhost:3333/health | jq .

echo "Hyphae:"
TOKEN="test-auth-token-salish-forge-2026"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3004/health | jq .

# Expected: All return 200 OK with status:"ok"

# 4. Check disk space
df -h | grep -E "/$|/home"
# Expected: < 80% used

# 5. Check database
psql -h localhost -U postgres -c "SELECT COUNT(*) FROM hot_tier; SELECT COUNT(*) FROM pg_stat_activity;" 2>&1 | head -5
# Expected: hot_tier count, active connections < 20

# 6. Review logs (last hour)
sudo journalctl --since "1 hour ago" -u memforge -u health-dashboard -u hyphae | grep -i error || echo "No errors found"

# 7. Check memory usage
ps aux | grep node | grep -v grep
# Expected: Each process < 500MB

# Summary
echo "✅ Daily health check complete"
```

### If Something Failed

| Issue | Action | Reference |
|-------|--------|-----------|
| Service not running | See RUNBOOK 6 | Service Recovery |
| Health endpoint failing | Check logs | Troubleshooting |
| Disk full | Cleanup logs | RUNBOOK 3 |
| Memory high | Check for leaks | Troubleshooting |
| DB error | Check connections | Database Issues |

---

## RUNBOOK 2: Backup & Restore Database

**Purpose:** Protect against data loss  
**Frequency:** Daily (automated via cron)  
**Time Required:** 10 minutes (manual)  
**Owner:** Operations

### Daily Automated Backup

```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * /usr/local/bin/backup-memforge.sh

# Create backup script
cat > /usr/local/bin/backup-memforge.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/memforge"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="tidepool"

mkdir -p $BACKUP_DIR

# Backup database
pg_dump -h localhost -U postgres -d $DB_NAME \
  | gzip > $BACKUP_DIR/memforge_${DATE}.sql.gz

# Keep only last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete

# Log
echo "Backup completed: memforge_${DATE}.sql.gz" >> /var/log/memforge-backup.log
EOF

chmod +x /usr/local/bin/backup-memforge.sh
```

### Manual Backup (Emergency)

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Create backup
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -h localhost -U postgres -d tidepool \
  | gzip > ~/memforge_backup_${DATE}.sql.gz

# 3. Copy to secure location (or cloud storage)
# Option A: Copy to local machine
scp artificium@100.97.161.7:~/memforge_backup_${DATE}.sql.gz ./

# Option B: Upload to S3/cloud (when configured)
# aws s3 cp ~/memforge_backup_${DATE}.sql.gz s3://backups/

echo "✅ Backup complete: memforge_backup_${DATE}.sql.gz"
```

### Restore from Backup

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Stop services (to prevent conflicts)
sudo systemctl stop memforge health-dashboard hyphae

# 3. Restore database
# ⚠️ WARNING: This will OVERWRITE current database
BACKUP_FILE="memforge_backup_20260318_020000.sql.gz"

dropdb -h localhost -U postgres -i tidepool
zcat ~/$BACKUP_FILE | psql -h localhost -U postgres

# 4. Verify restore
psql -h localhost -U postgres -d tidepool \
  -c "SELECT COUNT(*) FROM hot_tier; SELECT COUNT(*) FROM consolidation_audit;"

# 5. Start services
sudo systemctl start health-dashboard memforge hyphae

# 6. Verify
curl -s http://localhost:3333/health | jq .

echo "✅ Restore complete"
```

### Backup Verification (Weekly)

```bash
# 1. List recent backups
ls -lh /backups/memforge/ | tail -5

# 2. Test restore on staging (if available)
# or verify backup integrity
gzip -t /backups/memforge/memforge_20260318_020000.sql.gz && echo "✅ Backup valid"

# 3. Verify backup size is reasonable
# (Database should be 1-10MB at this stage)
du -h /backups/memforge/ | tail -1
```

---

## RUNBOOK 3: Service Recovery

**Purpose:** Restart failed service and verify recovery  
**Frequency:** As needed (on-call)  
**Time Required:** 5 minutes  
**Owner:** Operations

### Quick Restart

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Check current status
sudo systemctl status memforge

# 3. Restart service
sudo systemctl restart memforge

# 4. Monitor startup
sudo journalctl -u memforge -f &
TAIL_PID=$!
sleep 10
kill $TAIL_PID

# 5. Verify health
curl -s http://localhost:3333/health | jq .

# Expected: {"status":"ok","ts":"2026-03-18T..."}

echo "✅ Service restarted successfully"
```

### If Restart Fails

```bash
# 1. Check error logs
sudo journalctl -u memforge -n 50 --no-pager

# 2. Common issues:
# a) DATABASE_URL not set
#    → Fix: Check /home/artificium/memforge/.env
#    → Restart: sudo systemctl restart memforge

# b) Port already in use
#    → Fix: sudo fuser -k 3333/tcp
#    → Restart: sudo systemctl restart memforge

# c) Database connection error
#    → Fix: Verify PostgreSQL running (sudo systemctl status postgresql)
#    → Fix: Verify credentials in .env
#    → Restart: sudo systemctl restart memforge

# d) Out of memory
#    → Fix: Check for memory leaks (ps aux | grep node)
#    → Fix: Restart other services
#    → Fix: Reduce connection pool size

# 3. If still failing
echo "⚠️ Service failed to restart"
echo "Escalate to CTO with logs:"
sudo journalctl -u memforge -n 100 | mail -s "MemForge Recovery Failed" cto@salishforge.com
```

---

## RUNBOOK 4: Database Connection Issues

**Purpose:** Diagnose and fix database connectivity problems  
**Frequency:** As needed  
**Time Required:** 10 minutes  
**Owner:** Operations / DBA

### Diagnose Connection Issues

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Check if PostgreSQL running
sudo systemctl status postgresql

# Expected: "active (running)"
# If not: sudo systemctl start postgresql

# 3. Test connection manually
psql -h localhost -U postgres -c "SELECT 1;"
# Expected: Returns "1"

# 4. Check connection pool status
psql -U postgres -c "SELECT * FROM pg_stat_activity WHERE datname = 'tidepool';"
# Expected: < 20 connections

# 5. Check for idle connections
psql -U postgres -c "SELECT usename, state, COUNT(*) FROM pg_stat_activity GROUP BY usename, state;"

# 6. If too many idle connections
# Kill idle connections (⚠️ Be careful)
psql -U postgres << 'EOF'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'tidepool'
  AND state = 'idle'
  AND state_change < now() - interval '5 minutes';
EOF
```

### Fix Connection Issues

```bash
# 1. Check .env file
cat /home/artificium/memforge/.env

# Expected: DATABASE_URL=postgres://...

# 2. Verify DATABASE_URL format
# Format: postgres://user:password@host:port/database
# Example: postgres://postgres:postgres@localhost:5432/tidepool

# 3. Restart service to reconnect
sudo systemctl restart memforge

# 4. Monitor reconnection
sudo journalctl -u memforge -f
# Watch for: "Connected to database" or similar

# 5. Verify
curl -s http://localhost:3333/health | jq .
```

---

## RUNBOOK 5: Memory Leak Detection

**Purpose:** Identify and address memory growth issues  
**Frequency:** Weekly (or if high memory detected)  
**Time Required:** 30 minutes  
**Owner:** Operations / Developer

### Monitor Memory Over Time

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Get baseline
ps aux | grep "node.*server.js" | grep -v grep

# Record: RSS (resident set size) in column 6
# Expected baseline: MemForge ~50-100MB, Dashboard ~40MB, Hyphae ~20MB

# 3. Monitor for 1 hour
for i in {1..60}; do
  echo "$(date '+%Y-%m-%d %H:%M:%S') $(ps aux | grep memforge | grep 'node' | grep -v grep | awk '{print $6}') MB"
  sleep 60
done | tee /tmp/memforge-memory.log

# 4. Analyze growth
# If memory growing > 10MB per hour → likely memory leak
# If memory stable → acceptable
tail -5 /tmp/memforge-memory.log
```

### Identify Memory Leak

```bash
# 1. Check heap usage (requires running with --expose-gc)
# Kill service, restart with profiling
sudo systemctl stop memforge

# 2. Start with profiling
cd /home/artificium/memforge
DATABASE_URL=postgres://... node --expose-gc dist/server.js &

# 3. Generate heap snapshot (after 15 min of normal load)
node -e "
  const v8 = require('v8');
  const fs = require('fs');
  const snapshot = v8.writeHeapSnapshot();
  console.log('Heap snapshot written:', snapshot);
" 2>&1

# 4. Compare snapshots over time
# Large objects that persist = memory leak indicator

# 5. Stop profiling
kill %1
sudo systemctl start memforge
```

### Fix Memory Leak

**Common causes:**

| Cause | Fix |
|-------|-----|
| Unbounded array growth | Implement size limit, cleanup strategy |
| Event listener leaks | `removeListener()` in cleanup code |
| Circular references | Use WeakMap/WeakSet where appropriate |
| Connection pool leak | Verify connections closed after use |

**Standard fix process:**
1. Identify which service (MemForge, Dashboard, Hyphae)
2. Review recent commits to that service
3. Check if issue existed in previous version
4. Revert change or implement fix
5. Test with memory monitoring
6. Deploy

---

## RUNBOOK 6: Load Reduction (High CPU/Memory)

**Purpose:** Respond to system overload  
**Frequency:** As needed  
**Time Required:** 15 minutes  
**Owner:** Operations

### Quick Load Reduction

```bash
# 1. Identify load
top -b -n 1 | head -20
# Look for: CPU > 80%, Memory > 80%

# 2. Identify heavy process
ps aux | sort -rnk 3,3 | head -5  # By CPU
ps aux | sort -rnk 4,4 | head -5  # By memory

# 3. Temporary fix: Reduce incoming traffic
# Option A: Rate limit at firewall/load balancer
# Option B: Temporarily reduce worker pool size
# Option C: Enable caching to reduce DB load

# 4. Long-term fix: Optimize or scale
# - Identify slow queries
# - Optimize database indexes
# - Add caching (Redis)
# - Scale horizontally (add more instances)
```

### Emergency Scaling (If Available)

```bash
# 1. Temporarily disable non-critical services
sudo systemctl stop health-dashboard
# Keep: memforge, hyphae, postgresql

# 2. Increase resource limits (if in container)
# Edit systemd service:
sudo systemctl edit memforge
# Add/update:
# [Service]
# MemoryLimit=2G
# CPUQuota=80%

# 3. Reduce connection pool
# Edit /home/artificium/memforge/.env
DATABASE_POOL_SIZE=10  # Reduced from 20

# 4. Restart services
sudo systemctl restart memforge

# 5. Monitor recovery
watch -n 5 'ps aux | grep node'

# 6. Re-enable services once stable
sudo systemctl start health-dashboard
```

---

## RUNBOOK 7: Network Partition Recovery

**Purpose:** Handle VPS network disconnection from main infrastructure  
**Frequency:** Rare, but critical  
**Time Required:** 10 minutes  
**Owner:** Operations / Network

### Detect Network Partition

```bash
# 1. Check connectivity
ping -c 1 8.8.8.8                    # Public internet
ping -c 1 aihome.local               # Local network
ping -c 1 100.81.137.100             # aihome Tailscale

# 2. If ping fails: Network partition detected
echo "⚠️ Network partition detected"

# 3. Check Tailscale status
tailscale status
# Expected: Connected, all peers reachable

# 4. If Tailscale disconnected
tailscale up
# or
sudo systemctl restart tailscaled
```

### Recovery Procedure

```bash
# 1. If temporary network outage
# Wait 30-60s for automatic recovery
# Verify: ping 100.81.137.100

# 2. If persistent
# Check firewall rules
sudo ufw status

# Check DNS
nslookup 100.81.137.100

# 3. If still disconnected
# Restart Tailscale
sudo systemctl restart tailscaled
sleep 5
tailscale up

# 4. Verify connectivity restored
ping -c 1 100.81.137.100
curl http://aihome.local:5000 2>&1 | head -1

# 5. Verify services still operational
curl http://localhost:3333/health
```

---

## RUNBOOK 8: Database Maintenance

**Purpose:** Regular database optimization  
**Frequency:** Weekly  
**Time Required:** 15 minutes  
**Owner:** DBA / Operations

### Weekly Maintenance

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Vacuum and analyze (defragment)
psql -U postgres -d tidepool << 'EOF'
VACUUM ANALYZE;
EOF

# 3. Check for unused indexes
psql -U postgres -d tidepool << 'EOF'
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY idx_blks_read DESC;
EOF

# 4. Check table sizes
psql -U postgres -d tidepool << 'EOF'
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
EOF

# 5. Archive old data if needed
psql -U postgres -d tidepool << 'EOF'
-- Move data older than 90 days from warm_tier to cold_tier
INSERT INTO cold_tier
SELECT * FROM warm_tier
WHERE consolidated_at < NOW() - INTERVAL '90 days';

DELETE FROM warm_tier
WHERE consolidated_at < NOW() - INTERVAL '90 days';

VACUUM ANALYZE;
EOF

echo "✅ Database maintenance complete"
```

---

## RUNBOOK 9: Log Cleanup

**Purpose:** Manage disk space by archiving old logs  
**Frequency:** Weekly  
**Time Required:** 5 minutes  
**Owner:** Operations

### Log Cleanup

```bash
# 1. SSH to VPS
ssh artificium@100.97.161.7

# 2. Check current disk usage
df -h

# 3. Check journal size
sudo journalctl --disk-usage

# 4. Archive old logs (keep last 30 days)
sudo journalctl --vacuum-time=30d

# 5. Optionally limit journal size
sudo journalctl --vacuum-size=500M

# 6. Verify
sudo journalctl --disk-usage
df -h

echo "✅ Log cleanup complete"
```

---

## RUNBOOK 10: On-Call Escalation

**Purpose:** When to escalate issues  
**Frequency:** As needed  
**Owner:** On-call engineer

### Escalation Matrix

| Issue | Severity | Action | Escalate To |
|-------|----------|--------|-------------|
| Service down < 1 min, auto-recovered | Low | Log, monitor | None |
| Service down 1-5 min, manual restart needed | Medium | Restart, notify | Ops lead |
| Service down > 5 min, restart fails | High | Follow RUNBOOK 6, gather logs | CTO (Flint) |
| Data corruption or loss | Critical | Stop services, gather evidence | CEO (John) |
| Security breach suspected | Critical | Isolate, preserve logs | CEO + CTO |

### Escalation Procedure

```bash
# 1. Low severity (log and monitor)
echo "Issue: <description>" >> /var/log/incident.log

# 2. Medium severity (notify)
# Send message to on-call group
# Or: Open GitHub issue

# 3. High severity (escalate to CTO)
# Gather information
sudo journalctl -u memforge -n 500 > /tmp/incident-logs.txt
ps aux > /tmp/incident-procs.txt
df -h > /tmp/incident-disk.txt

# Send to CTO
mail -s "⚠️ High-severity incident: Service recovery failed" flint@salishforge.com \
  < /tmp/incident-logs.txt

# 4. Critical severity (escalate to CEO)
# Follow steps above, add:
mail -s "🚨 CRITICAL: Data loss suspected" john@salishforge.com \
  < /tmp/incident-logs.txt

# Also notify CTO:
mail -cc "flint@salishforge.com" ...
```

---

## Quick Reference

**Service restart:**
```bash
sudo systemctl restart memforge
```

**Health check:**
```bash
curl http://localhost:3333/health
```

**View logs:**
```bash
sudo journalctl -u memforge -f
```

**Database backup:**
```bash
pg_dump -U postgres -d tidepool | gzip > ~/backup.sql.gz
```

**Memory check:**
```bash
ps aux | grep node
```

---

**Last Updated:** 2026-03-18  
**Version:** 1.0

