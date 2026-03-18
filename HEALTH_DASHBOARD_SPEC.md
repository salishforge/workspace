# Health Dashboard — Test Project Spec

**Purpose:** Coordinate Flint (orchestrator) + Tidepool-Flint (executor) + Coding Agent (dev) to build a real feature

**Success Criteria:**
- Dashboard endpoint returns agent health status in real-time
- Coordination logged via NATS (audit trail visible)
- Tidepool-Flint deploys successfully to VPS
- All communication logged; no silent failures

---

## Architecture

```
┌─────────────────────────────────────────┐
│ Flint (OpenClaw) — Orchestrator         │
│ ├─ Receives: "build health dashboard"   │
│ ├─ Breaks into tasks                    │
│ └─ Sends: Task A → Coding Agent         │
│           Task B → Tidepool-Flint       │
└──────────┬──────────────────────────────┘
           │ (NATS topics)
    ┌──────┴────────┐
    │               │
    ▼               ▼
┌──────────────┐  ┌─────────────────┐
│Coding Agent  │  │Tidepool-Flint   │
│(Ollama/qwen) │  │(VPS, Claude)    │
├──────────────┤  ├─────────────────┤
│Task A:       │  │Task B:          │
│Design &      │  │Deploy endpoint  │
│implement     │  │Wire to MemForge │
│dashboard     │  │Test health      │
│endpoint      │  │checks           │
└──────────────┘  └─────────────────┘
```

---

## Subtasks

### Task A: Dashboard Implementation (Coding Agent)

**Input:** Architecture spec (below)  
**Output:** `GET /health` endpoint code (Express.js)

**What it does:**
```typescript
// Input (from Tidepool-Flint):
// - Agent IDs
// - How to query NATS
// - Schema for response

// Output:
interface AgentHealth {
  agentId: string;
  lastHeartbeat: ISO8601;
  status: 'healthy' | 'degraded' | 'dead';
  metrics: {
    messageLatency_ms: number;
    memoryUsage_percent: number;
    uptimeSeconds: number;
  };
}

// Endpoint:
GET /health
  → Returns: AgentHealth[]
```

**Constraints:**
- Simple Express endpoint (no external deps if possible)
- Query NATS for agent status
- Query PostgreSQL audit log for heartbeat timing
- Return JSON

---

### Task B: Infrastructure Deployment (Tidepool-Flint)

**Input:** Code from Coding Agent  
**Output:** Endpoint deployed on VPS, accessible via HTTP

**What it does:**
1. Receive code from Coding Agent
2. Create Express.js service on VPS
3. Wire to NATS (for agent status)
4. Wire to PostgreSQL (for audit log timing)
5. Run health checks (verify it works)
6. Report success/failure back to Flint

**Acceptance Criteria:**
- `curl http://localhost:3000/health` returns valid JSON
- Response includes all agents currently connected
- Response updates in real-time (within 1 second of agent change)

---

## Implementation Details

### Dashboard Endpoint Spec

```
GET /health

Response:
{
  "timestamp": "2026-03-17T14:30:00Z",
  "agents": [
    {
      "agentId": "tidepool-flint",
      "status": "healthy",
      "lastHeartbeat": "2026-03-17T14:29:58Z",
      "heartbeatAge_seconds": 2,
      "metrics": {
        "uptime_seconds": 86400,
        "memory_percent": 45.2,
        "messageLatency_ms": 234
      }
    },
    {
      "agentId": "tidepool-clio",
      "status": "offline",
      "lastHeartbeat": "2026-03-17T10:00:00Z",
      "heartbeatAge_seconds": 14400,
      "metrics": null
    }
  ],
  "summary": {
    "total": 2,
    "healthy": 1,
    "degraded": 0,
    "dead": 1
  }
}
```

### Data Sources

**Agent Status:**
- NATS subscription to `sf.agent.*.heartbeat`
- Each agent publishes heartbeat every 10 seconds
- Missing heartbeat for 30s = dead

**Message Latency:**
- Query PostgreSQL audit log
- Find messages from agent in last 5 minutes
- Calculate average delivery time

**Memory Usage:**
- Tidepool-Flint reports via NATS payload
- Parse from heartbeat message

---

## Communication Protocol

### Step 1: Task Assignment (Flint → Agents)

**To Coding Agent (via sub-agent spawn):**
```json
{
  "task": "dashboard-backend",
  "type": "code",
  "specification": "...(full spec above)...",
  "deadline": "when ready",
  "model": "qwen2.5-coder-7b"
}
```

**To Tidepool-Flint (via NATS):**
```json
{
  "from": "flint",
  "to": "tidepool-flint",
  "topic": "sf.agent.flint.request",
  "action": "deploy_health_dashboard",
  "payload": {
    "code": "...(from Coding Agent)...",
    "port": 3000,
    "nats_url": "nats://localhost:4222"
  }
}
```

### Step 2: Execution

**Coding Agent:**
- Receives task
- Implements endpoint
- Returns code to Flint

**Tidepool-Flint:**
- Receives deployment request
- Creates Express app
- Binds to NATS
- Binds to PostgreSQL
- Starts server
- Reports readiness to Flint

### Step 3: Verification

**Flint:**
- Calls `GET /health` on VPS
- Verifies response format
- Checks all agents reported
- Reports success/failure

---

## Success Indicators

1. **Endpoint accessible:**
   ```bash
   curl http://{VPS_IP}:3000/health
   ```
   Returns 200 + valid JSON

2. **Agent detection working:**
   - Dashboard shows Tidepool-Flint as healthy
   - Dashboard shows Tidepool-Clio as offline (correct)
   - Shows accurate heartbeat timing

3. **Real-time updates:**
   - Stop Tidepool-Flint → dashboard shows dead within 30s
   - Restart Tidepool-Flint → dashboard shows healthy

4. **Audit trail complete:**
   - All NATS messages logged
   - All PostgreSQL queries logged
   - Can trace full request through system

---

## Failure Modes (Expect & Handle)

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Coding Agent crashes | Sub-agent returns error | Respawn, retry |
| Tidepool-Flint NATS down | No heartbeat for 30s | Alert Flint |
| PostgreSQL query slow | Response >1s | Implement caching |
| Dashboard endpoint crashes | 500 error | Tidepool-Flint restarts service |
| Port 3000 already in use | Deployment fails | Use different port |

---

## Expected Coordination Log

```
[14:30] Flint: Break task into subtasks
  → Task A: Coding Agent (qwen)
  → Task B: Tidepool-Flint (deploy)

[14:31] Flint → Coding Agent: "Implement dashboard endpoint"
[14:32] Coding Agent: "Got it, starting implementation"
[14:33] Coding Agent: "Endpoint complete, sending code..."
[14:34] Flint receives code from Coding Agent
[14:34] Flint → Tidepool-Flint: "Deploy this endpoint"
[14:35] Tidepool-Flint: "Deploying..."
[14:36] Tidepool-Flint: "Endpoint live on port 3000"
[14:36] Flint: "Testing endpoint..."
[14:36] Flint: "✅ Health dashboard live"
[14:37] Flint: Full audit log + success report
```

---

## Monitoring During Test

**Flint will watch:**
- NATS message flow (real-time via `nats sub` or logs)
- PostgreSQL audit log (for message timing)
- Health endpoint responses (periodic curl)
- Tidepool-Flint logs (for errors)
- Coding Agent logs (for code quality issues)

**Report includes:**
- All messages sent/received (with timestamps)
- Any failures and recovery
- Latency metrics
- Cost breakdown (API calls, if any)
- Infrastructure status

---

## Next Steps

1. Spawn Coding Agent (sub-agent in OpenClaw)
2. Send Task A specification
3. Monitor Coding Agent progress
4. When code ready, send to Tidepool-Flint
5. Tidepool-Flint deploys + tests
6. Verify endpoint works
7. Collect all logs + metrics
8. Report full coordination history
