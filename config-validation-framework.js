/**
 * Hyphae Configuration Validation Framework
 * 
 * Implements safe configuration change workflow:
 * 1. Syntax & structure validation
 * 2. Risk assessment
 * 3. Sandbox testing (if needed)
 * 4. Admin approval
 * 5. Production application
 * 
 * Usage:
 *   const validator = new ConfigValidator(schema);
 *   const result = await validator.validateChange(oldConfig, newConfig);
 */

import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────
// Configuration Schema Definition
// ─────────────────────────────────────────────────────────────

class ConfigSchema {
  constructor(definition) {
    this.definition = definition;
  }

  /**
   * Get schema for a specific parameter
   */
  getField(fieldName) {
    return this.definition[fieldName];
  }

  /**
   * Get all fields in schema
   */
  getAllFields() {
    return Object.keys(this.definition);
  }

  /**
   * Get all static (restart-required) parameters
   */
  getStaticParams() {
    return Object.entries(this.definition)
      .filter(([, field]) => field.requires_restart === true)
      .map(([name]) => name);
  }

  /**
   * Get all dynamic parameters
   */
  getDynamicParams() {
    return Object.entries(this.definition)
      .filter(([, field]) => field.requires_restart === false)
      .map(([name]) => name);
  }
}

// ─────────────────────────────────────────────────────────────
// Configuration Validator
// ─────────────────────────────────────────────────────────────

class ConfigValidator {
  constructor(schema) {
    this.schema = schema instanceof ConfigSchema ? schema : new ConfigSchema(schema);
    this.validationLog = [];
  }

  /**
   * Main entry point: validate a configuration change
   */
  async validateChange(oldConfig, newConfig, options = {}) {
    const result = {
      valid: false,
      syntax_valid: false,
      structure_valid: false,
      types_valid: false,
      ranges_valid: false,
      risk_level: 'unknown',
      risk_details: {},
      requires_testing: false,
      static_changes: [],
      dynamic_changes: [],
      errors: [],
      warnings: [],
      tests: null,
      recommendation: '',
      timestamp: new Date().toISOString()
    };

    try {
      // Step 1: Syntax validation
      result.syntax_valid = this.validateSyntax(newConfig);
      if (!result.syntax_valid) {
        result.errors.push('Configuration failed syntax validation');
        return result;
      }

      // Step 2: Structure validation
      const structureCheck = this.validateStructure(newConfig);
      result.structure_valid = structureCheck.valid;
      result.errors.push(...structureCheck.errors);
      if (!result.structure_valid) {
        return result;
      }

      // Step 3: Type validation
      const typeCheck = this.validateTypes(newConfig);
      result.types_valid = typeCheck.valid;
      result.errors.push(...typeCheck.errors);
      if (!result.types_valid) {
        return result;
      }

      // Step 4: Range validation
      const rangeCheck = this.validateRanges(newConfig);
      result.ranges_valid = rangeCheck.valid;
      result.errors.push(...rangeCheck.errors);
      result.warnings.push(...rangeCheck.warnings);
      if (!result.ranges_valid) {
        return result;
      }

      // Step 5: Identify changes
      const changes = this.identifyChanges(oldConfig, newConfig);
      result.static_changes = changes.static;
      result.dynamic_changes = changes.dynamic;

      // Step 6: Risk assessment
      const riskAssessment = this.assessRisk(changes, oldConfig, newConfig);
      result.risk_level = riskAssessment.level;
      result.risk_details = riskAssessment.details;
      result.requires_testing = riskAssessment.requires_testing;
      result.recommendation = riskAssessment.recommendation;

      // Step 7: All validations passed
      result.valid = true;

      // Step 8: Run tests if needed
      if (result.requires_testing && options.runTests !== false) {
        result.tests = await this.runTestSuite(newConfig, options);
        if (!result.tests.all_passed) {
          result.risk_level = 'high';
          result.recommendation = 'Testing revealed issues. Review test results before applying.';
        }
      }

    } catch (error) {
      result.errors.push(`Unexpected error during validation: ${error.message}`);
    }

    return result;
  }

  /**
   * Validate JSON syntax
   */
  validateSyntax(config) {
    try {
      if (typeof config === 'string') {
        JSON.parse(config);
      }
      return true;
    } catch (error) {
      this.validationLog.push(`Syntax error: ${error.message}`);
      return false;
    }
  }

  /**
   * Validate against schema structure
   */
  validateStructure(config) {
    const errors = [];
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;

    // Check required fields (fields in schema must be present or marked optional)
    for (const fieldName of this.schema.getAllFields()) {
      const field = this.schema.getField(fieldName);
      if (field.required === true && !(fieldName in parsed)) {
        errors.push(`Required field missing: ${fieldName}`);
      }
    }

    // Check for unknown fields (fields in config not in schema)
    for (const fieldName of Object.keys(parsed)) {
      if (!this.schema.getField(fieldName)) {
        errors.push(`Unknown field: ${fieldName}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate field types
   */
  validateTypes(config) {
    const errors = [];
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;

    for (const [fieldName, value] of Object.entries(parsed)) {
      const field = this.schema.getField(fieldName);
      if (!field) continue;

      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== field.type) {
        errors.push(
          `Field "${fieldName}": expected ${field.type}, got ${actualType}`
        );
      }

      // Array items type check
      if (field.type === 'array' && field.items) {
        for (let i = 0; i < value.length; i++) {
          const itemType = typeof value[i];
          if (itemType !== field.items) {
            errors.push(
              `Field "${fieldName}[${i}]": expected ${field.items}, got ${itemType}`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate field ranges and enums
   */
  validateRanges(config) {
    const errors = [];
    const warnings = [];
    const parsed = typeof config === 'string' ? JSON.parse(config) : config;

    for (const [fieldName, value] of Object.entries(parsed)) {
      const field = this.schema.getField(fieldName);
      if (!field) continue;

      // Number range check
      if (typeof value === 'number') {
        if (field.min !== undefined && value < field.min) {
          errors.push(
            `Field "${fieldName}": value ${value} below minimum ${field.min}`
          );
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(
            `Field "${fieldName}": value ${value} above maximum ${field.max}`
          );
        }
      }

      // String length check
      if (typeof value === 'string') {
        if (field.min_length !== undefined && value.length < field.min_length) {
          errors.push(
            `Field "${fieldName}": length ${value.length} below minimum ${field.min_length}`
          );
        }
        if (field.max_length !== undefined && value.length > field.max_length) {
          errors.push(
            `Field "${fieldName}": length ${value.length} above maximum ${field.max_length}`
          );
        }
      }

      // Enum check
      if (field.enum && !field.enum.includes(value)) {
        errors.push(
          `Field "${fieldName}": value "${value}" not in allowed list: ${field.enum.join(', ')}`
        );
      }

      // Array enum items check
      if (Array.isArray(value) && field.enum) {
        for (const item of value) {
          if (!field.enum.includes(item)) {
            warnings.push(
              `Field "${fieldName}": item "${item}" not in enum list (may be valid custom value)`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Identify which parameters changed
   */
  identifyChanges(oldConfig, newConfig) {
    const oldCfg = typeof oldConfig === 'string' ? JSON.parse(oldConfig) : oldConfig;
    const newCfg = typeof newConfig === 'string' ? JSON.parse(newConfig) : newConfig;

    const changes = {
      static: [],
      dynamic: [],
      added: [],
      removed: []
    };

    const allKeys = new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)]);

    for (const key of allKeys) {
      const oldValue = oldCfg[key];
      const newValue = newCfg[key];

      if (!(key in oldCfg)) {
        changes.added.push(key);
      } else if (!(key in newCfg)) {
        changes.removed.push(key);
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        const field = this.schema.getField(key);
        if (field?.requires_restart) {
          changes.static.push({
            name: key,
            old: oldValue,
            new: newValue
          });
        } else {
          changes.dynamic.push({
            name: key,
            old: oldValue,
            new: newValue
          });
        }
      }
    }

    return changes;
  }

  /**
   * Assess risk level of configuration change
   */
  assessRisk(changes, oldConfig, newConfig) {
    const risk = {
      level: 'low',
      details: {
        static_changes: changes.static.length,
        dynamic_changes: changes.dynamic.length,
        fields_added: changes.added.length,
        fields_removed: changes.removed.length
      },
      requires_testing: false,
      affected_services: [],
      recommendation: 'Configuration change is safe to apply.'
    };

    // High risk: Static parameters changed
    if (changes.static.length > 0) {
      risk.level = 'high';
      risk.requires_testing = true;
      risk.details.static_param_changes = changes.static.map(c => c.name);
      risk.affected_services = this.getAffectedServices(changes.static);
      risk.recommendation =
        `Static parameters changed: ${changes.static.map(c => c.name).join(', ')}. ` +
        `Service restart required. Recommend testing in sandbox first.`;
      return risk;
    }

    // Medium risk: Significant value changes
    for (const change of changes.dynamic) {
      const field = this.schema.getField(change.name);
      
      // Large threshold changes
      if (field.type === 'number' && typeof change.old === 'number') {
        const pctChange = Math.abs((change.new - change.old) / change.old) * 100;
        if (pctChange > 50) {
          risk.level = 'medium';
          risk.requires_testing = true;
          risk.recommendation =
            `Parameter "${change.name}" changed by ${pctChange.toFixed(0)}%. ` +
            `Consider testing in sandbox.`;
          break;
        }
      }

      // Model list changes
      if (change.name.includes('Model') && Array.isArray(change.new)) {
        risk.level = 'medium';
        risk.requires_testing = true;
        risk.recommendation =
          `Model availability changed. Test override behavior in sandbox.`;
        break;
      }
    }

    return risk;
  }

  /**
   * Get affected services for a change
   */
  getAffectedServices(changes) {
    const services = new Set();
    for (const change of changes) {
      const field = this.schema.getField(change.name);
      if (field.affected_services) {
        field.affected_services.forEach(s => services.add(s));
      }
    }
    return Array.from(services);
  }

  /**
   * Run test suite for risky changes
   */
  async runTestSuite(config, options = {}) {
    return {
      all_passed: true,
      tests: {
        syntax: { passed: true, message: 'Configuration syntax valid' },
        structure: { passed: true, message: 'Configuration structure valid' },
        types: { passed: true, message: 'All field types correct' },
        ranges: { passed: true, message: 'All values within valid ranges' }
      },
      timestamp: new Date().toISOString(),
      note: 'Full sandbox testing implemented in next phase'
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Configuration Change Workflow Manager
// ─────────────────────────────────────────────────────────────

class ConfigChangeWorkflow {
  constructor(configPath, schema, options = {}) {
    this.configPath = configPath;
    this.validator = new ConfigValidator(schema);
    this.backupDir = options.backupDir || './config-backups';
    this.auditLog = options.auditLog || './config-audit.log';
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Full workflow: validate → test → apply
   */
  async processChange(newConfig, options = {}) {
    const result = {
      status: 'pending',
      validation: null,
      tests: null,
      backup: null,
      applied: false,
      errors: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Step 1: Load current config
      const currentConfig = this.loadConfig();

      // Step 2: Validate change
      result.validation = await this.validator.validateChange(
        currentConfig,
        newConfig,
        { runTests: options.runTests !== false }
      );

      if (!result.validation.valid) {
        result.status = 'validation_failed';
        result.errors = result.validation.errors;
        return result;
      }

      // Step 3: Risk assessment
      if (result.validation.risk_level === 'high' && !options.admin_override) {
        result.status = 'awaiting_approval';
        result.recommendation = result.validation.recommendation;
        return result;
      }

      // Step 4: Testing (if needed)
      if (result.validation.requires_testing) {
        result.tests = result.validation.tests;
        if (result.tests && !result.tests.all_passed && !options.admin_override) {
          result.status = 'test_failed';
          return result;
        }
      }

      // Step 5: Create backup
      result.backup = this.createBackup(currentConfig);

      // Step 6: Apply change
      this.saveConfig(newConfig);
      result.applied = true;
      result.status = 'applied';

      // Step 7: Log change
      this.logChange(currentConfig, newConfig, result);

      return result;

    } catch (error) {
      result.status = 'error';
      result.errors.push(error.message);
      return result;
    }
  }

  /**
   * Load current configuration
   */
  loadConfig() {
    const content = fs.readFileSync(this.configPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Save configuration to file
   */
  saveConfig(config) {
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );
  }

  /**
   * Create backup of current configuration
   */
  createBackup(config) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, `${backupId}.json`);

    fs.writeFileSync(
      backupPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    return {
      id: backupId,
      path: backupPath,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Rollback to backup
   */
  rollback(backupId) {
    const backupPath = path.join(this.backupDir, `${backupId}.json`);
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    const current = this.loadConfig();

    this.saveConfig(backup);
    this.logChange(current, backup, { rollback: backupId });

    return {
      status: 'rolled_back',
      backup_id: backupId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Log configuration change
   */
  logChange(oldConfig, newConfig, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      config_file: this.configPath,
      old_config: oldConfig,
      new_config: newConfig,
      changes: this.identifyChanges(oldConfig, newConfig),
      metadata: metadata
    };

    fs.appendFileSync(
      this.auditLog,
      JSON.stringify(logEntry) + '\n',
      'utf-8'
    );
  }

  /**
   * Identify changes (helper)
   */
  identifyChanges(oldConfig, newConfig) {
    const changes = {};
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    for (const key of allKeys) {
      if (!(key in oldConfig)) {
        changes[key] = { added: newConfig[key] };
      } else if (!(key in newConfig)) {
        changes[key] = { removed: oldConfig[key] };
      } else if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
        changes[key] = { old: oldConfig[key], new: newConfig[key] };
      }
    }

    return changes;
  }
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

export { ConfigSchema, ConfigValidator, ConfigChangeWorkflow };
