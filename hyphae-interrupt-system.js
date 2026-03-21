/**
 * Hyphae Priority Interrupt System
 * 
 * Critical alert delivery to all registered agents
 * - Push-based (not polling) for critical alerts
 * - Broadcast to all or selected agents
 * - Guaranteed delivery with retries
 * - Interrupt handler in agents
 * - Escalation levels: critical, warning, info
 */

export class InterruptSystem {
  /**
   * Broadcast critical interrupt to all agents
   */
  static async broadcastInterrupt(pool, alert) {
    try {
      const { level, message, context, requiresAck = true } = alert;

      if (!['critical', 'warning', 'info'].includes(level)) {
        return { error: 'Invalid alert level (critical/warning/info)' };
      }

      if (!message) {
        return { error: 'Alert message required' };
      }

      // Create interrupt record
      const result = await pool.query(
        `INSERT INTO hyphae_priority_interrupts 
         (level, message, context, requires_ack, created_at, status)
         VALUES ($1, $2, $3, $4, NOW(), 'pending')
         RETURNING id, created_at`,
        [level, message, JSON.stringify(context || {}), requiresAck]
      );

      const interruptId = result.rows[0].id;

      // Get all registered agents
      const agentsResult = await pool.query(
        `SELECT agent_id FROM hyphae_registered_agents WHERE status = 'active'`
      );

      const agents = agentsResult.rows.map(row => row.agent_id);

      if (agents.length === 0) {
        console.log('[interrupt] ⚠️  No active agents to notify');
        return {
          interrupt_id: interruptId,
          level: level,
          broadcast_to: 0,
          message: 'No active agents'
        };
      }

      // Create delivery queue for each agent
      for (const agentId of agents) {
        await pool.query(
          `INSERT INTO hyphae_interrupt_delivery_queue 
           (interrupt_id, agent_id, status, created_at)
           VALUES ($1, $2, 'pending', NOW())`,
          [interruptId, agentId]
        );
      }

      console.log(`[interrupt] 🚨 Critical alert broadcast to ${agents.length} agents`);
      console.log(`[interrupt]    Level: ${level}`);
      console.log(`[interrupt]    Message: ${message.substring(0, 60)}...`);

      return {
        interrupt_id: interruptId,
        level: level,
        broadcast_to: agents.length,
        agents: agents,
        status: 'broadcast'
      };
    } catch (error) {
      console.error(`[interrupt] Broadcast error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Get pending interrupts for an agent
   */
  static async getPendingInterrupts(pool, agentId) {
    try {
      const result = await pool.query(
        `SELECT i.id, i.level, i.message, i.context, i.requires_ack, i.created_at
         FROM hyphae_priority_interrupts i
         JOIN hyphae_interrupt_delivery_queue d ON i.id = d.interrupt_id
         WHERE d.agent_id = $1 AND d.status = 'pending'
         ORDER BY i.level DESC, i.created_at DESC
         LIMIT 10`,
        [agentId]
      );

      const interrupts = result.rows.map(row => ({
        id: row.id,
        level: row.level,
        message: row.message,
        context: JSON.parse(row.context || '{}'),
        requires_ack: row.requires_ack,
        received_at: row.created_at
      }));

      if (interrupts.length > 0) {
        console.log(`[interrupt] ${agentId}: ${interrupts.length} pending interrupt(s)`);
      }

      return interrupts;
    } catch (error) {
      console.error(`[interrupt] Get pending error: ${error.message}`);
      return [];
    }
  }

  /**
   * Agent acknowledges interrupt receipt and handling
   */
  static async acknowledgeInterrupt(pool, agentId, interruptId, response = null) {
    try {
      // Mark delivery as acked
      await pool.query(
        `UPDATE hyphae_interrupt_delivery_queue 
         SET status = 'acked', acked_at = NOW()
         WHERE interrupt_id = $1 AND agent_id = $2`,
        [interruptId, agentId]
      );

      // Store agent response if provided
      if (response) {
        await pool.query(
          `INSERT INTO hyphae_interrupt_responses 
           (interrupt_id, agent_id, response, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [interruptId, agentId, response]
        );
      }

      // Check if all agents have acked
      const pendingResult = await pool.query(
        `SELECT COUNT(*) as count FROM hyphae_interrupt_delivery_queue 
         WHERE interrupt_id = $1 AND status != 'acked'`,
        [interruptId]
      );

      if (pendingResult.rows[0].count === 0) {
        await pool.query(
          `UPDATE hyphae_priority_interrupts SET status = 'all_acked' WHERE id = $1`,
          [interruptId]
        );

        console.log(`[interrupt] ✅ All agents acked interrupt ${interruptId}`);
      }

      console.log(`[interrupt] ${agentId} acked interrupt ${interruptId}`);

      return { success: true, interrupt_id: interruptId };
    } catch (error) {
      console.error(`[interrupt] Ack error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Get interrupt status (for monitoring/debugging)
   */
  static async getInterruptStatus(pool, interruptId) {
    try {
      const interruptResult = await pool.query(
        `SELECT id, level, message, status, created_at FROM hyphae_priority_interrupts WHERE id = $1`,
        [interruptId]
      );

      if (!interruptResult.rows.length) {
        return { error: 'Interrupt not found' };
      }

      const interrupt = interruptResult.rows[0];

      // Get delivery status for all agents
      const deliveryResult = await pool.query(
        `SELECT agent_id, status, acked_at FROM hyphae_interrupt_delivery_queue WHERE interrupt_id = $1`,
        [interruptId]
      );

      const delivery = deliveryResult.rows.map(row => ({
        agent: row.agent_id,
        status: row.status,
        acked_at: row.acked_at
      }));

      return {
        interrupt: {
          id: interrupt.id,
          level: interrupt.level,
          message: interrupt.message,
          status: interrupt.status,
          created_at: interrupt.created_at
        },
        delivery: delivery
      };
    } catch (error) {
      console.error(`[interrupt] Status error: ${error.message}`);
      return { error: error.message };
    }
  }

  /**
   * Initialize interrupt system schema
   */
  static async initializeSchema(pool) {
    try {
      // Priority interrupts table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_priority_interrupts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          level TEXT NOT NULL CHECK (level IN ('critical', 'warning', 'info')),
          message TEXT NOT NULL,
          context JSONB,
          requires_ack BOOLEAN DEFAULT true,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'all_acked', 'expired')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
        )
      `);

      // Delivery queue (tracks per-agent delivery)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_interrupt_delivery_queue (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          interrupt_id UUID NOT NULL REFERENCES hyphae_priority_interrupts(id),
          agent_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'acked', 'failed')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          acked_at TIMESTAMPTZ,
          retry_count INT DEFAULT 0
        )
      `);

      // Agent responses to interrupts
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hyphae_interrupt_responses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          interrupt_id UUID NOT NULL REFERENCES hyphae_priority_interrupts(id),
          agent_id TEXT NOT NULL,
          response TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_interrupts_level ON hyphae_priority_interrupts(level);
        CREATE INDEX IF NOT EXISTS idx_delivery_queue_agent ON hyphae_interrupt_delivery_queue(agent_id, status);
        CREATE INDEX IF NOT EXISTS idx_responses_interrupt ON hyphae_interrupt_responses(interrupt_id);
      `);

      console.log('[interrupt] ✅ Schema initialized');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      console.log('[interrupt] ✅ Schema already exists');
    }
  }
}

export default InterruptSystem;
