/**
 * Hyphae Agent Registry
 * 
 * Register agents, issue credentials, track metadata
 * - Agent registration
 * - Credential issuance
 * - Metadata tracking
 * - Agent discovery
 */

import { SecretsManager } from './hyphae-secrets-manager.js';

export class AgentRegistry {
  /**
   * Register new agent with Hyphae
   */
  static async registerAgent(pool, agentId, metadata = {}) {
    try {
      // Check if already registered
      const existing = await pool.query(
        `SELECT id FROM hyphae_registered_agents WHERE agent_id = $1`,
        [agentId]
      );

      if (existing.rows.length > 0) {
        return { error: `Agent ${agentId} already registered` };
      }

      // Generate API key
      const apiKey = SecretsManager.generateApiKey(agentId);

      // Store in secrets manager
      await SecretsManager.storeKey(pool, agentId, apiKey, metadata);

      // Register agent
      const result = await pool.query(
        `INSERT INTO hyphae_registered_agents 
         (agent_id, metadata, status, registered_at)
         VALUES ($1, $2, 'active', NOW())
         RETURNING id, registered_at`,
        [agentId, JSON.stringify(metadata)]
      );

      console.log(`[registry] Agent registered: ${agentId}`);

      return {
        agent_id: agentId,
        api_key: apiKey,
        status: 'active',
        registered_at: result.rows[0].registered_at
      };
    } catch (error) {
      console.error(`[registry] Registration error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Get agent registration details
   */
  static async getAgent(pool, agentId) {
    try {
      const result = await pool.query(
        `SELECT agent_id, metadata, status, registered_at, last_activity
         FROM hyphae_registered_agents
         WHERE agent_id = $1`,
        [agentId]
      );

      if (!result.rows.length) {
        return null;
      }

      const row = result.rows[0];
      return {
        agent_id: row.agent_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        status: row.status,
        registered_at: row.registered_at,
        last_activity: row.last_activity
      };
    } catch (error) {
      console.error(`[registry] Get error: ${error.message}`);
      return null;
    }
  }

  /**
   * List all registered agents
   */
  static async listAgents(pool) {
    try {
      const result = await pool.query(
        `SELECT agent_id, metadata, status, registered_at, last_activity
         FROM hyphae_registered_agents
         ORDER BY registered_at DESC`
      );

      return result.rows.map(row => ({
        agent_id: row.agent_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        status: row.status,
        registered_at: row.registered_at,
        last_activity: row.last_activity
      }));
    } catch (error) {
      console.error(`[registry] List error: ${error.message}`);
      return [];
    }
  }

  /**
   * Update agent metadata
   */
  static async updateAgent(pool, agentId, metadata) {
    try {
      const result = await pool.query(
        `UPDATE hyphae_registered_agents
         SET metadata = $1, last_activity = NOW()
         WHERE agent_id = $2
         RETURNING metadata, last_activity`,
        [JSON.stringify(metadata), agentId]
      );

      if (!result.rows.length) {
        return { error: `Agent ${agentId} not found` };
      }

      console.log(`[registry] Agent updated: ${agentId}`);
      return { success: true, metadata: JSON.parse(result.rows[0].metadata) };
    } catch (error) {
      console.error(`[registry] Update error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Deactivate agent
   */
  static async deactivateAgent(pool, agentId) {
    try {
      await pool.query(
        `UPDATE hyphae_registered_agents
         SET status = 'inactive', last_activity = NOW()
         WHERE agent_id = $1`,
        [agentId]
      );

      console.log(`[registry] Agent deactivated: ${agentId}`);
      return { success: true };
    } catch (error) {
      console.error(`[registry] Deactivation error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Initialize registry database schema
   */
  static async initializeSchema(pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_registered_agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT UNIQUE NOT NULL,
          metadata JSONB,
          status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
          registered_at TIMESTAMPTZ DEFAULT NOW(),
          last_activity TIMESTAMPTZ
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_registered_agents_id ON hyphae_registered_agents(agent_id);
        CREATE INDEX IF NOT EXISTS idx_registered_agents_status ON hyphae_registered_agents(status);
      `);

      console.log('[registry] ✅ Schema initialized');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      console.log('[registry] ✅ Schema already exists');
    }
  }
}

export default AgentRegistry;
