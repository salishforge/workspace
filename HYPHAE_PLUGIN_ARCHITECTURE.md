# Hyphae Plugin Architecture & Extension System

**Status:** Core Platform Design (John Brooke, March 19, 2026)  
**Principle:** Extensible by design. Core is minimal. Behavior via plugins.

---

## Philosophy: Hyphae as Framework

**Not:** Hyphae is a tool that agents use  
**Yes:** Hyphae is a framework that organizations extend

**This means:**
- Core platform is minimal and stable
- Features are plugins (interchangeable, optional, replaceable)
- Organizations/communities contribute extensions without forking
- Someone can completely replace memory backend, training system, validation, etc.
- Open source (or commercial) but **fundamentally extensible**

---

## Core Hyphae (Minimal, Stable)

**What stays in core (immutable):**
```
├─ HTTP RPC server (port 3100)
├─ Agent registration protocol (cryptographic identity)
├─ Secret vault API (encrypted storage interface)
├─ Service router (plugins ↔ agents)
├─ Plugin loader and lifecycle management
└─ Audit log (immutable record of everything)
```

**Everything else is a plugin:**
```
Extensions/Plugins:
├─ Training System (org/workgroup config, prompt injection)
├─ Memory Backend (PostgreSQL, but could be Redis, DynamoDB, etc.)
├─ Reasoning Pattern (ReAct, but could be plan-then-execute, etc.)
├─ Tool Registry (code analyzer, test runner, deployer, etc.)
├─ Validation Framework (requirements agent, test suite, etc.)
├─ Prompt Management (versioning, A/B testing, etc.)
├─ Service Connectors (1Password, Azure, AWS, PostgreSQL, S3, etc.)
├─ Monitoring & Metrics (dashboards, alerts, logging)
├─ Sub-Agent Factory (how sub-agents are spawned and configured)
└─ Custom Business Logic (org-specific policies, workflows, etc.)
```

---

## Plugin Architecture: Three Tier System

### Tier 1: Core Plugins (Provided by Hyphae, Not Removable)

These plugins come with Hyphae and define the minimal behavior:
```
hyphae-plugin-rpc-server/      ← HTTP RPC endpoint
hyphae-plugin-registration/    ← Zero-trust registration
hyphae-plugin-vault/           ← Secret storage interface
hyphae-plugin-audit/           ← Immutable audit log
hyphae-plugin-router/          ← Agent↔Service routing
```

### Tier 2: Default Plugins (Recommended, Replaceable)

These come with Hyphae but can be replaced:
```
hyphae-plugin-training-system/        ← Org/workgroup config
hyphae-plugin-memory-postgresql/      ← Memory backend (SQL)
hyphae-plugin-reasoning-react/        ← ReAct reasoning pattern
hyphae-plugin-validation-behavioral/  ← Behavioral validation
hyphae-plugin-prompts-versioned/      ← Prompt management
hyphae-plugin-tools-builtin/          ← Standard tools
```

### Tier 3: Community & Organization Plugins (Extensible)

Organizations/communities build these:
```
hyphae-plugin-memory-redis/           ← Redis memory backend
hyphae-plugin-memory-mongodb/         ← MongoDB memory backend
hyphae-plugin-reasoning-planning/     ← Plan-then-execute pattern
hyphae-plugin-validation-security/    ← Custom security validation
hyphae-plugin-tools-acme-corp/        ← Acme Corp's custom tools
hyphae-plugin-training-acme/          ← Acme Corp's training layer
hyphae-plugin-workflow-approval/      ← Custom approval workflows
hyphae-plugin-metrics-datadog/        ← Datadog integration
hyphae-plugin-monitoring-newrelic/    ← New Relic integration
```

---

## Extension Points: Where Behavior Can Be Customized

### Extension Point 1: Agent Training Layer

**Interface:** `TrainingProvider`

```typescript
interface TrainingProvider {
  // Get the merged training for an agent
  getTraining(agentId: string, context: TrainingContext): Promise<AgentTraining>;
  
  // Update training config
  updateOrgTraining(orgId: string, config: OrgTrainingConfig): Promise<void>;
  updateWorkgroupTraining(workgroupId: string, config: WorkgroupTrainingConfig): Promise<void>;
  
  // Get service discovery docs
  getServiceDocs(serviceName: string): Promise<ServiceDocumentation>;
  
  // Get capability manifest
  getCapabilityManifest(agentId: string): Promise<CapabilityManifest>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-training-system` (default, Tier 2)
- `hyphae-plugin-training-acme-corp` (Acme Corp custom, Tier 3)
- `hyphae-plugin-training-advanced` (community-built, Tier 3)

### Extension Point 2: Memory Backend

**Interface:** `MemoryBackend`

```typescript
interface MemoryBackend {
  // Store with scope
  store(scope: MemoryScope, key: string, value: unknown): Promise<void>;
  
  // Retrieve with scope-aware search
  query(scope: MemoryScope, question: string, limit: number): Promise<MemoryResult[]>;
  
  // List accessible scopes
  getAccessibleScopes(agentId: string): Promise<MemoryScope[]>;
  
  // Lifecycle
  createScope(scope: MemoryScope): Promise<void>;
  deleteScope(scope: MemoryScope): Promise<void>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-memory-postgresql` (default, Tier 2)
- `hyphae-plugin-memory-redis` (high-speed in-memory, community, Tier 3)
- `hyphae-plugin-memory-mongodb` (document-based, community, Tier 3)
- `hyphae-plugin-memory-dynamodb` (AWS-native, community, Tier 3)

### Extension Point 3: Reasoning Pattern

**Interface:** `ReasoningEngine`

```typescript
interface ReasoningEngine {
  // Execute reasoning loop
  reason(agentId: string, task: string, context: Context): Promise<ReasoningTrace>;
  
  // Get pattern configuration
  getPattern(): ReasoningPattern;
  
  // Lifecycle hooks
  onAgentStartup(agentId: string): Promise<void>;
  onTaskComplete(agentId: string, trace: ReasoningTrace): Promise<void>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-reasoning-react` (default, Tier 2)
- `hyphae-plugin-reasoning-planning` (plan-then-execute, community, Tier 3)
- `hyphae-plugin-reasoning-hierarchical` (hierarchical reasoning, community, Tier 3)
- `hyphae-plugin-reasoning-tree-of-thoughts` (parallel path exploration, community, Tier 3)

### Extension Point 4: Validation Framework

**Interface:** `ValidationProvider`

```typescript
interface ValidationProvider {
  // Validate output against criteria
  validate(output: unknown, criteria: ValidationCriteria): Promise<ValidationResult>;
  
  // Run test suite
  runTests(code: string, testConfig: TestConfig): Promise<TestResult>;
  
  // Check requirements
  checkRequirements(code: string, requirements: Requirement[]): Promise<RequirementCheckResult>;
  
  // Custom validators can register
  registerValidator(name: string, fn: ValidatorFunction): void;
}
```

**Replaceable implementations:**
- `hyphae-plugin-validation-behavioral` (default, Tier 2)
- `hyphae-plugin-validation-security` (security-focused, Tier 3)
- `hyphae-plugin-validation-compliance` (compliance rules, Tier 3)
- `hyphae-plugin-validation-performance` (performance requirements, Tier 3)

### Extension Point 5: Tool Registry

**Interface:** `ToolRegistry`

```typescript
interface ToolRegistry {
  // Register a tool (with OpenAPI definition)
  registerTool(tool: ToolDefinition): Promise<void>;
  
  // List available tools
  listTools(agentId: string): Promise<Tool[]>;
  
  // Call a tool
  callTool(toolName: string, params: unknown): Promise<ToolResult>;
  
  // Discover tools by category
  discoverByCategory(category: string): Promise<Tool[]>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-tools-builtin` (standard tools, Tier 2)
- `hyphae-plugin-tools-acme-corp` (Acme Corp tools, Tier 3)
- `hyphae-plugin-tools-security` (security tools, community, Tier 3)
- `hyphae-plugin-tools-devops` (deployment tools, community, Tier 3)

### Extension Point 6: Prompt Management

**Interface:** `PromptManager`

```typescript
interface PromptManager {
  // Load prompt for agent
  loadPrompt(agentId: string, version?: string): Promise<string>;
  
  // Update prompt
  updatePrompt(agentId: string, prompt: string): Promise<void>;
  
  // Versioning
  getPromptHistory(agentId: string): Promise<PromptVersion[]>;
  rollbackPrompt(agentId: string, version: string): Promise<void>;
  
  // A/B testing
  getPromptVariant(agentId: string, variant: string): Promise<string>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-prompts-versioned` (Git-like versioning, Tier 2)
- `hyphae-plugin-prompts-ab-testing` (A/B testing support, community, Tier 3)
- `hyphae-plugin-prompts-generated` (AI-generated prompts, community, Tier 3)

### Extension Point 7: Service Connectors

**Interface:** `ServiceConnector`

```typescript
interface ServiceConnector {
  // Connect to external service
  connect(config: ConnectorConfig): Promise<void>;
  
  // Execute service operation
  execute(operation: string, params: unknown): Promise<unknown>;
  
  // Health check
  healthCheck(): Promise<HealthStatus>;
  
  // Capabilities
  getCapabilities(): ServiceCapability[];
}
```

**Replaceable implementations:**
- `hyphae-plugin-connector-1password` (1Password, Tier 2)
- `hyphae-plugin-connector-aws` (AWS services, Tier 2)
- `hyphae-plugin-connector-azure` (Azure services, Tier 2)
- `hyphae-plugin-connector-postgresql` (PostgreSQL, Tier 2)
- `hyphae-plugin-connector-redis` (Redis, community, Tier 3)
- `hyphae-plugin-connector-datadog` (Datadog, community, Tier 3)
- `hyphae-plugin-connector-slack` (Slack integration, community, Tier 3)

### Extension Point 8: Sub-Agent Factory

**Interface:** `SubAgentFactory`

```typescript
interface SubAgentFactory {
  // Spawn sub-agent with configuration
  spawn(config: SpawnConfig): Promise<AgentHandle>;
  
  // Configure sub-agent (parent override)
  configure(agentId: string, overrides: AgentOverrides): Promise<void>;
  
  // Manage sub-agent lifecycle
  terminate(agentId: string): Promise<void>;
  getStatus(agentId: string): Promise<AgentStatus>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-subagent-default` (standard spawn, Tier 2)
- `hyphae-plugin-subagent-container` (Docker containerized, community, Tier 3)
- `hyphae-plugin-subagent-kubernetes` (Kubernetes orchestration, community, Tier 3)
- `hyphae-plugin-subagent-serverless` (AWS Lambda/Google Cloud, community, Tier 3)

### Extension Point 9: Custom Workflows

**Interface:** `WorkflowPlugin`

```typescript
interface WorkflowPlugin {
  // Define custom workflow
  defineWorkflow(workflow: WorkflowDefinition): Promise<void>;
  
  // Execute workflow
  executeWorkflow(name: string, params: unknown): Promise<WorkflowResult>;
  
  // Integrate with approval chains, escalations, etc.
  onApprovalRequired(approval: ApprovalRequest): Promise<ApprovalDecision>;
  onEscalationRequired(escalation: EscalationRequest): Promise<void>;
}
```

**Replaceable implementations:**
- `hyphae-plugin-workflow-standard` (basic workflows, Tier 2)
- `hyphae-plugin-workflow-approval` (Acme Corp approvals, Tier 3)
- `hyphae-plugin-workflow-compliance` (compliance workflows, Tier 3)

---

## Plugin Lifecycle: Loading & Initialization

### Plugin Discovery

```typescript
// Hyphae looks for plugins in standard locations
/hyphae/plugins/                           ← Built-in plugins
/hyphae/plugins-custom/                    ← Organization plugins
~/.hyphae/plugins/                         ← User plugins
HYPHAE_PLUGIN_PATH=/custom/path            ← Environment variable

// Each plugin directory has manifest.json
{
  "name": "hyphae-plugin-training-system",
  "version": "1.0.0",
  "type": "training",
  "entry": "dist/index.js",
  "hyphaeVersion": "^7.0.0",
  "interfaces": ["TrainingProvider"],
  "dependencies": {
    "pg": "^8.0.0"
  }
}
```

### Plugin Loading Order

```
1. Core plugins (Tier 1, non-replaceable)
   ├─ hyphae-plugin-rpc-server
   ├─ hyphae-plugin-registration
   ├─ hyphae-plugin-vault
   ├─ hyphae-plugin-audit
   └─ hyphae-plugin-router

2. Default plugins (Tier 2, replaceable)
   ├─ hyphae-plugin-training-system
   ├─ hyphae-plugin-memory-postgresql
   ├─ hyphae-plugin-reasoning-react
   ├─ hyphae-plugin-validation-behavioral
   └─ ... (others)

3. Custom plugins (Tier 3, user-provided)
   ├─ hyphae-plugin-training-acme-corp
   ├─ hyphae-plugin-memory-redis
   └─ ... (user overrides)

4. Plugin initialization
   └─ Each plugin's init() called in dependency order
   └─ Configuration loaded from org config tables
   └─ Plugins register interfaces with router
```

### Plugin Configuration

```typescript
// Each plugin reads from a config table
CREATE TABLE hyphae_plugin_configurations (
  plugin_name TEXT PRIMARY KEY,
  enabled BOOLEAN,
  version TEXT,
  config JSONB,
  overrides JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

// Example:
INSERT INTO hyphae_plugin_configurations VALUES (
  'hyphae-plugin-memory-postgresql',
  true,
  '1.0.0',
  {
    "connectionString": "postgresql://...",
    "poolSize": 10,
    "maxRetries": 3
  },
  { "org_salish_forge": { "poolSize": 20 } }
);
```

---

## Plugin Development Guide

### Creating a Plugin

**Step 1: Create manifest**
```json
// manifest.json
{
  "name": "hyphae-plugin-memory-redis",
  "version": "1.0.0",
  "type": "memory",
  "entry": "dist/index.js",
  "hyphaeVersion": "^7.0.0",
  "interfaces": ["MemoryBackend"],
  "dependencies": {
    "redis": "^4.0.0"
  }
}
```

**Step 2: Implement interface**
```typescript
// src/index.ts
import { MemoryBackend, MemoryScope } from '@hyphae/core';

export class RedisMemoryBackend implements MemoryBackend {
  private client: RedisClient;
  
  async init(config: PluginConfig): Promise<void> {
    this.client = await createRedisClient(config.connectionString);
  }
  
  async store(scope: MemoryScope, key: string, value: unknown): Promise<void> {
    const scopedKey = `${scope.id}:${key}`;
    await this.client.set(scopedKey, JSON.stringify(value));
  }
  
  async query(scope: MemoryScope, question: string, limit: number): Promise<MemoryResult[]> {
    // Implement vector search or semantic search here
    // Return results from Redis
  }
  
  async getAccessibleScopes(agentId: string): Promise<MemoryScope[]> {
    // Return scopes this agent can access
  }
}

export function register(hyphae: HyphaeApi): void {
  hyphae.registerMemoryBackend('redis', new RedisMemoryBackend());
}
```

**Step 3: Package & distribute**
```bash
npm package hyphae-plugin-memory-redis
# Publish to npm, GitHub, or internal registry
```

**Step 4: Install in Hyphae**
```bash
hyphae plugin install hyphae-plugin-memory-redis@1.0.0
# or
hyphae plugin install ./local/path/hyphae-plugin-memory-redis

# Enable in config
hyphae plugin enable hyphae-plugin-memory-redis
hyphae plugin set-default memory hyphae-plugin-memory-redis
```

---

## Plugin Versioning & Compatibility

### Version Strategy

**Hyphae uses semantic versioning:**
```
HYPHAE VERSION: 7.0.0
PLUGIN TARGET:  "hyphaeVersion": "^7.0.0"
                ↓
COMPATIBLE:     7.0.0, 7.0.1, 7.0.5, 7.3.0
NOT:            6.9.0, 8.0.0
```

### Interface Versioning

**Plugins implement interfaces with versions:**
```typescript
export class RedisMemoryBackend implements MemoryBackend@v1.0 {
  // Implements v1.0 of MemoryBackend interface
}

// When interface changes (v1.1):
export class RedisMemoryBackendV11 implements MemoryBackend@v1.1 {
  // Implements v1.1 with new methods
}

// Hyphae can run both simultaneously for gradual migration
```

### Backward Compatibility

**Hyphae guarantees:**
- ✅ Core plugin interfaces don't change (backward compatible)
- ✅ Default plugins upgraded with Hyphae
- ✅ User plugins can stay on older versions
- ✅ Migration guides provided for breaking changes

---

## Plugin Permissions & Sandboxing

### Plugin Isolation

**Each plugin runs with limited permissions:**

```typescript
interface PluginPermissions {
  // What this plugin can do
  memoryAccess: 'read' | 'read-write' | 'none',
  vaultAccess: 'read' | 'read-write' | 'none',
  networkAccess: boolean,
  fileSystemAccess: string[], // Specific paths only
  processAccess: boolean,
  
  // Rate limiting
  callsPerSecond: number,
  maxConcurrentCalls: number
}
```

**Example:**
```json
{
  "name": "hyphae-plugin-memory-redis",
  "permissions": {
    "memoryAccess": "read-write",
    "vaultAccess": "none",
    "networkAccess": true,
    "fileSystemAccess": [],
    "processAccess": false,
    "callsPerSecond": 1000
  }
}
```

### Audit Trail

All plugin operations logged:
```sql
INSERT INTO hyphae_plugin_audit_log (plugin, operation, params, result, latency, timestamp)
VALUES ('hyphae-plugin-memory-redis', 'store', {...}, 'success', 45, NOW());
```

---

## Plugin Registry: Discovery & Installation

### Central Registry (Optional)

Hyphae can use a central plugin registry (like npm):

```bash
# Search plugins
hyphae plugin search memory

# Install from registry
hyphae plugin install hyphae-plugin-memory-redis

# List installed
hyphae plugin list

# Show plugin info
hyphae plugin info hyphae-plugin-memory-redis

# Remove plugin
hyphae plugin remove hyphae-plugin-memory-redis
```

### Local Registry

Organizations can host internal plugin registry:

```bash
# Install from private registry
hyphae plugin install hyphae-plugin-training-acme \
  --registry https://plugins.acme.internal
```

---

## Plugin Composition: How Plugins Work Together

### Example: Acme Corp Stack

```
Core Plugins (Tier 1)
  ├─ hyphae-plugin-rpc-server
  ├─ hyphae-plugin-registration
  ├─ hyphae-plugin-vault
  ├─ hyphae-plugin-audit
  └─ hyphae-plugin-router

Default Plugins (Tier 2)
  ├─ hyphae-plugin-reasoning-react
  ├─ hyphae-plugin-validation-behavioral
  └─ hyphae-plugin-prompts-versioned

Acme Custom Plugins (Tier 3)
  ├─ hyphae-plugin-memory-postgresql → [Overrides default]
  ├─ hyphae-plugin-training-acme → [Custom org training]
  ├─ hyphae-plugin-tools-acme → [Acme-specific tools]
  ├─ hyphae-plugin-connector-datadog → [Datadog logging]
  ├─ hyphae-plugin-validation-security → [Acme security rules]
  └─ hyphae-plugin-workflow-approval → [Acme approval chain]

Result:
- Acme agents use ReAct reasoning (default)
- Acme agents use PostgreSQL memory (default)
- Acme agents get Acme training config (custom)
- Acme agents use Acme tools (custom)
- Acme agents log to Datadog (custom)
- Acme agents validate with Acme security rules (custom)
- Acme agents follow Acme approval workflows (custom)

All without modifying Hyphae source code.
```

---

## API: Plugin Management RPC Endpoints

```typescript
// Load installed plugins
hyphae.plugins.list()
// Returns: [{ name, version, type, enabled, status }, ...]

// Get plugin info
hyphae.plugins.info('hyphae-plugin-memory-redis')
// Returns: manifest, config, permissions, version

// Check plugin status
hyphae.plugins.status('hyphae-plugin-memory-redis')
// Returns: { running: true, errors: [], metrics: {...} }

// Install plugin (from registry or local path)
hyphae.plugins.install('hyphae-plugin-memory-redis@1.0.0')
hyphae.plugins.install('./local/hyphae-plugin-custom')

// Update plugin
hyphae.plugins.update('hyphae-plugin-memory-redis', '1.1.0')

// Remove plugin
hyphae.plugins.uninstall('hyphae-plugin-memory-redis')

// Enable/disable
hyphae.plugins.enable('hyphae-plugin-memory-redis')
hyphae.plugins.disable('hyphae-plugin-memory-redis')

// Set default for an interface
hyphae.plugins.setDefault('memory', 'hyphae-plugin-memory-redis')

// Get plugin logs
hyphae.plugins.logs('hyphae-plugin-memory-redis', { limit: 100 })
```

---

## Design Principles

### 1. Minimal Core
- Core is as small as possible
- Only essential infrastructure (RPC, registration, vault, routing)
- Everything else is optional and replaceable

### 2. Clear Interfaces
- Well-defined contracts for each extension point
- Interface documentation is gold standard
- Implementations are black boxes

### 3. Loose Coupling
- Plugins communicate through interfaces, not direct imports
- Plugins don't depend on each other
- Router mediates all plugin interactions

### 4. Graceful Degradation
- If a plugin fails, system continues (with reduced capabilities)
- Fallback to default implementation if custom fails
- Audit trail shows what happened

### 5. Backward Compatibility
- Hyphae never breaks existing plugins
- New versions of interfaces are additive
- Deprecation warnings before removal

### 6. Open Ecosystem
- Easy for anyone to create plugins
- No approval required for community plugins
- Commercial viability (companies can monetize plugins)
- Open source viability (AGPL, MIT, Apache options)

---

## Commercial vs Open Source Strategy

### Option A: Fully Open Source
```
hyphae-core/              ← Apache 2.0
├─ hyphae-plugin-*       ← Apache 2.0
└─ Ecosystem is completely open

Anyone can:
  - Use, modify, distribute
  - Create and sell plugins
  - Fork and maintain versions
```

### Option B: Core Open, Plugins Tiered
```
hyphae-core/              ← Open source (Apache 2.0)
├─ hyphae-plugin-[tier2]  ← Open source
│
plugins-commercial/       ← Proprietary
├─ hyphae-plugin-advanced-training    (Salish Forge sells)
├─ hyphae-plugin-gpu-optimization     (Salish Forge sells)
└─ hyphae-plugin-enterprise-security  (Salish Forge sells)

Community plugins/        ← Open source (any license)
├─ hyphae-plugin-memory-redis
├─ hyphae-plugin-tools-slack
└─ ...

This gives Salish Forge:
  - Monetization path (premium plugins)
  - Community contributions (free plugins)
  - Open source credibility (core is free)
```

### Option C: Core Commercial, Plugin Ecosystem Open
```
hyphae-core/              ← Commercial license
├─ hyphae-plugin-*        ← Open source Apache 2.0
│
Anyone can:
  - Use plugins freely
  - Create plugins (no permission needed)
  - Sell plugins
  - Use open source plugins

Only core requires license.
```

**Recommendation:** Option B (Core Open + Premium Plugins)
- Best balance of community + revenue
- Attracts ecosystem
- Monetizes advanced features
- Doesn't lock down extensions

---

## How Plugins Integrate with Training System

### The Complete Picture

```
Agent Registers
    ↓
Core Plugin: Registration
    ↓
Agent Gets Training from Training Plugin
    ├─ Global defaults
    ├─ Org config
    ├─ Workgroup config
    └─ Parent overrides
    ↓
Training Plugin Injects into Agent
    ├─ System prompt prefix
    ├─ Capability manifest
    └─ Memory seeding
    ↓
Agent Now Knows:
    ├─ What services exist (from Service Registry Plugin)
    ├─ How to use them (from Service Connector Plugins)
    ├─ Where to store memory (from Memory Backend Plugin)
    ├─ How to reason (from Reasoning Engine Plugin)
    ├─ How to validate (from Validation Plugin)
    └─ What tools to use (from Tool Registry Plugin)
    ↓
Agent Operates with Full Context
    ├─ Uses ReAct Reasoning Plugin
    ├─ Stores in Memory Backend Plugin
    ├─ Calls Tools via Tool Registry Plugin
    ├─ Validates with Validation Plugin
    ├─ Escalates via Workflow Plugin
    └─ All logged to Audit Plugin
```

---

## Implementation Sequence (Updated)

### Phase 0: Core Foundation (Now)
- [x] Secrets Vault (Phase 0)
- [x] Zero-Trust Registration (Phase 0)
- [x] Universal Service API (Phase 0)
- [ ] **Plugin Architecture & Loader** (NEW, Phase 0c)

### Phase 0c: Plugin System (2 weeks)
**Deliverables:**
- Core Plugin Loader
- Plugin Lifecycle Management (init, enable, disable, remove)
- Plugin Manifest Specification
- Plugin Discovery & Registry
- Plugin Permission System
- RPC endpoints for plugin management
- Plugin development guide

**Files to Create:**
- `hyphae/plugin-loader.ts` — Load and initialize plugins
- `hyphae/plugin-registry.ts` — Manage plugin versions and dependencies
- `hyphae/plugin-permissions.ts` — Enforce plugin isolation
- `hyphae/plugin-manifest.ts` — Parse plugin manifests
- `@hyphae/plugin-api.ts` — Interfaces for all extension points
- `HYPHAE_PLUGIN_DEVELOPMENT_GUIDE.md` — How to build plugins

### Phase 0a: Training System (3 weeks)
- Now built as: `hyphae-plugin-training-system` (replaceable default)
- Can be overridden with custom training plugins

### Phase 0b: Memory Scoping (2 weeks)
- Implemented in: `hyphae-plugin-memory-postgresql` (default)
- Can be replaced with Redis, MongoDB, DynamoDB, etc.

### Phases 1-5: All Built as Plugins
- Phase 1 Reasoning: `hyphae-plugin-reasoning-react`
- Phase 2 Memory: `hyphae-plugin-memory-*` (various backends)
- Phase 3 Validation: `hyphae-plugin-validation-behavioral`
- Phase 4 Prompts: `hyphae-plugin-prompts-versioned`
- Phase 5 Tools: `hyphae-plugin-tools-builtin` + connectors

---

## The Vision

**Hyphae is not a product. Hyphae is a platform.**

**Users don't install Hyphae. They build with Hyphae.**

**The value is not in what Hyphae does. The value is in what organizations can build on top of Hyphae.**

### For Open Source Community
- Fork Hyphae
- Build plugins for their stack
- Share plugins with others
- No dependency on Salish Forge

### For Enterprises
- Use Hyphae core
- Install default plugins
- Build custom plugins for their org
- Extend without touching source code

### For Salish Forge
- Maintain core + default plugins
- Build premium plugins (sold separately)
- Provide plugin hosting/registry
- Consulting on plugin development
- Support for enterprise deployments

### For Plugin Developers
- Build plugins for any use case
- Sell through plugin registry
- Community builds ecosystem
- No approval/gatekeeping

---

**Version:** 1.0  
**Status:** Plugin architecture complete, ready for Phase 0c implementation  
**Next:** Integrate plugin architecture into Phase 0c, update roadmap
