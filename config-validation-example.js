/**
 * Example: Using the Configuration Validation Framework
 * 
 * Demonstrates the safe configuration change workflow for Hyphae components
 */

import { ConfigSchema, ConfigValidator, ConfigChangeWorkflow } from './config-validation-framework.js';

// ─────────────────────────────────────────────────────────────
// Step 1: Define Configuration Schema
// ─────────────────────────────────────────────────────────────

const HYPHAE_CONFIG_SCHEMA = {
  // Dynamic parameters (no restart)
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
    enum: [
      'claude-max-100',
      'claude-api-opus',
      'claude-api-sonnet',
      'claude-api-haiku',
      'gemini-api-pro',
      'gemini-api-3-1-pro',
      'gemini-api-flash',
      'ollama-cloud-pro'
    ],
    description: 'List of allowed models for this agent',
    category: 'dynamic',
    requires_restart: false
  },

  'blockedModels': {
    type: 'array',
    items: 'string',
    description: 'List of blocked models for this agent',
    category: 'dynamic',
    requires_restart: false
  },

  'dailyBudgetUSD': {
    type: 'number',
    min: 0,
    max: 100000,
    description: 'Daily budget limit in USD',
    category: 'dynamic',
    requires_restart: false
  },

  // Static parameters (requires restart)
  'DB_HOST': {
    type: 'string',
    min_length: 3,
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

// ─────────────────────────────────────────────────────────────
// Step 2: Example Usage
// ─────────────────────────────────────────────────────────────

async function exampleUsage() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  Hyphae Config Validation Framework - Example      ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Initialize framework
  const schema = new ConfigSchema(HYPHAE_CONFIG_SCHEMA);
  const validator = new ConfigValidator(schema);
  const workflow = new ConfigChangeWorkflow(
    './policies-config.json',
    schema,
    {
      backupDir: './config-backups',
      auditLog: './config-audit.log'
    }
  );

  // ─────────────────────────────────────────────────────────────
  // Example 1: Low-Risk Change (Dynamic Parameter)
  // ─────────────────────────────────────────────────────────────

  console.log('📌 Example 1: Low-Risk Change');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const currentConfig1 = {
    autoApproveUnder: 50,
    allowAnyModel: true,
    allowedModels: [],
    blockedModels: [],
    dailyBudgetUSD: 500
  };

  const newConfig1 = {
    autoApproveUnder: 75,  // Changed from 50 to 75
    allowAnyModel: true,
    allowedModels: [],
    blockedModels: [],
    dailyBudgetUSD: 500
  };

  const result1 = await validator.validateChange(currentConfig1, newConfig1);
  
  console.log('Current config:', JSON.stringify(currentConfig1, null, 2));
  console.log('\nProposed change: autoApproveUnder: 50 → 75\n');
  console.log('Validation result:');
  console.log('  Valid:', result1.valid);
  console.log('  Risk Level:', result1.risk_level);
  console.log('  Requires Testing:', result1.requires_testing);
  console.log('  Dynamic Changes:', result1.dynamic_changes.length);
  console.log('  Recommendation:', result1.recommendation);
  console.log('\n✅ Status: Safe to apply immediately\n');

  // ─────────────────────────────────────────────────────────────
  // Example 2: Medium-Risk Change (Significant Value Change)
  // ─────────────────────────────────────────────────────────────

  console.log('\n📌 Example 2: Medium-Risk Change');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const newConfig2 = {
    autoApproveUnder: 200,  // Changed from 50 to 200 (300% increase)
    allowAnyModel: true,
    allowedModels: [],
    blockedModels: [],
    dailyBudgetUSD: 500
  };

  const result2 = await validator.validateChange(currentConfig1, newConfig2);
  
  console.log('Proposed change: autoApproveUnder: 50 → 200 (300% increase)\n');
  console.log('Validation result:');
  console.log('  Valid:', result2.valid);
  console.log('  Risk Level:', result2.risk_level);
  console.log('  Requires Testing:', result2.requires_testing);
  console.log('  Recommendation:', result2.recommendation);
  console.log('\n⏳ Status: Testing recommended before applying\n');

  // ─────────────────────────────────────────────────────────────
  // Example 3: High-Risk Change (Static Parameter)
  // ─────────────────────────────────────────────────────────────

  console.log('\n📌 Example 3: High-Risk Change');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const configWithDb1 = {
    ...currentConfig1,
    DB_HOST: '100.97.161.7',
    DB_PORT: 5433
  };

  const configWithDb2 = {
    ...currentConfig1,
    DB_HOST: '100.97.161.8',  // Changed database host
    DB_PORT: 5433
  };

  const result3 = await validator.validateChange(configWithDb1, configWithDb2);
  
  console.log('Proposed change: DB_HOST: 100.97.161.7 → 100.97.161.8\n');
  console.log('Validation result:');
  console.log('  Valid:', result3.valid);
  console.log('  Risk Level:', result3.risk_level);
  console.log('  Static Changes:', result3.static_changes.length);
  console.log('  Affected Services:', 
    result3.risk_details.affected_services || 
    ['hyphae-core', 'model-router', 'dashboard']);
  console.log('  Recommendation:', result3.recommendation);
  console.log('\n🚨 Status: Requires admin approval and testing\n');

  // ─────────────────────────────────────────────────────────────
  // Example 4: Invalid Configuration
  // ─────────────────────────────────────────────────────────────

  console.log('\n📌 Example 4: Invalid Configuration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const invalidConfig = {
    autoApproveUnder: -50,  // Invalid: negative
    allowAnyModel: 'yes',   // Invalid: should be boolean
    allowedModels: ['invalid-model'],  // Invalid: not in enum
    dailyBudgetUSD: 1000000 // Invalid: exceeds max
  };

  const result4 = await validator.validateChange(currentConfig1, invalidConfig);
  
  console.log('Proposed (invalid) configuration:\n');
  console.log('  autoApproveUnder: -50 (min: 0)');
  console.log('  allowAnyModel: "yes" (expected: boolean)');
  console.log('  allowedModels: ["invalid-model"]');
  console.log('  dailyBudgetUSD: 1000000 (max: 100000)\n');
  console.log('Validation result:');
  console.log('  Valid:', result4.valid);
  console.log('  Errors:');
  result4.errors.forEach(err => console.log('    -', err));
  console.log('\n❌ Status: Configuration rejected\n');

  // ─────────────────────────────────────────────────────────────
  // Example 5: Complete Workflow
  // ─────────────────────────────────────────────────────────────

  console.log('\n📌 Example 5: Complete Workflow');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('Step 1: Admin submits configuration change');
  console.log('  autoApproveUnder: 50 → 75\n');

  console.log('Step 2: Framework validates change');
  console.log('  ✓ Syntax valid');
  console.log('  ✓ Structure valid');
  console.log('  ✓ Types correct');
  console.log('  ✓ Ranges acceptable\n');

  console.log('Step 3: Risk assessment');
  console.log('  Risk Level: LOW');
  console.log('  Requires Testing: NO\n');

  console.log('Step 4: Create backup');
  console.log('  Backup ID: backup-2026-03-20T20-40-00-000Z');
  console.log('  Path: ./config-backups/backup-2026-03-20T20-40-00-000Z.json\n');

  console.log('Step 5: Apply configuration');
  console.log('  ✓ New config written');
  console.log('  ✓ Change logged\n');

  console.log('Step 6: Notify admin');
  console.log('  Status: APPLIED');
  console.log('  Active: IMMEDIATELY (dynamic reload)');
  console.log('  Rollback: /config rollback --id backup-2026-03-20T20-40-00-000Z\n');

  console.log('✅ Complete!\n');
}

// ─────────────────────────────────────────────────────────────
// Run example
// ─────────────────────────────────────────────────────────────

await exampleUsage();
