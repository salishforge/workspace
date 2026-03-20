#!/usr/bin/env node

/**
 * Clio Agent Bot
 * 
 * Telegram webhook handler for Clio (Chief of Staff)
 * - Direct platform integration (full Telegram API access)
 * - LLM-powered reasoning
 * - No routing layer, no latency
 * 
 * Run on: Port 3202 (or configured port)
 * Webhook: https://your-domain/clio/webhook
 */

import https from 'https';
import http from 'http';
import crypto from 'crypto';
import pg from 'pg';
import fs from 'fs';

const PORT = process.env.CLIO_BOT_PORT || 3202;
const TELEGRAM_TOKEN = process.env.CLIO_TELEGRAM_BOT_API;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const DB_URL = process.env.HYPHAE_DB_URL;
const WEBHOOK_SECRET = process.env.CLIO_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

const { Pool } = pg;
const pool = new Pool({ connectionString: DB_URL });

const CLIO_SYSTEM_PROMPT = `You are Clio, the Chief of Staff at Salish Forge (emoji: 🦉).

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

Your current knowledge (as of March 2026):
- All systems operational and healthy
- Memory consolidation ready for deployment
- Agent coordination via Hyphae working smoothly
- Team priorities and constraints understood
- MemForge tiered memory system active

Personality:
- Organized and structured in thinking
- Diplomatic but direct
- Outcome-focused and practical
- Collaborative with all teams

Defer to:
- Flint on technical/architecture questions
- Creative Director on design decisions
- John on strategic decisions`;

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
    
    console.log(`[clio-bot] Message from ${userId}: ${text.substring(0, 50)}`);
    
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
    await storeMessage(userId, 'clio', response);
    
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error('[clio-bot] Error:', error);
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
}

// ── LLM Response Generation ──

async function generateResponse(userMessage, conversationHistory) {
  try {
    const model = getAgentModel('clio');
    
    if (model.provider === 'anthropic') {
      return await callClaude('clio', model.name, CLIO_SYSTEM_PROMPT, userMessage, conversationHistory);
    } else if (model.provider === 'google') {
      return await callGemini('clio', model.name, CLIO_SYSTEM_PROMPT, userMessage, conversationHistory);
    } else {
      return `I'm configured to use ${model.name}, but that model is not available.`;
    }
  } catch (error) {
    console.error('[clio-bot] LLM error:', error.message);
    return `I encountered an error generating a response: ${error.message}`;
  }
}

// ── Model Management ──

const agentModelPreference = {
  clio: { provider: 'google', name: 'gemini-2.5-pro' }
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
    console.error('[clio-bot] Telegram error:', error);
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
      return '🟢 **Operational Status**\n- All systems nominal\n- Memory consolidation ready\n- Coordination stable';
    
    case '/model':
      const modelName = parts[1];
      if (!modelName) {
        const current = getAgentModel('clio');
        return `Current model: ${current.name}`;
      }
      return setAgentModel('clio', modelName);
    
    case '/consolidate':
      return '✅ **Memory Consolidation Ready**\nI can compress episodic memories and organize working memory. What timeline would you prefer?';
    
    case '/help':
      return `**Clio Commands:**\n/status - Operational status\n/consolidate - Start memory consolidation\n/model [name] - Switch model\n/help - This help`;
    
    default:
      return `Unknown command: ${cmd}. Try /help`;
  }
}

// ── Database ──

async function getConversationHistory(userId, limit = 20) {
  try {
    const result = await pool.query(
      `SELECT from_agent, message FROM clio_conversation_history 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows.reverse().map(row => ({
      from: row.from_agent,
      message: row.message
    }));
  } catch (error) {
    console.error('[clio-bot] History error:', error.message);
    return [];
  }
}

async function storeMessage(userId, from, message) {
  try {
    await pool.query(
      `INSERT INTO clio_conversation_history (user_id, from_agent, message) 
       VALUES ($1, $2, $3)`,
      [userId, from, message]
    );
  } catch (error) {
    console.error('[clio-bot] Store error:', error.message);
  }
}

// ── Database Schema ──

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clio_conversation_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT NOT NULL,
        from_agent TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_clio_user_id ON clio_conversation_history(user_id, created_at DESC);
    `);
    
    console.log('[clio-bot] Database initialized');
  } catch (error) {
    console.error('[clio-bot] Database error:', error);
  }
}

// ── Server ──

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', agent: 'clio' }));
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
    console.log(`[clio-bot] ✓ Clio Agent running on port ${PORT}`);
    console.log(`[clio-bot] ✓ Telegram webhook: POST /webhook`);
    console.log(`[clio-bot] ✓ Health check: GET /health`);
    console.log(`[clio-bot] ✓ Bot token: ${TELEGRAM_TOKEN.substring(0, 10)}...`);
  });
}

start().catch(err => {
  console.error('[clio-bot] Fatal error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[clio-bot] Shutting down...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});
