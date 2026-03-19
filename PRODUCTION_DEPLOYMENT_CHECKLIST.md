# Production Deployment Checklist

**Status:** Ready for Deployment  
**Date:** March 19, 2026  
**Target:** VPS 100.97.161.7

---

## Pre-Deployment Verification (Local)

### Environment Setup
- [ ] Node.js 20+ installed
- [ ] Python 3.9+ installed (for CrewAI/AutoGen, if needed)
- [ ] GOOGLE_API_KEY set and valid
- [ ] Docker + Docker Compose installed
- [ ] Git credentials configured

### Code Quality
- [ ] All code committed to master branch
- [ ] No uncommitted changes
- [ ] All tests passing locally
- [ ] No TypeScript compilation errors
- [ ] No console.error or warnings in startup

### Hyphae Core
- [ ] Docker image builds successfully
- [ ] Docker Compose starts without errors
- [ ] Health check returns {"status":"healthy"}
- [ ] Service discovery works (GET /api/services)
- [ ] API rate limiting configured
- [ ] Database schema initialized

### Agent Implementation
- [ ] Flint (CrewAI) builds without errors
- [ ] Clio (AutoGen) builds without errors
- [ ] Both agents use Gemini 2.5 Pro
- [ ] Error handling covers all cases
- [ ] Timeout enforcement working
- [ ] Graceful shutdown implemented

### Integration Testing
- [ ] Agents register with Hyphae
- [ ] Service discovery returns both agents
- [ ] RPC call: Clio → Flint works
- [ ] RPC call: Flint → Clio works
- [ ] Audit trail logs all calls
- [ ] Errors are clear + actionable

### Performance Baseline (Local)
- [ ] Service discovery: <10ms
- [ ] RPC overhead: <50ms
- [ ] Health check latency: <5ms
- [ ] Throughput: 500+ req/sec baseline
- [ ] Memory usage: stable
- [ ] No memory leaks detected

---

## VPS Deployment

### Infrastructure Preparation
- [ ] VPS has 2GB+ RAM free
- [ ] VPS has 20GB+ disk space
- [ ] PostgreSQL running + accessible
- [ ] Network connectivity: 100Mbps+
- [ ] SSH access verified
- [ ] Firewall allows port 3100 (internal)

### Code Deployment
```bash
# SSH to VPS
ssh ubuntu@100.97.161.7
cd workspace

# Pull latest code
git pull origin master
git log --oneline -1

# Verify commit is Phase 2 agents
```

- [ ] Master branch at correct commit
- [ ] All new files present
- [ ] No merge conflicts
- [ ] Timestamps recent (within 10 minutes)

### Hyphae Core Deployment
```bash
cd hyphae
docker-compose up -d
sleep 10
curl http://localhost:3100/api/health
```

- [ ] Docker-compose services starting
- [ ] PostgreSQL healthy
- [ ] Hyphae health check: 200 OK
- [ ] No errors in logs

### Agent Deployment
```bash
cd ../hyphae-agents
npm install
npm run build

# Start agents in tmux
export GOOGLE_API_KEY='...'
tmux new-session -d -s flint "npm run start:flint"
tmux new-session -d -s clio "npm run start:clio"

# Verify startup
sleep 5
tmux capture-pane -t flint -p | tail -20
tmux capture-pane -t clio -p | tail -20
```

- [ ] Agents start without errors
- [ ] No GOOGLE_API_KEY errors
- [ ] Both agents register with Hyphae
- [ ] Startup logs show: ✅ Registered with Hyphae

### Post-Deployment Verification
```bash
# Check service discovery
curl http://localhost:3100/api/services

# Check both agents
curl http://localhost:3100/api/services/flint
curl http://localhost:3100/api/services/clio
```

- [ ] Both agents appear in service discovery
- [ ] Both agents show healthy: true
- [ ] Capabilities listed correctly
- [ ] Endpoints are reachable

### Integration Testing (VPS)
```bash
# Test Flint.status
curl -X POST http://localhost:3100/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "test",
    "targetAgent": "flint",
    "capability": "status",
    "params": {},
    "timeout": 10000
  }'

# Test Clio.status
curl -X POST http://localhost:3100/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "test",
    "targetAgent": "clio",
    "capability": "status",
    "params": {},
    "timeout": 10000
  }'

# Test RPC: Clio → Flint
curl -X POST http://localhost:3100/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "clio",
    "targetAgent": "flint",
    "capability": "execute_task",
    "params": {"task": "Test task"},
    "timeout": 60000
  }'
```

- [ ] Flint.status returns operational
- [ ] Clio.status returns operational
- [ ] RPC calls succeed
- [ ] Response times reasonable (<5s)

### Load Testing (VPS)
```bash
npm run load-test
```

- [ ] Service discovery: >500 req/sec
- [ ] Health checks: <5ms latency
- [ ] Error rate: <0.1%
- [ ] No timeouts or failures

### Stability Testing
```bash
# Monitor for 5 minutes
watch -n 1 'curl -s http://localhost:3100/api/stats | jq'

# Check logs
tail -f <(tmux capture-pane -t flint -p -S -100)
tail -f <(tmux capture-pane -t clio -p -S -100)
```

- [ ] Stats consistent across multiple queries
- [ ] No errors in agent logs
- [ ] Memory usage stable
- [ ] No timeouts or failures

---

## Production Validation

### Monitoring Setup
- [ ] Logs are accessible
- [ ] Health checks running
- [ ] Metrics collecting
- [ ] Alerts configured (optional)

### Backup & Recovery
- [ ] Database has backup
- [ ] Backup procedure documented
- [ ] Recovery tested
- [ ] RPO < 1 hour

### Documentation Review
- [ ] Deployment guide complete
- [ ] Runbooks available
- [ ] Troubleshooting guide ready
- [ ] Admin contacts documented

### Security Review
- [ ] No hardcoded secrets
- [ ] GOOGLE_API_KEY only in env vars
- [ ] Database password secured
- [ ] SSH access restricted
- [ ] Firewall rules minimal

---

## Go / No-Go Decision

**GO Criteria (All Must Pass):**
- ✅ Both agents register with Hyphae
- ✅ Service discovery returns both
- ✅ RPC calls work both directions
- ✅ Audit trail complete + accurate
- ✅ Performance baseline met
- ✅ No critical errors in logs
- ✅ Stability test: 5 min clean
- ✅ Load test: >500 req/sec

**NO-GO Decision If:**
- ❌ Any agent fails to start
- ❌ RPC calls timeout consistently
- ❌ Audit trail shows errors
- ❌ Memory leak detected
- ❌ Load test fails
- ❌ Critical security issue found

---

## Rollback Plan

**If Critical Issue Detected:**

1. Stop agents:
```bash
tmux kill-session -t flint
tmux kill-session -t clio
```

2. Stop Hyphae:
```bash
docker-compose down
```

3. Restore from backup (if needed):
```bash
psql -U postgres < backup.sql
```

4. Revert code:
```bash
git checkout HEAD~1
```

5. Restart:
```bash
docker-compose up -d
# ... restart agents
```

---

## Post-Deployment

### Day 1
- [ ] Monitor agents for 24 hours
- [ ] Check audit trail regularly
- [ ] Verify backup runs
- [ ] Document any issues

### Day 2-7
- [ ] Monitor daily
- [ ] Run load test weekly
- [ ] Verify performance stable
- [ ] Document lessons learned

### Ongoing
- [ ] Weekly health checks
- [ ] Monthly security audits
- [ ] Quarterly capacity planning
- [ ] Annual disaster recovery drill

---

## Sign-Off

**Deployer:** ________________  
**Approver:** John Brooke  
**Date:** ________________  
**Time:** ________________  

**Pre-Deployment Checklist:** [✅ / ⚠️ / ❌]  
**Deployment Successful:** [✅ / ❌]  
**Post-Deployment Verification:** [✅ / ⚠️ / ❌]  

**Notes:**

---

