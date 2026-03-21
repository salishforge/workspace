#!/usr/bin/env node

/**
 * Hyphae Service Registry
 * 
 * Manages service definitions, agent registration, credential issuance,
 * and policy enforcement for the Hyphae multi-agent coordination platform.
 * 
 * Endpoints:
 * - POST /agent/register - Register new agent with Hyphae
 * - GET /agent/{agent_id}/services - List available services for agent
 * - GET /service/{service_id}/schema - Get service definition and training material
 * - POST /credential/{agent_id}/{service_id}/request - Request credential for service
 * - POST /credential/{agent_id}/{service_id}/revoke - Revoke agent's credential
 * - GET /audit/agent/{agent_id} - Get audit log for agent
 */

import express from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment configuration
const CONFIG = {
  PORT: process.env.HYPHAE_REGISTRY_PORT || 3108,
  DB_HOST: 'localhost',
  DB_PORT: 5433,
  DB_USER: 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'hyphae-password-2026',
  DB_NAME: 'hyphae',
  ENCRYPTION_KEY: process.env.HYPHAE_ENCRYPTION_KEY || 'hyphae-master-key-2026-salish-forge', // Should be env var!
};

const app = express();
const pool = new Pool({
  host: CONFIG.DB_HOST,
  port: CONFIG.DB_PORT,
  user: CONFIG.DB_USER,
  password: CONFIG.DB_PASSWORD,
  database: CONFIG.DB_NAME
});

app.use(express.json());

// ============================================================================
// Encryption/Decryption Utilities
// ============================================================================

function encryptCredential(plaintext, keyVersion = 'v1') {
  const iv = crypto.randomBytes(16);
  const salt = crypto.randomBytes(32);
  
  // Derive key from master secret
  const key = crypto.pbkdf2Sync(CONFIG.ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return: iv.authTag.salt.ciphertext (all hex encoded for storage)
  const result = `${iv.toString('hex')}.${authTag.toString('hex')}.${salt.toString('hex')}.${encrypted}`;
  
  return result;
}

function decryptCredential(encrypted) {
  try {
    const parts = encrypted.split('.');
    if (parts.length !== 4) throw new Error('Invalid credential format');
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const salt = Buffer.from(parts[2], 'hex');
    const ciphertext = parts[3];
    
    const key = crypto.pbkdf2Sync(CONFIG.ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error(`Decryption error: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Audit Logging
// ============================================================================

async function logAudit(agentId, serviceId, eventType, action, details = {}, success = true, errorMsg = null) {
  try {
    await pool.query(
      `INSERT INTO hyphae_service_audit_log 
       (agent_id, service_id, event_type, action, details, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        agentId,
        serviceId,
        eventType,
        action,
        JSON.stringify(details),
        success,
        errorMsg
      ]
    );
  } catch (error) {
    console.error(`Audit logging error: ${error.message}`);
  }
}

// ============================================================================
// Policy Evaluation
// ============================================================================

async function evaluatePolicy(agentId, serviceId) {
  try {
    const result = await pool.query(
      `SELECT * FROM hyphae_agent_policies 
       WHERE agent_id = $1 AND service_id = $2 
       AND (valid_until IS NULL OR valid_until > NOW())`,
      [agentId, serviceId]
    );
    
    if (result.rows.length === 0) {
      // No explicit policy - deny by default
      return { authorized: false, reason: 'No policy found' };
    }
    
    const policy = result.rows[0];
    
    // Check if explicitly authorized
    if (!policy.authorized) {
      return { authorized: false, reason: 'Access denied by policy', policy };
    }
    
    // Check if agent is registered and active
    const agentCheck = await pool.query(
      `SELECT status FROM hyphae_agent_registrations WHERE agent_id = $1`,
      [agentId]
    );
    
    if (agentCheck.rows.length === 0) {
      return { authorized: false, reason: 'Agent not registered', policy };
    }
    
    const agent = agentCheck.rows[0];
    if (agent.status !== 'active') {
      return { authorized: false, reason: `Agent status is ${agent.status}`, policy };
    }
    
    return { authorized: true, policy };
  } catch (error) {
    console.error(`Policy evaluation error: ${error.message}`);
    return { authorized: false, reason: error.message };
  }
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * POST /agent/register
 * Register a new agent with Hyphae
 */
app.post('/agent/register', async (req, res) => {
  const { agent_id, agent_name, agent_type, contact_email, contact_telegram } = req.body;
  
  if (!agent_id) {
    return res.status(400).json({ error: 'agent_id required' });
  }
  
  try {
    // Generate master key for agent
    const masterKey = crypto.randomBytes(32).toString('hex');
    const masterKeyEncrypted = encryptCredential(masterKey);
    
    // Insert agent registration
    const result = await pool.query(
      `INSERT INTO hyphae_agent_registrations 
       (agent_id, agent_name, agent_type, contact_email, contact_telegram, master_key_encrypted, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (agent_id) DO UPDATE SET 
         status = 'active',
         last_accessed_at = NOW()
       RETURNING *`,
      [agent_id, agent_name || agent_id, agent_type || 'reasoning', contact_email, contact_telegram, masterKeyEncrypted]
    );
    
    const agent = result.rows[0];
    
    // Create default policies for all active services
    const servicesResult = await pool.query(
      `SELECT service_id FROM hyphae_services WHERE status = 'active'`
    );
    
    for (const service of servicesResult.rows) {
      await pool.query(
        `INSERT INTO hyphae_agent_policies (agent_id, service_id, authorized)
         VALUES ($1, $2, true)
         ON CONFLICT DO NOTHING`,
        [agent_id, service.service_id]
      );
    }
    
    // Get available services
    const servicesAvailable = await pool.query(
      `SELECT service_id, name FROM hyphae_services 
       WHERE status = 'active' LIMIT 10`
    );
    
    // Log registration (system event, no service)
    await pool.query(
      `INSERT INTO hyphae_service_audit_log 
       (agent_id, service_id, event_type, action, details, success)
       VALUES ($1, NULL, $2, $3, $4, true)`,
      [agent_id, 'agent_registered', 'Registration successful', JSON.stringify({ agent_name, agent_type })]
    );
    
    res.status(201).json({
      status: 'registered',
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      agent_type: agent.agent_type,
      hyphae_url: 'http://100.97.161.7:3100',
      registry_url: 'http://100.97.161.7:3108',
      master_key: masterKey,  // WARNING: Only show once!
      available_services: servicesAvailable.rows.map(s => ({
        service_id: s.service_id,
        name: s.name,
        requires_credential: true,
        schema_endpoint: `/service/${s.service_id}/schema`,
        credential_endpoint: `/credential/${agent_id}/${s.service_id}/request`
      })),
      next_steps: [
        '1. Save your master_key (shown only once)',
        '2. For each service, call GET /service/{service_id}/schema to learn how to use it',
        '3. Call POST /credential/{agent_id}/{service_id}/request to get credentials',
        '4. Use credentials with the service directly (Hyphae not in data path)'
      ]
    });
  } catch (error) {
    console.error(`Registration error: ${error.message}`);
    await logAudit(agent_id, 'hyphae', 'agent_registration_failed', error.message, {}, false, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /agent/{agent_id}/services
 * List available services for an agent
 */
app.get('/agent/:agent_id/services', async (req, res) => {
  const { agent_id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT DISTINCT s.service_id, s.name, s.description, s.version, ap.authorized
       FROM hyphae_services s
       LEFT JOIN hyphae_agent_policies ap ON (ap.service_id = s.service_id AND ap.agent_id = $1)
       WHERE s.status = 'active'
       ORDER BY s.name`,
      [agent_id]
    );
    
    const services = result.rows.map(s => ({
      service_id: s.service_id,
      name: s.name,
      description: s.description,
      version: s.version,
      authorized: s.authorized !== false,
      schema_url: `/service/${s.service_id}/schema`,
      credential_request_url: `/credential/${agent_id}/${s.service_id}/request`
    }));
    
    res.json({ agent_id, available_services: services });
  } catch (error) {
    console.error(`Service list error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /service/{service_id}/schema
 * Get service definition, training material, and examples
 */
app.get('/service/:service_id/schema', async (req, res) => {
  const { service_id } = req.params;
  
  try {
    // Get service definition
    const serviceResult = await pool.query(
      `SELECT * FROM hyphae_services WHERE service_id = $1`,
      [service_id]
    );
    
    if (serviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    const service = serviceResult.rows[0];
    
    // Get training material
    const trainingResult = await pool.query(
      `SELECT * FROM hyphae_service_training WHERE service_id = $1`,
      [service_id]
    );
    
    const training = trainingResult.rows.length > 0 ? trainingResult.rows[0] : null;
    
    // Get API examples
    const examplesResult = await pool.query(
      `SELECT * FROM hyphae_service_api_examples WHERE service_id = $1 ORDER BY created_at`,
      [service_id]
    );
    
    const examples = examplesResult.rows;
    
    res.json({
      service: {
        service_id: service.service_id,
        name: service.name,
        description: service.description,
        version: service.version,
        auth_method: service.auth_method,
        status: service.status,
        category: service.category
      },
      training: training ? {
        system_prompt_section: training.system_prompt_section,
        rate_limits: training.rate_limits,
        acceptable_use: training.acceptable_use,
        restrictions: training.restrictions
      } : null,
      api_examples: examples.map(e => ({
        method: e.method_name,
        description: e.description,
        request: e.example_request,
        response: e.example_response,
        notes: e.notes
      }))
    });
  } catch (error) {
    console.error(`Schema retrieval error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /credential/{agent_id}/{service_id}/request
 * Request credential for a service
 */
app.post('/credential/:agent_id/:service_id/request', async (req, res) => {
  const { agent_id, service_id } = req.params;
  
  try {
    // Evaluate policy
    const policyCheck = await evaluatePolicy(agent_id, service_id);
    if (!policyCheck.authorized) {
      await logAudit(agent_id, service_id, 'credential_request_denied', policyCheck.reason, {}, false);
      return res.status(403).json({ error: `Credential request denied: ${policyCheck.reason}` });
    }
    
    // Check if credential already exists
    const existingResult = await pool.query(
      `SELECT credential_id, credential_expires FROM hyphae_agent_credentials 
       WHERE agent_id = $1 AND service_id = $2 AND status = 'active'`,
      [agent_id, service_id]
    );
    
    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      
      // If still valid, return it
      if (!existing.credential_expires || new Date(existing.credential_expires) > new Date()) {
        await logAudit(agent_id, service_id, 'credential_retrieved', 'Used existing credential', {}, true);
        
        return res.json({
          status: 'success',
          message: 'Credential already issued and valid',
          credential_id: existing.credential_id,
          get_credential_endpoint: `/credential/${existing.credential_id}`,
          note: 'Call the endpoint to retrieve the actual credential'
        });
      }
    }
    
    // Generate new credential (API key format)
    const credentialValue = `hyphae_${agent_id}_${service_id}_${crypto.randomBytes(16).toString('hex')}`;
    const credentialEncrypted = encryptCredential(credentialValue);
    
    // Insert credential
    const credResult = await pool.query(
      `INSERT INTO hyphae_agent_credentials 
       (agent_id, service_id, credential_encrypted, credential_type, issued_at, issued_by)
       VALUES ($1, $2, $3, 'api_key', NOW(), 'registry')
       RETURNING credential_id, issued_at, credential_expires`,
      [agent_id, service_id, credentialEncrypted]
    );
    
    const credentialId = credResult.rows[0].credential_id;
    
    await logAudit(agent_id, service_id, 'credential_issued', 'New credential generated', 
      { credential_id: credentialId }, true);
    
    res.status(201).json({
      status: 'success',
      message: 'Credential issued',
      credential_id: credentialId,  // Include ID for proxy requests
      credential_value: credentialValue,  // Only shown once!
      agent_id,
      service_id,
      issued_at: new Date().toISOString(),
      expires_at: null,
      // Agents use the Hyphae proxy endpoint for hard enforcement
      proxy_endpoint: 'http://localhost:3109',
      usage: {
        format: `POST http://localhost:3109/${service_id}/<method>`,
        headers: {
          'Content-Type': 'application/json',
          'X-Credential-ID': credentialId.toString(),
          'Authorization': `Bearer ${credentialValue}`  // For future use
        },
        example: `POST http://localhost:3109/${service_id}/sendMessage`,
        example_headers: {
          'X-Credential-ID': credentialId.toString(),
          'Content-Type': 'application/json'
        },
        note: 'All requests go through Hyphae proxy for hard rate limiting + revocation enforcement'
      },
      rate_limit: {
        telegram: '30 messages/minute',
        'agent-rpc': '60 calls/minute',
        memory: '1000 calls/minute'
      },
      important: [
        'Save credential_id and credential_value immediately.',
        'Include X-Credential-ID header in all proxy requests.',
        'credential_id enables hard revocation enforcement.',
        'These values will not be shown again.'
      ]
    });
  } catch (error) {
    console.error(`Credential request error: ${error.message}`);
    await logAudit(agent_id, service_id, 'credential_request_failed', error.message, {}, false, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /credential/{agent_id}/{service_id}/revoke
 * Revoke agent's credential for a service
 */
app.post('/credential/:agent_id/:service_id/revoke', async (req, res) => {
  const { agent_id, service_id } = req.params;
  const { reason } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE hyphae_agent_credentials
       SET status = 'revoked', revoked_at = NOW(), revoked_reason = $3
       WHERE agent_id = $1 AND service_id = $2 AND status = 'active'
       RETURNING credential_id`,
      [agent_id, service_id, reason || 'Manual revocation']
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active credential found' });
    }
    
    await logAudit(agent_id, service_id, 'credential_revoked', reason || 'Manual revocation', {}, true);
    
    res.json({
      status: 'revoked',
      agent_id,
      service_id,
      message: 'Credential revoked successfully'
    });
  } catch (error) {
    console.error(`Credential revoke error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /audit/{agent_id}
 * Get audit log for an agent
 */
app.get('/audit/:agent_id', async (req, res) => {
  const { agent_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '50'), 500);
  
  try {
    const result = await pool.query(
      `SELECT audit_id, event_type, action, details, success, error_message, created_at 
       FROM hyphae_service_audit_log 
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agent_id, limit]
    );
    
    res.json({
      agent_id,
      audit_entries: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error(`Audit retrieval error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// ============================================================================
// Startup
// ============================================================================

const server = app.listen(CONFIG.PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║     HYPHAE SERVICE REGISTRY                            ║`);
  console.log(`║     Listening on port ${CONFIG.PORT}                              ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  server.close();
  pool.end();
  process.exit(0);
});
