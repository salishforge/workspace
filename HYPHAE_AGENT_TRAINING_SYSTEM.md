# Hyphae Agent Training & Customization System

**Status:** Architecture Definition (John Brooke, March 19, 2026)  
**Scope:** How Hyphae becomes a platform, not just middleware

---

## Core Concept: Agent Training as Infrastructure

**Problem:** Agents don't know how to use Hyphae. They don't know about services, memory scopes, or customizations.

**Solution:** Training System that injects configuration into agents at registration + runtime.

### Three Types of Configuration

**1. Global Hyphae Defaults**
```
Every agent learns:
- How to call Hyphae services (vault, memory, tools)
- How to discover available services
- How to report errors back to Hyphae
- How to request sub-agent spawning
- Default timeout/retry behavior
```

**2. Organization Customizations**
```
Example: Acme Corp configures Hyphae agents differently than Widget Corp

Acme Corp:
- All agents must log decisions to specific audit table
- Code reviews require 2-agent approval
- Security issues escalate to acme_security_team
- Memory retention: 90 days

Widget Corp:
- All agents log to Datadog (not Acme's PostgreSQL)
- Code reviews single-agent (faster)
- Security issues escalate to widget_ops
- Memory retention: 30 days
```

**3. Workgroup Customizations**
```
Within Acme Corp, Project X (Hyphae team):
- Uses different model (Claude vs Gemini)
- Has access to internal GitHub org (other agents don't)
- Reports metrics to different dashboard
- Creates sub-agent memory scopes

vs Project Y (Platform team):
- Uses Gemini
- No GitHub access
- Reports to different dashboard
- Different sub-agent policies
```

---

## Architecture: Four Training Levels

```
Global Hyphae Defaults (Hardcoded)
        ↓
Organization Customizations (Config table)
        ↓
Workgroup Customizations (Config table)
        ↓
Sub-agent Policies (Parent agent configures children)
        ↓
Final Merged Training Injected into Agent
```

### Level 1: Global Hyphae Defaults (Immutable)

Every agent starts with understanding:

**Service Discovery Protocol:**
```typescript
// Built into every agent
async function discoverHyphaeServices() {
  const services = await hyphae.call('service', 'available');
  // Returns: vault, memory, tools, messaging, sub-agent-spawn
  // Each service has docs: hyphae.call('service', 'docs', 'vault')
}
```

**Memory Scope Model:**
```
Global Memory (shared by all agents in org)
├─ Organizational knowledge
├─ Published decisions
└─ Shared constraints

Workgroup Memory (shared by agents in workgroup)
├─ Project-specific knowledge
├─ Team decisions
└─ Workgroup constraints

Agent-Local Memory (private to this agent)
├─ Session context
├─ Working notes
└─ Temporary state

Sub-Stack Memory (shared between primary + sub-agents)
├─ Parent agent's decisions
├─ Sub-agent outcomes
└─ Inherited constraints
```

**Standard Hyphae Service Calls:**
```typescript
// Every agent can do this (global default)

// Access secrets (with org-level encryption keys)
const apiKey = await hyphae.vault.get('service.api_key');

// Search organizational memory
const decisions = await hyphae.memory.query('What was decided about X?', {
  scope: 'global'
});

// Spawn sub-agent (with auto-configuration)
const worker = await hyphae.spawn({
  task: 'analyze code',
  model: 'gemini-2.5-pro', // inherited from parent org config
  inherit: {
    memory: 'sub_stack_memory_id_xxx',
    vault: 'parent_org_vault',
    constraints: 'parent_policies'
  }
});

// Get workgroup configuration
const config = await hyphae.config.getWorkgroup();
// Returns: { approvalRequired: true, auditTable: '...', escalationTeam: '...' }

// Access sub-stack memory (only I and my children can access)
const subStackMemory = await hyphae.memory.getSubStack('sub_stack_id');
```

### Level 2: Organization Customizations (Config)

**Stored:** `hyphae_org_configurations` table

```sql
CREATE TABLE hyphae_org_configurations (
  org_id TEXT PRIMARY KEY,
  
  -- Service routing
  primary_model TEXT, -- 'claude' | 'gemini' | 'gpt5'
  fallback_model TEXT,
  
  -- Vault encryption
  encryption_key_id TEXT,
  secret_rotation_days INT,
  
  -- Memory policy
  global_memory_retention_days INT, -- 0 = indefinite
  audit_table_name TEXT,
  audit_required BOOLEAN,
  
  -- Sub-agent policy
  auto_spawn_allowed BOOLEAN,
  sub_agent_max_depth INT,
  sub_agent_cpu_limit TEXT,
  sub_agent_memory_limit TEXT,
  
  -- Escalation
  security_escalation_team TEXT,
  budget_escalation_user TEXT,
  
  -- Customization
  custom_validation_rules JSONB,
  custom_prompt_prefix TEXT,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Example Org Config (Salish Forge):**
```json
{
  "org_id": "salish-forge",
  "primary_model": "gemini-2.5-pro",
  "fallback_model": "claude-opus-4.6",
  "global_memory_retention_days": 0,
  "audit_required": true,
  "audit_table_name": "hyphae_audit_trail",
  "auto_spawn_allowed": true,
  "sub_agent_max_depth": 5,
  "security_escalation_team": "flint",
  "budget_escalation_user": "john-brooke",
  "custom_validation_rules": {
    "code_review_requires_approval": true,
    "security_issues_block_deployment": true,
    "test_coverage_minimum": 0.80
  },
  "custom_prompt_prefix": "You are part of Salish Forge, a family-rooted creative technology company..."
}
```

### Level 3: Workgroup Customizations (Config)

**Stored:** `hyphae_workgroup_configurations` table

```sql
CREATE TABLE hyphae_workgroup_configurations (
  workgroup_id TEXT PRIMARY KEY,
  org_id TEXT, -- Foreign key
  workgroup_name TEXT,
  
  -- Override org defaults
  primary_model TEXT, -- Override org model
  workgroup_memory_retention_days INT,
  
  -- Workgroup-specific policies
  allowed_services JSONB, -- Subset of all services
  custom_constraints JSONB,
  
  -- Access control
  authorized_agents JSONB, -- List of agent IDs
  authorized_external_services JSONB, -- GitHub, etc.
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**Example Workgroup Config (Hyphae Ops):**
```json
{
  "workgroup_id": "hyphae-ops",
  "org_id": "salish-forge",
  "workgroup_name": "Hyphae Operations Team",
  "primary_model": "claude-opus-4.6", // Override org default
  "workgroup_memory_retention_days": 90, // Stricter than org default (0)
  "allowed_services": [
    "vault",
    "memory",
    "tools",
    "messaging",
    "sub_agent_spawn"
  ],
  "custom_constraints": {
    "max_token_spend_per_day": 100000,
    "max_concurrent_tasks": 10
  },
  "authorized_agents": ["flint", "clio", "hyphae-worker-1"],
  "authorized_external_services": ["github:salishforge"]
}
```

### Level 4: Sub-Agent Policies (Parent-Configured)

**Parent agent can override config for its children:**

```typescript
// Flint (parent) spawning task-processor-1 (child)

const child = await hyphae.spawn({
  task: 'process code submission',
  
  // Inherit defaults from parent's config
  inherit: {
    org: 'salish-forge',
    workgroup: 'hyphae-ops',
    model: undefined, // Use parent's model
    vault_access: 'parent', // Access parent's secrets
    memory_access: 'sub_stack' // Get own memory scope
  },
  
  // Parent overrides for this child only
  override: {
    max_runtime_seconds: 300, // Tighter than parent
    escalation_team: 'flint', // Escalate back to me
    memory_retention_days: 7, // Short-lived task
    allowed_tools: ['code_analyzer', 'test_runner'] // Limited tools
  }
});
```

**Stored:** `hyphae_sub_agent_policies` table

```sql
CREATE TABLE hyphae_sub_agent_policies (
  sub_agent_id TEXT PRIMARY KEY,
  parent_agent_id TEXT,
  org_id TEXT,
  workgroup_id TEXT,
  
  -- Inheritance flags
  inherit_org_config BOOLEAN,
  inherit_workgroup_config BOOLEAN,
  inherit_parent_memory BOOLEAN,
  
  -- Parent overrides
  cpu_limit TEXT,
  memory_limit TEXT,
  max_runtime_seconds INT,
  allowed_tools JSONB,
  custom_constraints JSONB,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## Training Injection Mechanism

When agent registers or starts, Hyphae injects training via **prompt prefix** + **context injection** + **capability manifest**.

### 1. Prompt Prefix Injection

**System prompt construction (for every agent):**

```typescript
// Global defaults (immutable)
const globalPrefix = `
You are an autonomous agent in the Hyphae coordination platform.

## Hyphae Services Available:
- vault: Access encrypted secrets
- memory: Persistent knowledge storage
- tools: Execute structured operations
- messaging: Communicate with other agents
- spawn: Create sub-agents for parallel work

## Service Discovery:
Ask Hyphae what services are available: await hyphae.services.list()
Ask for docs: await hyphae.services.docs('vault')

## Memory Scopes:
- global_memory: Shared across all agents
- workgroup_memory: Shared with workgroup agents
- agent_local_memory: Private to me
- sub_stack_memory: Shared with my sub-agents

## Error Handling:
If something fails, escalate to your configured escalation team.
All operations logged to hyphae audit trail.
`;

// Org customization
const orgPrefix = orgConfig.custom_prompt_prefix || '';
// "You are part of Salish Forge, a family-rooted creative technology company..."

// Workgroup customization
const workgroupPrefix = workgroupConfig.custom_prompt || '';

// Sub-agent parent override
const parentOverride = subAgentPolicy.custom_prompt || '';

// Merged prompt
const finalSystemPrompt = 
  globalPrefix + '\n\n' +
  orgPrefix + '\n\n' +
  workgroupPrefix + '\n\n' +
  parentOverride;
```

### 2. Capability Manifest Injection

Agent receives capability list showing what's actually available:

```typescript
// Agent initialization
const manifest = await hyphae.getCapabilityManifest();

// Returns:
{
  agent_id: 'flint',
  org_id: 'salish-forge',
  workgroup_id: 'hyphae-ops',
  
  // What this agent can do
  capabilities: [
    {
      name: 'vault.get',
      description: 'Access encrypted secrets',
      params: { secret_name: 'string' },
      scopes: ['organization', 'workgroup']
    },
    {
      name: 'memory.query',
      description: 'Search persistent memory',
      scopes: ['global', 'workgroup', 'agent_local']
    },
    {
      name: 'spawn',
      description: 'Create sub-agent',
      max_depth: 5,
      allowed_models: ['gemini-2.5-pro', 'claude-opus-4.6']
    }
  ],
  
  // What this agent can access
  services: {
    vault: { available: true, encryption_key_id: 'org-key-123' },
    memory: { available: true, scopes: ['global', 'workgroup', 'agent_local', 'sub_stack'] },
    tools: { available: true, allowed: ['code_analyzer', 'test_runner', 'deploy'] }
  },
  
  // Configuration applying to this agent
  config: {
    model: 'gemini-2.5-pro',
    escalation_team: 'flint',
    max_concurrent_tasks: 10,
    memory_retention_days: 90
  }
}
```

### 3. Context Seeding (Pre-loaded Memory)

On registration, agent gets seeded with:
- Organization operating principles
- Team constraints
- Approved escalation paths
- Memory of prior decisions

```typescript
// Agent startup
async function onAgentStart(agentId) {
  // Seed organizational knowledge
  const orgMemory = await hyphae.memory.getOrganizationBootstrap();
  // Contains: foundational values, approved patterns, known constraints
  
  // Seed workgroup knowledge
  const workgroupMemory = await hyphae.memory.getWorkgroupBootstrap();
  // Contains: project goals, team agreements, resource limits
  
  // Seed agent-specific guidance
  const agentGuidance = await hyphae.memory.getAgentGuidance(agentId);
  // Contains: role expectations, decision authorities, escalation points
  
  // Agent now operates with informed context
}
```

---

## Discovery & Learning System

Agents can query what they're configured to do:

```typescript
// "What can I do?"
const capabilities = await hyphae.getCapabilities();

// "What services exist?"
const services = await hyphae.services.list();
// Returns: vault, memory, tools, messaging, spawn, ...

// "How do I use service X?"
const docs = await hyphae.services.docs('vault');
// Returns: endpoint signatures, example calls, error codes

// "What's my configuration?"
const config = await hyphae.config.get();
// Returns: model, escalation team, constraints, etc.

// "What are my workgroup's rules?"
const rules = await hyphae.config.getWorkgroup();
// Returns: approval requirements, constraints, authorized services

// "What constraints apply to me?"
const constraints = await hyphae.constraints.getEffective();
// Returns: merged org + workgroup + parent overrides

// "What memory can I access?"
const memoryScopes = await hyphae.memory.getAccessibleScopes();
// Returns: global, workgroup, agent_local, sub_stack
```

---

## Training Update Mechanism

Organizations can update agent behavior **without redeploying**:

### Scenario: Salish Forge Updates Code Review Policy

**Before:**
```json
{
  "code_review_requires_approval": false
}
```

**After:** (Flint decides to require approval)
```json
{
  "code_review_requires_approval": true,
  "approval_required_from": ["flint", "clio"]
}
```

**Deployment:**
```typescript
// Update org config in Hyphae
await hyphae.admin.updateOrgConfig('salish-forge', {
  custom_validation_rules: {
    code_review_requires_approval: true,
    approval_required_from: ['flint', 'clio']
  }
});

// All agents get updated guidance on next operation
// No need to restart agents or change prompts
// Agents query config, get new rules, apply them
```

---

## Shared Memory with Scoping

Different agents can have different views of memory:

```typescript
// Global memory (visible to ALL agents in org)
await hyphae.memory.store({
  scope: 'global',
  category: 'decision',
  key: 'approved_architecture_pattern',
  value: { pattern: 'hub_and_spoke', approved_by: 'flint', date: '2026-03-19' }
});

// Workgroup memory (visible to agents in this workgroup)
await hyphae.memory.store({
  scope: 'workgroup',
  workgroup_id: 'hyphae-ops',
  key: 'current_sprint_goals',
  value: { goals: [...], assigned_to: ['flint', 'worker-1'] }
});

// Sub-stack memory (visible only to parent + children)
const subStackMemory = await hyphae.memory.createSubStack('sub_stack_id');
await subStackMemory.store({
  key: 'task_progress',
  value: { status: 'running', progress: 0.65 }
});

// Access with inheritance
const memory = await hyphae.memory.query('approval patterns', {
  scopes: ['global', 'workgroup', 'agent_local'] // Search in this order
});
// Returns: results from most specific scope first
```

---

## Sub-Agent Hierarchy with Inheritance

```
Flint (primary agent, salish-forge org)
├─ task-processor-1 (child, inherits Flint's config)
│  └─ subtask-analyzer-1 (grandchild, inherits through Flint)
├─ code-reviewer-1 (child, different overrides)
│  └─ linter-1 (grandchild)
└─ deployer-1 (child)

Clio (primary agent, salish-forge org)
└─ approver-1 (child)
```

**Trust chain:**
```
Flint authorized by: zero-trust protocol
task-processor-1 authorized by: Flint's registration + inheritance
subtask-analyzer-1 authorized by: Flint's trust chain + task-processor-1
```

**Configuration inheritance:**
```
subtask-analyzer-1 gets:
1. Global Hyphae defaults ✓
2. salish-forge org config ✓
3. hyphae-ops workgroup config ✓
4. Flint's override (if any) ✓
5. task-processor-1's override (if any) ✓
6. Final merged config applied ✓
```

---

## API: Training System RPC Endpoints

```typescript
// Agent Registration with Training
hyphae.agent.register({
  agentId: 'new-agent',
  org: 'salish-forge',
  workgroup: 'hyphae-ops',
  model: 'gemini-2.5-pro'
})
// Returns: training manifest + capability list

// Get Current Training
hyphae.training.getManifest(agentId)
// Returns: merged training across all levels

// Update Org-Level Training
hyphae.admin.updateOrgTraining('salish-forge', {
  custom_prompt_prefix: 'New organizational values...',
  custom_validation_rules: { ... }
})

// Update Workgroup-Level Training
hyphae.admin.updateWorkgroupTraining('hyphae-ops', {
  custom_constraints: { ... }
})

// Parent Configure Sub-Agent
hyphae.agent.configureChild({
  parentId: 'flint',
  childId: 'task-processor-1',
  override: {
    max_runtime_seconds: 300,
    allowed_tools: ['code_analyzer'],
    memory_retention_days: 7
  }
})

// Discover Available Services
hyphae.services.list()
// Returns: [{ name: 'vault', docs: '...', version: '1.0' }, ...]

// Get Service Documentation
hyphae.services.docs('vault')
// Returns: API reference, example usage, error codes

// Create Workgroup Memory Scope
hyphae.memory.createWorkgroupScope({
  workgroup_id: 'hyphae-ops',
  scope_name: 'sprint-2-decisions'
})

// Create Sub-Stack Memory Scope
hyphae.memory.createSubStackScope({
  parent_agent_id: 'flint',
  sub_agents: ['task-processor-1', 'subtask-analyzer-1']
})
```

---

## Integration with 5-Phase Roadmap

### Phase 1: ReAct Reasoning
**Training applies:** Agents receive org-level "how to reason" guidance

```
Global default: "Use ReAct pattern (Thought → Action → Observation)"
Org override: "Log all thoughts to audit table"
Workgroup override: "Budget each thought to max 2 seconds"
Parent override: "Escalate thoughts about security to parent"
```

### Phase 2: Persistent Memory
**Training applies:** Memory scope rules are trained into agents

```
Global default: "Memory has global, workgroup, agent_local, sub_stack scopes"
Org override: "Global memory retention: 0 days (indefinite)"
Workgroup override: "Workgroup memory retention: 90 days"
Parent override: "Sub-stack memory: 7 days (task-specific)"
```

### Phase 3: Behavioral Validation
**Training applies:** Org-specific validation rules are injected

```
Global default: "Validate all code before approval"
Org override: "Require 2-agent approval for production code"
Workgroup override: "Test coverage must be >= 85%"
Parent override: "Budget validation: only if > $10K"
```

### Phase 4: Structured Prompts
**Training applies:** Org-customized prompts replace defaults

```
Global default: [Standard role/capabilities/constraints]
Org override: "You are part of Salish Forge..."
Workgroup override: "You are on the Hyphae Operations team..."
Parent override: "You are a sub-agent for code analysis, report to parent"
```

### Phase 5: Tool Integration
**Training applies:** Org-specific tool catalog is discovered

```
Global default: "Available tools: code_analyzer, test_runner, deploy"
Org override: "Salish Forge tools: + security_scanner + performance_profiler"
Workgroup override: "Hyphae ops tools: + infrastructure_deployer + log_analyzer"
Parent override: "Only code_analyzer and test_runner for this sub-agent"
```

---

## Database Schema Addition

```sql
-- Organization-level training config
CREATE TABLE hyphae_org_training_configs (
  org_id TEXT PRIMARY KEY,
  org_name TEXT,
  
  -- Prompt customization
  custom_prompt_prefix TEXT,
  custom_prompt_suffix TEXT,
  
  -- Memory policies
  memory_retention_days INT,
  shared_memory_enabled BOOLEAN,
  
  -- Validation rules (JSON)
  custom_validation_rules JSONB,
  
  -- Sub-agent policy
  sub_agent_max_depth INT,
  sub_agent_default_model TEXT,
  
  -- Service configuration
  available_services JSONB,
  service_timeouts JSONB,
  
  -- Constraints
  custom_constraints JSONB,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Workgroup-level training config
CREATE TABLE hyphae_workgroup_training_configs (
  workgroup_id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES hyphae_org_training_configs(org_id),
  workgroup_name TEXT,
  
  -- Override org defaults
  override_prompt_prefix TEXT,
  override_constraints JSONB,
  
  -- Workgroup-specific rules
  workgroup_rules JSONB,
  
  -- Access control
  authorized_agents JSONB,
  authorized_services JSONB,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Sub-agent parent-configured overrides
CREATE TABLE hyphae_sub_agent_training_overrides (
  sub_agent_id TEXT PRIMARY KEY,
  parent_agent_id TEXT,
  org_id TEXT,
  
  -- Parent's specific overrides
  override_prompt_prefix TEXT,
  override_constraints JSONB,
  allowed_tools JSONB,
  
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Audit trail for training changes
CREATE TABLE hyphae_training_audit_log (
  id SERIAL PRIMARY KEY,
  org_id TEXT,
  workgroup_id TEXT,
  agent_id TEXT,
  change_type TEXT, -- 'create' | 'update' | 'delete'
  changed_fields JSONB,
  changed_by TEXT,
  created_at TIMESTAMP
);
```

---

## Why This Matters

### Before (Hyphae as Middleware)
- Agents don't know about Hyphae services
- Every agent needs custom setup
- Customizations not shareable
- Sub-agents don't inherit parent policies
- Configuration stuck in prompts (hard to update)

### After (Hyphae as Platform)
- ✅ Agents auto-discover services
- ✅ One-time org setup, all agents inherit
- ✅ Customizations reusable across projects
- ✅ Sub-agents inherit parent + org policies
- ✅ Configuration dynamically updatable
- ✅ Different companies use same Hyphae platform, different behavior
- ✅ Memory scoped to org/workgroup/sub-stack
- ✅ Training versioned and auditable

---

## Implementation Sequence

### Phase 0a: Training Infrastructure (New, before Phase 1)
**Duration:** 2-3 weeks
**Deliverables:**
- Training API endpoints (getManifest, updateOrgTraining, etc.)
- Org/workgroup/sub-agent config tables
- Prompt prefix injection mechanism
- Capability manifest generation
- Service discovery endpoints

**RPC Endpoints to Add:**
- `training.getManifest(agentId)` — Get merged training
- `admin.updateOrgTraining(orgId, config)` — Update org training
- `admin.updateWorkgroupTraining(workgroupId, config)` — Update workgroup
- `agent.configureChild(parentId, childId, overrides)` — Parent configures child
- `services.list()` — Discover available services
- `services.docs(serviceName)` — Get service docs

### Phase 0b: Memory Scoping (Enhanced Phase 2)
**Duration:** 1-2 weeks
**Deliverables:**
- Global memory (all agents)
- Workgroup memory (workgroup agents only)
- Sub-stack memory (parent + children only)
- Scope-aware querying
- Automatic scope filtering

---

## Timeline Revision

```
Phase 0a (NEW): Training Infrastructure (2-3 weeks)
Phase 0b (NEW): Memory Scoping (1-2 weeks)
Phase 1: ReAct Reasoning (aware of training)
Phase 2: Persistent Memory (with scopes)
Phase 3: Behavioral Validation (applies org rules)
Phase 4: Structured Prompts (with org customization)
Phase 5: Tool Integration (service discovery)

Instead of 6 months → now requires 7-8 months (add 4 weeks for training)
```

---

## Key Insight: Hyphae Becomes a Platform

**Not:** "Hyphae is how agents coordinate"
**Yes:** "Hyphae is how organizations train and align agents"

This shifts the value proposition:
- Company A uses Hyphae → their agents work their way
- Company B uses Hyphae → their agents work Company B's way
- **Same platform, different behavior**

This is how you go from "agent coordination tool" to "AI operating system for organizations."

---

**Version:** 1.0  
**Status:** Architecture definition (awaiting feedback)  
**Next:** Integrate into HYPHAE_ARCHITECTURE_ROADMAP.md
