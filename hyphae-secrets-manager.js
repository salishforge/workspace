/**
 * Hyphae Secrets Manager
 * 
 * Secure credential generation, storage, and governance
 * - Generate API keys
 * - Encrypt/decrypt credentials
 * - Track key usage and rotation
 * - Revoke compromised keys
 */

import crypto from 'crypto';

// Ensure encryption key is exactly 32 bytes (256 bits) for AES-256
const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY || 'hyphae-encryption-key-2026-32-char-minimum-required').padEnd(32, '0').substring(0, 32);
const ALGORITHM = 'aes-256-gcm';

export class SecretsManager {
  /**
   * Generate secure API key
   * Format: hyphae_<agent_id>_<random_32_chars>
   */
  static generateApiKey(agentId) {
    const random = crypto.randomBytes(24).toString('hex'); // 48 chars
    return `hyphae_${agentId}_${random}`;
  }

  /**
   * Encrypt sensitive data
   */
  static encrypt(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt sensitive data
   */
  static decrypt(encryptedData) {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY),
      Buffer.from(encryptedData.iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Store API key in database
   */
  static async storeKey(pool, agentId, apiKey, metadata = {}) {
    try {
      const encrypted = this.encrypt(apiKey);

      const result = await pool.query(
        `INSERT INTO hyphae_agent_api_keys 
         (agent_id, api_key_encrypted, iv, auth_tag, metadata, status, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW() + INTERVAL '365 days')
         RETURNING id, created_at`,
        [
          agentId,
          encrypted.encrypted,
          encrypted.iv,
          encrypted.authTag,
          JSON.stringify(metadata)
        ]
      );

      console.log(`[secrets] Generated API key for ${agentId}`);
      return result.rows[0];
    } catch (error) {
      console.error(`[secrets] Key storage error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate API key
   */
  static async validateKey(pool, apiKey) {
    try {
      // Extract agent ID from key format
      const parts = apiKey.split('_');
      if (parts.length !== 3 || parts[0] !== 'hyphae') {
        return { valid: false, error: 'Invalid key format' };
      }

      const agentId = parts[1];

      const result = await pool.query(
        `SELECT id, agent_id, api_key_encrypted, iv, auth_tag, status, expires_at, last_used_at
         FROM hyphae_agent_api_keys
         WHERE agent_id = $1 AND status = 'active' AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [agentId]
      );

      if (!result.rows.length) {
        return { valid: false, error: 'Key not found or expired' };
      }

      const row = result.rows[0];
      const encryptedData = {
        encrypted: row.api_key_encrypted,
        iv: row.iv,
        authTag: row.auth_tag
      };

      const decrypted = this.decrypt(encryptedData);

      if (decrypted !== apiKey) {
        return { valid: false, error: 'Key mismatch' };
      }

      // Update last_used_at
      await pool.query(
        `UPDATE hyphae_agent_api_keys SET last_used_at = NOW() WHERE id = $1`,
        [row.id]
      );

      return {
        valid: true,
        agentId: row.agent_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      };
    } catch (error) {
      console.error(`[secrets] Validation error: ${error.message}`);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Revoke API key
   */
  static async revokeKey(pool, apiKey) {
    try {
      await pool.query(
        `UPDATE hyphae_agent_api_keys 
         SET status = 'revoked', revoked_at = NOW()
         WHERE api_key_encrypted = (
           SELECT api_key_encrypted FROM hyphae_agent_api_keys 
           WHERE agent_id = (
             SELECT agent_id FROM hyphae_agent_api_keys 
             LIMIT 1
           ) LIMIT 1
         )`,
        []
      );

      console.log(`[secrets] Key revoked`);
      return { success: true };
    } catch (error) {
      console.error(`[secrets] Revocation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get agent's current API key
   */
  static async getAgentKey(pool, agentId) {
    try {
      const result = await pool.query(
        `SELECT api_key_encrypted, iv, auth_tag, status, expires_at
         FROM hyphae_agent_api_keys
         WHERE agent_id = $1 AND status = 'active' AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [agentId]
      );

      if (!result.rows.length) {
        return null;
      }

      const row = result.rows[0];
      const encryptedData = {
        encrypted: row.api_key_encrypted,
        iv: row.iv,
        authTag: row.auth_tag
      };

      return this.decrypt(encryptedData);
    } catch (error) {
      console.error(`[secrets] Get key error: ${error.message}`);
      return null;
    }
  }

  /**
   * Initialize secrets database schema
   */
  static async initializeSchema(pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_agent_api_keys (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL,
          api_key_encrypted TEXT NOT NULL,
          iv TEXT NOT NULL,
          auth_tag TEXT NOT NULL,
          metadata JSONB,
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON hyphae_agent_api_keys(agent_id, status);
        CREATE INDEX IF NOT EXISTS idx_agent_api_keys_status ON hyphae_agent_api_keys(status, expires_at DESC);
      `);

      console.log('[secrets] ✅ Schema initialized');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      console.log('[secrets] ✅ Schema already exists');
    }
  }
}

export default SecretsManager;
