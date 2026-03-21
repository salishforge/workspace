# Backlog: High Security Service Connectors

**Status:** Design Phase (Not Implemented)  
**Priority:** Medium (Implement when needed for high-value services)  
**Owner:** Flint, CTO  
**Date Created:** March 21, 2026  

---

## Executive Summary

Design and implement "High Security Service Connectors" - a specialized proxy pattern for services with high-value or sensitive credentials (AWS, Stripe, production databases, etc.).

**Key Principle:** Service secrets never leave Hyphae backend. Agent receives Hyphae credential only. Proxy injects actual service secret on each request.

---

## Current Architecture (Sufficient for MVP)

```
Agent → Proxy (validates agent, checks rate limit)
         ↓
Agent receives: credential_id + credential_value (plaintext, one-time)
         ↓
Agent uses: credential_value in X-Credential-ID header
         ↓
Proxy validates: credential_value in database
         ↓
Service receives: actual service secret (never seen by agent)
```

**Threat Model:** If agent is compromised, attacker gets Telegram token (limited value, easily revoked)

---

## High Security Pattern (Future Option)

```
Agent → Registry (register + get authorization)
         ↓
Agent receives: hyphae_clio_hyphae_xyz (Hyphae credential only, NOT service secret)
         ↓
Agent uses: hyphae_clio_hyphae_xyz in requests
         ↓
Proxy validates (3-factor authentication):
  1. Agent credential valid? (hyphae_clio_hyphae_xyz in DB)
  2. Master key valid? (agent.master_key matches)
  3. Policy authorized? (agent.service_id authorized=true)
         ↓
Proxy decrypts: service_secret from hyphae_service_secrets table
         ↓
Proxy injects: service_secret into request (replaces agent credential)
         ↓
Service receives: actual service secret (Hyphae never shared it with agent)
```

**Threat Model:** If agent is compromised, attacker gets Hyphae credential (useless without master key + policy). Service secret remains protected in Hyphae backend.

---

## Use Cases for High Security Connectors

| Service | Risk Level | Reason | High Security Recommended |
|---------|-----------|--------|--------------------------|
| Telegram | Low | Easily revoked, limited scope | No |
| Discord | Low | Easily revoked, limited scope | No |
| AWS | High | Root keys = full infrastructure access | **YES** |
| Stripe | High | Payment processing = financial impact | **YES** |
| Production DB | Critical | Data exfiltration, deletion possible | **YES** |
| GitHub Enterprise | Medium | Code access, admin privileges | **MAYBE** |
| Okta/IAM | Critical | Identity/authentication | **YES** |

---

## Design Tasks (Backlog Items)

### Task 1: Service Secret Management (DESIGN)
- [ ] Design hyphae_service_secrets table schema
- [ ] Implement secret encryption (master key per environment)
- [ ] Implement secret rotation (90-day cycle with grace period)
- [ ] Implement secret versioning (support multiple active secrets)
- [ ] Document secret lifecycle

**Complexity:** Medium  
**Effort:** 8-12 hours  
**Blocker:** None (independent from agent changes)

### Task 2: Service Auth Config (DESIGN & IMPLEMENT)
- [ ] Design hyphae_service_auth_config table
- [ ] Document auth patterns for common services (Telegram, Discord, AWS, Stripe, GitHub)
- [ ] Implement auth injection for query params (Telegram style)
- [ ] Implement auth injection for headers (Discord, GitHub style)
- [ ] Implement auth injection for body fields
- [ ] Add custom injection hook system

**Complexity:** Medium  
**Effort:** 12-16 hours  
**Blocker:** Task 1

### Task 3: Zero-Knowledge Proxy (IMPLEMENT)
- [ ] Create separate proxy instance or mode for high-security connectors
- [ ] Implement agent credential validation (3-factor)
- [ ] Implement service secret decryption
- [ ] Implement auth injection into requests
- [ ] Implement error handling (secret missing, decryption failure, injection failure)
- [ ] Add comprehensive logging (without exposing secrets)

**Complexity:** High  
**Effort:** 16-24 hours  
**Blocker:** Tasks 1-2

### Task 4: Testing (IMPLEMENT)
- [ ] Unit tests for secret encryption/decryption
- [ ] Unit tests for auth injection (per auth pattern)
- [ ] Integration tests for high-security proxy
- [ ] Test secret rotation behavior
- [ ] Test decryption failure handling
- [ ] Test injection into different request types (JSON, form, multipart)

**Complexity:** High  
**Effort:** 20-32 hours  
**Blocker:** Task 3

### Task 5: Documentation & Training (DOCUMENT)
- [ ] Write "High Security Connector" architecture guide
- [ ] Create runbook for onboarding new high-security services
- [ ] Document threat models and mitigation strategies
- [ ] Create debugging guide (without exposing secrets)
- [ ] Create security audit checklist

**Complexity:** Low  
**Effort:** 8-12 hours  
**Blocker:** Tasks 1-4

### Task 6: Service Connectors (IMPLEMENT as needed)
- [ ] AWS high-security connector (with SigV4 signing)
- [ ] Stripe high-security connector
- [ ] Production database high-security connector
- [ ] Okta/IAM high-security connector

**Complexity:** Medium per service  
**Effort:** 16-20 hours per service  
**Blocker:** Tasks 1-5

---

## Architecture Decision: Single vs. Multiple Proxies

### Option A: Single Proxy with Mode Flag (Simpler)
```javascript
// One proxy service (port 3109)
app.post('/*', async (req, res) => {
  const service = getService(path);
  
  if (service.security_level === 'high') {
    // Use zero-knowledge pattern
    return handleHighSecurityProxy(req, res);
  } else {
    // Use standard pattern
    return handleStandardProxy(req, res);
  }
});
```

**Pros:** One service to maintain, consistent logging  
**Cons:** Complex dispatch logic, harder to test

### Option B: Separate Proxy Services (Cleaner)
```
Port 3109: Standard Proxy (Telegram, Discord, low-risk services)
Port 3110: High Security Proxy (AWS, Stripe, production DBs)

Agent routes based on service tier:
  if (service.security_level === 'standard') {
    proxy_endpoint = 'http://localhost:3109'
  } else {
    proxy_endpoint = 'http://localhost:3110'
  }
```

**Pros:** Clear separation, easier to test, can evolve independently  
**Cons:** Two services to maintain, separate logging/monitoring

**Recommendation:** Option B (separate services) - cleaner architecture.

---

## Implementation Notes

### Secret Encryption Strategy
```javascript
// Master key per environment (AWS KMS, HashiCorp Vault, or local encrypted file)
ENVIRONMENT_MASTER_KEY = fs.readFileSync('/secure/hyphae-master-key.enc')

// Per-service secret encryption
serviceSecret = {
  value: 'stripe_sk_live_...',
  encrypted: encrypt(value, ENVIRONMENT_MASTER_KEY),
  version: 'v1',
  rotated_at: Date.now(),
  expires_at: Date.now() + (90 * 24 * 60 * 60 * 1000)  // 90 days
}
```

### Logging Without Exposing Secrets
```javascript
// GOOD: Log without secret
audit.log({
  event: 'high_security_request',
  agent_id: 'clio',
  service_id: 'stripe',
  method: 'POST',
  path: '/v1/charges',
  secret_version: 'v1',  // Don't log the actual secret
  status: 200,
  duration_ms: 145
});

// BAD: Never log actual secret
// audit.log({ secret: 'stripe_sk_live_...', ... });  // NEVER!
```

### Testing High-Security Connectors
```javascript
// Mock service secrets in test environment
const testSecrets = {
  stripe: 'sk_test_...',
  aws: 'AKIAIOSFODNN7EXAMPLE'  // Test credentials only
};

// Test injection without hitting real services
const injectedRequest = injectSecret(request, testSecrets.stripe);
assert(injectedRequest.headers['Authorization'].includes('Bearer sk_test_'));

// Test decryption
const decrypted = decryptSecret(encryptedSecret);
assert(decrypted === originalSecret);
```

---

## Threat Models Addressed

### Threat: Compromised Agent Exfiltrates Service Credentials

**Current approach:**
- ❌ Agent has plaintext credential
- ❌ Agent could leak it to attacker
- ❌ Attacker gains full service access

**High-security approach:**
- ✅ Agent only has Hyphae credential (useless without master key)
- ✅ Service secret only in Hyphae memory (not accessible to agent)
- ✅ Attacker can't use Hyphae credential without master key
- ✅ Service credential never leaves backend

### Threat: Credential Rotation

**Current approach:**
- Agent must be notified of rotation
- Agent must fetch new credential
- Potential for old credential to be used

**High-security approach:**
- Hyphae rotates service secret
- Agent's Hyphae credential unchanged
- Automatic use of new secret on next request
- Seamless to agent

### Threat: Unauthorized Service Access

**Current approach:**
- Policy checked during credential request
- Agent could cache old policy state

**High-security approach:**
- Policy checked on EVERY request (3-factor auth)
- Immediate policy enforcement
- No stale policy state

---

## Performance Impact (Estimated)

| Operation | Current | High Security | Overhead |
|-----------|---------|---------------|----------|
| Request validation | 2ms | 5ms | +3ms (decrypt secret) |
| Rate limiting | 1ms | 1ms | 0ms (same) |
| Forwarding | 0.5ms | 0.5ms + injection | +0-2ms (varies by service) |
| Response | N/A | N/A | N/A |
| **Total per request** | **3.5ms** | **6.5-8.5ms** | **+3-5ms** |

**Acceptable for high-security services** (AWS, Stripe, DB access are naturally higher latency).

---

## Backlog Priority & Sequencing

### Phase 1: Current (MVP)
- ✅ Standard proxy (port 3109)
- ✅ Agent credentials with encryption
- ✅ Rate limiting
- ✅ Audit logging

### Phase 2: High-Security Foundation (When needed)
- [ ] Task 1: Service secret management
- [ ] Task 2: Service auth configuration

### Phase 3: High-Security Proxy (When needed)
- [ ] Task 3: Zero-knowledge proxy implementation
- [ ] Task 4: Comprehensive testing

### Phase 4: Service Connectors (As services are added)
- [ ] Task 5: Documentation
- [ ] Task 6: AWS connector
- [ ] Task 6: Stripe connector
- [ ] Task 6: Production DB connector
- [ ] Task 6: IAM connector

---

## Decision Rationale

**NOT implementing now because:**

1. ✅ Current architecture is strong enough for MVP
2. ✅ Threat model (agent compromise) is low-probability
3. ✅ Service credentials are low-value (Telegram, Discord)
4. ✅ Complexity cost (3-5ms latency, 60+ hours design/impl/test) not justified
5. ✅ Better to build operational experience with standard pattern first

**IMPLEMENT later when:**
- [ ] Adding AWS, Stripe, or production database connectors
- [ ] Bringing in third-party agents (lower trust)
- [ ] Compliance requires secrets never leave backend
- [ ] Agent compromise becomes realistic threat

---

## Related Decisions

**See also:**
- [HYPHAE_MVP_COMPLETE.md](HYPHAE_MVP_COMPLETE.md) - Current architecture
- [SECURITY_AUDIT_HYPHAE_REGISTRY.md](SECURITY_AUDIT_HYPHAE_REGISTRY.md) - Security assessment

---

## Questions for Future Consideration

1. **Multi-region secrets:** If Hyphae runs in multiple regions, how do secrets sync?
2. **Compliance audit:** Can we prove secrets never left backend? (Logging without secrets)
3. **Disaster recovery:** If Hyphae secret storage corrupted, can we recover service access?
4. **Key rotation:** How often should environment master key rotate?
5. **Emergency access:** If Hyphae is down, how do humans access services for incident response?

---

**Document Owner:** Flint, CTO  
**Last Updated:** March 21, 2026  
**Status:** Design Phase - Ready for Implementation When Needed
