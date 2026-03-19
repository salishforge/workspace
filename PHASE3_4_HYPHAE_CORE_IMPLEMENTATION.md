# Phase 3-4: Hyphae Core Implementation

**Status:** Specification + Database Schema  
**Timeline:** To be implemented in hyphae repo  
**Scope:** Agent registry, vault, audit log, service router, circuit breaker

## Phase 3: Hyphae Core Baseline

### 1. Agent Registry

**Table: `hyphae_agent_identities`**
```sql
CREATE TABLE hyphae_agent_identities (
  agent_id TEXT PRIMARY KEY,
  public_key_ed25519 TEXT NOT NULL, -- 32 bytes, base64
  encryption_key_id TEXT NOT NULL,
  roles JSONB DEFAULT '[]',
  capabilities JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_active ON hyphae_agent_identities(is_active, agent_id);
CREATE INDEX idx_agent_revoked ON hyphae_agent_identities(revoked_at);
```

**API Endpoints:**
- `POST /register` — Zero-trust registration (challenge-response)
- `GET /agents/:agentId` — Get agent identity
- `POST /revoke/:agentId` — Instant revocation
- `GET /agents` — List all agents (admin)

### 2. Zero-Trust Registration Protocol

**Table: `hyphae_registration_challenges`**
```sql
CREATE TABLE hyphae_registration_challenges (
  challenge_id TEXT PRIMARY KEY, -- UUID
  agent_id TEXT NOT NULL,
  nonce TEXT NOT NULL, -- 256-bit random
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '5 minutes',
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_challenges_agent ON hyphae_registration_challenges(agent_id, expires_at);
```

**Table: `hyphae_key_grants`**
```sql
CREATE TABLE hyphae_key_grants (
  key_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  encryption_key BYTEA NOT NULL, -- AES-256 key, encrypted with master key
  issued_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id)
);

CREATE INDEX idx_keys_agent ON hyphae_key_grants(agent_id);
```

**Flow:**
1. Agent requests: `POST /register/initiate` → Challenge issued
2. Agent signs challenge with Ed25519 private key
3. Agent submits: `POST /register/submit` with signature
4. Server verifies signature against public key
5. Server issues encryption key
6. Agent can now access vault

### 3. Secret Vault

**Table: `hyphae_secrets`**
```sql
CREATE TABLE hyphae_secrets (
  secret_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  value_encrypted BYTEA NOT NULL, -- AES-256-GCM
  nonce BYTEA NOT NULL, -- 96-bit for GCM
  created_at TIMESTAMPTZ DEFAULT now(),
  accessed_at TIMESTAMPTZ,
  FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id),
  UNIQUE (agent_id, secret_name)
);

CREATE INDEX idx_secrets_agent ON hyphae_secrets(agent_id, secret_name);
```

**API Endpoints:**
- `POST /vault/set` — Store secret (encrypted with agent's key)
- `GET /vault/get/:secretName` — Retrieve secret (decrypt with agent's key)
- `GET /vault/list` — List secret names (no values)
- `DELETE /vault/:secretName` — Delete secret

**Encryption:**
```typescript
// On set:
const key = await getAgentEncryptionKey(agentId);
const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
const encrypted = Buffer.concat([
  cipher.update(secretValue, 'utf8'),
  cipher.final()
]);
const authTag = cipher.getAuthTag();
// Store: { value_encrypted: encrypted, nonce, authTag }

// On get:
const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
decipher.setAuthTag(authTag);
const decrypted = Buffer.concat([
  decipher.update(valueEncrypted),
  decipher.final()
]);
```

### 4. Immutable Audit Log

**Table: `hyphae_audit_log`**
```sql
CREATE TABLE hyphae_audit_log (
  log_id BIGSERIAL PRIMARY KEY, -- Monotonic increasing
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'register', 'vault_get', 'revoke', etc.
  resource TEXT, -- What was accessed
  status TEXT, -- 'success', 'failure', 'denied'
  details JSONB, -- Additional context
  timestamp TIMESTAMPTZ DEFAULT now(),
  
  -- Immutability: Never update or delete
  CHECK (log_id > 0)
);

CREATE INDEX idx_audit_agent ON hyphae_audit_log(agent_id, timestamp);
CREATE INDEX idx_audit_action ON hyphae_audit_log(action, timestamp);
```

**Write-Only Policy:**
- INSERT only (no UPDATE, DELETE)
- Application enforces immutability
- Database triggers prevent modification

**Audit Points:**
```
- agent_register_initiate
- agent_register_submit
- agent_register_approve / reject
- agent_revoke
- vault_get (success/denied)
- vault_set (success/denied)
- service_call (route, result)
- circuit_breaker_open / close
```

### 5. Service Router

**Core Function:**
```typescript
async function routeServiceRequest(agentId, serviceName, request) {
  // 1. Verify agent identity
  const agent = await getAgent(agentId);
  if (!agent || agent.revoked_at) {
    auditLog('service_call', serviceName, 'denied', { reason: 'revoked' });
    throw new Error('Agent revoked');
  }

  // 2. Check agent has capability
  if (!agent.capabilities.includes(serviceName)) {
    auditLog('service_call', serviceName, 'denied', { reason: 'no_capability' });
    throw new Error('Agent not authorized for service');
  }

  // 3. Check circuit breaker (see Phase 4)
  const circuit = getCircuitBreaker(serviceName);
  if (circuit.state === 'OPEN') {
    auditLog('service_call', serviceName, 'fallback');
    return getFallbackResponse(serviceName);
  }

  // 4. Call service (with timeout)
  try {
    const response = await callPlugin(serviceName, request, 5000); // 5s timeout
    circuit.recordSuccess();
    auditLog('service_call', serviceName, 'success');
    return response;
  } catch (error) {
    circuit.recordFailure();
    auditLog('service_call', serviceName, 'failure', { error: error.message });
    
    if (circuit.shouldOpen()) {
      sendPriorityInterrupt(agentId, serviceName);
    }
    
    return getFallbackResponse(serviceName);
  }
}
```

---

## Phase 4: Hyphae Circuit Breaker

### State Machine

**Table: `hyphae_circuit_breakers`**
```sql
CREATE TABLE hyphae_circuit_breakers (
  service_name TEXT PRIMARY KEY,
  state TEXT NOT NULL, -- 'CLOSED', 'OPEN', 'HALF_OPEN'
  failure_count INT DEFAULT 0,
  success_count INT DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  tested_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**State Transitions:**
```
CLOSED → OPEN:
  Condition: failure_rate > 5% in 60s
  Action: Block requests, send priority interrupt

OPEN → HALF_OPEN:
  Condition: 30s have passed since OPEN
  Action: Allow 1 test request

HALF_OPEN → CLOSED:
  Condition: Test request succeeds (4+ of 5)
  Action: Resume normal operation

HALF_OPEN → OPEN:
  Condition: Test request fails
  Action: Remain blocked
```

**Implementation:**
```typescript
class CircuitBreaker {
  constructor(serviceName, errorThreshold = 5, windowMs = 60000, halfOpenDelayMs = 30000) {
    this.serviceName = serviceName;
    this.state = 'CLOSED';
    this.failures = [];
    this.successes = [];
    this.errorThreshold = errorThreshold;
    this.windowMs = windowMs;
    this.halfOpenDelayMs = halfOpenDelayMs;
    this.openedAt = null;
  }

  recordSuccess() {
    this.successes.push(Date.now());
    // Clean old entries
    const cutoff = Date.now() - this.windowMs;
    this.successes = this.successes.filter(t => t > cutoff);
    this.failures = this.failures.filter(t => t > cutoff);

    // If in HALF_OPEN and 4+/5 succeed, close
    if (this.state === 'HALF_OPEN' && this.successes.length >= 4) {
      this.state = 'CLOSED';
      console.log(`[hyphae] Circuit ${this.serviceName}: HALF_OPEN → CLOSED`);
    }
  }

  recordFailure() {
    this.failures.push(Date.now());
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter(t => t > cutoff);
    this.successes = this.successes.filter(t => t > cutoff);

    const errorRate = this.failures.length / (this.failures.length + this.successes.length);
    if (errorRate > (this.errorThreshold / 100) && this.failures.length > 0) {
      if (this.state === 'CLOSED') {
        this.state = 'OPEN';
        this.openedAt = Date.now();
        console.log(`[hyphae] Circuit ${this.serviceName}: CLOSED → OPEN`);
        return true; // Signal to send priority interrupt
      }
    }
  }

  isHalfOpen() {
    return this.state === 'HALF_OPEN' && 
           (Date.now() - this.openedAt) > this.halfOpenDelayMs;
  }

  isOpen() {
    return this.state === 'OPEN';
  }

  getState() {
    if (this.isHalfOpen()) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }
}

const circuitBreakers = new Map();
function getCircuitBreaker(serviceName) {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, new CircuitBreaker(serviceName));
  }
  return circuitBreakers.get(serviceName);
}
```

### Metrics Export (Prometheus)

**Endpoint: `GET /metrics`**

```
# HELP hyphae_circuit_state Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)
# TYPE hyphae_circuit_state gauge
hyphae_circuit_state{service="memforge"} 0
hyphae_circuit_state{service="training"} 0

# HELP hyphae_circuit_failures_total Total failures per service
# TYPE hyphae_circuit_failures_total counter
hyphae_circuit_failures_total{service="memforge"} 0
hyphae_circuit_failures_total{service="training"} 2

# HELP hyphae_circuit_successes_total Total successes per service
# TYPE hyphae_circuit_successes_total counter
hyphae_circuit_successes_total{service="memforge"} 1247
hyphae_circuit_successes_total{service="training"} 580
```

### Priority Interrupt System

**When circuit opens → Send to all affected agents:**

```typescript
async function sendPriorityInterrupt(agentId, serviceName) {
  const interrupt = {
    type: 'CAPABILITY_UNAVAILABLE',
    capability: serviceName,
    timestamp: new Date().toISOString(),
    fallback: getFallbackDescription(serviceName),
    retryAt: new Date(Date.now() + 30000).toISOString() // 30s
  };

  // Out-of-band delivery (not via normal RPC)
  await publishToInterruptChannel(agentId, interrupt);
  
  // Log in audit trail
  await auditLog('priority_interrupt', serviceName, 'sent', { agent: agentId });
}
```

---

## Database Schema (Complete)

```sql
-- Agent Management
CREATE TABLE hyphae_agent_identities (...);
CREATE TABLE hyphae_registration_challenges (...);
CREATE TABLE hyphae_key_grants (...);

-- Secrets
CREATE TABLE hyphae_secrets (...);

-- Audit Trail
CREATE TABLE hyphae_audit_log (...);

-- Circuit Breaker
CREATE TABLE hyphae_circuit_breakers (...);

-- Indexes on all critical paths
```

---

## Deployment

**Files to create:**
- `/home/artificium/.openclaw/workspace/hyphae/hyphae-core.js` (main server)
- `/home/artificium/.openclaw/workspace/hyphae/services/agent-registry.js`
- `/home/artificium/.openclaw/workspace/hyphae/services/vault.js`
- `/home/artificium/.openclaw/workspace/hyphae/services/router.js`
- `/home/artificium/.openclaw/workspace/hyphae/services/circuit-breaker.js`
- `/home/artificium/.openclaw/workspace/hyphae/schema.sql` (with all tables above)

**Port:** 3100 (Hyphae Core RPC)

**API Format:**
```
POST /rpc
{
  "jsonrpc": "2.0",
  "method": "agent.register",
  "params": { ... },
  "id": 1
}
```

---

## Status

✅ Phases 3-4 specification complete  
⏭ Ready for implementation in `salishforge/hyphae` repo
⏭ Phase 1-2 (MemForge) code complete and committed
⏭ Sub-agent spawning for testing (next)
