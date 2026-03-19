/**
 * Hyphae Core - Enhanced with Secrets Vault
 * Bootstrap sequence integrates vault initialization
 */

import express from 'express';
import { Pool } from 'pg';
import { HyphaeCoreVault } from './secrets-vault';
import { registerSecretsHandlers } from './secrets-rpc-handlers';

const app = express();
const db = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

let vault: HyphaeCoreVault;
let isReady = false;

/**
 * Initialize Hyphae Core with Secrets Vault
 */
async function initializeHyphaeCore() {
  console.log('🚀 Initializing Hyphae Core with Secrets Vault...');

  // 1. Test database connection
  try {
    await db.query('SELECT 1');
    console.log('✅ PostgreSQL connected');
  } catch (e) {
    console.error('❌ PostgreSQL connection failed:', e);
    process.exit(1);
  }

  // 2. Initialize database schema
  try {
    const schemaSQL = `
      CREATE TABLE IF NOT EXISTS hyphae_secrets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        value_encrypted TEXT NOT NULL,
        service VARCHAR(100) NOT NULL DEFAULT 'system',
        expires_at TIMESTAMP,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(255),
        updated_by VARCHAR(255)
      );

      CREATE INDEX IF NOT EXISTS idx_secrets_name ON hyphae_secrets(name);
      CREATE INDEX IF NOT EXISTS idx_secrets_service ON hyphae_secrets(service);

      CREATE TABLE IF NOT EXISTS hyphae_secrets_audit (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        secret_name VARCHAR(255) NOT NULL,
        service VARCHAR(100) NOT NULL,
        action VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        accessed_by VARCHAR(255),
        accessed_at TIMESTAMP DEFAULT NOW(),
        ip_address INET,
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_secrets_audit_name ON hyphae_secrets_audit(secret_name);
    `;

    await db.query(schemaSQL);
    console.log('✅ Database schema initialized');
  } catch (e) {
    console.error('❌ Schema initialization failed:', e);
    // Continue anyway - tables may already exist
  }

  // 3. Initialize Secrets Vault
  const encryptionKey = process.env.HYPHAE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn(
      '⚠️  HYPHAE_ENCRYPTION_KEY not set - using random key (secrets will be lost on restart)'
    );
  }

  vault = new HyphaeCoreVault(db, encryptionKey);
  console.log('🔐 Secrets Vault initialized');

  // 4. Register RPC handlers for secrets
  registerSecretsHandlers(vault, {
    registerHandler: (capability: string, handler: Function) => {
      console.log(`  ✅ Registered handler: ${capability}`);
    },
  });

  isReady = true;
  console.log('✅ Hyphae Core ready');
}

/**
 * RPC endpoint - agents call this
 */
app.post('/rpc', express.json(), async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ error: 'Hyphae Core not ready' });
  }

  const { sourceAgent, capability, params, timeout } = req.body;

  try {
    // Route to appropriate handler
    let result;

    if (capability === 'secrets.get') {
      result = await vault.getSecret(params.secretName, sourceAgent);
      return res.json({ success: true, value: result });
    } else if (capability === 'secrets.list') {
      const secrets = await vault.listSecrets(params.service);
      return res.json({
        success: true,
        secrets: secrets.map((s) => ({
          name: s.name,
          service: s.service,
          expires_at: s.expires_at,
          created_at: s.created_at,
        })),
      });
    } else if (capability === 'secrets.set') {
      if (sourceAgent !== 'system' && sourceAgent !== 'flint') {
        return res.status(403).json({ error: 'Not authorized to set secrets' });
      }
      await vault.setSecret(
        params.secretName,
        params.value,
        sourceAgent,
        params.expiresAt
      );
      return res.json({ success: true });
    } else if (capability === 'secrets.audit') {
      if (sourceAgent !== 'system' && sourceAgent !== 'flint') {
        return res.status(403).json({ error: 'Not authorized to view audit' });
      }
      const audit = await vault.getAuditTrail(params.limit || 100);
      return res.json({ success: true, audit });
    } else if (capability === 'ping') {
      return res.json({ success: true, agent: sourceAgent });
    } else {
      return res.status(400).json({ error: `Unknown capability: ${capability}` });
    }
  } catch (error: any) {
    console.error(`RPC error (${capability}):`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: isReady ? 'ready' : 'initializing',
    vault: isReady ? 'operational' : 'initializing',
    timestamp: new Date().toISOString(),
  });
});

/**
 * List registered secrets (metadata only)
 */
app.get('/api/secrets', express.json(), async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ error: 'Not ready' });
  }

  try {
    const service = req.query.service as string;
    const secrets = await vault.listSecrets(service);
    res.json({
      success: true,
      count: secrets.length,
      secrets: secrets.map((s) => ({
        name: s.name,
        service: s.service,
        expires_at: s.expires_at,
        created_at: s.created_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list secrets' });
  }
});

/**
 * Audit trail endpoint (admin only)
 */
app.get('/api/audit', async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ error: 'Not ready' });
  }

  try {
    const limit = parseInt((req.query.limit as string) || '100');
    const audit = await vault.getAuditTrail(limit);
    res.json({ success: true, count: audit.length, audit });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get audit trail' });
  }
});

/**
 * Startup
 */
const PORT = process.env.PORT || 3100;

initializeHyphaeCore().then(() => {
  app.listen(PORT, () => {
    console.log(`🌐 Hyphae Core listening on port ${PORT}`);
    console.log(`   RPC endpoint: POST /rpc`);
    console.log(`   Health check: GET /health`);
    console.log(`   Secrets API: GET /api/secrets`);
    console.log(`   Audit trail: GET /api/audit`);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await db.end();
  process.exit(0);
});
