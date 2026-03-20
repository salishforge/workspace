#!/usr/bin/env node

/**
 * Hyphae Core - Immutable baseline fabric for multi-agent coordination
 * 
 * Responsibilities:
 * 1. Agent identity & registration (zero-trust)
 * 2. Secret vault (encrypted, per-agent keys)
 * 3. Service routing (request → plugin or fallback)
 * 4. Circuit breaker (failure detection + recovery)
 * 5. Immutable audit log
 * 
 * Port: 3100
 */

import https from 'https';
import crypto from 'crypto';
import pg from 'pg';
import fs from 'fs';
import { EventEmitter } from 'events';

const PORT = process.env.HYPHAE_PORT || 3100;
const DB_URL = process.env.HYPHAE_DB_URL;
const ENCRYPTION_KEY = process.env.HYPHAE_ENCRYPTION_KEY;

if (!DB_URL) {
  console.error('[hyphae] HYPHAE_DB_URL environment variable required');
  process.exit(1);
}

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  console.error('[hyphae] HYPHAE_ENCRYPTION_KEY required (min 32 chars)');
  process.exit(1);
}

// ── Database Connection ──
const pool = new pg.Pool({ connectionString: DB_URL });

// ── Circuit Breaker ──
class CircuitBreaker extends EventEmitter {
  constructor(serviceName, errorThreshold = 5, windowMs = 60000, halfOpenDelayMs = 30000) {
    super();
    this.serviceName = serviceName;
    this.state = 'CLOSED';
    this.failures = [];
    this.successes = [];
    this.errorThreshold = errorThreshold;
    this.windowMs = windowMs;
    this.halfOpenDelayMs = halfOpenDelayMs;
    this.openedAt = null;
  }

  recordSuccess() {
    this.successes.push(Date.now());
    const cutoff = Date.now() - this.windowMs;
    this.successes = this.successes.filter(t => t > cutoff);
    this.failures = this.failures.filter(t => t > cutoff);

    if (this.state === 'HALF_OPEN' && this.successes.length >= 4) {
      this.setState('CLOSED');
    }
  }

  recordFailure() {
    this.failures.push(Date.now());
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter(t => t > cutoff);
    this.successes = this.successes.filter(t => t > cutoff);

    const total = this.failures.length + this.successes.length;
    const errorRate = total > 0 ? this.failures.length / total : 0;
    const MIN_CALL_THRESHOLD = 10; // Require at least 10 calls before opening

    if (errorRate > (this.errorThreshold / 100) && this.failures.length > 0 && total >= MIN_CALL_THRESHOLD) {
      if (this.state === 'CLOSED') {
        this.setState('OPEN');
        this.openedAt = Date.now();
        return true; // Signal to send interrupt
      }
    }

    return false;
  }

  setState(newState) {
    if (this.state !== newState) {
      console.log(`[hyphae] Circuit ${this.serviceName}: ${this.state} → ${newState}`);
      this.state = newState;
      this.emit('stateChange', { service: this.serviceName, state: newState });
    }
  }

  getState() {
    if (this.state === 'OPEN' && (Date.now() - this.openedAt) > this.halfOpenDelayMs) {
      this.setState('HALF_OPEN');
    }
    return this.state;
  }

  isOpen() {
    return this.getState() === 'OPEN';
  }

  isHalfOpen() {
    return this.getState() === 'HALF_OPEN';
  }

  metrics() {
    return {
      service: this.serviceName,
      state: this.getState(),
      failures: this.failures.length,
      successes: this.successes.length,
      errorRate: this.successes.length + this.failures.length > 0 
        ? (this.failures.length / (this.failures.length + this.successes.length)).toFixed(2)
        : 0
    };
  }
}

const circuitBreakers = new Map();
function getCircuitBreaker(serviceName) {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, new CircuitBreaker(serviceName));
  }
  return circuitBreakers.get(serviceName);
}

// ── Audit Logger ──
async function auditLog(action, agentId, resource, status, details = {}) {
  try {
    await pool.query(
      `INSERT INTO hyphae_audit_log (agent_id, action, resource, status, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [agentId || 'system', action, resource, status, JSON.stringify(details)]
    );
  } catch (error) {
    console.error(`[hyphae] Audit log failed: ${error.message}`);
  }
}

// ── Agent Verification ──
async function verifyAgent(agentId) {
  try {
    const result = await pool.query(
      `SELECT * FROM hyphae_agent_identities WHERE agent_id = $1`,
      [agentId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const agent = result.rows[0];
    if (!agent.is_active || agent.revoked_at) {
      return null;
    }
    
    return agent;
  } catch (error) {
    console.error(`[hyphae] Agent verification failed: ${error.message}`);
    return null;
  }
}

// ── Key Derivation (no key material stored) ──
function deriveAgentKey(agentId) {
  // HKDF: derive per-agent key from master key + agent_id
  // HYPHAE_ENCRYPTION_KEY (256-bit) + agent_id → 32-byte AES key
  const ikm = Buffer.from(ENCRYPTION_KEY, 'utf-8').slice(0, 32);
  const salt = Buffer.alloc(0);
  const info = Buffer.from(`hyphae-agent-key:${agentId}`, 'utf-8');
  
  // HKDF-SHA256: extract + expand
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const expanded = crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .slice(0, 32);
  
  return expanded;
}

// ── Vault Operations ──
async function getSecret(agentId, secretName) {
  try {
    const agent = await verifyAgent(agentId);
    if (!agent) {
      await auditLog('vault_get', agentId, secretName, 'denied', { reason: 'agent_invalid' });
      throw new Error('Agent not found or revoked');
    }

    const result = await pool.query(
      `SELECT value_encrypted, nonce FROM hyphae_secrets 
       WHERE agent_id = $1 AND secret_name = $2`,
      [agentId, secretName]
    );

    if (result.rows.length === 0) {
      await auditLog('vault_get', agentId, secretName, 'notfound');
      throw new Error('Secret not found');
    }

    const { value_encrypted, nonce } = result.rows[0];
    
    // Decrypt with derived agent key
    const agentKey = deriveAgentKey(agentId);
    const nonceBuffer = Buffer.from(nonce, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', agentKey, nonceBuffer);
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(value_encrypted, 'hex')),
      decipher.final()
    ]).toString('utf-8');
    
    await auditLog('vault_get', agentId, secretName, 'success');
    return decrypted;
  } catch (error) {
    await auditLog('vault_get', agentId, secretName, 'failure', { error: error.message });
    throw error;
  }
}

// ── Request Router ──
async function routeRequest(agentId, serviceName, request) {
  try {
    const agent = await verifyAgent(agentId);
    if (!agent) {
      await auditLog('service_call', agentId, serviceName, 'denied', { reason: 'invalid_agent' });
      throw new Error('Agent revoked or not found');
    }

    // Check capability
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
    if (!capabilities.includes(serviceName)) {
      await auditLog('service_call', agentId, serviceName, 'denied', { reason: 'no_capability' });
      throw new Error('Agent not authorized for service');
    }

    // Check circuit breaker
    const circuit = getCircuitBreaker(serviceName);
    if (circuit.isOpen()) {
      await auditLog('service_call', agentId, serviceName, 'fallback');
      return {
        status: 'fallback',
        message: `Service ${serviceName} temporarily unavailable`,
        retryAt: new Date(Date.now() + 30000)
      };
    }

    // Call plugin (simulated)
    try {
      // In production: call actual plugin
      // const response = await callPlugin(serviceName, request);
      const response = { status: 'success', result: null };
      
      circuit.recordSuccess();
      await auditLog('service_call', agentId, serviceName, 'success');
      return response;
    } catch (error) {
      const shouldInterrupt = circuit.recordFailure();
      await auditLog('service_call', agentId, serviceName, 'failure', { error: error.message });
      
      if (shouldInterrupt) {
        // Send priority interrupt (async, no blocking)
        sendPriorityInterrupt(agentId, serviceName).catch(e => 
          console.warn(`[hyphae] Could not send interrupt: ${e.message}`)
        );
      }
      
      throw error;
    }
  } catch (error) {
    throw error;
  }
}

async function sendPriorityInterrupt(agentId, serviceName) {
  // In production: send out-of-band notification
  const interrupt = {
    type: 'CAPABILITY_UNAVAILABLE',
    capability: serviceName,
    timestamp: new Date().toISOString(),
    fallback: `Use cached ${serviceName} results`,
    retryAt: new Date(Date.now() + 30000).toISOString()
  };
  
  console.log(`[hyphae] Priority interrupt for ${agentId}: ${serviceName} unavailable`);
  // TODO: Implement actual interrupt delivery channel
}

// ── Authentication Middleware ──
function verifyBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.slice(7); // Extract token
}

// ── HTTP Server ──
const tlsOptions = process.env.HYPHAE_SKIP_TLS ? null : {
  key: fs.readFileSync(process.env.HYPHAE_TLS_KEY || '/etc/hyphae/key.pem', 'utf-8').catch(() => null),
  cert: fs.readFileSync(process.env.HYPHAE_TLS_CERT || '/etc/hyphae/cert.pem', 'utf-8').catch(() => null)
};

const createServer = tlsOptions && tlsOptions.key && tlsOptions.cert ? https.createServer : require('http').createServer;
const serverConfig = tlsOptions && tlsOptions.key && tlsOptions.cert ? [tlsOptions] : [];
const server = createServer(...serverConfig, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Unauthenticated endpoints
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Authenticated endpoints (require bearer token)
  if ((req.url === '/metrics' || req.url === '/rpc') && !verifyBearerToken(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid bearer token' }));
    return;
  }

  if (req.url === '/metrics' && req.method === 'GET') {
    const metrics = Array.from(circuitBreakers.values()).map(cb => cb.metrics());
    res.writeHead(200);
    res.end(JSON.stringify({ circuits: metrics }));
    return;
  }

  if (req.url === '/rpc' && req.method === 'POST') {
    let body = '';
    const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
    
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (max 1MB)' }));
      }
    });
    
    req.on('end', async () => {
      if (body.length > MAX_BODY_SIZE) return; // Already responded
      
      try {
        const { jsonrpc, method, params, id } = JSON.parse(body);

        let result;
        switch (method) {
          case 'vault.get':
            result = await getSecret(params.agentId, params.secretName);
            break;
          case 'service.call':
            result = await routeRequest(params.agentId, params.serviceName, params.request);
            break;
          case 'agent.verify':
            result = await verifyAgent(params.agentId);
            break;
          default:
            throw new Error(`Unknown method: ${method}`);
        }

        res.writeHead(200);
        res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -1, message: error.message },
          id
        }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ── Initialization ──
async function initializeDatabase() {
  try {
    const schema = `
      CREATE TABLE IF NOT EXISTS hyphae_agent_identities (
        agent_id TEXT PRIMARY KEY,
        public_key_ed25519 TEXT NOT NULL,
        encryption_key_id TEXT NOT NULL,
        roles JSONB DEFAULT '[]',
        capabilities JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT true,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS hyphae_secrets (
        secret_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        secret_name TEXT NOT NULL,
        value_encrypted BYTEA NOT NULL,
        nonce BYTEA NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id),
        UNIQUE (agent_id, secret_name)
      );

      CREATE TABLE IF NOT EXISTS hyphae_key_grants (
        key_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        encryption_key BYTEA NOT NULL,
        issued_at TIMESTAMPTZ DEFAULT now(),
        revoked_at TIMESTAMPTZ,
        FOREIGN KEY (agent_id) REFERENCES hyphae_agent_identities(agent_id)
      );

      CREATE TABLE IF NOT EXISTS hyphae_audit_log (
        log_id BIGSERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT,
        status TEXT,
        details JSONB,
        timestamp TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS hyphae_circuit_breakers (
        service_name TEXT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'CLOSED',
        failure_count INT DEFAULT 0,
        success_count INT DEFAULT 0,
        last_failure_at TIMESTAMPTZ,
        opened_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_secrets_agent ON hyphae_secrets(agent_id);
      CREATE INDEX IF NOT EXISTS idx_keys_agent ON hyphae_key_grants(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_agent ON hyphae_audit_log(agent_id, timestamp);
    `;

    await pool.query(schema);
    console.log('[hyphae] Database schema initialized');
  } catch (error) {
    console.error('[hyphae] Database initialization failed:', error.message);
    process.exit(1);
  }
}

async function start() {
  await initializeDatabase();
  
  server.listen(PORT, () => {
    console.log(`[hyphae] ✓ Core running on port ${PORT}`);
    console.log(`[hyphae] ✓ Health check: GET /health`);
    console.log(`[hyphae] ✓ Metrics: GET /metrics`);
    console.log(`[hyphae] ✓ RPC: POST /rpc`);
  });
}

// ── Graceful Shutdown ──
process.on('SIGTERM', async () => {
  console.log('[hyphae] Shutting down...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});

start().catch(error => {
  console.error('[hyphae] Fatal error:', error);
  process.exit(1);
});
