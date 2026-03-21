/**
 * Hyphae Service Registry & Notifications
 * 
 * Manage service versions and notify agents of changes
 * - Track service versions
 * - Publish service change notifications
 * - Agent subscriptions to updates
 * - Dynamic catalog refresh
 */

export class ServiceRegistry {
  /**
   * Get current service catalog with version
   */
  static getServiceCatalog(version = null) {
    const services = {
      'agent.sendMessage': {
        description: 'Send message to another agent',
        version: '1.0',
        endpoint: '/rpc',
        method: 'agent.sendMessage',
        params: ['from_agent_id', 'to_agent_id', 'message', 'context?', 'priority?'],
        authentication: 'required'
      },
      'agent.getMessages': {
        description: 'Retrieve pending messages from other agents',
        version: '1.0',
        endpoint: '/rpc',
        method: 'agent.getMessages',
        params: ['agent_id', 'limit?', 'status?'],
        authentication: 'required'
      },
      'agent.ackMessage': {
        description: 'Acknowledge message receipt',
        version: '1.0',
        endpoint: '/rpc',
        method: 'agent.ackMessage',
        params: ['message_id', 'processed_by'],
        authentication: 'required'
      },
      'agent.discoverCapabilities': {
        description: 'Discover other agents and their capabilities',
        version: '1.0',
        endpoint: '/rpc',
        method: 'agent.discoverCapabilities',
        params: ['requesting_agent'],
        authentication: 'required'
      },
      'agent.getConversationHistory': {
        description: 'Retrieve past exchanges with another agent',
        version: '1.0',
        endpoint: '/rpc',
        method: 'agent.getConversationHistory',
        params: ['agent_1', 'agent_2', 'limit?'],
        authentication: 'required'
      },
      'agent.getServiceUpdates': {
        description: 'Check for service catalog updates',
        version: '1.1',
        endpoint: '/rpc',
        method: 'agent.getServiceUpdates',
        params: ['agent_id', 'last_catalog_version?'],
        authentication: 'required',
        new_in_version: '1.1'
      },
      'agent.subscribeToUpdates': {
        description: 'Subscribe to service catalog changes',
        version: '1.1',
        endpoint: '/rpc',
        method: 'agent.subscribeToUpdates',
        params: ['agent_id'],
        authentication: 'required',
        new_in_version: '1.1'
      }
    };

    return {
      version: '1.1',
      timestamp: new Date().toISOString(),
      services: services,
      updates_since_version: version ? this.getUpdatesSince(version) : []
    };
  }

  /**
   * Get updates since a specific version
   */
  static getUpdatesSince(version) {
    const updates = [];

    if (version === '1.0') {
      updates.push({
        version: '1.1',
        timestamp: '2026-03-21T03:40:00Z',
        new_services: [
          'agent.getServiceUpdates',
          'agent.subscribeToUpdates'
        ],
        new_features: [
          'Dynamic service discovery',
          'Agent subscription to updates',
          'Service version tracking'
        ],
        migration_notes: 'Optional: agents can now subscribe to automatic updates instead of polling'
      });
    }

    return updates;
  }

  /**
   * Publish service update notification
   */
  static async publishServiceUpdate(pool, newServices, deprecatedServices = []) {
    try {
      await pool.query(
        `INSERT INTO hyphae_service_updates 
         (version, new_services, deprecated_services, published_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          '1.1',
          JSON.stringify(newServices),
          JSON.stringify(deprecatedServices)
        ]
      );

      console.log(`[registry] Service update published: ${newServices.length} new services`);
      return true;
    } catch (error) {
      console.error(`[registry] Publish error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get pending updates for agent
   */
  static async getAgentUpdates(pool, agentId, lastVersion = null) {
    try {
      let query = `
        SELECT version, new_services, deprecated_services, published_at
        FROM hyphae_service_updates
        WHERE published_at > (
          SELECT COALESCE(last_catalog_check, '2000-01-01'::TIMESTAMPTZ)
          FROM hyphae_agent_subscriptions
          WHERE agent_id = $1
        )
        ORDER BY published_at DESC
        LIMIT 10
      `;

      const result = await pool.query(query, [agentId]);

      // Update last check time
      await pool.query(
        `UPDATE hyphae_agent_subscriptions 
         SET last_catalog_check = NOW()
         WHERE agent_id = $1`,
        [agentId]
      );

      return result.rows.map(row => ({
        version: row.version,
        new_services: JSON.parse(row.new_services || '[]'),
        deprecated_services: JSON.parse(row.deprecated_services || '[]'),
        published_at: row.published_at
      }));
    } catch (error) {
      console.error(`[registry] Get updates error: ${error.message}`);
      return [];
    }
  }

  /**
   * Subscribe agent to updates
   */
  static async subscribeAgent(pool, agentId) {
    try {
      await pool.query(
        `INSERT INTO hyphae_agent_subscriptions (agent_id, subscribed_at, last_catalog_check)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (agent_id) DO UPDATE SET
           subscribed_at = NOW(),
           last_catalog_check = NOW()`,
        [agentId]
      );

      console.log(`[registry] Agent subscribed to updates: ${agentId}`);
      return true;
    } catch (error) {
      console.error(`[registry] Subscribe error: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all subscribed agents
   */
  static async getSubscribedAgents(pool) {
    try {
      const result = await pool.query(
        `SELECT agent_id, subscribed_at, last_catalog_check
         FROM hyphae_agent_subscriptions
         WHERE subscribed_at IS NOT NULL
         ORDER BY agent_id`
      );

      return result.rows;
    } catch (error) {
      console.error(`[registry] List subscribers error: ${error.message}`);
      return [];
    }
  }

  /**
   * Initialize schema
   */
  static async initializeSchema(pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_service_updates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          version TEXT NOT NULL,
          new_services JSONB,
          deprecated_services JSONB,
          published_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_agent_subscriptions (
          agent_id TEXT PRIMARY KEY,
          subscribed_at TIMESTAMPTZ DEFAULT NOW(),
          last_catalog_check TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_service_updates_version ON hyphae_service_updates(version);
        CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_check ON hyphae_agent_subscriptions(last_catalog_check DESC);
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

export default ServiceRegistry;
