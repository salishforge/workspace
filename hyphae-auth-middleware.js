/**
 * Hyphae Authentication Middleware
 * 
 * Validate API keys, rate limiting, audit logging
 * - Authenticate RPC calls
 * - Rate limiting per agent
 * - Audit trail
 * - Quota tracking
 */

import { SecretsManager } from './hyphae-secrets-manager.js';

export class AuthMiddleware {
  constructor() {
    this.rateLimits = new Map(); // agent_id -> { count, resetAt }
    this.requestsPerMinute = 60; // Per-agent limit
  }

  /**
   * Authenticate RPC call
   */
  async authenticate(pool, apiKey) {
    if (!apiKey) {
      return { authenticated: false, error: 'Missing API key' };
    }

    const validation = await SecretsManager.validateKey(pool, apiKey);

    if (!validation.valid) {
      console.log(`[auth] Authentication failed: ${validation.error}`);
      return { authenticated: false, error: validation.error };
    }

    console.log(`[auth] ✅ Authentication successful: ${validation.agentId}`);
    return {
      authenticated: true,
      agentId: validation.agentId,
      metadata: validation.metadata
    };
  }

  /**
   * Check rate limit for agent
   */
  checkRateLimit(agentId) {
    const now = Date.now();
    const limit = this.rateLimits.get(agentId) || { count: 0, resetAt: now + 60000 };

    // Reset if window expired
    if (now > limit.resetAt) {
      limit.count = 0;
      limit.resetAt = now + 60000;
    }

    limit.count++;

    if (limit.count > this.requestsPerMinute) {
      this.rateLimits.set(agentId, limit);
      return { allowed: false, remaining: 0, resetAt: limit.resetAt };
    }

    this.rateLimits.set(agentId, limit);
    return {
      allowed: true,
      remaining: this.requestsPerMinute - limit.count,
      resetAt: limit.resetAt
    };
  }

  /**
   * Log audit trail
   */
  async logAuditEvent(pool, agentId, method, params, success = true) {
    try {
      await pool.query(
        `INSERT INTO hyphae_auth_audit_log 
         (agent_id, method, params, success, timestamp)
         VALUES ($1, $2, $3, $4, NOW())`,
        [agentId, method, JSON.stringify(params), success]
      );
    } catch (error) {
      console.error(`[auth] Audit log error: ${error.message}`);
    }
  }

  /**
   * Initialize auth database schema
   */
  static async initializeSchema(pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_auth_audit_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL,
          method TEXT NOT NULL,
          params JSONB,
          success BOOLEAN DEFAULT true,
          timestamp TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_auth_audit_agent ON hyphae_auth_audit_log(agent_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_auth_audit_method ON hyphae_auth_audit_log(method, timestamp DESC);
      `);

      console.log('[auth] ✅ Audit schema initialized');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      console.log('[auth] ✅ Audit schema already exists');
    }
  }
}

export default AuthMiddleware;
