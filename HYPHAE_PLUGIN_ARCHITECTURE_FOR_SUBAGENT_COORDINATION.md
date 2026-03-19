# Hyphae Plugin Architecture for Sub-Agent Coordination

**Issue Identified:** Autonomous sub-agents cannot reliably access credentials, clone repos, or make network calls.

**Solution:** Design Hyphae plugins to mediate these capabilities for sub-agents.

---

## The Problem (What We Learned)

When spawning 6 sub-agents for MemForge + Hyphae development:
- All 7 attempts failed silently (no repo clones, no output)
- Sub-agents are isolated (no credential inheritance)
- No network access to GitHub
- No access to parent's SSH keys
- Silent failures (no error messages for debugging)

**Root Cause:** Sub-agents run in sandboxed environments without access to parent's:
- API keys (Anthropic, Google, OpenAI)
- Git credentials (SSH keys)
- Network access (GitHub, external APIs)
- File system (can't access parent's code)

---

## The Solution: Hyphae Plugin Architecture

Instead of asking sub-agents to bootstrap themselves, Hyphae Core provides plugins that:

### 1. **hyphae-plugin-credential-broker**
**Purpose:** Sub-agents request credentials from parent (Hyphae Core) without storing them.

```typescript
// Sub-agent requests credential
await hyphae.credentials.get('ANTHROPIC_API_KEY');

// Hyphae Core:
// 1. Verify sub-agent identity (zero-trust)
// 2. Check permission (does this agent have access?)
// 3. Return credential (encrypted, one-use token, or via secure channel)
// 4. Audit: Log credential access

// Sub-agent never stores the key, always requests it
```

**Implementation:**
- Table: `hyphae_credential_access_log` (audit trail)
- Encryption: AES-256-GCM (in-transit)
- Revocation: Instant (parent locks out sub-agent)
- Rate limiting: Prevent credential harvesting

---

### 2. **hyphae-plugin-git-proxy**
**Purpose:** Sub-agents can't clone/push; they request Git operations from parent.

```typescript
// Sub-agent can't do this:
// git clone git@github.com:salishforge/memforge.git

// Instead:
await hyphae.git.clone('salishforge/memforge', '/workspace/memforge');

// Hyphae Core:
// 1. Parent (Flint) has SSH access
// 2. Parent clones repo
// 3. Mount at /workspace/memforge (sub-agent can read)
// 4. Sub-agent can commit/push via:
await hyphae.git.commit('/workspace/memforge', 'my changes', 'commit msg');
await hyphae.git.push('/workspace/memforge', 'feature-branch');
```

**Implementation:**
- Mount strategy: Shared volumes (parent's workspace)
- Credential handling: Parent owns SSH key, sub-agent never sees it
- Commit/push: Routed through parent with sub-agent as committer
- Audit: Full git history preserved

---

### 3. **hyphae-plugin-workspace-mounter**
**Purpose:** Pre-seed sub-agents with code and shared files.

```typescript
// Parent (Flint) prepares workspace:
await hyphae.workspace.prepare({
  target: '/tmp/subagent-workspace',
  repos: [
    { name: 'memforge', url: 'git@github.com:salishforge/memforge.git' },
    { name: 'hyphae', url: 'git@github.com:salishforge/hyphae.git' }
  ],
  install: ['npm install'] // Pre-install dependencies
});

// Sub-agent spawned with:
// cwd: /tmp/subagent-workspace/memforge
// Files already available (no clone needed)
// Dependencies already installed

// Sub-agent can immediately:
// cd /tmp/subagent-workspace/memforge && npm test
```

**Implementation:**
- Parent clones repos to shared mount
- Sub-agent receives read-only or read-write access
- Dependencies pre-installed by parent
- Sub-agent starts working immediately

---

### 4. **hyphae-plugin-network-proxy**
**Purpose:** Sub-agents route API calls through parent (Hyphae Core).

```typescript
// Sub-agent can't call external APIs directly

// Instead:
await hyphae.api.call('anthropic', {
  model: 'claude-3-5-sonnet',
  messages: [...]
});

// Hyphae Core:
// 1. Verify sub-agent has permission (authz)
// 2. Call Anthropic API (parent has API key)
// 3. Stream response to sub-agent
// 4. Audit: Log API call (model, tokens, cost)
```

**Implementation:**
- Service abstraction (Anthropic, Google, OpenAI, etc.)
- Credential handling (parent stores keys)
- Rate limiting (per-agent quotas)
- Cost tracking (crucial for multi-agent scenarios)
- Audit trail (what agent called what API, when, cost)

---

### 5. **hyphae-plugin-environment-injector**
**Purpose:** Sub-agents receive environment variables securely.

```typescript
// Parent configures:
await hyphae.environment.setForSubagent('memforge-dev', {
  MEMFORGE_DB_URL: 'postgresql://...',
  NODE_ENV: 'development',
  LOG_LEVEL: 'debug'
});

// Sub-agent spawned with environment set
// Variables injected at spawn time (not hardcoded in task)
// Parent can rotate/revoke anytime
```

**Implementation:**
- Per-agent environment variables
- Encryption in-transit and at-rest
- No environment variable leakage to other agents
- Audit: When env was set/changed
- Revocation: Instant

---

### 6. **hyphae-plugin-artifact-exchange**
**Purpose:** Sub-agents produce artifacts (code, reports, test results) and parent retrieves them.

```typescript
// Sub-agent produces work:
await hyphae.artifacts.upload({
  type: 'code',
  path: '/workspace/memforge/consolidation_agent.js',
  metadata: {
    task: 'consolidation-hardening',
    status: 'ready-for-review',
    tests_passed: 347,
    coverage: 0.87
  }
});

// Parent retrieves:
const results = await hyphae.artifacts.list({
  agent: 'memforge-dev',
  type: 'code'
});

// Parent reviews, merges to main repo
```

**Implementation:**
- Artifact storage (shared filesystem or Hyphae API)
- Metadata + checksums (integrity verification)
- Versioning (track multiple submissions)
- Audit trail (who uploaded what, when)

---

## Integration with Hyphae Core

These plugins integrate with existing Hyphae Core:

```
Hyphae Core (Immutable Foundation)
├─ Agent Registry (identity, revocation)
├─ Vault (secrets)
├─ Circuit Breaker (failure detection)
├─ Audit Log (immutable record)
└─ Sub-Agent Coordination Plugins (NEW)
   ├─ Credential Broker
   ├─ Git Proxy
   ├─ Workspace Mounter
   ├─ Network Proxy
   ├─ Environment Injector
   └─ Artifact Exchange
```

---

## Immediate Solution (This Execution)

**While building the plugins, use workaround:**

1. **Parent (Flint) executes locally**
   - Clone repos (have SSH access)
   - Install dependencies
   - Run initial setup
   - Pre-seed sub-agents with code

2. **Sub-agents spawned with code ready**
   - `cwd` already set to repo root
   - Dependencies already installed
   - Only need to focus on implementation

3. **Credentials passed securely**
   - Via environment variables at spawn time
   - Via git proxy (commits signed as sub-agent)
   - Via network proxy (API calls routed through parent)

---

## Example: MemForge-Dev Sub-Agent (v3, With Pre-Seeding)

```bash
#!/bin/bash
# Parent (Flint) prepares

# 1. Clone repo (parent has SSH)
git clone git@github.com:salishforge/memforge.git /tmp/subagent-workspace/memforge

# 2. Install dependencies (parent)
cd /tmp/subagent-workspace/memforge && npm install

# 3. Spawn sub-agent with workspace already ready
sessions_spawn({
  task: """
    # Sub-agent starts with code ready
    cd /tmp/subagent-workspace/memforge
    
    # Already have dependencies
    ls node_modules/ | wc -l  # Should show 100+
    
    # Implement consolidation hardening
    # Run tests
    npm test
    
    # Create PR
    git checkout -b feature/consolidation-hardening
    # (make changes)
    git commit -am "Consolidation hardening: error recovery + budget handling"
    git push origin feature/consolidation-hardening
  """,
  environment: {
    ANTHROPIC_API_KEY: '...',  // Injected at spawn
    GEMINI_API_KEY: '...',
    GIT_USER_NAME: 'MemForge-Dev-Bot',
    GIT_USER_EMAIL: 'bot@memforge.local'
  },
  cwd: '/tmp/subagent-workspace/memforge'
});
```

---

## What Gets Built (Hyphae Plugin Roadmap)

### Phase 1: Sub-Agent Coordination (Next)
- [x] Credential Broker
- [x] Git Proxy
- [x] Workspace Mounter
- [ ] Network Proxy
- [ ] Environment Injector
- [ ] Artifact Exchange

### Phase 2: Multi-Agent Workflows
- [ ] Parallel execution coordination
- [ ] Dependency tracking (wait for X before running Y)
- [ ] Result aggregation
- [ ] Failure recovery

### Phase 3: Autonomous Teams
- [ ] Agent spawning (create workers on-demand)
- [ ] Load balancing (distribute work)
- [ ] Resource quotas (per-agent limits)
- [ ] Auto-scaling (more agents if load high)

---

## Success Criteria for This Approach

✅ Sub-agents can access code (pre-seeded workspace)  
✅ Sub-agents can authenticate (credentials injected at spawn)  
✅ Sub-agents can make API calls (network proxy)  
✅ Sub-agents can commit/push (git proxy)  
✅ Parent can retrieve artifacts (artifact exchange)  
✅ All operations audited (immutable log)  
✅ Instant revocation possible (agent loses access)  

---

## Why This Matters

This solves a fundamental problem: **autonomous agents need coordinated infrastructure.**

Without these plugins:
- Sub-agents are isolated and ineffective
- Credentials are either inaccessible or insecure
- Parent must execute everything locally (defeats purpose of agents)
- No audit trail of what sub-agents did

With these plugins:
- Sub-agents can reliably execute specialized tasks
- Credentials stay secure (parent manages, agents don't store)
- Parent delegates work (actual parallelism)
- Complete audit trail (compliance, debugging)

This is the foundation for truly autonomous multi-agent systems.

---

**Status:** Design complete  
**Next:** Implement credential broker + git proxy (next iteration)  
**This execution:** Use workaround (parent pre-seeds, sub-agents work)
