# Hyphae Emergency Recovery Assistant (ERA)

**Status:** Core architectural component (design)  
**Version:** 1.0  
**Date:** March 18, 2026  
**Author:** Flint (CTO), John Brooke (CEO)  

---

## Executive Summary

**ERA is the system recovery console for Hyphae.** When normal infrastructure fails, ERA provides:
- Complete system visibility (logs, state, memory, configs)
- Offline diagnostics (local model, no cloud dependency)
- Zero-trust remediation (approval gates, immutable audit trails)
- Cascade failure recovery (root cause analysis + fix suggestions)

**Key principle:** ERA must be the last thing standing. If ERA fails, human admins can still diagnose and fix.

---

## Design Philosophy

**Unbreakable resilience through minimalism:**

1. **Core Isolation** — ERA is unaffected by plugin failures, agent framework issues, or transport layer problems
2. **Offline-First** — ERA runs with local model, no cloud dependency, no internet required
3. **Zero-Trust** — No operation is auto-approved; every action requires explicit human authorization
4. **Immutable Audit** — Every ERA action logged to append-only ledger
5. **Read-First** — All read operations unrestricted; all write operations require approval

**When normal systems fail, ERA is still available to help diagnose and recover.**

---

## Architecture

### ERA Components

```
Hyphae Emergency Recovery Assistant (ERA)
├── Inference Engine (local model)
│   ├── Ollama + Qwen 7B (default)
│   ├── Or Claude Haiku + local cache
│   └── ~4GB memory, runs on any hardware
│
├── System State Access (read-heavy, zero-trust)
│   ├── PostgreSQL (direct, secure connection)
│   ├── Service Registry
│   ├── RPC Audit Trail
│   ├── Timekeeper logs
│   ├── Agent memory (MemForge)
│   ├── Agent state snapshots
│   └── All configurations
│
├── Diagnostic Engine
│   ├── Log analysis (pattern matching)
│   ├── State correlation (which failures caused which)
│   ├── Memory analysis (semantic search for anomalies)
│   ├── Cascade detection (failure propagation)
│   └── Root cause analysis
│
├── Approval Gate (writes only)
│   ├── Human admin command interface
│   ├── Time-limited approval tokens
│   ├── Reason/justification required
│   └── MFA for critical operations
│
└── Audit Logger (immutable)
    ├── Every read logged
    ├── Every write + approval logged
    ├── Timestamp + admin identity
    ├── Outcome recorded
    └── Append-only storage (cannot be modified)
```

### Access Isolation

**What ERA can always see (no approval needed):**
```
Logs:
- RPC audit trail (all agent-to-agent calls)
- Timekeeper logs (clock sync, validation)
- Error logs (agent failures, timeouts)
- System logs (service health, connectivity)

Registry:
- All registered agents + capabilities
- Service health status
- Last heartbeat timestamp

Metrics:
- Agent capacity/utilization
- RPC latency distribution
- Error rates by agent/capability

Memory/State:
- Agent knowledge (MemForge)
- Semantic search (find relevant memories)
- Relationship graphs (agent dependencies)
- Agent state snapshots (when available)

Configuration:
- All service configs
- All agent configs
- Security policies
- Rate limits
```

**What ERA can do (requires approval + MFA):**
```
Write Operations:
- Restart services
- Modify service registry
- Update configurations
- Change rate limits
- Rotate credentials
- Archive/rotate logs

Recovery Operations:
- Trigger agent re-registration
- Reset saga workflows
- Clear dead letter queues
- Force clock resynchronization
- Evict unhealthy agents from mesh

Advanced Operations:
- Modify audit logs (only under extreme circumstances)
- Direct database writes
- Credential rotation
- Network topology changes
```

### Authentication Model

**Physical/Out-of-Band Only:**
```
Option 1: Local Console
  - Physical access to machine running Hyphae
  - Keyboard input on local terminal
  - Cryptographic key (hardware token or file with strict permissions)
  - MFA: PIN + biometric or TOTP

Option 2: Secure Out-of-Band
  - SSH with certificate-based auth (no passwords)
  - MFA: TOTP + hardware token
  - IP whitelist (admin workstations only)
  - Audit log on SSH level + ERA level

Option 3: Emergency Credentials
  - One-time use recovery codes (printed, stored in safe)
  - Can only be used in offline mode
  - Each use logged and marked as emergency
  - Forces full audit review after use

NO: Cloud-based auth, API keys, ambient credentials
```

### Approval Workflow

**For any write operation:**

```
1. Admin types: /approve action:restart_service service:agent-x reason:"stuck_in_saga"

2. ERA displays:
   - What: "Restart agent-x"
   - Why: "Agent stuck in saga for 5 minutes"
   - Impact: "Running RPC calls will be interrupted"
   - Alternatives: "[1] Force saga compensation, [2] Rebalance to another agent"
   - Audit: "This will be logged as: <admin>, <timestamp>, <action>, <outcome>"

3. Admin approves (or cancels):
   - /confirm <approval_token>  (approval required)
   - OR /cancel reason:"chose alternative approach"

4. ERA executes (or rejects):
   - If approved: Execute with full audit trail
   - If denied: Log denial reason
   - If timeout (5 min): Deny and alert admin

5. Outcome logged:
   - WHO: admin identity
   - WHAT: action taken
   - WHEN: timestamp + duration
   - WHY: justification provided
   - RESULT: success/failure + details
```

---

## Diagnostic Capabilities

### Log Analysis

**Pattern Recognition:**
```
Admin: "Why are agents failing?"

ERA analyzes and reports:
[Clock Desync Pattern]
- 3 agents with clock_offset > 5000ms
- Started 15 minutes ago
- Correlates with RPC_TIMEOUT spike
- Likely cause: NTP service stopped on those machines
- Affected: researcher, analyzer, writer agents
- Fix: /approve restart_ntp agent:researcher,analyzer,writer

[Cascade Failure Pattern]
- researcher timeout → analyzer gets no input
- analyzer stalls → writer stalled waiting
- writer timeout triggers SAGA_TIMEOUT
- saga compensation fails (too slow)
- Cascades to 5 more agents
- Root: researcher clock desync (see above)

Recommendation:
1. /approve clock_resync agent:researcher
2. Wait for clock sync confirmation
3. Monitor RPC latency normalization
4. If not recovered in 2 min: /approve restart_agent agent:researcher
```

### State Analysis

**Memory Correlation:**
```
Admin: "Why did agent-X make a bad decision?"

ERA can:
- Query agent's knowledge (MemForge)
- Find relevant memories for the decision
- Check if related pattern library entries exist
- Correlate with other agents' state at same time
- Identify if information was missing/wrong
- Suggest: "Agent made decision with [X, Y] facts, but [Z] was unknown"
```

### Cascade Detection

**Failure Propagation:**
```
Admin: "Why did the whole system go down?"

ERA traces:
1. Initial failure: "NATS broker OOM at 23:47:31"
2. Direct impact: "234 message deliveries failed"
3. Secondary impact: "18 agents couldn't reach broker, marked unhealthy"
4. Tertiary: "Service registry updated, agents discovered missing peers"
5. Cascade: "5 sagas timed out due to peer unavailability"
6. Failure: "Saga compensation initiated but broker still down"
7. Avalanche: "Retry backoff caused exponential queue growth"
8. Result: "System unrecoverable without broker restart"

Root cause: NATS OOM
Breakpoint: Cascade detection didn't trigger auto-restart
Fix: /approve increase_nats_memory 4gb (with approval)
OR: /approve enable_auto_restart_on_broker_failure
```

---

## Security Model

### Zero-Trust Principles

**1. Verify Every Access**
```
Every read operation:
  - Verify admin identity
  - Check authorization (role-based)
  - Log: WHO accessed WHAT at WHEN
  - Validate: Is this access consistent with role?
  
Every write operation:
  - Verify admin identity (MFA required)
  - Check authorization
  - Require explicit approval
  - Verify admin understood the impact
  - Log: WHO approved WHAT, WHY, at WHEN
  - Record outcome: SUCCESS/FAILURE with details
```

**2. Assume Breach**
```
If admin credentials compromised:
  - ERA still requires in-person approval for writes
  - Or out-of-band approval (phone call, SMS, etc.)
  - Stolen token can only read, not write
  - Unusual access patterns trigger alerts
  - Recovery codes require physical access
```

**3. Immutable Audit**
```
ERA audit trail stored separately:
  - Cannot be deleted (append-only database)
  - Cannot be modified (hash chain verification)
  - Accessible only to ERA and auditors
  - Survives system failures
  - Cryptographic integrity verification
```

### Capabilities & RBAC

**Admin Roles:**

| Role | Capabilities | Use Case |
|------|--------------|----------|
| **Observer** | Read all logs, state, configs | Monitoring, understanding |
| **Responder** | Observer + approve read-only repairs | On-call troubleshooting |
| **Operator** | Observer + Responder + service restart | Daily operations |
| **Architect** | Operator + config changes | Major maintenance |
| **Emergency** | All (with 2-factor approval) | Crisis recovery only |

**Example capabilities:**
```
observer:
  - logs:read
  - state:read
  - memory:read
  
responder:
  - observer:all
  - saga:force_compensation (requires approval)
  - agent:reregister (requires approval)
  
operator:
  - responder:all
  - service:restart (requires approval)
  - clock:resync (requires approval)
  
architect:
  - operator:all
  - config:modify (requires approval + reason)
  - rate_limit:change (requires approval)
  
emergency:
  - all:write (requires dual approval + MFA)
```

---

## Implementation

### Local Model

**Recommended: Ollama + Qwen 7B**

```bash
# Install
ollama pull qwen:7b

# ERA uses for:
- Log pattern analysis
- State correlation
- Root cause hypothesis
- Fix suggestions
- Learning normal system behavior
```

**Reasoning:**
- 7B parameters = 4-6GB memory = runs on any server
- Fast inference (10-50ms per query)
- Good at pattern recognition
- Offline-capable
- No API dependency
- Cost: zero (local, one-time)

**Alternative: Claude Haiku + Local Cache**
- Stream some queries to Haiku
- Cache common analyses
- Fall back to local model if no internet

### Database Access

**Separate PostgreSQL Connection:**
```
ERA connection:
  - Separate superuser role (era_reader + era_admin)
  - Direct TCP (no application layer)
  - SSL/TLS encrypted
  - IP-restricted to ERA process only
  - Connection pooling disabled (each query is atomic)
  - Timeout: 30 seconds (force error vs hang)
  
Read-only by default:
  - era_reader role has SELECT only
  - Transactions READ ONLY by default
  - No CREATE/ALTER/DELETE possible
  
Write operations:
  - Require era_admin role switch
  - Only available after approval gate
  - Each write is single transaction
  - Logged at PostgreSQL level too
```

### Audit Logger

**Immutable Append-Only Log:**
```
Storage:
  - Separate PostgreSQL table
  - Or dedicated write-once filesystem
  - Or blockchain-style hash chain
  
Entry format:
{
  sequence: 1234,
  timestamp: "2026-03-18T23:27:00Z",
  admin: "john_admin",
  role: "operator",
  action: "restart_service",
  target: "agent-researcher",
  reason: "stuck in saga for 5 minutes",
  approval: {
    required: true,
    approved: true,
    approved_by: "admin_emergency",
    approval_time: "2026-03-18T23:27:15Z",
    token: "hash(...)"
  },
  outcome: {
    success: true,
    details: "Service restarted, took 3 seconds",
    timestamp: "2026-03-18T23:27:18Z"
  },
  hash: "sha256(...)",
  previous_hash: "sha256(...)"
}
```

---

## Operational Workflow

### Normal Operations

```
Human admin: "Check cluster health"
ERA: "All services healthy. 2 agents at >80% capacity."
Human: "Which agents?"
ERA: "researcher (92% utilization), analyzer (81% utilization)"
Human: "Any issues?"
ERA: "No errors. Both healthy. Consider scaling if trend continues."
```

### Troubleshooting

```
Human: "Agent-X is unresponsive"
ERA: "Checking agent-x state...
  Last heartbeat: 2 minutes ago (unhealthy)
  RPC calls to agent-x: 3 failed in last 5 min
  Clock offset: 23ms (healthy)
  Memory: 340MB / 512MB (66%, normal)
  
  Hypothesis: Service crashed or networking issue
  
  Quick checks:
  [1] /approve restart_agent agent:x
  [2] /approve check_network_connectivity agent:x
  [3] /approve force_reregistration agent:x
  
  Recommend: Try [1] first (most likely)"