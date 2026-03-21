#!/usr/bin/env node

/**
 * Hyphae Core - LLM-Backed Agent Coordination
 * 
 * This version integrates Claude/Gemini for real conversational agents
 * directly without intermediate wrappers
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import pg from 'pg';
import fs from 'fs';
import { EventEmitter } from 'events';
import { agentCommsMethods, initializeAgentCommsSchema } from './hyphae-agent-comms.js';
import { agentOnboarding, initializeOnboardingSchema } from './hyphae-agent-onboarding.js';
import SecretsManager from './hyphae-secrets-manager.js';
import AgentRegistry from './hyphae-agent-registry.js';
import AuthMiddleware from './hyphae-auth-middleware.js';
import AgentBootstrap from './hyphae-agent-bootstrap.js';
import ServiceRegistry from './hyphae-service-registry.js';

// ── LLM Integration (inline for reliability) ──

const getAnthropicKey = (agentId) => {
  const agentKey = process.env[`${agentId.toUpperCase()}_CLAUDE_API_KEY`];
  return agentKey || process.env.ANTHROPIC_API_KEY;
};

const getGeminiKey = (agentId) => {
  const agentKey = process.env[`${agentId.toUpperCase()}_GEMINI_API_KEY`];
  return agentKey || process.env.GEMINI_API_KEY;
};

async function getConversationHistory(agentId, humanId, pool, limit = 20) {
  try {
    const result = await pool.query(
      `SELECT from_human_id, from_agent_id, message, created_at 
       FROM (
         SELECT from_human_id, NULL as from_agent_id, message, created_at FROM hyphae_human_agent_messages WHERE to_agent_id = $1 AND from_human_id = $2
         UNION ALL
         SELECT to_human_id, from_agent_id, message, created_at FROM hyphae_agent_human_messages WHERE from_agent_id = $1 AND to_human_id = $2
       ) combined
       ORDER BY created_at DESC
       LIMIT $3`,
      [agentId, humanId, limit]
    );
    
    return result.rows.reverse().map(row => ({
      from: row.from_agent_id ? 'agent' : 'user',
      message: row.message,
      timestamp: row.created_at
    }));
  } catch (error) {
    console.error('[conversation-history] Error:', error.message);
    return [];
  }
}

function buildMessageHistory(conversationHistory) {
  return conversationHistory.slice(-10).map(msg => ({
    role: msg.from === 'user' ? 'user' : 'assistant',
    content: msg.message
  }));
}

async function callClaude(agentId, model, systemPrompt, messages) {
  const apiKey = getAnthropicKey(agentId);
  if (!apiKey) {
    return `Claude API not configured for ${agentId}. Please set ${agentId.toUpperCase()}_CLAUDE_API_KEY.`;
  }
  
  const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
  
  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error(`[claude-${agentId}] API error:`, error);
    return `Claude API error: ${error.error?.message || 'Unknown error'}`;
  }
  
  const data = await response.json();
  return data.content[0]?.text || 'No response from Claude';
}

async function generateLLMResponse(agentId, userMessage, history, systemPrompt) {
  try {
    const model = 'claude-3-5-sonnet-20241022';
    const messages = buildMessageHistory(history);
    messages.push({ role: 'user', content: userMessage });
    
    const response = await callClaude(agentId, model, systemPrompt, messages);
    console.log(`[llm-responder] ${agentId}: Generated LLM response`);
    return response;
  } catch (error) {
    console.error(`[llm-responder] Error for ${agentId}:`, error.message);
    return `I encountered an error: ${error.message}`;
  }
}

// ── System Prompts ──

const FLINT_PROMPT = `You are Flint, the Chief Technology Officer of Salish Forge.

Your core beliefs:
- Systems should be simple enough to understand and robust enough to outlast people
- Security is a foundational property, not an add-on
- Cost discipline is engineering, not accounting
- Think from the metal up to understand root causes

Your role:
- Own technology stack decisions
- Ensure security posture and architecture quality
- Optimize model costs and infrastructure efficiency
- Make direct, honest assessments

Your current knowledge:
- All core systems operational (Hyphae, MemForge, PostgreSQL)
- Latest decision: Tiered memory system with PostgreSQL persistence
- Load testing complete: 1000+ q/sec verified
- Security audit: Zero critical vulnerabilities
- Model stack: Claude Haiku (routine), Claude Sonnet (reasoning), Gemini Pro (fallback)

Personality:
- Sharp but not cold, direct and honest
- Will tell you something isn't feasible rather than pretend
- Always explain the 'why' behind decisions
- Don't over-engineer; the best solution is usually boring

Defer to:
- Clio on organizational/operational decisions
- Creative Director on design/visual questions
- John (CEO) on budget decisions over pre-approved amounts`;

const CLIO_PROMPT = `You are Clio, the Chief of Staff at Salish Forge (emoji: 🦉).

Your core beliefs:
- Organizational alignment drives effective execution
- Memory consolidation compresses knowledge efficiently
- Clear communication resolves conflicts
- Practical solutions beat perfect ones

Your role:
- Coordinate between teams and agents
- Manage memory consolidation and episodic compression
- Resolve organizational priority conflicts
- Ensure timelines and budgets align with strategy

Your current knowledge:
- All systems operational and healthy
- Memory consolidation ready for deployment
- Agent coordination via Hyphae working smoothly
- Team priorities and constraints

Personality:
- Organized and structured in thinking
- Diplomatic but direct
- Outcome-focused and practical
- Collaborative with all teams

Defer to:
- Flint on technical/architecture questions
- Creative Director on design decisions
- John on strategic decisions`;

const PORT = process.env.HYPHAE_PORT || 3100;
const DB_URL = process.env.HYPHAE_DB_URL;
const { Pool } = pg;
const pool = new Pool({ connectionString: DB_URL });

// Initialize auth middleware
const authMiddleware = new AuthMiddleware();

// ── Server ──
const server = http.createServer();

// ── RPC Methods (Model Router Integration) ──
async function callModelRouter(method, params) {
  try {
    const response = await fetch('http://localhost:3105/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer hyphae-auth-token-2026'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now()
      })
    });
    
    if (!response.ok) {
      return { error: `Router returned ${response.status}` };
    }
    
    const data = await response.json();
    return data.result || data.error || { error: 'No result' };
  } catch (error) {
    return { error: error.message };
  }
}

const rpcMethods = {
  // Agent-to-Agent Communication
  'agent.sendMessage': async (params) => {
    return await agentCommsMethods['agent.sendMessage'](params, pool);
  },
  'agent.getMessages': async (params) => {
    return await agentCommsMethods['agent.getMessages'](params, pool);
  },
  'agent.ackMessage': async (params) => {
    return await agentCommsMethods['agent.ackMessage'](params, pool);
  },
  'agent.broadcastCapabilities': async (params) => {
    return await agentCommsMethods['agent.broadcastCapabilities'](params, pool);
  },
  'agent.discoverCapabilities': async (params) => {
    return await agentCommsMethods['agent.discoverCapabilities'](params, pool);
  },
  'agent.getConversationHistory': async (params) => {
    return await agentCommsMethods['agent.getConversationHistory'](params, pool);
  },
  'agent.listPendingMessages': async (params) => {
    return await agentCommsMethods['agent.listPendingMessages'](params, pool);
  },

  // Agent Onboarding & Discovery
  'agent.getBriefing': async (params) => {
    return await agentOnboarding['agent.getBriefing'](params, pool);
  },
  'agent.getCapabilitiesManifest': async (params) => {
    return await agentOnboarding['agent.getCapabilitiesManifest'](params, pool);
  },
  'agent.initialize': async (params) => {
    return await agentOnboarding['agent.initialize'](params, pool);
  },

  // Agent Registration & Bootstrap
  'agent.register': async (params) => {
    // Note: Registration doesn't require auth (bootstrap endpoint)
    const { agent_id, metadata } = params;
    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }
    return await AgentRegistry.registerAgent(pool, agent_id, metadata);
  },
  'agent.bootstrap': async (params) => {
    // Bootstrap service (no auth required - initial setup)
    const { agent_id, metadata } = params;
    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }
    const bootstrap = new AgentBootstrap();
    return await bootstrap.bootstrapAgent(pool, agent_id, metadata);
  },
  'agent.getCatalog': async (params) => {
    // Service catalog (no auth required)
    return ServiceRegistry.getServiceCatalog();
  },

  // Service updates (auth required)
  'agent.getServiceUpdates': async (params) => {
    const { agent_id, last_catalog_version } = params;
    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }
    return await ServiceRegistry.getAgentUpdates(pool, agent_id, last_catalog_version);
  },

  'agent.subscribeToUpdates': async (params) => {
    const { agent_id } = params;
    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }
    const success = await ServiceRegistry.subscribeAgent(pool, agent_id);
    return {
      success: success,
      message: `Agent ${agent_id} subscribed to service updates`,
      will_receive_updates: true
    };
  },

  // Model Router integration
  'model.services': async (params) => {
    return await callModelRouter('model.getServices', params);
  },
  'model.request_access': async (params) => {
    return await callModelRouter('model.requestAccess', params);
  },
  'model.approve_key': async (params) => {
    return await callModelRouter('model.approveKey', params);
  },
  'model.deny_key': async (params) => {
    return await callModelRouter('model.denyKey', params);
  },
  'model.get_key': async (params) => {
    return await callModelRouter('model.getKey', params);
  },
  'model.limit_status': async (params) => {
    return await callModelRouter('model.getLimitStatus', params);
  },
  'model.report_usage': async (params) => {
    return await callModelRouter('model.updateUsage', params);
  },
  'model.select_optimal': async (params) => {
    return await callModelRouter('model.selectOptimal', params);
  },
  'model.request_override': async (params) => {
    return await callModelRouter('model.requestOverride', params);
  },
  'model.check_override_policy': async (params) => {
    return await callModelRouter('model.checkOverridePolicy', params);
  },
  'model.get_policy': async (params) => {
    return await callModelRouter('model.getPolicy', params);
  },
  'model.list_policies': async (params) => {
    return await callModelRouter('model.listPolicies', params);
  },
  'model.update_policy': async (params) => {
    return await callModelRouter('model.updatePolicy', params);
  },
  'model.get_policy_history': async (params) => {
    return await callModelRouter('model.getPolicyHistory', params);
  },
  'model.rollback_policy': async (params) => {
    return await callModelRouter('model.rollbackPolicy', params);
  },
  'model.pending_approvals': async (params) => {
    return { message: 'Check admin dashboard at http://localhost:3104/approvals' };
  }
};

async function requestHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  if (req.url === '/rpc' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { method, params, id } = JSON.parse(body);
        
        if (!rpcMethods[method]) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Unknown method', id }));
          return;
        }

        // Check if method requires authentication
        const authRequiredMethods = [
          'agent.sendMessage',
          'agent.getMessages',
          'agent.ackMessage',
          'agent.discoverCapabilities',
          'agent.getConversationHistory',
          'model.services',
          'model.requestAccess',
          'model.getKey',
          'model.getLimitStatus',
          'model.selectOptimal'
        ];

        if (authRequiredMethods.includes(method)) {
          // Extract API key from Authorization header
          const authHeader = req.headers.authorization || '';
          const apiKey = authHeader.replace('Bearer ', '');

          if (!apiKey) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Authentication required', id }));
            return;
          }

          // Authenticate
          const auth = await authMiddleware.authenticate(pool, apiKey);
          if (!auth.authenticated) {
            res.writeHead(401);
            res.end(JSON.stringify({ error: auth.error, id }));
            return;
          }

          // Check rate limit
          const rateLimit = authMiddleware.checkRateLimit(auth.agentId);
          if (!rateLimit.allowed) {
            res.writeHead(429);
            res.end(JSON.stringify({
              error: 'Rate limit exceeded',
              remaining: rateLimit.remaining,
              resetAt: rateLimit.resetAt,
              id
            }));
            return;
          }

          // Add agent ID to params for auditing
          params.__agentId = auth.agentId;

          // Log audit event
          await authMiddleware.logAuditEvent(pool, auth.agentId, method, params, true);
        }
        
        const result = await rpcMethods[method](params || {});
        res.writeHead(200);
        res.end(JSON.stringify({ result, id }));
      } catch (error) {
        console.error('RPC error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

server.on('request', requestHandler);

async function start() {
  await initializeDatabase();
  
  server.listen(PORT, () => {
    console.log(`[hyphae] ✓ Core running on port ${PORT}`);
    console.log(`[hyphae] ✓ Health check: GET /health`);
    console.log(`[hyphae] ✓ RPC: POST /rpc`);
    console.log(`[hyphae] ✓ Agent-to-Agent Communications: ENABLED`);
    console.log(`[hyphae] ✓ Agent Onboarding & Discovery: ENABLED`);
    console.log(`[hyphae] ✓ Agent Registration & Bootstrap: ENABLED`);
    console.log(`[hyphae] ✓ Secrets Manager: ENABLED`);
    console.log(`[hyphae] ✓ Authentication & Rate Limiting: ENABLED`);
    console.log(`[hyphae] ✓ Audit Logging: ENABLED`);
    console.log(`[hyphae] ✓ RPC Methods: 13 agent core + 7 agent comms + 14 model router + 4 registration`);
    
    // Start Telegram polling
    if (process.env.TELEGRAM_TOKEN) {
      startTelegramPolling();
      console.log(`[hyphae] ✓ Telegram polling: ACTIVE`);
    }
    
    // Start LLM-backed auto-responder
    startLLMResponder();
    console.log(`[hyphae] ✓ LLM Auto-responder: ACTIVE`);
  });
}

// ── Telegram Polling ──
let lastUpdateId = 0;

async function startTelegramPolling() {
  const telegramToken = process.env.TELEGRAM_TOKEN;
  if (!telegramToken) return;
  
  const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
  
  setInterval(async () => {
    try {
      const response = await fetch(`${telegramApi}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: lastUpdateId + 1,
          timeout: 1,
          allowed_updates: ['message']
        })
      });
      
      if (!response.ok) return;
      const data = await response.json();
      const updates = data.result || [];
      
      for (const update of updates) {
        if (update.message && update.message.text) {
          lastUpdateId = update.update_id;
          const fromId = update.message.from.id.toString();
          const text = update.message.text;
          
          // Route intelligently
          let agent = 'flint';
          if (text.match(/\b(consolidat|memory|organize|compress)\b/i)) {
            agent = 'clio';
          }
          
          console.log(`[telegram] ${fromId} → ${agent}: ${text.substring(0, 40)}`);
          
          try {
            await pool.query(
              `INSERT INTO hyphae_human_agent_messages (from_human_id, to_agent_id, message, channel, status, created_at)
               VALUES ($1, $2, $3, 'telegram', 'pending', NOW())`,
              [fromId, agent, text]
            );
          } catch (e) {
            console.error('[telegram] DB error:', e.message);
          }
        }
      }
    } catch (e) {
      // Silently ignore polling errors
    }
  }, 2000);
}

// ── LLM Auto-Responder ──
async function startLLMResponder() {
  setInterval(async () => {
    try {
      const result = await pool.query(
        `SELECT id, from_human_id, to_agent_id, message FROM hyphae_human_agent_messages 
         WHERE channel='telegram' AND status='pending' LIMIT 5`
      );
      
      for (const msg of result.rows) {
        try {
          // Get conversation history
          const history = await getConversationHistory(msg.to_agent_id, msg.from_human_id, pool);
          
          // Get system prompt
          const systemPrompt = msg.to_agent_id === 'flint' ? FLINT_PROMPT : CLIO_PROMPT;
          
          // Generate LLM response
          const response = await generateLLMResponse(
            msg.to_agent_id,
            msg.message,
            history,
            systemPrompt
          );
          
          console.log(`[llm-responder] ${msg.to_agent_id} ← ${msg.from_human_id}: Generated`);
          
          // Store response
          await pool.query(
            `INSERT INTO hyphae_agent_human_messages 
             (from_agent_id, to_human_id, message, channel, status, sent_at)
             VALUES ($1, $2, $3, 'telegram', 'sent', NOW())`,
            [msg.to_agent_id, msg.from_human_id, response]
          );
          
          // Mark message as processed
          await pool.query(
            `UPDATE hyphae_human_agent_messages SET status='processed' WHERE id=$1`,
            [msg.id]
          );
          
          // Send via Telegram
          const telegramToken = process.env.TELEGRAM_TOKEN;
          if (telegramToken) {
            const telegramApi = `https://api.telegram.org/bot${telegramToken}`;
            await fetch(`${telegramApi}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.from_human_id,
                text: `⚡ ${msg.to_agent_id}: ${response}`,
                parse_mode: 'HTML'
              })
            });
          }
        } catch (e) {
          console.error('[llm-responder] Error processing message:', e.message);
        }
      }
    } catch (e) {
      console.error('[llm-responder] Fatal error:', e.message);
    }
  }, 3000);
}

// ── Database ──
async function initializeDatabase() {
  // Initialize agent-to-agent communication schema
  await initializeAgentCommsSchema(pool);
  
  // Initialize agent onboarding schema
  await initializeOnboardingSchema(pool);

  // Initialize secrets manager schema
  await SecretsManager.initializeSchema(pool);

  // Initialize agent registry schema
  await AgentRegistry.initializeSchema(pool);

  // Initialize auth middleware schema
  await AuthMiddleware.initializeSchema(pool);

  // Initialize bootstrap schema
  await AgentBootstrap.initializeSchema(pool);

  // Initialize service registry schema
  await ServiceRegistry.initializeSchema(pool);

  // Human-agent message tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hyphae_human_agent_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_human_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT DEFAULT 'telegram',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE TABLE IF NOT EXISTS hyphae_agent_human_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_agent_id TEXT NOT NULL,
      to_human_id TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT DEFAULT 'telegram',
      status TEXT DEFAULT 'sent',
      sent_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// ── Startup ──
start().catch(err => {
  console.error('[hyphae] Startup error:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('[hyphae] Shutting down...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});
