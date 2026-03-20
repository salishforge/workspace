#!/usr/bin/env node

/**
 * Hyphae Communications Module
 * 
 * Provides:
 * - Agent-to-agent messaging
 * - Capability discovery
 * - Human-to-agent communication bridge
 * - Channel abstraction (Telegram, Discord, Slack, etc.)
 */

import crypto from 'crypto';
import { TelegramChannel } from './channels/telegram-channel.js';

// Channel providers registry
const channelProviders = {
  telegram: new TelegramChannel()
};

/**
 * AGENT-TO-AGENT MESSAGING
 */

export async function handleAgentSendMessage(pool, params, agentId, auditLog) {
  const { to_agent_id, message, message_type = 'request', metadata = {} } = params;

  // Validate
  if (!to_agent_id || !message) {
    throw new Error('Missing required: to_agent_id, message');
  }

  try {
    // Store message in queue
    const result = await pool.query(
      `INSERT INTO hyphae_agent_messages 
       (from_agent_id, to_agent_id, message, message_type, metadata, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
       RETURNING id`,
      [agentId, to_agent_id, message, message_type, JSON.stringify(metadata)]
    );

    const messageId = result.rows[0].id;

    // Log to audit trail
    await auditLog('agent_send_message', agentId, `message→${to_agent_id}`, 'success', {
      message_id: messageId,
      message_type
    });

    // Notify recipient agent (async)
    notifyAgentNewMessage(to_agent_id).catch(e =>
      console.warn('[hyphae-comms] Notification failed:', e.message)
    );

    return {
      status: 'queued',
      message_id: messageId,
      to_agent: to_agent_id,
      queued_at: new Date().toISOString()
    };
  } catch (error) {
    await auditLog('agent_send_message', agentId, `message→${to_agent_id}`, 'failure', {
      error: error.message
    });
    throw error;
  }
}

export async function handleAgentGetMessages(pool, params, agentId, auditLog) {
  try {
    const result = await pool.query(
      `SELECT id, from_agent_id, message, message_type, metadata, created_at
       FROM hyphae_agent_messages
       WHERE to_agent_id = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT 100`,
      [agentId]
    );

    const messages = result.rows.map(row => ({
      id: row.id,
      from: row.from_agent_id,
      message: row.message,
      type: row.message_type,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      received_at: row.created_at
    }));

    await auditLog('agent_get_messages', agentId, 'query_inbox', 'success', {
      message_count: messages.length
    });

    return {
      messages,
      count: messages.length
    };
  } catch (error) {
    await auditLog('agent_get_messages', agentId, 'query_inbox', 'failure', {
      error: error.message
    });
    throw error;
  }
}

export async function handleAgentAckMessage(pool, params, agentId, auditLog) {
  const { message_id } = params;

  if (!message_id) {
    throw new Error('Missing required: message_id');
  }

  try {
    await pool.query(
      `UPDATE hyphae_agent_messages
       SET status = 'processed', processed_at = NOW()
       WHERE id = $1 AND to_agent_id = $2`,
      [message_id, agentId]
    );

    await auditLog('agent_ack_message', agentId, `msg:${message_id}`, 'success');

    return {
      status: 'acknowledged',
      message_id,
      processed_at: new Date().toISOString()
    };
  } catch (error) {
    await auditLog('agent_ack_message', agentId, `msg:${message_id}`, 'failure', {
      error: error.message
    });
    throw error;
  }
}

/**
 * CAPABILITY DISCOVERY
 */

export async function handleAdvertiseCapabilities(pool, params, agentId, auditLog) {
  const { capabilities } = params;

  if (!Array.isArray(capabilities)) {
    throw new Error('Capabilities must be an array');
  }

  try {
    await pool.query(
      `INSERT INTO hyphae_agent_capabilities (agent_id, capabilities, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (agent_id) DO UPDATE
       SET capabilities = EXCLUDED.capabilities, updated_at = NOW()`,
      [agentId, JSON.stringify(capabilities)]
    );

    await auditLog('agent_advertise_capabilities', agentId, 'capability_registration', 'success', {
      capability_count: capabilities.length
    });

    return {
      agent_id: agentId,
      capabilities_registered: capabilities.length,
      updated_at: new Date().toISOString()
    };
  } catch (error) {
    await auditLog('agent_advertise_capabilities', agentId, 'capability_registration', 'failure', {
      error: error.message
    });
    throw error;
  }
}

export async function handleDiscoverCapabilities(pool, params, agentId, auditLog) {
  const { agent_id } = params;

  if (!agent_id) {
    throw new Error('Missing required: agent_id');
  }

  try {
    const result = await pool.query(
      `SELECT agent_id, capabilities, updated_at FROM hyphae_agent_capabilities
       WHERE agent_id = $1`,
      [agent_id]
    );

    if (result.rows.length === 0) {
      await auditLog('agent_discover_capabilities', agentId, `discover:${agent_id}`, 'failure', {
        error: 'Agent not found'
      });
      throw new Error(`Agent not found: ${agent_id}`);
    }

    const row = result.rows[0];
    const capabilities = JSON.parse(row.capabilities);

    await auditLog('agent_discover_capabilities', agentId, `discover:${agent_id}`, 'success', {
      capability_count: capabilities.length
    });

    return {
      agent_id,
      capabilities,
      updated_at: row.updated_at
    };
  } catch (error) {
    await auditLog('agent_discover_capabilities', agentId, `discover:${agent_id}`, 'failure', {
      error: error.message
    });
    throw error;
  }
}

export async function handleListAllAgents(pool, agentId, auditLog) {
  try {
    const result = await pool.query(
      `SELECT agent_id, capabilities, updated_at FROM hyphae_agent_capabilities
       ORDER BY agent_id`
    );

    const agents = result.rows.map(row => ({
      agent_id: row.agent_id,
      capability_count: JSON.parse(row.capabilities).length,
      capabilities: JSON.parse(row.capabilities),
      updated_at: row.updated_at
    }));

    await auditLog('agent_list_all_agents', agentId, 'system_discovery', 'success', {
      agent_count: agents.length
    });

    return {
      agents,
      total_agents: agents.length
    };
  } catch (error) {
    await auditLog('agent_list_all_agents', agentId, 'system_discovery', 'failure', {
      error: error.message
    });
    throw error;
  }
}

/**
 * HUMAN-TO-AGENT COMMUNICATION
 */

export async function handleHumanSendMessage(pool, params, auditLog) {
  const { from_human_id, to_agent_id, message, channel = 'telegram' } = params;

  if (!from_human_id || !to_agent_id || !message) {
    throw new Error('Missing required: from_human_id, to_agent_id, message');
  }

  try {
    const messageId = crypto.randomUUID();

    // Store message
    await pool.query(
      `INSERT INTO hyphae_human_agent_messages
       (id, from_human_id, to_agent_id, message, channel, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
      [messageId, from_human_id, to_agent_id, message, channel]
    );

    // Notify agent
    notifyAgentNewHumanMessage(to_agent_id).catch(e =>
      console.warn('[hyphae-comms] Human message notification failed:', e.message)
    );

    // Log
    await auditLog('human_send_message', from_human_id, `→${to_agent_id}`, 'success', {
      message_id: messageId,
      channel
    });

    return {
      status: 'delivered',
      message_id: messageId,
      to_agent: to_agent_id,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    await auditLog('human_send_message', from_human_id, `→${to_agent_id}`, 'failure', {
      error: error.message
    });
    throw error;
  }
}

export async function handleAgentGetHumanMessages(pool, params, agentId, auditLog) {
  try {
    const result = await pool.query(
      `SELECT id, from_human_id, message, channel, created_at
       FROM hyphae_human_agent_messages
       WHERE to_agent_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 100`,
      [agentId]
    );

    const messages = result.rows.map(row => ({
      id: row.id,
      from: row.from_human_id,
      message: row.message,
      channel: row.channel,
      received_at: row.created_at
    }));

    await auditLog('agent_get_human_messages', agentId, 'query_human_inbox', 'success', {
      message_count: messages.length
    });

    return {
      messages,
      count: messages.length
    };
  } catch (error) {
    await auditLog('agent_get_human_messages', agentId, 'query_human_inbox', 'failure', {
      error: error.message
    });
    throw error;
  }
}

export async function handleAgentSendHumanMessage(pool, params, agentId, auditLog) {
  const { to_human_id, message, channel = 'telegram' } = params;

  if (!to_human_id || !message) {
    throw new Error('Missing required: to_human_id, message');
  }

  try {
    const messageId = crypto.randomUUID();

    // Get channel provider
    const provider = channelProviders[channel];
    if (!provider) {
      throw new Error(`Unsupported channel: ${channel}`);
    }

    // Send via channel
    await provider.send(to_human_id, message, {
      from_agent: agentId,
      timestamp: new Date()
    });

    // Store message
    await pool.query(
      `INSERT INTO hyphae_agent_human_messages
       (id, from_agent_id, to_human_id, message, channel, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', NOW())`,
      [messageId, agentId, to_human_id, message, channel]
    );

    // Log
    await auditLog('agent_send_human_message', agentId, `→${to_human_id}`, 'success', {
      message_id: messageId,
      channel
    });

    return {
      status: 'sent',
      message_id: messageId,
      to_human: to_human_id,
      channel,
      sent_at: new Date().toISOString()
    };
  } catch (error) {
    await auditLog('agent_send_human_message', agentId, `→${to_human_id}`, 'failure', {
      error: error.message
    });
    throw error;
  }
}

/**
 * CHANNEL MANAGEMENT
 */

export async function handleGetChannelInfo(params) {
  const { channel = 'telegram' } = params;

  const provider = channelProviders[channel];
  if (!provider) {
    throw new Error(`Unsupported channel: ${channel}`);
  }

  return await provider.get_channel_info();
}

/**
 * INTERNAL: Notifications (async, non-blocking)
 */

function notifyAgentNewMessage(agentId) {
  // TODO: Implement wake-up mechanism (webhook, event emitter, etc.)
  // For now, just log
  console.log(`[hyphae-comms] Notifying agent ${agentId} of new message`);
  return Promise.resolve();
}

function notifyAgentNewHumanMessage(agentId) {
  // TODO: Implement wake-up mechanism
  console.log(`[hyphae-comms] Notifying agent ${agentId} of new human message`);
  return Promise.resolve();
}

/**
 * Export channel registry for extension
 */
export function registerChannelProvider(name, provider) {
  channelProviders[name] = provider;
  console.log(`[hyphae-comms] Registered channel provider: ${name}`);
}

export function getChannelProvider(name) {
  return channelProviders[name];
}

export function listChannelProviders() {
  return Object.keys(channelProviders);
}
