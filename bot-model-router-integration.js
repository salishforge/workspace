/**
 * Bot Model Router Integration
 * 
 * Simplifies agent bot integration with the Model Router Service
 * 
 * Usage in bot code:
 * const bot = new BotWithRouter({
 *   agent_id: 'flint',
 *   router_endpoint: 'http://localhost:3105/rpc'
 * });
 * 
 * const model = await bot.selectModelForTask('coding', 'hard', 'Write a database schema');
 * const response = await bot.callLLM(prompt, model);
 */

const fetch = require('node-fetch');

class BotWithRouter {
  constructor(config) {
    this.agent_id = config.agent_id;
    this.router_endpoint = config.router_endpoint || 'http://localhost:3105/rpc';
    this.hyphae_token = config.hyphae_token || 'hyphae-auth-token-2026';
  }
  
  /**
   * Call Model Router RPC endpoint
   */
  async callRouter(method, params) {
    try {
      const response = await fetch(this.router_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.hyphae_token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params: {
            ...params,
            agent_id: this.agent_id
          },
          id: Date.now()
        })
      });
      
      if (!response.ok) {
        throw new Error(`Router returned ${response.status}`);
      }
      
      const data = await response.json();
      return data.result || data.error;
    } catch (error) {
      console.error(`[${this.agent_id}] Router call failed (${method}):`, error.message);
      throw error;
    }
  }
  
  /**
   * Select optimal model for a task
   * 
   * Returns: { service_id, service_name, endpoint, key_value }
   */
  async selectModelForTask(taskType, complexity, description = null, isUrgent = false) {
    try {
      // Get optimal model selection from router
      const selection = await this.callRouter('model.selectOptimal', {
        task_type: taskType,
        complexity: complexity,
        is_urgent: isUrgent
      });
      
      if (selection.error) {
        console.warn(`[${this.agent_id}] Router selection error:`, selection.error);
        return this.getFallbackModel();
      }
      
      console.log(`[${this.agent_id}] Selected ${selection.service_name} for ${taskType} (score: ${selection.score})`);
      console.log(`  → Reason: ${selection.reason}`);
      console.log(`  → Usage: ${selection.usage_pct}%`);
      
      // Get API key
      const keyResult = await this.callRouter('model.getKey', {
        service_id: selection.service_id
      });
      
      if (keyResult.error) {
        // Try to request access
        console.log(`[${this.agent_id}] No key available, requesting access...`);
        const requestResult = await this.callRouter('model.requestAccess', {
          service_id: selection.service_id,
          reason: `Auto-request for ${taskType} task (${complexity} complexity)`
        });
        
        if (requestResult.key_id) {
          return {
            service_id: selection.service_id,
            service_name: selection.service_name,
            status: 'pending_approval',
            message: 'Key request sent to admin'
          };
        }
      }
      
      return {
        service_id: selection.service_id,
        service_name: selection.service_name,
        key_value: keyResult.key_value,
        endpoint: this.getEndpoint(selection.service_name),
        selection_reason: selection.reason,
        ready: true
      };
    } catch (error) {
      console.error(`[${this.agent_id}] Model selection failed:`, error.message);
      return this.getFallbackModel();
    }
  }
  
  /**
   * Report usage after LLM call completes
   */
  async reportUsage(serviceId, inputTokens, outputTokens, estimatedCost) {
    try {
      await this.callRouter('model.updateUsage', {
        service_id: serviceId,
        tokens: inputTokens + outputTokens,
        cost: estimatedCost
      });
    } catch (error) {
      console.warn(`[${this.agent_id}] Failed to report usage:`, error.message);
    }
  }
  
  /**
   * Get limit status for a service
   */
  async getLimitStatus(serviceId) {
    try {
      return await this.callRouter('model.getLimitStatus', {
        service_id: serviceId
      });
    } catch (error) {
      console.warn(`[${this.agent_id}] Failed to get limit status:`, error.message);
      return { error: error.message };
    }
  }
  
  /**
   * Get endpoint URL for a service
   */
  getEndpoint(serviceName) {
    const map = {
      'claude-max-100': 'https://api.anthropic.com/v1/messages',
      'claude-api-sonnet': 'https://api.anthropic.com/v1/messages',
      'claude-api-haiku': 'https://api.anthropic.com/v1/messages',
      'claude-api-opus': 'https://api.anthropic.com/v1/messages',
      'gemini-api-flash': 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      'gemini-api-pro': 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
      'gemini-api-3-1-pro': 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-1-pro:generateContent',
      'ollama-cloud-pro': 'https://api.ollama.com/v1/generate'
    };
    return map[serviceName] || 'https://api.anthropic.com/v1/messages';
  }
  
  /**
   * Fallback model if router is unavailable
   */
  getFallbackModel() {
    return {
      service_name: 'gemini-api-flash',
      fallback: true,
      message: 'Using fallback model (router unavailable)',
      ready: false
    };
  }
  
  /**
   * Helper: Call LLM with automatic model selection
   * 
   * Usage:
   * const response = await bot.callLLMSmartly('Write a function to sum arrays', {
   *   taskType: 'coding',
   *   complexity: 'moderate'
   * });
   */
  async callLLMSmartly(prompt, options = {}) {
    const { taskType = 'chat', complexity = 'moderate', isUrgent = false } = options;
    
    // Select optimal model
    const model = await this.selectModelForTask(taskType, complexity, prompt, isUrgent);
    
    if (!model.ready && !model.fallback) {
      throw new Error(model.message || 'Could not select model');
    }
    
    console.log(`[${this.agent_id}] Using model: ${model.service_name}`);
    
    try {
      // Call LLM (implementation depends on API)
      // This is a placeholder
      const response = await this.callLLM(prompt, model);
      
      // Report usage (if key was ready)
      if (model.ready) {
        const tokens = this.estimateTokens(prompt, response);
        await this.reportUsage(model.service_id, tokens.input, tokens.output, tokens.cost);
      }
      
      return response;
    } catch (error) {
      console.error(`[${this.agent_id}] LLM call failed:`, error.message);
      throw error;
    }
  }
  
  /**
   * Placeholder: Actual LLM call implementation
   * (Should be implemented in subclass or passed in)
   */
  async callLLM(prompt, model) {
    throw new Error('callLLM not implemented - must be provided by subclass');
  }
  
  /**
   * Estimate tokens (placeholder)
   */
  estimateTokens(prompt, response) {
    const promptChars = (prompt || '').length;
    const responseChars = (response || '').length;
    const avgCharsPerToken = 4;
    
    const inputTokens = Math.ceil(promptChars / avgCharsPerToken);
    const outputTokens = Math.ceil(responseChars / avgCharsPerToken);
    
    // Rough cost estimation
    let costPerToken = 0.00001;  // Default
    if (response.model_name && response.model_name.includes('opus')) {
      costPerToken = 0.00006;
    } else if (response.model_name && response.model_name.includes('flash')) {
      costPerToken = 0.00000053;
    }
    
    const cost = (inputTokens + outputTokens) * costPerToken;
    
    return {
      input: inputTokens,
      output: outputTokens,
      cost: parseFloat(cost.toFixed(6))
    };
  }
}

module.exports = {
  BotWithRouter
};
