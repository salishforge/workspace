# Flint (CTO) Direct Implementation Plan

**Authority:** John Brooke  
**Approach:** Hybrid (Flint executes critical path, sub-agents handle testing/deployment)  
**Timeline:** March 19-25, 2026

---

## What Flint Does (Direct Implementation)

### MemForge Phase 1: Consolidation Hardening
**File:** `/home/artificium/.openclaw/workspace/nanoclaw-fork/memforge/consolidation/consolidation_agent.js`

Tasks:
1. [ ] Add per-step error recovery (wrap steps 1-9 in try-catch)
2. [ ] Implement budget exhaustion handling (graceful stop, no crash)
3. [ ] Add partial consolidation state tracking
4. [ ] Systemd timer integration
5. [ ] Enhanced logging (token tracking, duration, error categorization)
6. [ ] Commit to feature/consolidation-hardening branch

### MemForge Phase 2: Retrieval Enhancement
**File:** `/home/artificium/.openclaw/workspace/nanoclaw-fork/memforge/retrieval/memory_retrieval.js`

Tasks:
1. [ ] Role-based filtering at SQL level
2. [ ] Graph traversal depth control
3. [ ] Caching layer (LRU, 1-hour TTL)
4. [ ] Latency optimization (add indexes, batch queries)
5. [ ] Fallback chain (vector → keyword → empty)
6. [ ] Commit to feature/retrieval-enhancement branch

### Hyphae Phase 1: Core Baseline
**File:** `/home/artificium/.openclaw/workspace/hyphae/`

Tasks:
1. [ ] Agent registry (table + API endpoints)
2. [ ] Zero-trust registration protocol (challenge-response)
3. [ ] Secret vault (AES-256-GCM, per-agent keys)
4. [ ] Immutable audit log (write-once table)
5. [ ] Service router (routing + fallback logic)
6. [ ] Commit to feature/core-baseline branch

### Hyphae Phase 2: Circuit Breaker
**File:** `/home/artificium/.openclaw/workspace/hyphae/`

Tasks:
1. [ ] State machine implementation (CLOSED → OPEN → HALF-OPEN)
2. [ ] Failure tracking (error rate, latency)
3. [ ] Metrics export (Prometheus format)
4. [ ] Integration with service router
5. [ ] Commit to feature/circuit-breaker branch

---

## What Sub-Agents Do (Testing + Deployment)

### Sub-Agent 1: MemForge Testing
**Input:** Code from Flint's consolidation-hardening + retrieval-enhancement branches  
**Task:**
- Unit tests (target 85% coverage)
- Integration tests (full sleep cycle)
- Load tests (1000 agents, 10M events/day)
- Security tests (SQL injection, auth enforcement)
- Generate reports

**Output:**
- Test suite (jest + mocha)
- Coverage report
- Test results JSON
- Security findings

**Spawn:** After consolidation-hardening + retrieval-enhancement merged to main

---

### Sub-Agent 2: Hyphae Testing
**Input:** Code from Flint's core-baseline + circuit-breaker branches  
**Task:**
- Unit tests (target 90% coverage)
- Integration tests (registration, vault, routing)
- Circuit breaker state transition tests
- Security tests (revocation, audit log integrity)
- Generate reports

**Output:**
- Test suite
- Coverage report
- Test results
- Security verification

**Spawn:** After core-baseline + circuit-breaker merged to main

---

### Sub-Agent 3: Security Pentesting
**Input:** Merged code from both MemForge and Hyphae  
**Task:**
- Code review (SQL injection, auth, encryption, secrets)
- OWASP Top 10 coverage
- Vulnerability scanning (npm, Snyk)
- Manual pentesting (30+ scenarios)
- Compliance verification

**Output:**
- Security report (findings + risk ratings)
- Remediation recommendations
- Audit checklist

**Spawn:** After Phase 1 + Phase 2 code is merged

---

### Sub-Agent 4: DevOps Deployment
**Input:** Finalized code + passing tests  
**Task:**
- Docker images (Hyphae, MemForge)
- docker-compose development environment
- Kubernetes manifests (production)
- Systemd timers
- Prometheus metrics + Grafana dashboards
- Alert rules
- Operator runbooks

**Output:**
- Docker images (pushed to registry)
- docker-compose.yml + setup scripts
- K8s manifests
- Deployment guide
- Runbooks

**Spawn:** After tests passing + security approved

---

## Implementation Sequence

```
PARALLEL:
├─ Flint: MemForge consolidation hardening
├─ Flint: MemForge retrieval enhancement
├─ Flint: Hyphae core baseline
└─ Flint: Hyphae circuit breaker

THEN:
├─ Sub-Agent 1: MemForge testing (on Flint's code)
├─ Sub-Agent 2: Hyphae testing (on Flint's code)
│
├─ INTEGRATION TESTING (if all tests pass)
│
├─ Sub-Agent 3: Security pentesting
│
├─ IF SECURITY APPROVED:
│   └─ Sub-Agent 4: DevOps deployment
│
└─ FINAL SIGN-OFF (Flint + John)
```

---

## Git Workflow

**Flint's branches:**
- `feature/consolidation-hardening` → PR to main
- `feature/retrieval-enhancement` → PR to main
- `feature/core-baseline` → PR to main
- `feature/circuit-breaker` → PR to main

**Sub-agents work on:**
- Main branch (after Flint's PRs merged)
- Generate test results + reports
- No direct code changes (testing only)

---

## Success Criteria

### Code Completion
- [ ] MemForge consolidation hardening: Working
- [ ] MemForge retrieval enhancement: Working
- [ ] Hyphae core baseline: Working
- [ ] Hyphae circuit breaker: Working
- [ ] All code committed to feature branches

### Testing (Sub-Agent 1)
- [ ] Unit tests: 85% coverage
- [ ] Integration tests: Full sleep cycle working
- [ ] Load tests: 10M events/day
- [ ] Security tests: All passing

### Testing (Sub-Agent 2)
- [ ] Unit tests: 90% coverage
- [ ] Integration tests: Registration, vault, routing
- [ ] Circuit breaker: State machine verified
- [ ] Security: Revocation + audit log integrity

### Security (Sub-Agent 3)
- [ ] Code review: No SQL injection, auth enforced
- [ ] OWASP Top 10: All categories covered
- [ ] Vulnerability scan: Zero CVEs
- [ ] Pentesting: All 30+ scenarios passed

### Deployment (Sub-Agent 4)
- [ ] Docker images: Built + pushed
- [ ] docker-compose: Development stack working
- [ ] Kubernetes: Production manifests ready
- [ ] Monitoring: Prometheus + Grafana
- [ ] Runbooks: 10+ scenarios documented

---

## Timeline

**Week 1 (Mar 19-25):**
- Day 1-2 (Mar 19-20): MemForge consolidation + retrieval (parallel)
- Day 2-3 (Mar 20-21): Hyphae core + circuit breaker (parallel)
- Day 3-4 (Mar 21-22): Sub-agents 1+2 testing (parallel)
- Day 5 (Mar 23): Security pentesting
- Day 6-7 (Mar 24-25): DevOps deployment + final review

**Completion:** March 25, 2026 (target)

---

## Pre-Seeded Sub-Agent Spawning

When sub-agents are spawned, they receive:

```bash
environment: {
  ANTHROPIC_API_KEY: '...',
  GEMINI_API_KEY: '...',
  OPENAI_API_KEY: '...',
  GIT_USER_NAME: 'SubAgent-Name',
  GIT_USER_EMAIL: 'bot@salishforge.local'
}

cwd: '/tmp/subagent-workspace/memforge' or '/tmp/subagent-workspace/hyphae'

# Code already cloned + dependencies installed
```

Sub-agents:
1. Don't need to clone (code ready)
2. Don't need to authenticate (env vars injected)
3. Can start working immediately
4. Only focus on their specialized task

---

## Hybrid Advantage

**Flint does (what I can do best):**
- Complex architectural decisions
- Security-sensitive changes
- Integration points
- Code review + validation

**Sub-agents do (what they're good for):**
- Comprehensive testing
- Running large test suites
- Security scanning (automated)
- Documentation generation
- Parallel test execution

**Result:** Faster delivery, better quality, no credential/network issues

---

**Status:** Flint ready to begin implementation  
**Start:** March 19, 2026, immediately  
**Target Completion:** March 25, 2026
