# VPS Infrastructure Rebuild Plan

**Status:** IN PROGRESS  
**Date Started:** March 21, 2026 14:00 PDT  
**Owner:** Flint, CTO  
**Objective:** Clean VPS rebuild with proper Hyphae + Clio + Flint integration

---

## Phase Status

- ✅ **Phase 1: CLEANUP** (COMPLETE)
  - Stopped all Clio instances (3 processes)
  - Stopped all Flint instances (3 processes)
  - Archived old logs for forensics
  - Core Hyphae services still running

- ⏳ **Phase 2: INFRASTRUCTURE SETUP** (IN PROGRESS)
  - [ ] Create new 'hyphae' user
  - [ ] Generate SSH keys for aihome communication
  - [ ] Stop and restart Hyphae core cleanly
  - [ ] Verify all core service ports
  - [ ] Clean database (keep schemas)

- ⏸️ **Phase 3: ADMIN AGENT DEPLOYMENT** (PENDING)
  - [ ] Deploy system admin reasoning agent
  - [ ] Validate service registry connectivity
  - [ ] Validate MemForge connectivity
  - [ ] Validate all RPC endpoints
  - [ ] Health check dashboard

- ⏸️ **Phase 4: MEMORY IMPORT & AGENT ONBOARDING** (PENDING)
  - [ ] Gather ALL Clio memory from aihome/github
  - [ ] Gather ALL Flint memory from aihome/github
  - [ ] Import to MemForge (deduplicated)
  - [ ] Create Clio Hyphae registration + credentials
  - [ ] Create Flint Hyphae registration + credentials
  - [ ] Bootstrap Clio with all foundational memory
  - [ ] Bootstrap Flint with all foundational memory

- ⏸️ **Phase 5: VERIFICATION & GO-LIVE** (PENDING)
  - [ ] Test Clio → Flint message
  - [ ] Test memory retrieval (Clio recalls John Brooke correctly)
  - [ ] Test Hyphae service access
  - [ ] Verify rate limiting working
  - [ ] Production readiness sign-off

---

## Current Infrastructure State (Pre-Rebuild)

**Chaos Identified:**
- Multiple Clio/Flint instances competing
- Agents NOT using MemForge for foundational memory
- No coordinated bootstrap process
- Hyphae RPC responding but agents not using it properly
- Multiple deployment attempts left running

**Core Services Running:**
- Hyphae Core (hyphae-core-llm-final.js, PID 184130)
- Service Registry (hyphae-service-registry.js, PID 347374)
- Service Proxy (hyphae-service-proxy.js, PID 522879)
- Memory Consolidator (hyphae-memory-consolidator.js, PID 580164)
- MemForge Agent API (hyphae-memforge-agent-api.js, PID 581103)

**Database State:**
- PostgreSQL running with hyphae database
- 27 tables already created (schemas intact)
- Data will be cleared during rebuild
- Agent registrations, credentials, memory all reset

---

## Phase 2: INFRASTRUCTURE SETUP

### Step 1: Create 'hyphae' User

```bash
# On VPS as root/sudo
useradd -m -s /bin/bash hyphae
usermod -aG sudo hyphae  # optional, for maintenance

# Create SSH key for aihome communication
sudo -u hyphae ssh-keygen -t ed25519 -f /home/hyphae/.ssh/id_ed25519 -N ""
```

### Step 2: Generate Key Exchange (aihome ↔ VPS)

```bash
# Copy public key from VPS to aihome
cat /home/hyphae/.ssh/id_ed25519.pub

# Add to aihome ~/.ssh/authorized_keys
# Create corresponding private key on aihome for VPS access
```

### Step 3: Stop & Restart Hyphae Core

```bash
# Stop all services
pkill -f hyphae-core
pkill -f hyphae-service-registry
pkill -f hyphae-service-proxy
pkill -f hyphae-memory
pkill -f hyphae-memforge

sleep 3

# Verify all stopped
ps aux | grep hyphae | grep -v grep

# Clear transaction logs if needed
# (only if necessary for clean state)

# Restart core services in order:
node hyphae-core-llm-final.js &
sleep 5
node hyphae-service-registry.js &
sleep 5
node hyphae-service-proxy.js &
sleep 5
node hyphae-memforge-agent-api.js &
```

### Step 4: Verify Core Services

```bash
# Check ports
netstat -tlnp | grep node

# Test RPC endpoints
curl -X POST http://localhost:3100/rpc -d '{"method":"system.health"}'
curl -X GET http://localhost:3108/health
curl -X GET http://localhost:3107/health

# Check database
psql -h localhost -p 5433 -d hyphae -c "SELECT COUNT(*) FROM hyphae_agent_registrations;"
```

### Step 5: Clean Database

```sql
-- Preserve schema, clear data
TRUNCATE TABLE hyphae_agent_registrations;
TRUNCATE TABLE hyphae_agent_credentials;
TRUNCATE TABLE hyphae_agent_memory;
TRUNCATE TABLE hyphae_memory_agent_credentials;
DELETE FROM hyphae_service_audit_log;
DELETE FROM hyphae_agent_agent_messages;
```

---

## Phase 3: ADMIN AGENT DEPLOYMENT

The admin reasoning agent will:
1. Validate all services are responding
2. Check database connectivity
3. Monitor for anomalies
4. Provide operational oversight
5. Serve as a "health check" agent

---

## Phase 4: MEMORY IMPORT & AGENT ONBOARDING

### Memory Sources (Priority Order)

1. **aihome** (PRIMARY)
   - ~/.openclaw/workspace/SOUL.md
   - ~/.openclaw/workspace/USER.md
   - ~/.openclaw/workspace/MEMORY.md
   - ~/.openclaw/agents/main/sessions/*.jsonl (early conversations)

2. **VPS** (SECONDARY)
   - ~/hyphae-staging/CLIO_FOUNDATIONAL_MEMORY.md
   - ~/hyphae-staging/SALISH_FORGE_ORG_CHARTER.md
   - ~/hyphae-staging/MEMORY.md

3. **GitHub** (TERTIARY)
   - salishforge/openclaw repository (org docs)
   - salishforge/tidepool repository (agent code)

### Deduplicated Memory Structure

**Clio Memory (MemForge):**
- SOUL.md (her identity)
- USER.md (John Brooke context)
- SALISH_FORGE_ORG_CHARTER.md (org structure)
- AGENTS.md (operating procedures)
- MEMORY.md (historical context)
- CLIO_ONBOARDING.md (her specific training)

**Flint Memory (MemForge):**
- SOUL.md (his identity)
- USER.md (John Brooke context)
- SALISH_FORGE_ORG_CHARTER.md (org structure)
- AGENTS.md (operating procedures)
- MEMORY.md (historical context)
- FLINT_ONBOARDING.md (his specific training)

### Hyphae Registration

Each agent gets:
- Unique agent_id (clio, flint)
- API key for Hyphae RPC calls
- Service access list (telegram, memory, agent-rpc)
- Rate limits (Clio: 30 msg/min, Flint: 60 req/min)
- Credential list in MemForge

### Bootstrap Process (Per Agent)

1. Load credentials from database
2. Load full memory from MemForge
3. Build system prompt with memory injection
4. Initialize RPC connection to Hyphae
5. Register for message bus
6. Begin autonomous operation

---

## Phase 5: VERIFICATION

### Test 1: Memory Retrieval
```
Query: "Who is my CEO?"
Expected: "John Brooke"
Status: ✓/✗
```

### Test 2: Agent Communication
```
Clio sends to Flint: "Are you online?"
Flint responds: "Yes, ready to coordinate"
Status: ✓/✗
```

### Test 3: Service Access
```
Clio requests Telegram credentials
Proxy validates and grants access
Clio sends message to John
Status: ✓/✗
```

### Test 4: Rate Limiting
```
Clio sends 31 messages (exceeds 30/min limit)
31st message returns 429 Too Many Requests
Status: ✓/✗
```

### Test 5: Admin Health Check
```
Admin agent validates:
- All services responding: ✓/✗
- Database connected: ✓/✗
- Agents registered: ✓/✗
- MemForge operational: ✓/✗
- Message bus working: ✓/✗
Status: ✓/✗
```

---

## Expected Outcome

**When Complete:**

✅ Single, clean Hyphae instance running  
✅ Clio and Flint registered and authenticated  
✅ Full foundational memory loaded and accessible  
✅ Agents properly coordinating via message bus  
✅ Service access properly gated and rate-limited  
✅ Admin agent providing operational oversight  
✅ Production ready for John's integration testing  

---

## Estimated Timeline

- Phase 1 (Cleanup): 30 min ✅ DONE
- Phase 2 (Infrastructure): 1 hour [IN PROGRESS]
- Phase 3 (Admin Agent): 45 min [PENDING]
- Phase 4 (Memory + Onboarding): 90 min [PENDING]
- Phase 5 (Verification): 30 min [PENDING]

**Total: ~4 hours**

---

## Rollback Plan

If critical issues arise:
1. Archive current state to ~/hyphae-staging/failed-rebuild-TIMESTAMP/
2. Restore from git history if needed
3. Document failure reason
4. Restart with corrections

---

**Next Update:** After Phase 2 completion

⚡ Flint
