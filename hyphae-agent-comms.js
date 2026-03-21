/**
 * Hyphae Agent-to-Agent Communication Infrastructure
 * 
 * RPC methods for autonomous inter-agent messaging
 * Enables Flint ↔ Clio coordination without human mediation
 */

export const agentCommsMethods = {
  /**
   * Send message from one agent to another
   * 
   * agent.sendMessage({
   *   from_agent_id: "flint",
   *   to_agent_id: "clio",
   *   message: "Cost spike detected. Need operational guidance.",
   *   context: { incident_type: "cost_spike", amount: 250 }
   * })
   */
  'agent.sendMessage': async (params, pool) => {
    const { from_agent_id, to_agent_id, message, context, priority = 'normal' } = params;

    if (!from_agent_id || !to_agent_id || !message) {
      return { error: 'Missing required: from_agent_id, to_agent_id, message' };
    }

    try {
      const result = await pool.query(
        `INSERT INTO hyphae_agent_agent_messages 
         (from_agent_id, to_agent_id, message, context, priority, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
         RETURNING id, created_at`,
        [from_agent_id, to_agent_id, message, JSON.stringify(context || {}), priority]
      );

      console.log(`[agent-comms] ${from_agent_id} → ${to_agent_id}: Message queued`);

      return {
        success: true,
        message_id: result.rows[0].id,
        timestamp: result.rows[0].created_at
      };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Get pending messages for an agent from other agents
   * 
   * agent.getMessages({
   *   agent_id: "clio",
   *   limit: 10,
   *   status: "pending"
   * })
   */
  'agent.getMessages': async (params, pool) => {
    const { agent_id, limit = 10, status = 'pending' } = params;

    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }

    try {
      const result = await pool.query(
        `SELECT id, from_agent_id, message, context, priority, created_at
         FROM hyphae_agent_agent_messages
         WHERE to_agent_id = $1 AND status = $2
         ORDER BY priority DESC, created_at ASC
         LIMIT $3`,
        [agent_id, status, limit]
      );

      const messages = result.rows.map(row => ({
        id: row.id,
        from: row.from_agent_id,
        message: row.message,
        context: JSON.parse(row.context || '{}'),
        priority: row.priority,
        received_at: row.created_at
      }));

      console.log(`[agent-comms] ${agent_id}: Retrieved ${messages.length} messages`);

      return { messages, count: messages.length };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Acknowledge message (mark as read/processed)
   * 
   * agent.ackMessage({
   *   message_id: "uuid",
   *   processed_by: "clio"
   * })
   */
  'agent.ackMessage': async (params, pool) => {
    const { message_id, processed_by } = params;

    if (!message_id || !processed_by) {
      return { error: 'Missing message_id or processed_by' };
    }

    try {
      await pool.query(
        `UPDATE hyphae_agent_agent_messages 
         SET status = 'processed', processed_by = $1, processed_at = NOW()
         WHERE id = $2`,
        [processed_by, message_id]
      );

      console.log(`[agent-comms] Message ${message_id} acked by ${processed_by}`);

      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Broadcast capabilities to other agents
   * 
   * agent.broadcastCapabilities({
   *   agent_id: "flint",
   *   capabilities: ["cost_optimization", "architecture_design", "security_review"],
   *   availability: "always"
   * })
   */
  'agent.broadcastCapabilities': async (params, pool) => {
    const { agent_id, capabilities, availability = 'always', contact_method = 'agent_message' } = params;

    if (!agent_id || !capabilities) {
      return { error: 'Missing agent_id or capabilities' };
    }

    try {
      await pool.query(
        `INSERT INTO hyphae_agent_capabilities (agent_id, capabilities, availability, contact_method, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (agent_id) DO UPDATE SET
           capabilities = EXCLUDED.capabilities,
           availability = EXCLUDED.availability,
           updated_at = NOW()`,
        [agent_id, JSON.stringify(capabilities), availability, contact_method]
      );

      console.log(`[agent-comms] ${agent_id}: Capabilities broadcast (${capabilities.length} capabilities)`);

      return { success: true, capabilities_broadcast: capabilities.length };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Discover capabilities of all other agents
   * 
   * agent.discoverCapabilities({
   *   requesting_agent: "clio"
   * })
   */
  'agent.discoverCapabilities': async (params, pool) => {
    const { requesting_agent } = params;

    if (!requesting_agent) {
      return { error: 'Missing requesting_agent' };
    }

    try {
      const result = await pool.query(
        `SELECT agent_id, capabilities, availability, contact_method, updated_at
         FROM hyphae_agent_capabilities
         WHERE agent_id != $1
         ORDER BY updated_at DESC`,
        [requesting_agent]
      );

      const agents = result.rows.map(row => ({
        agent_id: row.agent_id,
        capabilities: JSON.parse(row.capabilities),
        availability: row.availability,
        contact_method: row.contact_method,
        updated_at: row.updated_at
      }));

      console.log(`[agent-comms] ${requesting_agent}: Discovered ${agents.length} agents`);

      return { agents, count: agents.length };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * Get conversation history between two agents
   * 
   * agent.getConversationHistory({
   *   agent_1: "flint",
   *   agent_2: "clio",
   *   limit: 20
   * })
   */
  'agent.getConversationHistory': async (params, pool) => {
    const { agent_1, agent_2, limit = 20 } = params;

    if (!agent_1 || !agent_2) {
      return { error: 'Missing agent_1 or agent_2' };
    }

    try {
      const result = await pool.query(
        `SELECT id, from_agent_id, to_agent_id, message, context, priority, created_at
         FROM hyphae_agent_agent_messages
         WHERE (
           (from_agent_id = $1 AND to_agent_id = $2) OR
           (from_agent_id = $2 AND to_agent_id = $1)
         )
         ORDER BY created_at ASC
         LIMIT $3`,
        [agent_1, agent_2, limit]
      );

      const history = result.rows.map(row => ({
        id: row.id,
        from: row.from_agent_id,
        to: row.to_agent_id,
        message: row.message,
        context: JSON.parse(row.context || '{}'),
        timestamp: row.created_at
      }));

      console.log(`[agent-comms] ${agent_1} ↔ ${agent_2}: Retrieved ${history.length} messages`);

      return { history, count: history.length };
    } catch (error) {
      return { error: error.message };
    }
  },

  /**
   * List all pending messages across the system
   * (For debugging and monitoring)
   */
  'agent.listPendingMessages': async (params, pool) => {
    try {
      const result = await pool.query(
        `SELECT from_agent_id, to_agent_id, COUNT(*) as count
         FROM hyphae_agent_agent_messages
         WHERE status = 'pending'
         GROUP BY from_agent_id, to_agent_id
         ORDER BY count DESC`
      );

      const summary = result.rows.map(row => ({
        from: row.from_agent_id,
        to: row.to_agent_id,
        pending_count: row.count
      }));

      return { pending_messages_by_route: summary };
    } catch (error) {
      return { error: error.message };
    }
  }
};

/**
 * Initialize agent communication database schema
 */
export async function initializeAgentCommsSchema(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hyphae_agent_agent_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        message TEXT NOT NULL,
        context JSONB,
        priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'processed', 'failed')),
        processed_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        delivered_at TIMESTAMPTZ,
        processed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON hyphae_agent_agent_messages(to_agent_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON hyphae_agent_agent_messages(from_agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON hyphae_agent_agent_messages((CASE WHEN from_agent_id < to_agent_id THEN from_agent_id || ':' || to_agent_id ELSE to_agent_id || ':' || from_agent_id END), created_at DESC);

      CREATE TABLE IF NOT EXISTS hyphae_agent_capabilities (
        agent_id TEXT PRIMARY KEY,
        capabilities JSONB NOT NULL,
        availability TEXT DEFAULT 'always',
        contact_method TEXT DEFAULT 'agent_message',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_capabilities ON hyphae_agent_capabilities(agent_id);
    `);

    console.log('[agent-comms] ✅ Schema initialized');
  } catch (error) {
    if (!error.message.includes('already exists')) {
      throw error;
    }
    console.log('[agent-comms] ✅ Schema already exists');
  }
}

export default { agentCommsMethods, initializeAgentCommsSchema };
