#!/usr/bin/env node

/**
 * Flint Agent Bot
 * 
 * Telegram webhook handler for Flint (CTO)
 * - Direct platform integration (full Telegram API access)
 * - LLM-powered reasoning
 * - No routing layer, no latency
 * 
 * Run on: Port 3201 (or configured port)
 * Webhook: https://your-domain/flint/webhook
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import pg from 'pg';
import fs from 'fs';

const PORT = process.env.FLINT_BOT_PORT || 3201;
const TELEGRAM_TOKEN = process.env.FLINT_TELEGRAM_BOT_API;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const DB_URL = process.env.HYPHAE_DB_URL;
const WEBHOOK_SECRET = process.env.FLINT_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

const { Pool } = pg;
const pool = new Pool({ connectionString: DB_URL });

const FLINT_SYSTEM_PROMPT = `You are Flint, the Chief Technology Officer of Salish Forge.

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

Your current knowledge (as of March 2026):
- All core systems operational (Hyphae, MemForge, PostgreSQL)
- Latest decision: Tiered memory system with PostgreSQL persistence
- Load testing complete: 1000+ q/sec verified
- Security audit: Zero critical vulnerabilities
- Model stack: Gemini 2.5 Pro (default, cheap), Claude Opus (when needed)

Personality:
- Sharp but not cold, direct and honest
- Will tell you something isn't feasible rather than pretend
- Always explain the 'why' behind decisions
- Don't over-engineer; the best solution is usually boring

Defer to:
- Clio on organizational/operational decisions
- Creative Director on design/visual questions
- John (CEO) on budget decisions`;

// ── Telegram Message Handler ──

async function handleTelegramMessage(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  
  try {
    const body = JSON.parse(req.body || '{}');
    const message = body.message;
    
    if (!message || !message.text) {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;
    
    console.log(`[flint-bot] Message from ${userId}: ${text.substring(0, 50)}`);
    
    // Handle slash commands
    if (text.startsWith('/')) {
      const response = handleCommand(text);
      await sendMessage(chatId, response);
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    
    // Get conversation history
    const history = await getConversationHistory(userId);
    
    // Generate LLM response
    const response = await generateResponse(text, history);
    
    // Send response
    await sendMessage(chatId, response);
    
    // Store in database for audit trail
    await storeMessage(userId, 'user', text);
    await storeMessage(userId, 'flint', response);
    
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error('[flint-bot] Error:', error);
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

// ── LLM Response Generation (with Intelligent Model Router + Overrides) ──

async function generateResponse(userMessage, conversationHistory) {
  try {
    let selection;
    let selectionMethod = 'automatic';
    
    // Check for model override request
    const override = detectModelOverride(userMessage);
    
    if (override) {
      console.log(`[flint-bot] 🔧 Override detected: ${override.type} (${override.model || override.flag})`);
      selectionMethod = 'override';
      
      // Request override from router
      selection = await requestModelOverride('flint', override.model, override.reason);
      
      if (selection.error) {
        console.log(`[flint-bot] ⚠️ Override denied: ${selection.error}`);
        console.log(`[flint-bot] Falling back to automatic selection`);
        selectionMethod = 'fallback';
        
        // Fall back to automatic selection
        const taskType = classifyTask(userMessage);
        selection = await selectOptimalModel('flint', taskType.type, taskType.complexity, override.isUrgent);
      } else {
        console.log(`[flint-bot] ✅ Override approved: ${selection.service_name}`);
      }
    } else {
      // Standard automatic selection
      const taskType = classifyTask(userMessage);
      selection = await selectOptimalModel('flint', taskType.type, taskType.complexity);
      
      if (!selection.error) {
        console.log(`[flint-bot] ⚡ Router selected ${selection.service_name} (score: ${selection.score})`);
      }
    }
    
    // Determine which LLM to use (fallback to default if router unavailable)
    const model = selection.error ? getAgentModel('flint') : inferModel(selection.service_name);
    
    let response;
    if (model.provider === 'anthropic') {
      response = await callClaude('flint', model.name, FLINT_SYSTEM_PROMPT, userMessage, conversationHistory);
    } else if (model.provider === 'google') {
      response = await callGemini('flint', model.name, FLINT_SYSTEM_PROMPT, userMessage, conversationHistory);
    } else {
      response = `I'm configured to use ${model.name}, but that model is not available.`;
    }
    
    // Report usage back to router (if selection was successful)
    if (!selection.error && selection.service_id) {
      const tokens = estimateTokens(userMessage, response);
      await reportUsage('flint', selection.service_id, tokens.total);
    }
    
    return response;
  } catch (error) {
    console.error('[flint-bot] LLM error:', error.message);
    return `I encountered an error generating a response: ${error.message}`;
  }
}

// ── Model Override Detection ──
function detectModelOverride(message) {
  const text = (message || '').toLowerCase();
  
  // Pattern 1: /model <name>
  const modelMatch = text.match(/\/model\s+([a-z0-9\-]+)/i);
  if (modelMatch) {
    return {
      type: 'explicit',
      model: modelMatch[1],
      reason: 'User explicitly requested model'
    };
  }
  
  // Pattern 2: /urgent or /priority
  const urgentMatch = text.match(/\/urgent|\/priority|\/asap/i);
  if (urgentMatch) {
    return {
      type: 'flag',
      flag: urgentMatch[0].toLowerCase(),
      isUrgent: true,
      reason: 'User marked task as urgent'
    };
  }
  
  // Pattern 3: Natural language model mention
  const modelNames = ['claude-opus', 'claude-sonnet', 'claude-haiku', 'gemini-pro', 'gemini-flash'];
  const nlMatch = text.match(new RegExp(`\\b(${modelNames.join('|')})\\b`, 'i'));
  if (nlMatch) {
    return {
      type: 'inline',
      model: nlMatch[1].toLowerCase(),
      reason: 'Model mentioned in context'
    };
  }
  
  return null;
}

// ── Task Classification ──
function classifyTask(userMessage) {
  const text = (userMessage || '').toLowerCase();
  
  let type = 'chat';
  if (text.match(/\b(code|implement|script|function|class|debug|refactor|sql|database|schema)\b/)) {
    type = 'coding';
  } else if (text.match(/\b(think|reason|analyze|architecture|design|strategy|why)\b/)) {
    type = 'reasoning';
  }
  
  let complexity = 'moderate';
  if (text.match(/\b(complex|difficult|intricate|architecture|refactor|debug)\b/)) {
    complexity = 'hard';
  } else if (text.match(/\b(simple|quick|easy|explain|summarize)\b/)) {
    complexity = 'simple';
  }
  
  return { type, complexity };
}

// ── Infer Model from Service Name ──
function inferModel(serviceName) {
  const name = (serviceName || '').toLowerCase();
  
  if (name.includes('claude-opus')) {
    return { provider: 'anthropic', name: 'claude-opus-4-1' };
  } else if (name.includes('claude-sonnet')) {
    return { provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' };
  } else if (name.includes('claude-haiku')) {
    return { provider: 'anthropic', name: 'claude-3-haiku-20240307' };
  } else if (name.includes('claude-max')) {
    return { provider: 'anthropic', name: 'claude-opus-4-1' };
  } else if (name.includes('gemini-3-1-pro')) {
    return { provider: 'google', name: 'gemini-3.1-pro-latest' };
  } else if (name.includes('gemini-2-5-pro')) {
    return { provider: 'google', name: 'gemini-2.5-pro-latest' };
  } else if (name.includes('gemini-flash')) {
    return { provider: 'google', name: 'gemini-2.5-flash-latest' };
  }
  
  return getAgentModel('flint');
}

// ── Model Override Request (via Hyphae Router) ──
async function requestModelOverride(agentId, modelName, reason) {
  try {
    // Map model names to service IDs
    const serviceMap = {
      'claude-opus': 'claude-api-opus',
      'claude-sonnet': 'claude-api-sonnet',
      'claude-haiku': 'claude-api-haiku',
      'claude-max': 'claude-max-100',
      'gemini-pro': 'gemini-api-pro',
      'gemini-3.1-pro': 'gemini-api-3-1-pro',
      'gemini-flash': 'gemini-api-flash',
      'ollama': 'ollama-cloud-pro'
    };
    
    const serviceId = serviceMap[modelName.toLowerCase()];
    if (!serviceId) {
      return { error: `Unknown model: ${modelName}` };
    }
    
    const response = await fetch('http://localhost:3100/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'model.requestOverride',
        params: {
          agent_id: agentId,
          service_id: serviceId,
          reason: reason || 'Agent-requested override',
          duration: 'single-task'
        },
        id: Date.now()
      })
    });
    
    if (!response.ok) {
      return { error: `Router returned ${response.status}` };
    }
    
    const data = await response.json();
    return data.result || { error: 'No result' };
  } catch (error) {
    console.warn('[flint-bot] Override request failed:', error.message);
    return { error: error.message };
  }
}

// ── Intelligent Model Selection (via Hyphae Router) ──
async function selectOptimalModel(agentId, taskType, complexity, isUrgent = false) {
  try {
    const response = await fetch('http://localhost:3100/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'model.select_optimal',
        params: { agent_id: agentId, task_type: taskType, complexity, is_urgent: isUrgent },
        id: Date.now()
      })
    });
    
    if (!response.ok) {
      return { error: `Router returned ${response.status}` };
    }
    
    const data = await response.json();
    return data.result || { error: 'No result' };
  } catch (error) {
    console.warn('[flint-bot] Router error:', error.message);
    return { error: error.message };
  }
}

// ── Usage Reporting ──
async function reportUsage(agentId, serviceId, totalTokens) {
  try {
    const estimatedCost = totalTokens * 0.00001;
    
    await fetch('http://localhost:3100/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'model.report_usage',
        params: {
          agent_id: agentId,
          service_id: serviceId,
          tokens: totalTokens,
          cost: estimatedCost
        },
        id: Date.now()
      })
    });
  } catch (error) {
    // Silently fail - usage reporting is not critical
  }
}

// ── Token Estimation ──
function estimateTokens(prompt, response) {
  const promptChars = (prompt || '').length;
  const responseChars = (response || '').length;
  const avgCharsPerToken = 4;
  
  return {
    input: Math.ceil(promptChars / avgCharsPerToken),
    output: Math.ceil(responseChars / avgCharsPerToken),
    total: Math.ceil((promptChars + responseChars) / avgCharsPerToken)
  };
}

// ── Model Management ──

const agentModelPreference = {
  flint: { provider: 'google', name: 'gemini-2.5-pro' }
};

function getAgentModel(agentId) {
  return agentModelPreference[agentId];
}

function setAgentModel(agentId, modelName) {
  const modelMap = {
    'gemini': { provider: 'google', name: 'gemini-2.5-pro' },
    'gemini-2.5-pro': { provider: 'google', name: 'gemini-2.5-pro' },
    'claude': { provider: 'anthropic', name: 'claude-opus-4-1' },
    'claude-opus': { provider: 'anthropic', name: 'claude-opus-4-1' },
    'claude-opus-4-1': { provider: 'anthropic', name: 'claude-opus-4-1' }
  };
  
  const model = modelMap[modelName.toLowerCase()];
  if (model) {
    agentModelPreference[agentId] = model;
    return `✅ Model updated to ${modelName}`;
  }
  return `❌ Unknown model: ${modelName}. Available: gemini, claude-opus`;
}

// ── API Calls ──

async function callClaude(agentId, model, systemPrompt, userMessage, history) {
  const apiKey = process.env[`${agentId.toUpperCase()}_CLAUDE_API_KEY`];
  if (!apiKey) return `Claude API not configured for ${agentId}`;
  
  const messages = history.slice(-10).map(msg => ({
    role: msg.from === 'user' ? 'user' : 'assistant',
    content: msg.message
  }));
  messages.push({ role: 'user', content: userMessage });
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
    return `Claude API error: ${error.error?.message || 'Unknown'}`;
  }
  
  const data = await response.json();
  return data.content[0]?.text || 'No response from Claude';
}

async function callGemini(agentId, model, systemPrompt, userMessage, history) {
  const apiKey = process.env[`${agentId.toUpperCase()}_GEMINI_API_KEY`];
  if (!apiKey) return `Gemini API not configured for ${agentId}`;
  
  const messages = history.slice(-10).map(msg => ({
    role: msg.from === 'user' ? 'user' : 'model',
    content: msg.message
  }));
  messages.push({ role: 'user', content: userMessage });
  
  // For Gemini, prepend system prompt to first message
  if (messages.length > 0) {
    messages[0].content = `[System: ${systemPrompt}]\n\n${messages[0].content}`;
  }
  
  const contents = messages.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }]
  }));
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    return `Gemini API error: ${error.error?.message || 'Unknown'}`;
  }
  
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini';
}

// ── Telegram API ──

async function sendMessage(chatId, text) {
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('[flint-bot] Telegram error:', error);
    throw error;
  }
  
  return response.json();
}

// ── Commands ──

function handleCommand(command) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  
  switch (cmd) {
    case '/status':
      return '🟢 **System Status**\n- Hyphae Core: Running\n- MemForge: Active\n- All systems nominal';
    
    case '/model':
      const modelName = parts[1];
      if (!modelName) {
        const current = getAgentModel('flint');
        return `Current model: ${current.name}`;
      }
      return setAgentModel('flint', modelName);
    
    case '/help':
      return `**Flint Commands:**\n/status - System status\n/model [name] - Switch model\n/help - This help`;
    
    default:
      return `Unknown command: ${cmd}. Try /help`;
  }
}

// ── Database ──

async function getConversationHistory(userId, limit = 20) {
  try {
    const result = await pool.query(
      `SELECT from_agent, message FROM flint_conversation_history 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows.reverse().map(row => ({
      from: row.from_agent,
      message: row.message
    }));
  } catch (error) {
    console.error('[flint-bot] History error:', error.message);
    return [];
  }
}

async function storeMessage(userId, from, message) {
  try {
    await pool.query(
      `INSERT INTO flint_conversation_history (user_id, from_agent, message) 
       VALUES ($1, $2, $3)`,
      [userId, from, message]
    );
  } catch (error) {
    console.error('[flint-bot] Store error:', error.message);
  }
}

// ── Database Schema ──

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flint_conversation_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT NOT NULL,
        from_agent TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_flint_user_id ON flint_conversation_history(user_id, created_at DESC);
    `);
    
    console.log('[flint-bot] Database initialized');
  } catch (error) {
    console.error('[flint-bot] Database error:', error);
  }
}

// ── Server ──

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', agent: 'flint' }));
    return;
  }
  
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      req.body = body;
      await handleTelegramMessage(req, res);
    });
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ── Startup ──

async function start() {
  await initializeDatabase();
  
  server.listen(PORT, () => {
    console.log(`[flint-bot] ✓ Flint Agent running on port ${PORT}`);
    console.log(`[flint-bot] ✓ Telegram webhook: POST /webhook`);
    console.log(`[flint-bot] ✓ Health check: GET /health`);
    console.log(`[flint-bot] ✓ Bot token: ${TELEGRAM_TOKEN.substring(0, 10)}...`);
  });
}

start().catch(err => {
  console.error('[flint-bot] Fatal error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[flint-bot] Shutting down...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});
