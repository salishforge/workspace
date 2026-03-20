/**
 * Hyphae Communications Integration Module
 * 
 * Handles RPC method registration for the communications system
 * Designed to be imported and integrated into hyphae-core.js
 * 
 * Usage in hyphae-core.js:
 *   import * as CommIntegration from './hyphae-communications-integration.js';
 *   
 *   // In RPC dispatcher:
 *   case 'agent.advertise_capabilities':
 *     result = await CommIntegration.handleAdvertiseCapabilities(pool, params, agentId, auditLog);
 *     break;
 *   // ... (other cases)
 */

import * as Communications from './hyphae-communications.js';

/**
 * Register all communication RPC methods
 * Call this during hyphae-core.js initialization
 */
export function registerCommunicationMethods() {
  console.log('[hyphae-comms] Communications system initialized');
  return {
    methods: [
      'agent.advertise_capabilities',
      'agent.discover_capabilities',
      'agent.list_all_agents',
      'agent.send_message',
      'agent.get_messages',
      'agent.ack_message',
      'agent.human_send_message',
      'agent.get_human_messages',
      'agent.send_human_message',
      'agent.get_channel_info'
    ]
  };
}

/**
 * RPC Handler: Agent advertise capabilities
 */
export async function handleAdvertiseCapabilities(pool, params, agentId, auditLog) {
  return await Communications.handleAdvertiseCapabilities(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: Discover agent capabilities
 */
export async function handleDiscoverCapabilities(pool, params, agentId, auditLog) {
  return await Communications.handleDiscoverCapabilities(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: List all agents
 */
export async function handleListAllAgents(pool, agentId, auditLog) {
  return await Communications.handleListAllAgents(pool, agentId, auditLog);
}

/**
 * RPC Handler: Agent sends message to another agent
 */
export async function handleAgentSendMessage(pool, params, agentId, auditLog) {
  return await Communications.handleAgentSendMessage(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: Get messages for this agent
 */
export async function handleAgentGetMessages(pool, params, agentId, auditLog) {
  return await Communications.handleAgentGetMessages(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: Acknowledge message receipt
 */
export async function handleAgentAckMessage(pool, params, agentId, auditLog) {
  return await Communications.handleAgentAckMessage(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: Human sends message to agent
 */
export async function handleHumanSendMessage(pool, params, auditLog) {
  return await Communications.handleHumanSendMessage(pool, params, auditLog);
}

/**
 * RPC Handler: Get messages from humans
 */
export async function handleAgentGetHumanMessages(pool, params, agentId, auditLog) {
  return await Communications.handleAgentGetHumanMessages(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: Agent sends message to human
 */
export async function handleAgentSendHumanMessage(pool, params, agentId, auditLog) {
  return await Communications.handleAgentSendHumanMessage(pool, params, agentId, auditLog);
}

/**
 * RPC Handler: Get channel info
 */
export async function handleGetChannelInfo(params) {
  return await Communications.handleGetChannelInfo(params);
}

/**
 * Integration code snippet for hyphae-core.js
 * 
 * Add this to the RPC method dispatcher switch statement:
 * 
 * case 'agent.advertise_capabilities':
 *   result = await CommIntegration.handleAdvertiseCapabilities(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.discover_capabilities':
 *   result = await CommIntegration.handleDiscoverCapabilities(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.list_all_agents':
 *   result = await CommIntegration.handleListAllAgents(pool, agentId, auditLog);
 *   break;
 * case 'agent.send_message':
 *   result = await CommIntegration.handleAgentSendMessage(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.get_messages':
 *   result = await CommIntegration.handleAgentGetMessages(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.ack_message':
 *   result = await CommIntegration.handleAgentAckMessage(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.human_send_message':
 *   result = await CommIntegration.handleHumanSendMessage(pool, params, auditLog);
 *   break;
 * case 'agent.get_human_messages':
 *   result = await CommIntegration.handleAgentGetHumanMessages(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.send_human_message':
 *   result = await CommIntegration.handleAgentSendHumanMessage(pool, params, agentId, auditLog);
 *   break;
 * case 'agent.get_channel_info':
 *   result = await CommIntegration.handleGetChannelInfo(params);
 *   break;
 */
