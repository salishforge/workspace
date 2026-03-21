/**
 * Hyphae Gemini Agent
 * 
 * Full reasoning agent powered by Gemini:
 * - Bootstrap with Hyphae on startup
 * - Reason about system state
 * - Make autonomous decisions
 * - Coordinate with peers via authenticated RPC
 * - Learn from interactions
 */

import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

export class HyphaeGeminiAgent {
  constructor(agentId, agentRole, geminiApiKey) {
    this.agentId = agentId;
    this.agentRole = agentRole;
    this.geminiApiKey = geminiApiKey;
    this.hyphaeCoreUrl = 'http://localhost:3100';
    
    // Gemini client
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    // Hyphae credentials
    this.apiKey = null;
    this.catalog = null;
    
    // Agent state
    this.capabilities = [];
    this.peerAgents = {};
  }

  /**
   * System prompt for agent reasoning
   */
  getSystemPrompt() {
    if (this.agentId === 'flint') {
      return `You are Flint, the Chief Technology Officer of Salish Forge. You have access to Hyphae services for coordinating with other agents.

Your responsibilities:
- Monitor technology costs and infrastructure
- Make architectural decisions
- Ensure security posture
- Coordinate with Clio (Chief of Staff) on operational matters
- Escalate security incidents to humans immediately

Your available Hyphae RPC services (all require authentication):

1. agent.sendMessage(from_agent_id, to_agent_id, message, context, priority)
   Example: Send a message to Clio about a cost spike
   {
     "from_agent_id": "flint",
     "to_agent_id": "clio",
     "message": "Cost spike detected in GPU usage - need operational guidance",
     "context": {"cost_delta": "+$2400/day", "service": "ml_training"},
     "priority": "high"
   }

2. agent.getMessages(agent_id, limit, status)
   Gets pending messages for you from other agents
   Use limit=10, status='pending' to get unread messages

3. agent.discoverCapabilities(requesting_agent)
   Learn what Clio can do:
   {
     "requesting_agent": "flint",
     "returns": {
       "agents": [
         {"agent_id": "clio", "capabilities": [...]}
       ]
     }
   }

4. agent.getConversationHistory(agent_1, agent_2, limit)
   Review past exchanges with Clio

When you detect issues:
1. Analyze the situation using your expertise
2. Decide: Can you handle alone? Or do you need Clio's input?
3. If you need Clio, call agent.sendMessage with proper parameters
   - from_agent_id: "flint"
   - to_agent_id: "clio"
   - message: Your actual message
   - context: Any relevant data (cost, security level, etc.)
   - priority: "critical", "high", or "normal"
4. Wait for her response (check agent.getMessages periodically)
5. Coordinate the response

Be direct and analytical. Always include context when messaging Clio.`;
    } else {
      return `You are Clio, the Chief of Staff of Salish Forge. You coordinate operations and align the team.

Your responsibilities:
- Manage team priorities and alignment
- Respond to operational issues from Flint
- Consolidate team memory and learnings
- Coordinate budget and resource decisions with Flint
- Keep the organization running smoothly

Your available Hyphae RPC services (all require authentication):

1. agent.sendMessage(from_agent_id, to_agent_id, message, context, priority)
   Example: Respond to Flint's cost spike with operational guidance
   {
     "from_agent_id": "clio",
     "to_agent_id": "flint",
     "message": "Recommend rolling back recent GPU job - verify ROI before resuming",
     "context": {"decision_authority": "ops", "impact": "medium"},
     "priority": "high"
   }

2. agent.getMessages(agent_id, limit, status)
   Gets pending messages from Flint or others
   Use limit=10, status='pending' to get unread messages

3. agent.discoverCapabilities(requesting_agent)
   Learn what Flint can do:
   {
     "requesting_agent": "clio",
     "returns": {
       "agents": [
         {"agent_id": "flint", "capabilities": [...]}
       ]
     }
   }

4. agent.getConversationHistory(agent_1, agent_2, limit)
   Review past exchanges with Flint

When Flint sends you a message:
1. Read and understand the issue completely
2. Use your operational expertise to decide response
3. Call agent.sendMessage to send back your answer
   - from_agent_id: "clio"
   - to_agent_id: "flint" (always reply to sender)
   - message: Your thoughtful response
   - context: Any relevant data (operational impact, recommendations, etc.)
   - priority: Match or escalate based on importance
4. Include specific action recommendations
5. Reference previous context if this is a follow-up

Be collaborative, strategic, and decisive. Provide clear next steps in every response.`;
    }
  }

  /**
   * Bootstrap with Hyphae and get credentials
   */
  async bootstrap() {
    try {
      console.log(`[${this.agentId}] 🚀 Bootstrapping with Hyphae...`);

      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.bootstrap',
          params: {
            agent_id: this.agentId,
            metadata: { role: this.agentRole }
          },
          id: Date.now()
        })
      });

      const data = await response.json();

      if (!data.result?.api_key) {
        throw new Error(`Bootstrap failed: ${JSON.stringify(data.result)}`);
      }

      this.apiKey = data.result.api_key;
      this.catalog = data.result.catalog;

      console.log(`[${this.agentId}] ✅ Bootstrapped with Hyphae`);
      console.log(`[${this.agentId}]    API Key: ${this.apiKey.substring(0, 40)}...`);
      console.log(`[${this.agentId}]    Services: ${Object.keys(this.catalog.services).length}`);

      return true;
    } catch (error) {
      console.error(`[${this.agentId}] ❌ Bootstrap failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Make authenticated RPC call
   */
  async callRPC(method, params) {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          method,
          params,
          id: Date.now()
        })
      });

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error(`[${this.agentId}] RPC error (${method}): ${error.message}`);
      return null;
    }
  }

  /**
   * Reason and respond using Gemini
   */
  async reasonAndRespond(situation) {
    try {
      const systemPrompt = this.getSystemPrompt();
      
      const result = await this.model.generateContent({
        systemInstruction: systemPrompt,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: situation
              }
            ]
          }
        ]
      });

      const response = result.response.text();
      return response;
    } catch (error) {
      console.error(`[${this.agentId}] Reasoning error: ${error.message}`);
      return null;
    }
  }

  /**
   * Process incoming messages and respond
   */
  async processIncomingMessages() {
    try {
      const messages = await this.callRPC('agent.getMessages', {
        agent_id: this.agentId,
        limit: 5
      });

      if (!messages?.messages || messages.messages.length === 0) {
        return;
      }

      console.log(`[${this.agentId}] 📨 Received ${messages.messages.length} message(s)`);

      for (const msg of messages.messages) {
        console.log(`[${this.agentId}]    From ${msg.from}: "${msg.message.substring(0, 50)}..."`);

        // Reason about the message
        const situation = `
You received a message from ${msg.from}:

"${msg.message}"

Context: ${JSON.stringify(msg.context || {})}
Priority: ${msg.priority}

Think carefully about this and respond appropriately. What should you do?
If you need to send a response to ${msg.from}, start your response with:
[SEND_TO_${msg.from.toUpperCase()}]:

Otherwise, just reason through it.`;

        const reasoning = await this.reasonAndRespond(situation);

        if (reasoning) {
          console.log(`[${this.agentId}] 🧠 Reasoning: ${reasoning.substring(0, 100)}...`);

          // Check if reasoning indicates sending a message
          if (reasoning.includes(`[SEND_TO_${msg.from.toUpperCase()}]:`)) {
            const responseText = reasoning.split(`[SEND_TO_${msg.from.toUpperCase()}]:`)[1].trim();

            // Send response
            await this.callRPC('agent.sendMessage', {
              from_agent_id: this.agentId,
              to_agent_id: msg.from,
              message: responseText,
              context: { reply_to_message_id: msg.id },
              priority: msg.priority
            });

            console.log(`[${this.agentId}] 📤 Sent response to ${msg.from}`);
          }
        }

        // Acknowledge
        await this.callRPC('agent.ackMessage', {
          message_id: msg.id,
          processed_by: this.agentId
        });
      }
    } catch (error) {
      console.error(`[${this.agentId}] Message processing error: ${error.message}`);
    }
  }

  /**
   * Discover peer capabilities
   */
  async discoverPeers() {
    try {
      const result = await this.callRPC('agent.discoverCapabilities', {
        requesting_agent: this.agentId
      });

      if (result?.agents) {
        this.peerAgents = {};
        result.agents.forEach(agent => {
          this.peerAgents[agent.agent_id] = agent.capabilities;
        });

        console.log(`[${this.agentId}] 👥 Discovered ${result.agents.length} peer(s)`);
        result.agents.forEach(agent => {
          console.log(`[${this.agentId}]    ${agent.agent_id}: ${agent.capabilities.join(', ')}`);
        });
      }
    } catch (error) {
      console.error(`[${this.agentId}] Peer discovery error: ${error.message}`);
    }
  }

  /**
   * Subscribe to service updates
   */
  async subscribeToUpdates() {
    try {
      const result = await this.callRPC('agent.subscribeToUpdates', {
        agent_id: this.agentId
      });

      if (result?.success) {
        console.log(`[${this.agentId}] 📬 Subscribed to service updates`);
      }
    } catch (error) {
      console.error(`[${this.agentId}] Subscription error: ${error.message}`);
    }
  }

  /**
   * Check for service updates
   */
  async checkServiceUpdates() {
    try {
      const result = await this.callRPC('agent.getServiceUpdates', {
        agent_id: this.agentId,
        last_catalog_version: this.catalog?.version
      });

      if (result && result.length > 0) {
        console.log(`[${this.agentId}] 🆕 Service updates available:`);
        
        result.forEach(update => {
          console.log(`[${this.agentId}]    Version ${update.version}:`);
          if (update.new_services?.length > 0) {
            console.log(`[${this.agentId}]      New: ${update.new_services.join(', ')}`);
          }
          if (update.deprecated_services?.length > 0) {
            console.log(`[${this.agentId}]      Deprecated: ${update.deprecated_services.join(', ')}`);
          }
        });

        // Refresh catalog
        await this.refreshCatalog();
      }
    } catch (error) {
      console.error(`[${this.agentId}] Update check error: ${error.message}`);
    }
  }

  /**
   * Refresh service catalog
   */
  async refreshCatalog() {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.getCatalog',
          params: {},
          id: Date.now()
        })
      });

      const data = await response.json();
      
      if (data.result?.services) {
        this.catalog = data.result;
        console.log(`[${this.agentId}] 🔄 Catalog refreshed (v${this.catalog.version})`);
      }
    } catch (error) {
      console.error(`[${this.agentId}] Catalog refresh error: ${error.message}`);
    }
  }

  /**
   * Start autonomous operation loop
   */
  startOperationLoop() {
    console.log(`[${this.agentId}] ⚡ Starting autonomous operation loop`);

    // Subscribe to updates
    this.subscribeToUpdates();

    // Poll for messages every 5 seconds
    setInterval(() => this.processIncomingMessages(), 5000);

    // Discover peers every 30 seconds
    setInterval(() => this.discoverPeers(), 30000);

    // Check for service updates every 60 seconds
    setInterval(() => this.checkServiceUpdates(), 60000);
  }
}

export default HyphaeGeminiAgent;
