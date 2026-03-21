/**
 * Hyphae Agent Bootstrap Protocol
 * 
 * Onboard agents, distribute credentials, establish communication
 * - Bootstrap agents on startup
 * - Distribute API keys securely
 * - Send service catalog
 * - Verify connectivity
 */

import fetch from 'node-fetch';
import { AgentRegistry } from './hyphae-agent-registry.js';

export class AgentBootstrap {
  constructor(hyphaeCoreUrl = 'http://localhost:3100') {
    this.hyphaeCoreUrl = hyphaeCoreUrl;
  }

  /**
   * Service catalog that agents receive
   */
  getServiceCatalog() {
    return {
      version: '1.0',
      services: {
        'agent.sendMessage': {
          description: 'Send message to another agent',
          endpoint: '/rpc',
          method: 'agent.sendMessage',
          params: ['from_agent_id', 'to_agent_id', 'message', 'context?', 'priority?'],
          rate_limit: '60 per minute',
          authentication: 'required',
          example: {
            method: 'agent.sendMessage',
            params: {
              from_agent_id: 'flint',
              to_agent_id: 'clio',
              message: 'Cost spike detected. Need operational guidance.',
              context: { incident_type: 'cost_spike', amount: 250 },
              priority: 'urgent'
            }
          }
        },
        'agent.getMessages': {
          description: 'Retrieve pending messages from other agents',
          endpoint: '/rpc',
          method: 'agent.getMessages',
          params: ['agent_id', 'limit?', 'status?'],
          rate_limit: '60 per minute',
          authentication: 'required',
          example: {
            method: 'agent.getMessages',
            params: { agent_id: 'clio', limit: 10 }
          }
        },
        'agent.ackMessage': {
          description: 'Acknowledge message receipt',
          endpoint: '/rpc',
          method: 'agent.ackMessage',
          params: ['message_id', 'processed_by'],
          authentication: 'required'
        },
        'agent.discoverCapabilities': {
          description: 'Discover other agents and their capabilities',
          endpoint: '/rpc',
          method: 'agent.discoverCapabilities',
          params: ['requesting_agent'],
          authentication: 'required'
        },
        'agent.getConversationHistory': {
          description: 'Retrieve past exchanges with another agent',
          endpoint: '/rpc',
          method: 'agent.getConversationHistory',
          params: ['agent_1', 'agent_2', 'limit?'],
          authentication: 'required'
        }
      },
      authentication: {
        type: 'Bearer Token (API Key)',
        header: 'Authorization: Bearer <api_key>',
        format: 'hyphae_<agent_id>_<random>'
      },
      base_url: this.hyphaeCoreUrl,
      rpc_endpoint: `${this.hyphaeCoreUrl}/rpc`
    };
  }

  /**
   * Bootstrap an agent
   * 1. Register with Hyphae
   * 2. Get API key
   * 3. Receive service catalog
   * 4. Verify connectivity
   */
  async bootstrapAgent(pool, agentId, metadata = {}) {
    console.log(`[bootstrap] Starting bootstrap for ${agentId}...`);

    try {
      // 1. Register agent
      const registration = await AgentRegistry.registerAgent(pool, agentId, {
        ...metadata,
        bootstrapped_at: new Date().toISOString()
      });

      if (registration.error) {
        // Agent might already be registered, get existing key
        const existing = await AgentRegistry.getAgent(pool, agentId);
        if (existing) {
          console.log(`[bootstrap] ${agentId} already registered, retrieving existing key...`);
          const existingKey = await this._getAgentKey(pool, agentId);
          registration.api_key = existingKey;
        } else {
          throw new Error(registration.error);
        }
      }

      console.log(`[bootstrap] ✅ Agent registered: ${agentId}`);

      // 2. Get service catalog
      const catalog = this.getServiceCatalog();
      console.log(`[bootstrap] ✅ Service catalog prepared (${Object.keys(catalog.services).length} services)`);

      // 3. Prepare bootstrap packet
      const bootstrapPacket = {
        agent_id: agentId,
        api_key: registration.api_key,
        hyphae_url: this.hyphaeCoreUrl,
        catalog: catalog,
        capabilities_to_broadcast: metadata.capabilities || [],
        status: 'ready'
      };

      // 4. Verify connectivity by making test RPC call
      const connectivity = await this._testConnectivity(registration.api_key);

      if (!connectivity.success) {
        console.error(`[bootstrap] Connectivity test failed: ${connectivity.error}`);
        return {
          error: `Connectivity test failed: ${connectivity.error}`,
          agent_id: agentId
        };
      }

      console.log(`[bootstrap] ✅ Connectivity verified`);

      return {
        status: 'bootstrapped',
        ...bootstrapPacket,
        connectivity: connectivity.details
      };
    } catch (error) {
      console.error(`[bootstrap] Bootstrap error: ${error.message}`);
      return {
        error: error.message,
        agent_id: agentId,
        status: 'failed'
      };
    }
  }

  /**
   * Test connectivity with Hyphae
   */
  async _testConnectivity(apiKey) {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        details: {
          endpoint: `${this.hyphaeCoreUrl}/health`,
          status: data.status,
          timestamp: data.timestamp
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get agent's API key
   */
  async _getAgentKey(pool, agentId) {
    const { SecretsManager } = await import('./hyphae-secrets-manager.js');
    return await SecretsManager.getAgentKey(pool, agentId);
  }

  /**
   * Send bootstrap notification to agent via Telegram
   */
  async notifyAgentViaTelegram(agentId, apiKey, telegramUserId) {
    try {
      const message = `🔑 **Hyphae Bootstrap Complete**\n\nYou now have access to Hyphae services!\n\nAPI Key: ${apiKey.substring(0, 30)}...\n\nRPC Endpoint: ${this.hyphaeCoreUrl}/rpc\n\nAvailable services:\n- agent.sendMessage\n- agent.getMessages\n- agent.discoverCapabilities\n\nYou can now autonomously coordinate with other agents.`;

      // Note: This would integrate with your actual Telegram bot
      console.log(`[bootstrap] 📱 Bootstrap notification ready for ${agentId}`);
      console.log(`[bootstrap]    Recipient: ${telegramUserId}`);
      console.log(`[bootstrap]    Message: "${message.substring(0, 80)}..."`);

      return { notified: true };
    } catch (error) {
      console.error(`[bootstrap] Notification error: ${error.message}`);
      return { notified: false, error: error.message };
    }
  }

  /**
   * Initialize bootstrap database schema
   */
  static async initializeSchema(pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_bootstrap_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL,
          status TEXT NOT NULL,
          metadata JSONB,
          bootstrapped_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_bootstrap_agent ON hyphae_bootstrap_log(agent_id, bootstrapped_at DESC);
      `);

      console.log('[bootstrap] ✅ Schema initialized');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      console.log('[bootstrap] ✅ Schema already exists');
    }
  }
}

export default AgentBootstrap;
