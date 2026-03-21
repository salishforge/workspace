/**
 * Hyphae Agent Base Loop
 * 
 * Polling mechanism for agents to:
 * 1. Receive inter-agent messages
 * 2. Broadcast capabilities
 * 3. Discover other agents
 * 4. Respond to requests autonomously
 */

import fetch from 'node-fetch';

export class HyphaeAgentLoop {
  constructor(agentId, capabilities) {
    this.agentId = agentId;
    this.capabilities = capabilities;
    this.hyphaeCoreUrl = 'http://localhost:3100';
    this.messageBuffer = [];
    this.isPolling = false;
  }

  /**
   * Broadcast this agent's capabilities to other agents
   */
  async broadcastCapabilities() {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.broadcastCapabilities',
          params: {
            agent_id: this.agentId,
            capabilities: this.capabilities,
            availability: 'always'
          },
          id: Date.now()
        })
      });

      const data = await response.json();
      console.log(`[${this.agentId}] ✓ Capabilities broadcast: ${this.capabilities.join(', ')}`);
      return data.result;
    } catch (error) {
      console.error(`[${this.agentId}] Broadcast error:`, error.message);
      return null;
    }
  }

  /**
   * Discover capabilities of other agents
   */
  async discoverCapabilities() {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.discoverCapabilities',
          params: { requesting_agent: this.agentId },
          id: Date.now()
        })
      });

      const data = await response.json();
      const result = data.result || {};
      
      if (result.agents) {
        console.log(`[${this.agentId}] Discovered ${result.count} agents with capabilities`);
        return result.agents;
      }
      
      return [];
    } catch (error) {
      console.error(`[${this.agentId}] Discovery error:`, error.message);
      return [];
    }
  }

  /**
   * Poll for messages from other agents
   */
  async pollForMessages() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.getMessages',
          params: { agent_id: this.agentId, limit: 10 },
          id: Date.now()
        })
      });

      const data = await response.json();
      const result = data.result || {};

      if (result.messages && result.messages.length > 0) {
        console.log(`[${this.agentId}] ✉️  Received ${result.count} messages from other agents`);
        
        for (const msg of result.messages) {
          console.log(`[${this.agentId}] ← ${msg.from}: ${msg.message.substring(0, 60)}...`);
          
          // Buffer message for processing
          this.messageBuffer.push(msg);
          
          // Acknowledge receipt
          await this.ackMessage(msg.id);
        }
        
        return result.messages;
      }
    } catch (error) {
      console.error(`[${this.agentId}] Poll error:`, error.message);
    } finally {
      this.isPolling = false;
    }

    return [];
  }

  /**
   * Acknowledge a message
   */
  async ackMessage(messageId) {
    try {
      await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.ackMessage',
          params: { message_id: messageId, processed_by: this.agentId },
          id: Date.now()
        })
      });
    } catch (error) {
      console.error(`[${this.agentId}] Ack error:`, error.message);
    }
  }

  /**
   * Send a message to another agent
   */
  async sendMessage(toAgentId, message, context = null, priority = 'normal') {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.sendMessage',
          params: {
            from_agent_id: this.agentId,
            to_agent_id: toAgentId,
            message: message,
            context: context,
            priority: priority
          },
          id: Date.now()
        })
      });

      const data = await response.json();
      
      if (data.result && data.result.success) {
        console.log(`[${this.agentId}] → ${toAgentId}: Message sent (priority: ${priority})`);
        return data.result;
      } else {
        console.error(`[${this.agentId}] Send error:`, data.result?.error);
        return null;
      }
    } catch (error) {
      console.error(`[${this.agentId}] Send error:`, error.message);
      return null;
    }
  }

  /**
   * Get conversation history with another agent
   */
  async getConversationHistory(otherAgentId, limit = 20) {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.getConversationHistory',
          params: {
            agent_1: this.agentId,
            agent_2: otherAgentId,
            limit: limit
          },
          id: Date.now()
        })
      });

      const data = await response.json();
      return (data.result && data.result.history) || [];
    } catch (error) {
      console.error(`[${this.agentId}] History error:`, error.message);
      return [];
    }
  }

  /**
   * Get agent's onboarding briefing
   */
  async getBriefing() {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.getBriefing',
          params: { agent_id: this.agentId },
          id: Date.now()
        })
      });

      const data = await response.json();
      return data.result || null;
    } catch (error) {
      console.error(`[${this.agentId}] Briefing fetch error:`, error.message);
      return null;
    }
  }

  /**
   * Start continuous polling loop
   */
  startPolling(intervalMs = 5000) {
    console.log(`[${this.agentId}] Starting inter-agent polling (interval: ${intervalMs}ms)`);
    
    // Broadcast capabilities immediately
    this.broadcastCapabilities();

    // Poll for messages periodically
    setInterval(() => this.pollForMessages(), intervalMs);
    
    // Process buffered messages periodically
    setInterval(() => this.processMessageBuffer(), 3000);
  }

  /**
   * Process buffered messages
   */
  async processMessageBuffer() {
    while (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift();
      try {
        await this.handleAgentMessage(msg);
      } catch (error) {
        console.error(`[${this.agentId}] Error processing message:`, error.message);
      }
    }
  }

  /**
   * Handle incoming agent message (override in subclass for specific behavior)
   * Default: just log it
   */
  async handleAgentMessage(msg) {
    console.log(`[${this.agentId}] 📨 Message from ${msg.from}: "${msg.message.substring(0, 50)}..."`);
    console.log(`[${this.agentId}]    Priority: ${msg.priority}, Context: ${JSON.stringify(msg.context || {})}`);
    // Subclass should override this for specific behavior
  }
}

export default HyphaeAgentLoop;
