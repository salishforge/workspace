# Service Mesh Integration Testing Plan

**Timeline:** After Phase 1-2 complete (sub-agent deliverables)  
**Duration:** ~2 hours  
**Executor:** Flint (CTO) + minimal sub-agent support

---

## Pre-Integration Checklist

### Phase 1 Verification (Flint-Phase1 Deliverables)
- [ ] hyphae_service_registry table created (6 columns + 3 indexes)
- [ ] services.register RPC method callable
- [ ] services.heartbeat RPC method callable
- [ ] services.deregister RPC method callable
- [ ] Health check polling running (every 30s)
- [ ] All 5 unit tests pass
- [ ] Schema migrations applied

### Phase 2 Verification (Clio-Phase2 Deliverables)
- [ ] hyphae_service_integrations table created (4 columns + 2 indexes)
- [ ] services.discover RPC method callable
- [ ] services.integrate RPC method callable
- [ ] services.listIntegrations RPC method callable
- [ ] Integration cleanup on service deregister working
- [ ] All 7 unit tests pass
- [ ] Foreign key constraints properly configured

### Phase 3 Verification (Service-Routing)
- [ ] service-routing.js imported into hyphae-core.js
- [ ] routeServiceRequest() function accessible
- [ ] ServiceCircuitBreaker class instantiated per service
- [ ] Circuit breaker state transitions working
- [ ] Audit logging functional

---

## Integration Test Suite

### Test 1: Service Registration Flow

**Objective:** Verify complete registration → discovery → integration flow

**Steps:**
```bash
# 1. Register a test service
curl -X POST http://localhost:3102/rpc \
  -H "Authorization: Bearer test-token" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "method": "services.register",
    "params": {
      "service_id": "test-service-1",
      "service_name": "Test Service",
      "service_type": "test",
      "version": "1.0.0",
      "api_endpoint": "http://localhost:9999",
      "api_protocol": "json-rpc",
      "capabilities": [{"id": "ping", "method": "ping"}],
      "health_check_url": "http://localhost:9999/health"
    },
    "id": 1
  }'

# Expected response: { result: { registered: true, registration_token: "...", ... } }
```

**Verification:**
- [ ] Response includes registration_token
- [ ] Service appears in hyphae_service_registry table
- [ ] Service status is "registering" or "ready"
- [ ] Token is valid UUID format

---

### Test 2: Health Check Polling

**Objective:** Verify Hyphae polls service health every 30s

**Steps:**
```javascript
// 1. Register service with reachable health endpoint
// 2. Wait 31+ seconds
// 3. Check last_health_check timestamp
// 4. Confirm healthy = true
// 5. Take service offline (stop health endpoint)
// 6. Wait 31+ seconds
// 7. Confirm healthy = false after 3 consecutive failures
```

**SQL Checks:**
```sql
SELECT service_name, healthy, last_health_check, consecutive_failures 
FROM hyphae_service_registry 
WHERE service_name = 'Test Service';
```

**Verification:**
- [ ] last_health_check updates every 30-35 seconds
- [ ] healthy transitions from true → false when unreachable
- [ ] consecutive_failures increments on each failed check
- [ ] Service marked degraded after 3 failures

---

### Test 3: Service Discovery

**Objective:** Verify agents can discover available services

**Steps:**
```bash
# 1. Register 2 services (one healthy, one unhealthy)
# 2. Agent calls services.discover
curl -X POST http://localhost:3102/rpc \
  -H "Authorization: Bearer agent-token" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "method": "services.discover",
    "params": {
      "agent_id": "test-agent",
      "filters": {
        "service_type": "test",
        "healthy": true
      }
    },
    "id": 2
  }'
```

**Verification:**
- [ ] Only healthy services returned
- [ ] All required fields present in response
- [ ] Filtering by service_type works
- [ ] Filtering by healthy=true excludes degraded services
- [ ] Filtering by capabilities works

---

### Test 4: Agent Integration

**Objective:** Verify agent can integrate with service

**Steps:**
```bash
# 1. Agent discovers available services
# 2. Agent integrates with service
curl -X POST http://localhost:3102/rpc \
  -H "Authorization: Bearer agent-token" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "method": "services.integrate",
    "params": {
      "agent_id": "test-agent",
      "service_id": "test-service-1",
      "integration_type": "routed",
      "capabilities_needed": ["ping"]
    },
    "id": 3
  }'
```

**Verification:**
- [ ] Integration record created in hyphae_service_integrations
- [ ] Response includes integration_config
- [ ] agent_authorization token is unique
- [ ] integration_type is stored correctly
- [ ] capabilities_granted includes requested capabilities

---

### Test 5: Request Routing (Service Gateway)

**Objective:** Verify requests route through Hyphae gateway

**Steps:**
```bash
# 1. Agent integrated with service
# 2. Agent makes request through Hyphae
curl -X POST http://localhost:3102/rpc \
  -H "Authorization: Bearer agent-token" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "method": "services.call",
    "params": {
      "service_id": "test-service-1",
      "method": "ping",
      "params": {}
    },
    "id": 4
  }'

# 3. Mock service at localhost:9999 responds
```

**Verification:**
- [ ] Request reaches Hyphae gateway
- [ ] Gateway validates agent integration
- [ ] Gateway validates capability
- [ ] Request forwarded to service endpoint
- [ ] Response returned to agent
- [ ] Audit log records routing decision

---

### Test 6: Circuit Breaker - Healthy → OPEN

**Objective:** Verify circuit breaker opens on repeated failures

**Steps:**
```javascript
// 1. Register service with unreachable endpoint
// 2. Agent tries to call service 10+ times
// 3. Error rate should exceed 5%
// 4. Circuit should open
// 5. Agent should get circuit-open response (not timeout)
```

**Verification:**
- [ ] First few calls timeout (service unreachable)
- [ ] After 10 calls with >5% error rate, circuit opens
- [ ] Circuit state changes to OPEN
- [ ] New requests immediately return circuit-open (no timeout)
- [ ] Request doesn't reach unreachable service

---

### Test 7: Circuit Breaker - OPEN → HALF_OPEN → CLOSED

**Objective:** Verify circuit breaker recovery

**Steps:**
```javascript
// 1. Circuit is OPEN (from Test 6)
// 2. Wait 30+ seconds
// 3. Make 5 requests (service now reachable)
// 4. 4+ should succeed
// 5. Circuit should transition OPEN → HALF_OPEN → CLOSED
```

**Verification:**
- [ ] After 30s, circuit enters HALF_OPEN state
- [ ] First request in HALF_OPEN allowed
- [ ] If 4/5 succeed, circuit closes
- [ ] Subsequent requests go through normally

---

### Test 8: MemForge Integration

**Objective:** Verify MemForge self-registers and agents auto-discover

**Steps:**
```javascript
// 1. Start consolidation_agent.js (with Hyphae registration)
// 2. Start memory_retrieval.js (with Hyphae registration)
// 3. Verify both appear in hyphae_service_registry
// 4. Agent calls services.discover with service_type='memory'
// 5. Both MemForge services returned
// 6. Agent integrates with both
// 7. Agent can query memory through Hyphae gateway
```

**Verification:**
- [ ] Consolidation service registered
- [ ] Retrieval service registered
- [ ] Both services healthy after registration
- [ ] Agent discovers both services
- [ ] Agent can integrate with both
- [ ] Agent can call services through gateway
- [ ] Responses include memory data

---

### Test 9: Priority Interrupt System

**Objective:** Verify agents notified when circuit opens

**Steps:**
```javascript
// 1. Cause service to become unavailable
// 2. Circuit opens
// 3. Agent should receive interrupt notification
// 4. Agent switches to degraded mode
// 5. Service comes back online
// 6. Circuit recovers
// 7. Agent auto-recovers
```

**Verification:**
- [ ] Priority interrupt logged in audit log
- [ ] Agent notified via message channel (if implemented)
- [ ] Agent gracefully handles unavailability
- [ ] Agent auto-recovers without restart

---

### Test 10: Audit Logging

**Objective:** Verify all interactions logged

**Steps:**
```sql
SELECT * FROM hyphae_audit_log 
WHERE action IN ('service_routing', 'priority_interrupt') 
ORDER BY timestamp DESC 
LIMIT 20;
```

**Verification:**
- [ ] All service registrations logged
- [ ] All discovery queries logged
- [ ] All integration attempts logged
- [ ] All routing decisions logged
- [ ] All failures logged with error details
- [ ] All circuit breaker state changes logged
- [ ] Audit trail is complete and immutable

---

## Stress Tests (Optional)

### Concurrent Service Discovery
```bash
# 100 concurrent agents discovering services
for i in {1..100}; do
  curl -X POST http://localhost:3102/rpc ... &
done
wait
```

**Target:** <500ms p99 latency, zero errors

---

### Service Churn
```bash
# Register/deregister services rapidly
for i in {1..20}; do
  curl services.register ... &
  curl services.deregister ... &
done
```

**Target:** No orphaned integrations, all cleanups complete

---

### Circuit Breaker Stability
```bash
# 1000 requests with 50% error rate
# Verify circuit opens/closes predictably
```

**Target:** Circuit opens < 1s, recovers < 30s, no stuck states

---

## Integration Checklist

### Before MemForge Activation
- [ ] All Phase 1-2 tests pass
- [ ] All Phase 3-4 tests pass
- [ ] All 10 integration tests pass (optional stress tests pass)
- [ ] Audit log verified complete
- [ ] No data inconsistencies
- [ ] Performance baseline established (p95 <100ms)

### Before Production Deployment
- [ ] Code reviewed by Flint (CTO)
- [ ] Security review complete (no new vulnerabilities)
- [ ] Documentation updated
- [ ] Monitoring configured
- [ ] Runbooks written for failures
- [ ] Rollback plan prepared

---

## Success Criteria

✅ **Phase 1-2:** All RPC methods functional, all unit tests pass  
✅ **Phase 3-4:** Routing functional, circuit breaker stable  
✅ **Integration:** All 10 tests pass, MemForge auto-discovered  
✅ **MemForge:** Agents seamlessly using tiered memory  
✅ **Resilience:** Circuit breaker tested, recovery verified  
✅ **Observability:** Audit trail complete, metrics exported  

---

**Status:** Ready for execution after Phase 1-2 deliverables  
**Estimated Duration:** 2-3 hours (all tests)  
**Expected Outcome:** Full service mesh operational, MemForge integrated
