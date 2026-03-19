# Hyphae Zero-Trust Agent Registration Protocol

Enterprise-grade key exchange with tiered authorization for primary agents and autonomous sub-agent registration.

## Overview

Instead of embedding `HYPHAE_ENCRYPTION_KEY` as an environment variable, agents perform a **cryptographic key exchange** during registration:

- **Primary Agents (Flint, Clio)** → Require human approval via dashboard
- **Sub-Agents** → Auto-approved by parent agent (no human approval needed)
- **No Pre-Shared Secrets** → Only base of trust is agent cryptographic identity
- **Complete Audit Trail** → Every registration attempt is logged

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         Hyphae Core (Port 3100)                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Registration Protocol                            │  │
│  │  - Issue challenges (nonce)                       │  │
│  │  - Verify agent signatures                        │  │
│  │  - Tiered approval gates                          │  │
│  │  - Issue encryption keys                          │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Agent Identities (PostgreSQL)                    │  │
│  │  - Agent ID → Public Key mapping                  │  │
│  │  - Status: pending/active/revoked                 │  │
│  │  - Parent agent (for sub-agents)                  │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Key Grants (PostgreSQL)                          │  │
│  │  - Encryption key per agent                       │  │
│  │  - Expiry tracking                                │  │
│  │  - Revocation capability                          │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
           │
           │ Challenge-Response Key Exchange
           │ (Cryptographic Verification)
           │
    ┌──────┴──────┐
    │             │
┌───▼────┐   ┌───▼──────┐
│ Flint  │   │   Clio   │  ← Requires human approval
│(Primary)   │(Primary)  │
└────────┘   └──────┬───┘
                    │
                    │ Spawns
                    │
            ┌───────┴────────┐
            │                │
      ┌─────▼────┐    ┌──────▼─────┐
      │Task-1    │    │Task-2      │  ← Auto-approved
      │(Sub-Agent)   │(Sub-Agent)  │
      └──────────┘    └────────────┘
```

## Registration Flow

### For Primary Agents (Flint, Clio)

```
Agent Startup:
  │
  ├─ 1. Generate Ed25519 key pair (if not exists)
  │    └─ Store: ~/.hyphae-keys/flint.key, flint.pub
  │
  ├─ 2. Request registration challenge
  │    └─ POST /rpc: registration.initiate
  │    └─ Hyphae returns: nonce (random 256-bit value)
  │
  ├─ 3. Sign challenge with private key
  │    └─ signature = Ed25519Sign(nonce, private_key)
  │
  ├─ 4. Submit registration + signature
  │    └─ POST /rpc: registration.submit
  │    └─ Include: agentId, name, role, publicKey, nonce, signature
  │
  ├─ 5. Hyphae verifies signature
  │    └─ Ed25519Verify(nonce, signature, publicKey) → must pass
  │    └─ Stores: agent identity, status=pending
  │
  ├─ 6. Return status: pending_approval
  │    └─ Agent waits... (async polling for approval)
  │
  ├─ 7. Human approves in dashboard
  │    └─ Admin reviews: agentId, name, role
  │    └─ Clicks "Approve"
  │    └─ Hyphae generates encryption key (32 bytes)
  │    └─ Stores: key grant, status=active
  │
  ├─ 8. Agent polls for status
  │    └─ Agent detects: status=active, encryptionKey received
  │    └─ Stores key locally (encrypted on disk)
  │
  └─ 9. Agent is now registered
     └─ Can use vault for secrets
     └─ Can spawn sub-agents
```

**Example Primary Agent Timeline:**
```
09:00 → Agent starts
09:00 → Registration request submitted
09:00 → Status: pending_approval
09:00 → Waiting for human approval...
09:05 → [Human approves in dashboard]
09:05 → Status: active, encryptionKey received
09:05 → Agent operational
```

### For Sub-Agents

```
Sub-Agent Startup (spawned by Flint):
  │
  ├─ 1. Generate Ed25519 key pair (if not exists)
  │
  ├─ 2. Request registration challenge
  │    └─ POST /rpc: registration.initiate
  │    └─ Hyphae returns: nonce
  │
  ├─ 3. Sign challenge
  │    └─ signature = Ed25519Sign(nonce, private_key)
  │
  ├─ 4. Submit registration with parent vouching
  │    └─ POST /rpc: registration.submit
  │    └─ Include: vouchedBy=flint (parent agent ID)
  │    └─ Hyphae verifies signature
  │    └─ Hyphae checks: is flint active? YES
  │
  ├─ 5. Auto-approve (parent is active)
  │    └─ Hyphae generates encryption key
  │    └─ Stores: key grant, status=active
  │
  ├─ 6. Return: status=active, encryptionKey
  │    └─ Immediate response (no waiting)
  │
  └─ 7. Sub-agent operational
     └─ Can request secrets from vault
     └─ Can spawn further sub-sub-agents (if permitted)
```

**Example Sub-Agent Timeline:**
```
09:05 → Flint spawns sub-agent (task-processor-1)
09:05 → Registration request submitted
09:05 → Hyphae checks: is flint active? YES
09:05 → Auto-approve, return encryptionKey
09:05 → Sub-agent operational
       (entire flow: <100ms)
```

## Key Exchange Protocol

### Cryptographic Details

**Ed25519 Signatures:**
```
Agent generates:
  private_key: 32-byte Ed25519 private key
  public_key:  32-byte Ed25519 public key

Agent stores:
  ~/.hyphae-keys/[agentId].key  (mode 0600)
  ~/.hyphae-keys/[agentId].pub  (mode 0600)

Hyphae stores:
  hyphae_agent_identities.public_key (PEM format)

Signature process:
  signature = Ed25519Sign(nonce, private_key)
  
Verification process:
  valid = Ed25519Verify(nonce, signature, public_key)
```

**Why Ed25519?**
- ✅ Fast signature generation
- ✅ Small keys (32 bytes each)
- ✅ Resistant to side-channel attacks
- ✅ No trusted randomness needed
- ✅ Standard across all platforms

### Challenge-Response Flow

```json
1. Agent → Hyphae: "I am flint, generate challenge"
{
  "capability": "registration.initiate",
  "params": { "agentId": "flint" }
}

2. Hyphae → Agent: Challenge nonce (random 256 bits)
{
  "success": true,
  "nonce": "a1b2c3d4e5f6...(64 hex chars)"
}

3. Agent: Sign with private key
signature = Ed25519Sign(nonce, private_key)

4. Agent → Hyphae: Submit registration with signature
{
  "capability": "registration.submit",
  "params": {
    "agentId": "flint",
    "name": "Flint",
    "role": "Chief Technology Officer",
    "type": "primary",
    "publicKey": "...(PEM format hex)",
    "nonce": "a1b2c3d4e5f6...",
    "signature": "x1y2z3...(hex)"
  }
}

5. Hyphae: Verify signature
valid = Ed25519Verify(
  nonce="a1b2c3d4e5f6...",
  signature="x1y2z3...",
  publicKey="...(from agent)"
)

6. If valid and type=primary:
   Status: pending_approval (wait for human)

7. If valid and type=sub-agent:
   Check parent: is vouchedBy agent active?
   If yes: Auto-approve, return encryption key
   If no: Reject registration
```

## Database Schema

### hyphae_agent_identities
```sql
CREATE TABLE hyphae_agent_identities (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(255) UNIQUE,      -- 'flint', 'clio', 'task-processor-1'
  public_key TEXT,                    -- Ed25519 public key (PEM)
  name VARCHAR(255),                  -- 'Flint', 'Task Processor #1'
  role VARCHAR(255),                  -- 'Chief Technology Officer'
  type VARCHAR(50),                   -- 'primary', 'sub-agent'
  parent_agent_id VARCHAR(255),       -- For sub-agents: 'flint'
  status VARCHAR(50),                 -- 'pending', 'active', 'revoked'
  created_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by VARCHAR(255),           -- 'john', 'flint' (for sub-agents)
  revoked_at TIMESTAMP
);
```

### hyphae_registration_challenges
```sql
CREATE TABLE hyphae_registration_challenges (
  id UUID PRIMARY KEY,
  challenge_id VARCHAR(255) UNIQUE,
  agent_id VARCHAR(255),
  nonce TEXT,                         -- Challenge nonce (256-bit hex)
  status VARCHAR(50),                 -- 'pending', 'approved', 'rejected', 'expired'
  expires_at TIMESTAMP,               -- 5-minute expiry
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  created_at TIMESTAMP
);
```

### hyphae_key_grants
```sql
CREATE TABLE hyphae_key_grants (
  id UUID PRIMARY KEY,
  grant_id VARCHAR(255) UNIQUE,
  agent_id VARCHAR(255),
  encryption_key TEXT,                -- 32-byte hex (HYPHAE_ENCRYPTION_KEY for agent)
  issued_at TIMESTAMP,
  expires_at TIMESTAMP,               -- 1-year expiry (configurable)
  revoked_at TIMESTAMP,               -- NULL until revoked
  issued_by VARCHAR(255)              -- 'john' (human) or 'flint' (parent agent)
);
```

## Usage

### Agent Initialization (Primary)

```typescript
import RegistrationClient from './registration-client';

async function initializeFlint() {
  const registrationClient = new RegistrationClient({
    agentId: 'flint',
    name: 'Flint',
    role: 'Chief Technology Officer',
    type: 'primary',
    hyphaeUrl: 'http://localhost:3100',
  });

  // Perform key exchange
  const result = await registrationClient.register();

  if (result.status === 'pending_approval') {
    // Primary agent: wait for human approval
    console.log('Awaiting human approval...');
    const approval = await registrationClient.waitForApproval(300); // 5 min timeout
    
    if (approval.status === 'active') {
      const encryptionKey = approval.encryptionKey;
      // Use encryptionKey to initialize vault
      process.env.HYPHAE_ENCRYPTION_KEY = encryptionKey;
    }
  } else if (result.status === 'active') {
    // Sub-agent: auto-approved
    const encryptionKey = result.encryptionKey;
    process.env.HYPHAE_ENCRYPTION_KEY = encryptionKey;
  }
}

await initializeFlint();
```

### Sub-Agent Initialization (Autonomous)

```typescript
// Flint spawns sub-agent
const subAgent = await flint.spawnSubAgent({
  agentId: 'task-processor-1',
  name: 'Task Processor #1',
  role: 'task_execution',
  parentAgentId: 'flint',
});

// Sub-agent startup
async function initializeSubAgent() {
  const registrationClient = new RegistrationClient({
    agentId: 'task-processor-1',
    name: 'Task Processor #1',
    role: 'task_execution',
    type: 'sub-agent',
    parentAgentId: 'flint',
    hyphaeUrl: 'http://localhost:3100',
  });

  // Performs key exchange with parent vouching
  const result = await registrationClient.register();

  // result.status will be 'active' immediately (no waiting)
  const encryptionKey = result.encryptionKey;
  process.env.HYPHAE_ENCRYPTION_KEY = encryptionKey;
}

await initializeSubAgent();
```

## Security Properties

### What This Solves

| Problem | Solution |
|---------|----------|
| **No pre-shared secret needed** | Challenge-response proves identity |
| **Key distribution** | Hyphae generates per-agent encryption key |
| **Revocation** | Can immediately revoke an agent's key |
| **Autonomy** | Sub-agents can self-register via parent vouching |
| **Audit trail** | Every registration attempt logged |
| **Phishing-proof** | Signature verification prevents impersonation |

### Threat Model

**Attack: Agent impersonation**
- Attacker claims: "I am flint"
- Hyphae challenges with nonce
- Attacker can't sign (doesn't have private key)
- ✅ Attack fails

**Attack: Replay attack**
- Attacker captures: signature + nonce
- Attacker replays later
- Hyphae checks: nonce already used (expired)
- ✅ Attack fails

**Attack: Man-in-the-middle**
- Attacker intercepts HTTP traffic
- Attacker sees: nonce, signature, public key
- Attacker can't forge signature (don't have private key)
- ✅ Attack fails

**Attack: Compromise child agent's key**
- Attacker compromises sub-agent's private key
- Parent agent can revoke: `registration.revoke(agent_id)`
- Hyphae invalidates key grant
- ✅ Damage contained to one sub-agent

## Admin Dashboard Integration

Pending approvals view:

```
┌──────────────────────────────────────────────────────┐
│ Pending Agent Approvals                              │
├──────────────────────────────────────────────────────┤
│                                                      │
│ Agent ID      Role                    Created       │
│ ─────────────────────────────────────────────────── │
│ 📝 flint      Chief Technology Off... 2 min ago    │
│    Approve [✓] | Reject [✗]                         │
│                                                      │
│ 📝 clio       Chief of Staff          1 min ago    │
│    Approve [✓] | Reject [✗]                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Approval triggers key issuance:
```
Click: Approve
  ├─ Hyphae generates 32-byte encryption key
  ├─ Stores key grant (expires in 1 year)
  ├─ Updates agent status: pending → active
  ├─ Agent polling detects: active + encryptionKey
  └─ Agent operational
```

## Revocation & Rotation

### Revoke an Agent

```typescript
// Admin/parent revokes agent
await registrationProtocol.revokeAgent('task-processor-1', 'flint');

// Hyphae:
// 1. Updates status: active → revoked
// 2. Marks key grant: revoked_at = NOW()
// 3. Agent polling detects revocation
// 4. Agent stops requesting secrets
```

### Rotate Agent Key

```typescript
// After 1 year (or on demand)
await registrationProtocol.revokeAgent(agentId, approvedBy);
await registrationProtocol.initiateRegistration(agentId);
// Agent performs key exchange again
// Hyphae issues new encryption key
```

## File Paths

```
Agent private keys:
  ~/.hyphae-keys/flint.key         (mode 0600)
  ~/.hyphae-keys/flint.pub         (mode 0600)
  ~/.hyphae-keys/task-processor-1.key
  ~/.hyphae-keys/task-processor-1.pub

No environment variables needed:
  ✗ HYPHAE_ENCRYPTION_KEY (no longer in env)
  ✓ Only in ~/.hyphae-keys (encrypted on disk)
```

## Performance Objectives

**Design objectives for registration flow (must be verified by measurement):**

| Operation | Objective | Depends On | Verification |
|-----------|-----------|-----------|--------------|
| Challenge generation | <100ms | Random number generation | Single operation test |
| Ed25519 signature | <200ms | CPU, key size | Single operation test |
| Signature verification | <200ms | CPU, key size | Single operation test |
| Database write | <500ms | PostgreSQL, disk I/O | Insert audit record |
| Sub-agent registration | 1-5s (total) | All above + concurrent load | Load test with 100 sub-agents |

**Measurement Protocol:**

1. **Crypto Performance** (hardware-dependent)
   - Test on target hardware (CPU, crypto acceleration)
   - Measure Ed25519 sign/verify 1000x each
   - Identify p50, p95, p99 latencies
   - Document hardware specs with results

2. **Database Performance** (load-dependent)
   - Measure INSERT latency (warm and cold cache)
   - Test with concurrent registrations (1, 10, 100)
   - Monitor lock contention
   - Monitor disk I/O

3. **Full Registration Flow** (integrated test)
   - Primary agent registration (measure end-to-end)
   - Sub-agent registration (measure end-to-end)
   - Concurrent registrations (1, 10, 100 simultaneous)
   - Approval polling (measure poll latency)

4. **Record Deltas**
   ```
   Operation: Ed25519 signature
   Objective: <200ms
   Actual (hardware1): 85ms ✓ PASS
   Actual (hardware2): 450ms ✗ MISS (need crypto acceleration)
   ```

**Variables You Control:**
- **Approval poll interval:** Default 5s, adjustable based on latency
- **Timeout:** Default 5 min, adjustable based on SLA
- **Approval deadline:** Configure per-agent-type

**Variables You Cannot Assume:**
- Cryptographic performance (depends on CPU)
- Database latency (depends on load, indexing)
- Network latency (depends on topology)

Measure before making commitments.

## Environment Variables

Gone:
```bash
❌ HYPHAE_ENCRYPTION_KEY (in environment)
```

Stored in files:
```bash
✅ ~/.hyphae-keys/[agentId].key
✅ ~/.hyphae-keys/[agentId].pub
```

During registration:
```bash
✅ Agent's encryption key is returned via RPC
✅ Agent stores in ~/.hyphae-keys/[agentId].key.enc (encrypted)
```

## Benefits vs. Pre-Shared Key

| Aspect | Pre-Shared Key | Zero-Trust Registration |
|--------|---|---|
| **Setup** | Generate key in advance | Agent-initiated during startup |
| **Distribution** | Manual (email, slack, etc.) | Automatic via RPC |
| **Approval** | None | Human approval gate (primary) |
| **Sub-agents** | Need separate keys | Parent vouches, auto-approved |
| **Revocation** | Replace key everywhere | Revoke immediately in vault |
| **Audit trail** | Only if manually logged | Complete: every attempt logged |
| **Phishing-proof** | No (can steal key) | Yes (cryptographic verification) |

## References

- **Implementation:** hyphae/registration-protocol.ts
- **Client:** hyphae-agents/registration-client.ts
- **Database:** hyphae/schema-secrets.sql (registration tables)

---

**Version:** 1.0
**Status:** Production Ready
**Last Updated:** 2026-03-19
