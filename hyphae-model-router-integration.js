/**
 * Hyphae Model Router Integration Module
 * 
 * Integrates the Model Router Service into Hyphae Core RPC
 * Provides transparent routing and limit management for agents
 */

import fetch from 'node-fetch';

// Model Router endpoint
const MODEL_ROUTER_ENDPOINT = process.env.MODEL_ROUTER_ENDPOINT || 'http://localhost:3105/rpc';
const HYPHAE_TOKEN = process.env.HYPHAE_TOKEN || 'hyphae-auth-token-2026';

/**
 * Call Model Router RPC method
 */
async function callRouter(method, params) {
  try {
    const response = await fetch(MODEL_ROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HYPHAE_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now()
      })
    });
    
    if (!response.ok) {
      console.error(`Router call failed: ${response.status}`);
      return { error: `Router returned ${response.status}` };
    }
    
    const data = await response.json();
    return data.result || data.error || { error: 'No result' };
  } catch (error) {
    console.error(`Router call error (${method}):`, error.message);
    return { error: error.message };
  }
}

/**
 * Hyphae RPC Methods for Model Router
 * 
 * Expose router functionality through Hyphae's RPC interface
 */
const routerRpcMethods = {
  // Get available services
  'model.services': async (params) => {
    return await callRouter('model.getServices', params);
  },
  
  // Request API key access
  'model.request_access': async (params) => {
    const { agent_id, service_id, reason } = params;
    
    // Generate key
    const result = await callRouter('model.requestAccess', {
      agent_id,
      service_id,
      reason
    });
    
    if (result.key_id) {
      // Send admin notification
      await notifyAdminApproval(agent_id, service_id, result.key_id, reason);
    }
    
    return result;
  },
  
  // Admin: Approve key request
  'model.approve_key': async (params) => {
    const { key_id, approved_by, reason } = params;
    return await callRouter('model.approveKey', {
      key_id,
      approved_by,
      reason
    });
  },
  
  // Admin: Deny key request
  'model.deny_key': async (params) => {
    const { key_id, denied_by, reason } = params;
    return await callRouter('model.denyKey', {
      key_id,
      denied_by,
      reason
    });
  },
  
  // Get API key (for approved agents)
  'model.get_key': async (params) => {
    const { agent_id, service_id } = params;
    return await callRouter('model.getKey', {
      agent_id,
      service_id
    });
  },
  
  // Check limit status
  'model.limit_status': async (params) => {
    const { agent_id, service_id } = params;
    return await callRouter('model.getLimitStatus', {
      agent_id,
      service_id
    });
  },
  
  // Report usage (after API call completes)
  'model.report_usage': async (params) => {
    const { agent_id, service_id, cost, tokens } = params;
    return await callRouter('model.updateUsage', {
      agent_id,
      service_id,
      cost,
      tokens
    });
  },
  
  // Select optimal model for task
  'model.select_optimal': async (params) => {
    const { agent_id, task_type, complexity, is_urgent } = params;
    return await callRouter('model.selectOptimal', {
      agent_id,
      task_type,
      complexity,
      is_urgent
    });
  },
  
  // Get pending approvals (admin only)
  'model.pending_approvals': async (params) => {
    // Query router database for pending keys
    // This would be implemented in router service
    return { 
      note: 'Pending approvals endpoint - check router dashboard for details'
    };
  },
  
  // Get usage report (admin only)
  'model.usage_report': async (params) => {
    const { agent_id, time_period } = params;
    // Implementation in router service
    return { 
      note: 'Usage report endpoint - check router dashboard for details'
    };
  }
};

/**
 * Send approval notification to admin
 */
async function notifyAdminApproval(agentId, serviceId, keyId, reason) {
  const message = `
🔑 **API Key Request**
Agent: ${agentId}
Service: ${serviceId}
Reason: ${reason || 'Not specified'}

[APPROVE](approve:${keyId}) | [DENY](deny:${keyId}) | [DETAILS](details:${keyId})
  `.trim();
  
  // In production: send via Telegram/webhook
  console.log('[ADMIN NOTIFICATION]', message);
}

/**
 * Integration helper: Select model and get credentials
 * 
 * Usage in agent code:
 * const {service_id, key} = await integrateModel({
 *   agent_id: 'flint',
 *   task_type: 'coding',
 *   complexity: 'hard'
 * });
 */
async function selectAndGetCredentials(agentId, taskType, complexity, isUrgent = false) {
  try {
    // Get optimal model selection
    const selection = await callRouter('model.selectOptimal', {
      agent_id: agentId,
      task_type: taskType,
      complexity,
      is_urgent: isUrgent
    });
    
    if (selection.error) {
      return { error: selection.error };
    }
    
    const { service_id, service_name } = selection;
    
    // Get API key
    const keyResult = await callRouter('model.getKey', {
      agent_id: agentId,
      service_id
    });
    
    if (keyResult.error) {
      // Request new key if not available
      const requestResult = await callRouter('model.requestAccess', {
        agent_id: agentId,
        service_id,
        reason: `Auto-request for ${taskType} task (${complexity} complexity)`
      });
      
      return {
        service_id,
        service_name,
        key_id: requestResult.key_id,
        status: 'pending_approval',
        message: 'Key request sent for admin approval'
      };
    }
    
    return {
      service_id,
      service_name,
      key_value: keyResult.key_value,
      endpoint: keyResult.service_endpoint,
      ready: true
    };
  } catch (error) {
    console.error('Error in selectAndGetCredentials:', error);
    return { error: error.message };
  }
}

export {
  routerRpcMethods,
  callRouter,
  selectAndGetCredentials,
  notifyAdminApproval
};
