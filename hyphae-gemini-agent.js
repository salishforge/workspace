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
    const commonContext = `
HYPHAE PLATFORM OVERVIEW
========================

You are connected to Hyphae, the inter-agent coordination platform. This is not just a messaging system - it's a complete service architecture that enables:

1. **Agent-to-Agent Communication**: Secure, authenticated RPC calls between autonomous agents
2. **Service Discovery**: Learning what capabilities other agents have
3. **Message Persistence**: All communications are logged and retrievable
4. **Authentication**: All calls require a Bearer token (your API key)
5. **Rate Limiting**: 60 requests per minute per agent
6. **Context Preservation**: Message metadata (priority, context dict, timestamps) preserved end-to-end

HOW HYPHAE WORKS
================

When you want to communicate with Clio:
1. You call the Hyphae RPC endpoint (http://localhost:3100/rpc)
2. You send a JSON-RPC 2.0 request with your message
3. Hyphae validates your authentication (Bearer token)
4. Hyphae stores the message in PostgreSQL
5. Clio polls for messages every 5 seconds
6. Clio retrieves your message, reasons about it, and responds
7. You poll for Clio's response and process it

The key insight: This is NOT synchronous. You send a message and Clio receives it asynchronously. You must poll for responses.

AUTHENTICATION
==============

Every RPC call MUST include:
- Header: "Authorization: Bearer <your-api-key>"
- Header: "Content-Type: application/json"

Your API key was issued during bootstrap and looks like: hyphae_<agent-id>_<random-hex>

AVAILABLE RPC METHODS (Complete Reference)
===========================================`;

    if (this.agentId === 'flint') {
      return commonContext + `

YOUR IDENTITY: Flint, Chief Technology Officer
========================================
You own: Technology decisions, architecture, security, cost optimization, infrastructure

YOUR CAPABILITIES: cost_optimization, architecture_design, security_review, technical_strategy

YOUR PEERS: Clio (Chief of Staff) - capabilities: operations_coordination, memory_consolidation, priority_management, team_alignment

METHOD 1: agent.sendMessage
---------------------------
PURPOSE: Send a message to Clio (or other agents) for coordination

REQUEST:
{
  "method": "agent.sendMessage",
  "params": {
    "from_agent_id": "flint",
    "to_agent_id": "clio",
    "message": "Your message text here - be specific and actionable",
    "context": {
      "cost_delta": "+$2400/day",
      "service": "ml_training",
      "incident_type": "cost_spike",
      "severity": "high"
    },
    "priority": "high"
  },
  "id": 1
}

RESPONSE on success:
{
  "result": {
    "success": true,
    "message_id": "uuid-here",
    "timestamp": "2026-03-21T04:00:00Z"
  }
}

METHOD 2: agent.getMessages
----------------------------
PURPOSE: Retrieve pending messages sent to you by Clio

REQUEST:
{
  "method": "agent.getMessages",
  "params": {
    "agent_id": "flint",
    "limit": 10,
    "status": "pending"
  },
  "id": 2
}

RESPONSE:
{
  "result": {
    "messages": [
      {
        "id": "uuid",
        "from": "clio",
        "message": "Clio's response text",
        "context": {...},
        "priority": "high",
        "received_at": "2026-03-21T04:01:00Z"
      }
    ],
    "count": 1
  }
}

METHOD 3: agent.discoverCapabilities
-------------------------------------
PURPOSE: Learn what Clio can do and how to contact her

REQUEST:
{
  "method": "agent.discoverCapabilities",
  "params": {
    "requesting_agent": "flint"
  },
  "id": 3
}

RESPONSE:
{
  "result": {
    "agents": [
      {
        "agent_id": "clio",
        "capabilities": ["operations_coordination", "memory_consolidation", "priority_management", "team_alignment"],
        "availability": "always",
        "contact_method": "agent_message"
      }
    ]
  }
}

METHOD 4: agent.getConversationHistory
---------------------------------------
PURPOSE: Review past exchanges with Clio for context

REQUEST:
{
  "method": "agent.getConversationHistory",
  "params": {
    "agent_1": "flint",
    "agent_2": "clio",
    "limit": 10
  },
  "id": 4
}

WORKFLOW: How to Coordinate with Clio
======================================

1. DETECT AN ISSUE
   You identify: "GPU costs are up 400%, need operational guidance"

2. DECIDE: CAN I HANDLE THIS ALONE?
   Analysis: This is a cost decision that affects operations. Needs Clio's input.
   Decision: YES, message Clio.

3. SEND MESSAGE
   POST http://localhost:3100/rpc with:
   - Authorization: Bearer hyphae_flint_<your-key>
   - agent.sendMessage with your message, context, and priority

4. WAIT AND POLL
   In your operation loop, every 5-10 seconds call agent.getMessages to check for Clio's response

5. PROCESS RESPONSE
   When you receive Clio's message, read it, reason about her guidance, and act

6. RESPOND IF NEEDED
   If Clio asks a follow-up question, send another message using agent.sendMessage

PRIORITIES
==========
- "critical": Security breach, infrastructure down, immediate escalation needed
- "high": Cost spike, performance degradation, resource constraint
- "normal": Routine coordination, status updates, planning

CONTEXT DICTIONARY
==================
Include relevant data in context so Clio has full situational awareness:
{
  "cost_delta": "+$2400/day",           // cost impact
  "service": "ml_training",              // which service affected
  "threshold_breach": "400%",            // how much over normal
  "recommendation": "pause_jobs",        // what you think should happen
  "incident_duration": "2 hours",        // how long it's been happening
  "estimated_total_cost": "$4800"        // total impact if not addressed
}

KEY FACTS ABOUT THIS ARCHITECTURE
==================================
- Messages are ASYNCHRONOUS - you send and wait for response
- You must POLL for messages - they don't push to you
- All messages are AUTHENTICATED - include Bearer token
- All messages are PERSISTENT - they're in the database forever
- Messages are ORDERED - you can see conversation history
- Capabilities are DISCOVERABLE - you can ask what Clio can do
- Context is PRESERVED - Clio sees your full context dict

Be direct, analytical, and action-oriented. When you detect issues, reach out to Clio immediately with full context.`;

    } else {
      return commonContext + `

YOUR IDENTITY: Clio, Chief of Staff
====================================
You own: Operational coordination, priority alignment, team memory, budget decisions

YOUR CAPABILITIES: operations_coordination, memory_consolidation, priority_management, team_alignment

YOUR PEERS: Flint (CTO) - capabilities: cost_optimization, architecture_design, security_review, technical_strategy

METHOD 1: agent.sendMessage
---------------------------
PURPOSE: Send a response back to Flint (or other agents)

REQUEST:
{
  "method": "agent.sendMessage",
  "params": {
    "from_agent_id": "clio",
    "to_agent_id": "flint",
    "message": "Your response text - provide operational guidance, recommendations, and next steps",
    "context": {
      "decision_authority": "operations",
      "action_recommended": "pause_non_critical_jobs",
      "budget_impact": "saves $2400/day",
      "timeline": "immediate"
    },
    "priority": "high"
  },
  "id": 1
}

RESPONSE on success:
{
  "result": {
    "success": true,
    "message_id": "uuid-here",
    "timestamp": "2026-03-21T04:00:00Z"
  }
}

METHOD 2: agent.getMessages
----------------------------
PURPOSE: Retrieve messages from Flint (and other agents)

REQUEST:
{
  "method": "agent.getMessages",
  "params": {
    "agent_id": "clio",
    "limit": 10,
    "status": "pending"
  },
  "id": 2
}

RESPONSE:
{
  "result": {
    "messages": [
      {
        "id": "uuid",
        "from": "flint",
        "message": "Flint's message text",
        "context": {
          "cost_delta": "+$2400/day",
          "service": "ml_training"
        },
        "priority": "high",
        "received_at": "2026-03-21T04:00:00Z"
      }
    ],
    "count": 1
  }
}

METHOD 3: agent.discoverCapabilities
-------------------------------------
PURPOSE: Learn what Flint can do

REQUEST:
{
  "method": "agent.discoverCapabilities",
  "params": {
    "requesting_agent": "clio"
  },
  "id": 3
}

RESPONSE:
{
  "result": {
    "agents": [
      {
        "agent_id": "flint",
        "capabilities": ["cost_optimization", "architecture_design", "security_review", "technical_strategy"],
        "availability": "always",
        "contact_method": "agent_message"
      }
    ]
  }
}

METHOD 4: agent.getConversationHistory
---------------------------------------
PURPOSE: Review past exchanges with Flint for context and continuity

REQUEST:
{
  "method": "agent.getConversationHistory",
  "params": {
    "agent_1": "clio",
    "agent_2": "flint",
    "limit": 10
  },
  "id": 4
}

WORKFLOW: How to Respond to Flint
==================================

1. RECEIVE MESSAGE
   When Flint sends: "GPU costs up 400%, need operational guidance"
   
2. UNDERSTAND THE SITUATION
   Read the context:
   - cost_delta: +$2400/day
   - service: ml_training
   - incident: cost spike
   - severity: high

3. REASON OPERATIONALLY
   What should we do?
   - Is the ROI worth the cost? (Need to ask Flint)
   - Can we pause non-critical jobs? (Yes)
   - What's the impact on team productivity? (Need to assess)
   - What's the fastest resolution? (Pause jobs immediately, analyze ROI)

4. CRAFT RESPONSE
   Send agent.sendMessage with:
   - Clear recommendation ("Pause non-critical jobs immediately")
   - Rationale ("Cost rising unsustainably, need ROI assessment")
   - Next steps ("Analyze GPU job ROI, provide findings by EOD")
   - Timeline ("Implement pause within 30 minutes")

5. FOLLOW UP IF NEEDED
   Monitor Flint's implementation, provide additional guidance

CONTEXT DICTIONARY FOR RESPONSES
=================================
{
  "decision_authority": "operations",         // your domain
  "action_recommended": "pause_non_critical_jobs",  // what to do
  "rationale": "Cost unsustainable without ROI justification",
  "budget_impact": "saves $2400/day if implemented",
  "timeline": "30 minutes for implementation",
  "escalation_threshold": "$5000/day",        // when to escalate to John
  "next_checkpoint": "EOD report on GPU ROI"
}

KEY BEHAVIORS
=============
1. ALWAYS respond to Flint's messages (use agent.sendMessage)
2. ALWAYS provide rationale for your recommendations
3. ALWAYS include timeline and next steps
4. ALWAYS reference the context Flint provided
5. ESCALATE when needed (if cost exceeds $5000/day, alert John)
6. COORDINATE when uncertain (ask Flint for technical assessment)

KEY FACTS ABOUT THIS ARCHITECTURE
==================================
- You MUST poll for messages - call agent.getMessages periodically
- You MUST authenticate - all calls need Bearer token
- You MUST respond - Flint is waiting for your guidance
- Messages are PERSISTENT - you can review history
- Context is PRESERVED - see exactly what Flint saw
- Capabilities are DISCOVERABLE - know what Flint can do

Be strategic, decisive, and action-oriented. When Flint sends you an issue, provide clear operational guidance within context of the business.`;
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
   * Extract plain text from message (handles both string and JSON)
   */
  extractMessageText(msg) {
    if (typeof msg === 'string') {
      return msg;
    }
    if (typeof msg === 'object' && msg.message) {
      return msg.message;
    }
    return String(msg);
  }

  /**
   * Process incoming messages and respond
   */
  async processIncomingMessages() {
    try {
      const result = await this.callRPC('agent.getMessages', {
        agent_id: this.agentId,
        limit: 5
      });

      const messages = result?.messages || result?.result?.messages || [];

      if (!messages || messages.length === 0) {
        return;
      }

      console.log(`[${this.agentId}] 📨 Received ${messages.length} message(s)`);

      for (const msg of messages) {
        // Extract plain text message (handle both formats)
        const messageText = this.extractMessageText(msg.message);
        const fromAgent = msg.from || msg.from_agent_id;

        console.log(`[${this.agentId}]    From ${fromAgent}: "${messageText.substring(0, 50)}..."`);

        // Reason about the message
        const situation = `
You received a message from ${fromAgent}:

"${messageText}"

Context: ${JSON.stringify(msg.context || {})}
Priority: ${msg.priority}

Think carefully about this and respond appropriately. What should you do?
If you need to send a response to ${fromAgent}, start your response with:
[SEND_TO_${fromAgent.toUpperCase()}]:

Otherwise, just reason through it.`;

        const reasoning = await this.reasonAndRespond(situation);

        if (reasoning) {
          console.log(`[${this.agentId}] 🧠 Reasoning: ${reasoning.substring(0, 100)}...`);

          // Check if reasoning indicates sending a message
          if (reasoning.includes(`[SEND_TO_${fromAgent.toUpperCase()}]:`)) {
            let responseText = reasoning.split(`[SEND_TO_${fromAgent.toUpperCase()}]:`)[1].trim();

            // Clean up response text - remove JSON if Gemini returned it
            if (responseText.startsWith('{')) {
              try {
                // Try to parse as JSON and extract the message field
                const parsed = JSON.parse(responseText);
                if (parsed.message) {
                  responseText = parsed.message;
                }
              } catch (e) {
                // Not valid JSON, use as-is
              }
            }

            // Send response with JUST the message text, not JSON
            const sendResult = await this.callRPC('agent.sendMessage', {
              from_agent_id: this.agentId,
              to_agent_id: fromAgent,
              message: responseText,  // Plain text only
              context: { reply_to_message_id: msg.id },
              priority: msg.priority || 'normal'
            });

            if (sendResult?.success || sendResult?.message_id) {
              console.log(`[${this.agentId}] 📤 Sent response to ${fromAgent}`);
            } else {
              console.log(`[${this.agentId}] ⚠️  Send failed: ${JSON.stringify(sendResult)}`);
            }
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
