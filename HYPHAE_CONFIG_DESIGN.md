# Hyphae Configuration Design Principles

**Author:** John Brooke, Flint  
**Date:** March 20, 2026  
**Status:** Design Specification

---

## Core Principle: Dynamic Loading First

All configuration items in Hyphae and related components should use **dynamic loading** by default. Configuration should be read from files/sources at request time, not cached or loaded at startup.

**Why:**
- Services don't require restart for config changes
- Configuration changes take effect immediately
- Lower operational friction
- Better observability (can track which config version handled each request)
- Easier rollback (revert file, next request reads old config)

---

## Configuration Categories

### 1. Dynamic Loading (Preferred)

**Definition:** Configuration item that can be read from disk/source on each request without affecting service stability.

**Examples:**
- Agent override policies (allowAnyModel, thresholds)
- Model service provider endpoints
- Rate limits and quota settings
- Feature flags
- Approved model lists
- Cost budget thresholds

**Implementation Pattern:**
```javascript
// Load from file on each request
function getOverridePolicy(agentId) {
  const policies = loadPoliciesFromFile();  // Reads disk each time
  return policies[agentId] || getDefaults();
}

// Method called during RPC processing
'model.requestOverride': async (params) => {
  const policy = getOverridePolicy(params.agent_id);  // Fresh load
  // ... use policy
}
```

**Benefits:**
- ✅ No restart required
- ✅ Changes active immediately
- ✅ Easy rollback (revert file)
- ✅ Full audit trail (track file changes)

---

### 2. Static Configuration (Rare)

**Definition:** Configuration item that cannot be safely reloaded without service restart. Requires coordination of multiple services or affects process-level behavior.

**Examples:**
- Database connection strings (PostgreSQL pool)
- HTTP server port number
- Process-level resource limits (memory, file descriptors)
- Encryption key material
- TLS certificate paths
- Inter-service communication protocols

**Requirements When Static:**
1. **Explicit Flagging**
   - Document in code: `// STATIC: Database URL`
   - Mark in config schema
   - Add warning in validation

2. **Admin Notification**
   - Alert admin before allowing change
   - Show list of affected services
   - Require explicit confirmation

3. **Graceful Degradation**
   - Log when service detects config mismatch
   - Provide recovery instructions
   - Don't silently fail

**Implementation Pattern:**
```javascript
// Mark as static
const STATIC_PARAMS = {
  'DB_HOST': true,
  'DB_PORT': true,
  'HYPHAE_PORT': true,
  'ENCRYPTION_KEY': true
};

function flagStaticChange(paramName) {
  if (STATIC_PARAMS[paramName]) {
    return {
      is_static: true,
      requires_restart: true,
      affected_services: ['model-router', 'hyphae-core', 'dashboard'],
      recommendation: 'Requires service restart. Plan downtime window.'
    };
  }
  return { is_static: false };
}
```

---

## Configuration Change Workflow

### Step 1: Admin Makes Change

Admin changes configuration via:
- Dashboard UI (preferred)
- Direct file edit (advanced)
- RPC method call (programmatic)

---

### Step 2: Syntax & Structure Validation

**Automatic validation on any change:**

```javascript
async function validateConfigChange(configPath, newValues) {
  const validation = {
    syntax_valid: false,
    structure_valid: false,
    type_valid: false,
    range_valid: false,
    errors: [],
    warnings: []
  };

  try {
    // 1. Syntax check
    const parsed = JSON.parse(newValues);
    validation.syntax_valid = true;

    // 2. Structure validation
    const schema = getConfigSchema(configPath);
    const structureCheck = validateSchema(parsed, schema);
    if (!structureCheck.valid) {
      validation.errors.push(...structureCheck.errors);
      return validation;
    }
    validation.structure_valid = true;

    // 3. Type validation
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== schema[key].type) {
        validation.errors.push(
          `Field "${key}": expected ${schema[key].type}, got ${typeof value}`
        );
      }
    }
    validation.type_valid = validation.errors.length === 0;

    // 4. Range/value validation
    for (const [key, value] of Object.entries(parsed)) {
      if (schema[key].min && value < schema[key].min) {
        validation.errors.push(
          `Field "${key}": value ${value} below minimum ${schema[key].min}`
        );
      }
      if (schema[key].max && value > schema[key].max) {
        validation.errors.push(
          `Field "${key}": value ${value} above maximum ${schema[key].max}`
        );
      }
      if (schema[key].enum && !schema[key].enum.includes(value)) {
        validation.errors.push(
          `Field "${key}": value "${value}" not in allowed list: ${schema[key].enum.join(', ')}`
        );
      }
    }
    validation.range_valid = validation.errors.length === 0;

  } catch (error) {
    validation.errors.push(`Parse error: ${error.message}`);
  }

  return validation;
}
```

**Result:** ✅ All checks pass → Go to Step 3

**Result:** ❌ Validation fails → Alert admin with specific errors, stop

---

### Step 3: Risk Assessment

**Categorize the change:**

```javascript
async function assessConfigRisk(configPath, changes, oldConfig) {
  const risk = {
    level: 'low',  // low, medium, high
    affected_services: [],
    disruption_risk: {},
    requires_testing: false,
    recommendation: ''
  };

  // Check if static params changed
  const staticChanges = Object.keys(changes).filter(k => STATIC_PARAMS[k]);
  if (staticChanges.length > 0) {
    risk.level = 'high';
    risk.affected_services = ['all'];
    risk.requires_testing = true;
    risk.recommendation = 'Static parameters changed. Restart required.';
    return risk;
  }

  // Check if policy thresholds changed significantly
  if (changes.autoApproveUnder) {
    const oldThreshold = oldConfig.autoApproveUnder;
    const newThreshold = changes.autoApproveUnder;
    const pctChange = Math.abs((newThreshold - oldThreshold) / oldThreshold) * 100;
    
    if (pctChange > 50) {
      risk.level = 'medium';
      risk.requires_testing = true;
      risk.recommendation = `Threshold change >50% (${pctChange.toFixed(0)}%). Test in sandbox.`;
    }
  }

  // Check if model lists changed
  if (changes.allowedModels || changes.blockedModels) {
    risk.level = 'medium';
    risk.affected_services = ['model-router'];
    risk.requires_testing = true;
    risk.recommendation = 'Model availability changed. Test override behavior.';
  }

  return risk;
}
```

**Result:** LOW RISK → Go to Step 4a (apply directly)

**Result:** MEDIUM/HIGH RISK → Go to Step 4b (test first)

---

### Step 4a: Low-Risk Changes (Direct Application)

**For LOW RISK:**

```
1. Write config to file
2. Log change with timestamp
3. Return success to admin
4. Next request uses new config
5. ✅ Change active immediately
```

**Example:** Adjusting auto-approve threshold by 10%

---

### Step 4b: Medium/High-Risk Changes (Validation First)

**For MEDIUM/HIGH RISK:**

```javascript
async function testConfigInSandbox(configPath, newConfig) {
  // 1. Spin up isolated test environment
  const sandbox = await createValidationSandbox({
    image: 'hyphae-test:latest',
    config: newConfig,
    timeout: 30000  // 30 seconds
  });

  // 2. Run test suite
  const testResults = {
    startup: false,
    health_check: false,
    override_request: false,
    policy_enforcement: false,
    fallback_behavior: false,
    error_handling: false,
    performance: { latency_ms: 0, errors: 0 }
  };

  try {
    // Test 1: Service starts
    await sandbox.start();
    testResults.startup = true;

    // Test 2: Health check passes
    const health = await sandbox.healthCheck();
    testResults.health_check = health.ok;

    // Test 3: Override request works
    const override = await sandbox.testOverrideRequest({
      agent_id: 'test-agent',
      service_id: 'gemini-api-pro'
    });
    testResults.override_request = override.success;

    // Test 4: Policy enforced correctly
    const policyTest = await sandbox.testPolicyEnforcement(newConfig);
    testResults.policy_enforcement = policyTest.all_pass;

    // Test 5: Fallback behavior works
    const fallback = await sandbox.testFallbackBehavior();
    testResults.fallback_behavior = fallback.success;

    // Test 6: Error handling
    const errors = await sandbox.testErrorHandling();
    testResults.error_handling = errors.handled_gracefully;

    // Test 7: Performance acceptable
    const perf = await sandbox.measurePerformance(100);
    testResults.performance = perf;

  } catch (error) {
    return {
      status: 'test_failed',
      error: error.message,
      results: testResults
    };
  } finally {
    await sandbox.destroy();
  }

  return {
    status: 'test_passed',
    results: testResults,
    timestamp: new Date().toISOString()
  };
}
```

**Test Results:**
- ✅ All tests pass → Go to Step 5 (apply)
- ❌ Some tests fail → Alert admin with details, offer override

---

### Step 5: Admin Decision

**If tests passed:**
```
Alert: "Configuration change validated. Apply now?"
  [✅ Apply] [⏭ Schedule] [❌ Cancel]
```

**If tests failed:**
```
Alert: "Configuration change has risk. Details:"
  - Test X failed: [reason]
  - Test Y failed: [reason]
  
  [Apply Anyway?] [⏭ Schedule] [❌ Cancel] [View Details]
```

---

### Step 6: Apply to Production

**When approved:**

```javascript
async function applyConfigChange(configPath, newConfig, options = {}) {
  const { 
    test_results = null,
    admin_override = false,
    scheduled_time = null
  } = options;

  // 1. Create backup
  const backup = createBackup(configPath);
  
  // 2. Write new config
  fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
  
  // 3. Log change
  logConfigChange({
    path: configPath,
    old_config: loadCurrentConfig(configPath),
    new_config: newConfig,
    test_results: test_results,
    admin_override: admin_override,
    timestamp: new Date().toISOString(),
    backup_id: backup.id
  });
  
  // 4. Alert admin
  notifyAdmin({
    level: 'info',
    message: `Configuration updated: ${configPath}`,
    timestamp: new Date().toISOString(),
    test_passed: test_results?.status === 'test_passed',
    override: admin_override,
    rollback: `undo --id ${backup.id}`
  });
  
  return {
    status: 'applied',
    backup_id: backup.id,
    active_immediately: !STATIC_PARAMS[Object.keys(newConfig)[0]]
  };
}
```

---

## Configuration Validation Schema Example

```javascript
const CONFIG_SCHEMA = {
  // Dynamic configs (no restart)
  'autoApproveUnder': {
    type: 'number',
    min: 0,
    max: 10000,
    description: 'Auto-approve override requests under this USD threshold',
    category: 'dynamic',
    requires_restart: false
  },
  
  'allowAnyModel': {
    type: 'boolean',
    description: 'Agent can request any model',
    category: 'dynamic',
    requires_restart: false
  },
  
  'allowedModels': {
    type: 'array',
    items: 'string',
    enum: ['claude-max-100', 'claude-api-opus', 'gemini-api-pro'],
    description: 'List of allowed models for this agent',
    category: 'dynamic',
    requires_restart: false
  },
  
  // Static configs (requires restart)
  'DB_HOST': {
    type: 'string',
    description: 'PostgreSQL server hostname',
    category: 'static',
    requires_restart: true,
    affected_services: ['hyphae-core', 'model-router', 'dashboard']
  },
  
  'DB_PORT': {
    type: 'number',
    min: 1024,
    max: 65535,
    description: 'PostgreSQL server port',
    category: 'static',
    requires_restart: true,
    affected_services: ['hyphae-core', 'model-router', 'dashboard']
  },
  
  'HYPHAE_PORT': {
    type: 'number',
    min: 1024,
    max: 65535,
    description: 'HTTP server port for Hyphae core',
    category: 'static',
    requires_restart: true,
    affected_services: ['hyphae-core']
  },
  
  'ENCRYPTION_KEY': {
    type: 'string',
    min_length: 32,
    description: 'AES-256 encryption key for secrets',
    category: 'static',
    requires_restart: true,
    sensitive: true,
    affected_services: ['model-router']
  }
};
```

---

## Implementation Checklist

### For Dynamic Configs
- [ ] Load from file on each request (not startup)
- [ ] Provide RPC methods: get, update, list, history
- [ ] Implement change history tracking
- [ ] Support rollback to previous version
- [ ] Cache invalidation (if any caching)
- [ ] Log all reads and writes

### For Static Configs
- [ ] Document as STATIC in code comments
- [ ] Add to `STATIC_PARAMS` whitelist
- [ ] Require explicit admin confirmation
- [ ] Show affected services
- [ ] Provide restart instructions
- [ ] Alert on mismatch detection

### For All Config Changes
- [ ] Validate syntax (JSON parse)
- [ ] Validate structure (schema match)
- [ ] Validate types (field types)
- [ ] Validate ranges (min/max/enum)
- [ ] Assess risk level
- [ ] Test if medium/high risk
- [ ] Create backup before apply
- [ ] Log change to audit trail
- [ ] Alert admin with status

---

## Default Test Suite

**Every configuration change should run:**

1. **Syntax & Structure** (automatic)
   - JSON parses
   - Schema matches
   - Required fields present

2. **Semantic Validation**
   - No conflicts between fields
   - Dependencies satisfied
   - Model names valid

3. **Sandbox Testing** (for MEDIUM/HIGH risk)
   - Service starts
   - Health check passes
   - Core operations work
   - Error handling works
   - Performance acceptable
   - Fallback behavior works

4. **Rollback** (always possible)
   - Backup created before change
   - Can revert to backup
   - Backup deletion safe

---

## Admin Notifications

### Low-Risk Change Applied
```
✅ Configuration updated

Parameter: autoApproveUnder
Old: $50.00/day
New: $75.00/day

Status: Active immediately (dynamic reload)
Affected: Flint agent policy
Rollback: /config rollback --id backup-xyz
```

### Medium-Risk Change (Testing)
```
⏳ Configuration change in validation

Parameter: allowedModels
Change: Added claude-api-opus

Risk Level: MEDIUM
Reason: Model list changed

Testing in sandbox...
- Startup: ✓
- Health check: ✓
- Override request: ✓
- Policy enforcement: ✓
- Fallback behavior: ✓
- Performance: ✓

All tests passed. Ready to apply?
[Apply] [Schedule] [Cancel] [View Details]
```

### High-Risk Change (Requires Approval)
```
🚨 Configuration change requires approval

Parameter: DB_HOST
Old: 100.97.161.7
New: 100.97.161.8

Risk Level: HIGH
Reason: Static parameter - requires restart

Affected Services:
- hyphae-core
- model-router  
- dashboard

Recommendation:
1. Backup current database
2. Test new server connectivity
3. Plan 5-minute downtime
4. Restart all services

Override allowed?
[Apply Anyway] [Schedule] [Cancel] [Get Help]
```

---

## Summary

**Design Principles:**
1. Default to dynamic loading
2. Flag static parameters explicitly
3. Validate all config changes
4. Test medium/high risk changes
5. Require admin confirmation for risky changes
6. Always create backups
7. Full audit trail

**Result:**
- ✅ Safe configuration changes
- ✅ No unexpected downtime
- ✅ Easy rollback
- ✅ Admin always in control
- ✅ Full audit trail
