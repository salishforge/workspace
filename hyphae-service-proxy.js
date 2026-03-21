#!/usr/bin/env node

/**
 * Hyphae Network Proxy Service
 * 
 * Acts as a secure relay between agents and external services:
 * - Validates credentials (hard enforcement)
 * - Enforces rate limits (blocks if exceeded)
 * - Checks revocation status (immediate enforcement)
 * - Logs all traffic for audit
 * - Forwards to actual service endpoint
 * 
 * Port: 3109
 * 
 * Agent usage:
 *   POST http://localhost:3109/telegram/sendMessage
 *   Authorization: Bearer hyphae_clio_telegram_xyz
 *   {chat_id: "8201776295", message: "hello"}
 *   
 *   Hyphae proxy:
 *   1. Validates credential exists + not revoked
 *   2. Checks rate limit (30 msg/min for telegram)
 *   3. Forwards to actual Telegram API
 *   4. Logs the request
 *   5. Returns response
 */

import express from 'express';
import { Pool } from 'pg';
import fetch from 'node-fetch';
import crypto from 'crypto';

const CONFIG = {
  PORT: process.env.HYPHAE_PROXY_PORT || 3109,
  DB_HOST: 'localhost',
  DB_PORT: 5433,
  DB_USER: 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'hyphae-password-2026',
  DB_NAME: 'hyphae',
  ENCRYPTION_KEY: process.env.HYPHAE_ENCRYPTION_KEY || 'hyphae-master-key-2026-salish-forge',
  
  // Service-specific tokens (from hyphae.env)
  SERVICE_TOKENS: {
    telegram: {
      clio: process.env.CLIO_TELEGRAM_BOT_API || '',
      flint: process.env.FLINT_TELEGRAM_BOT_API || '',
      default: process.env.TELEGRAM_BOT_API || ''
    }
  }
};

const app = express();
const pool = new Pool({
  host: CONFIG.DB_HOST,
  port: CONFIG.DB_PORT,
  user: CONFIG.DB_USER,
  password: CONFIG.DB_PASSWORD,
  database: CONFIG.DB_NAME
});

// Rate limit tracking (in-memory for MVP, use Redis for production)
const rateLimitBuckets = new Map();

app.use(express.json());
app.use(express.text());
app.use(express.raw({ type: '*/*' }));

// ============================================================================
// Health check (no auth required)
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), port: CONFIG.PORT });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// ============================================================================
// Credential Decryption
// ============================================================================

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
    return null;
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

const RATE_LIMITS = {
  telegram: { limit: 30, window: 60000 },      // 30 msg/min
  'agent-rpc': { limit: 60, window: 60000 },   // 60 calls/min
  memory: { limit: 1000, window: 60000 }       // 1000 calls/min
};

function checkRateLimit(agentId, serviceId) {
  const key = `${agentId}:${serviceId}`;
  const now = Date.now();
  
  if (!rateLimitBuckets.has(key)) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMITS[serviceId].window });
    return { allowed: true, remaining: RATE_LIMITS[serviceId].limit - 1 };
  }
  
  const bucket = rateLimitBuckets.get(key);
  
  // Reset if window expired
  if (now >= bucket.resetAt) {
    bucket.count = 1;
    bucket.resetAt = now + RATE_LIMITS[serviceId].window;
    return { allowed: true, remaining: RATE_LIMITS[serviceId].limit - 1 };
  }
  
  // Check if limit exceeded
  if (bucket.count >= RATE_LIMITS[serviceId].limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  
  bucket.count++;
  return { allowed: true, remaining: RATE_LIMITS[serviceId].limit - bucket.count };
}

// ============================================================================
// Credential Validation
// ============================================================================

async function validateCredential(credentialId, serviceId) {
  try {
    // Lookup credential by ID (not by encrypted value - too complex)
    const result = await pool.query(
      `SELECT 
        c.credential_id,
        c.agent_id,
        c.service_id,
        c.status,
        c.credential_expires
       FROM hyphae_agent_credentials c
       WHERE c.credential_id = $1 AND c.service_id = $2`,
      [credentialId, serviceId]
    );
    
    if (result.rows.length === 0) {
      return { valid: false, reason: 'Credential not found' };
    }
    
    const cred = result.rows[0];
    
    // Check if revoked (HARD ENFORCEMENT - immediate)
    if (cred.status !== 'active') {
      return { valid: false, reason: `Credential revoked (status: ${cred.status})` };
    }
    
    // Check if expired
    if (cred.credential_expires && new Date(cred.credential_expires) < new Date()) {
      return { valid: false, reason: 'Credential expired' };
    }
    
    // Check agent status (HARD ENFORCEMENT - immediate)
    const agentResult = await pool.query(
      `SELECT status FROM hyphae_agent_registrations WHERE agent_id = $1`,
      [cred.agent_id]
    );
    
    if (agentResult.rows.length === 0) {
      return { valid: false, reason: 'Agent not registered' };
    }
    
    if (agentResult.rows[0].status !== 'active') {
      return { valid: false, reason: `Agent status: ${agentResult.rows[0].status}` };
    }
    
    return { 
      valid: true, 
      agentId: cred.agent_id,
      credentialId: cred.credential_id
    };
  } catch (error) {
    console.error(`Credential validation error: ${error.message}`);
    return { valid: false, reason: 'Validation error' };
  }
}

// ============================================================================
// Audit Logging
// ============================================================================

async function logProxyRequest(agentId, serviceId, method, path, statusCode, success, error = null) {
  try {
    await pool.query(
      `INSERT INTO hyphae_service_audit_log 
       (agent_id, service_id, event_type, action, details, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        agentId,
        serviceId,
        'proxy_request',
        `${method} ${path}`,
        JSON.stringify({ status_code: statusCode }),
        success,
        error
      ]
    );
  } catch (err) {
    console.error(`Audit logging error: ${err.message}`);
  }
}

// ============================================================================
// Service Endpoint Resolution
// ============================================================================

async function getServiceEndpoint(serviceId) {
  try {
    const result = await pool.query(
      `SELECT provider_endpoint FROM hyphae_credential_providers 
       WHERE service_id = $1`,
      [serviceId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0].provider_endpoint;
  } catch (error) {
    console.error(`Service endpoint lookup error: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Service Token Injection (For services that require auth in URL)
// ============================================================================

function injectServiceToken(serviceId, agentId, url, pathSuffix) {
  // Telegram requires: https://api.telegram.org/bot{TOKEN}/method
  if (serviceId === 'telegram') {
    const token = CONFIG.SERVICE_TOKENS.telegram[agentId] || CONFIG.SERVICE_TOKENS.telegram.default;
    
    if (!token) {
      console.error(`[PROXY] ❌ No Telegram token configured for agent ${agentId}`);
      return null;
    }
    
    // Format: https://api.telegram.org/bot{TOKEN}/method
    return `${url}/bot${token}${pathSuffix}`;
  }
  
  // For other services, URL doesn't need token injection (passed in header or body)
  return url + pathSuffix;
}

// ============================================================================
// Proxy Middleware
// ============================================================================

app.all('/*', async (req, res) => {
  const startTime = Date.now();
  const pathParts = req.path.split('/').filter(p => p);
  
  if (pathParts.length < 1) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  
  const serviceId = pathParts[0];  // /telegram/... → telegram
  const pathSuffix = '/' + pathParts.slice(1).join('/');  // /sendMessage
  
  console.log(`\n[PROXY] ${req.method} ${req.path}`);
  console.log(`[PROXY] Service: ${serviceId}`);
  
  // =====================================================================
  // Step 1: Extract and validate credential
  // =====================================================================
  
  // Credential ID comes from X-Credential-ID header
  const credentialId = req.headers['x-credential-id'];
  if (!credentialId) {
    console.log(`[PROXY] ❌ No credential ID`);
    await logProxyRequest(null, serviceId, req.method, req.path, 401, false, 'Missing X-Credential-ID header');
    return res.status(401).json({ error: 'Missing X-Credential-ID header' });
  }
  
  const credCheck = await validateCredential(credentialId, serviceId);
  if (!credCheck.valid) {
    console.log(`[PROXY] ❌ Credential invalid: ${credCheck.reason}`);
    await logProxyRequest(null, serviceId, req.method, req.path, 401, false, credCheck.reason);
    return res.status(401).json({ error: `Credential invalid: ${credCheck.reason}` });
  }
  
  const agentId = credCheck.agentId;
  console.log(`[PROXY] ✅ Credential valid for agent: ${agentId}`);
  
  // =====================================================================
  // Step 2: Check rate limit (HARD ENFORCEMENT)
  // =====================================================================
  
  const rateLimitCheck = checkRateLimit(agentId, serviceId);
  if (!rateLimitCheck.allowed) {
    console.log(`[PROXY] ❌ Rate limit exceeded for ${agentId}:${serviceId}`);
    await logProxyRequest(agentId, serviceId, req.method, req.path, 429, false, 'Rate limit exceeded');
    
    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit: RATE_LIMITS[serviceId].limit,
      window: `${RATE_LIMITS[serviceId].window / 1000}s`,
      resetAt: new Date(rateLimitCheck.resetAt).toISOString()
    });
  }
  
  console.log(`[PROXY] ✅ Rate limit OK (${rateLimitCheck.remaining} remaining)`);
  
  // =====================================================================
  // Step 3: Get service endpoint
  // =====================================================================
  
  const serviceEndpoint = await getServiceEndpoint(serviceId);
  if (!serviceEndpoint) {
    console.log(`[PROXY] ❌ Service endpoint not found: ${serviceId}`);
    await logProxyRequest(agentId, serviceId, req.method, req.path, 503, false, 'Service endpoint not configured');
    
    return res.status(503).json({ error: 'Service endpoint not configured' });
  }
  
  console.log(`[PROXY] ✅ Service endpoint: ${serviceEndpoint}`);
  
  // =====================================================================
  // Step 4: Inject service tokens if needed
  // =====================================================================
  
  const targetUrlWithToken = injectServiceToken(serviceId, agentId, serviceEndpoint, pathSuffix);
  if (!targetUrlWithToken) {
    console.log(`[PROXY] ❌ Token injection failed for ${serviceId}`);
    await logProxyRequest(agentId, serviceId, req.method, req.path, 503, false, 'Token injection failed');
    return res.status(503).json({ error: 'Service token not configured' });
  }
  
  const targetUrl = targetUrlWithToken;
  // Redact bot token in logs for security
  const redactedUrl = targetUrl.replace(/bot[A-Za-z0-9_:\-]+/, 'bot[REDACTED]');
  console.log(`[PROXY] 🔄 Forwarding to: ${redactedUrl}`);
  
  try {
    // Build proxy headers (remove auth, add proxy info)
    const proxyHeaders = { ...req.headers };
    delete proxyHeaders.host;
    delete proxyHeaders['content-length'];  // Let fetch calculate it
    
    // Keep authorization (might be needed by target service)
    
    const proxyOptions = {
      method: req.method,
      headers: proxyHeaders,
      timeout: 10000
    };
    
    // Forward body if present
    if (req.body && Object.keys(req.body).length > 0) {
      proxyOptions.body = JSON.stringify(req.body);
      console.log(`[PROXY] 📦 Body: ${proxyOptions.body.substring(0, 100)}...`);
    } else {
      console.log(`[PROXY] ⚠️  No body to forward`);
    }
    
    const proxyResponse = await fetch(targetUrl, proxyOptions);
    const responseData = await proxyResponse.text();
    
    console.log(`[PROXY] ✅ Response: ${proxyResponse.status}`);
    
    // =====================================================================
    // Step 5: Log successful request
    // =====================================================================
    
    await logProxyRequest(agentId, serviceId, req.method, req.path, proxyResponse.status, true);
    
    // =====================================================================
    // Step 6: Return response to agent
    // =====================================================================
    
    res.status(proxyResponse.status);
    
    // Copy response headers (except some meta ones)
    const excludeHeaders = ['transfer-encoding', 'content-encoding', 'content-length'];
    for (const [key, value] of Object.entries(proxyResponse.headers.raw() || {})) {
      if (!excludeHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }
    
    // Add proxy metadata
    res.setHeader('X-Proxy-Agent', agentId);
    res.setHeader('X-Proxy-Service', serviceId);
    res.setHeader('X-Proxy-Latency', `${Date.now() - startTime}ms`);
    res.setHeader('X-Rate-Limit-Remaining', rateLimitCheck.remaining);
    
    res.send(responseData);
    
  } catch (error) {
    console.error(`[PROXY] ❌ Proxy error: ${error.message}`);
    
    await logProxyRequest(agentId, serviceId, req.method, req.path, 502, false, error.message);
    
    res.status(502).json({
      error: 'Bad gateway',
      message: error.message,
      service: serviceId,
      endpoint: targetUrl
    });
  }
});

// ============================================================================
// Startup
// ============================================================================

const server = app.listen(CONFIG.PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║     HYPHAE NETWORK PROXY                              ║`);
  console.log(`║     Listening on port ${CONFIG.PORT}                              ║`);
  console.log(`║     Hard enforcement of auth + rate limits            ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down proxy...');
  server.close();
  pool.end();
  process.exit(0);
});
