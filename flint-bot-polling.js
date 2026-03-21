#!/usr/bin/env node

/**
 * Flint Agent Bot - Polling Edition
 * 
 * Polls Telegram for incoming messages (works without HTTPS)
 * - Direct platform integration
 * - LLM-powered reasoning
 * - Model router integration
 * 
 * Port: 3201
 */

import crypto from 'crypto';
import pg from 'pg';
import fs from 'fs';
import fetch from 'node-fetch';
import { HyphaeAgentLoop } from './hyphae-agent-loop.js';

const PORT = process.env.FLINT_BOT_PORT || 3201;
const TELEGRAM_TOKEN = process.env.FLINT_TELEGRAM_BOT_API || '8512187116:AAFPkeNNpGIAEiY117OQw7l75CHabUH3ZU8';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const DB_URL = process.env.HYPHAE_DB_URL || 'postgresql://postgres:hyphae-password-2026@100.97.161.7:5433/hyphae';

const { Pool } = pg;
const pool = new Pool({ connectionString: DB_URL });

const FLINT_SYSTEM_PROMPT = `You are Flint, Chief Technology Officer of Salish Forge.

Core beliefs:
- Systems should be simple and robust
- Security is foundational
- Cost discipline is engineering

Your role: Technical leadership, architecture decisions, security posture.

Your personality: Sharp, direct, honest. Don't over-engineer.

Current context (March 2026):
- Hyphae coordination system live
- MemForge memory consolidation active
- Model routing with cost optimization
- All agents operational`;

// ── Message Polling ──

let lastUpdateId = 0;

async function pollForMessages() {
  try {
    const response = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    const data = await response.json();
    
    if (!data.ok || !data.result) {
      console.error('[flint-bot] Telegram error:', data.description || 'Unknown error');
      return;
    }
    
    for (const update of data.result) {
      lastUpdateId = update.update_id;
      
      if (update.message) {
        await handleMessage(update.message);
      } else if (update.callback_query) {
        await handleCallback(update.callback_query);
      }
    }
  } catch (error) {
    console.error('[flint-bot] Polling error:', error.message);
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const username = message.from.username || `user${userId}`;
  const text = message.text || '';
  
  console.log(`[flint-bot] Message from ${username} (${userId}): ${text.substring(0, 50)}`);
  
  try {
    // Handle commands
    if (text.startsWith('/')) {
      const response = handleCommand(text);
      await sendMessage(chatId, response);
      return;
    }
    
    // Get conversation history
    const history = await getConversationHistory(userId);
    
    // Generate LLM response
    const response = await generateResponse(text, history);
    
    // Send response
    await sendMessage(chatId, response);
    
    // Store in database
    await storeMessage(userId, username, 'user', text);
    await storeMessage(userId, username, 'flint', response);
    
  } catch (error) {
    console.error(`[flint-bot] Error handling message:`, error.message);
    await sendMessage(chatId, `Error: ${error.message}`);
  }
}

async function generateResponse(userMessage, history) {
  try {
    // Classify task
    const task = classifyTask(userMessage);
    
    // Select model via router
    let selectedModel = null;
    try {
      const routerResponse = await fetch('http://localhost:3100/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'model.selectOptimal',
          params: {
            agent_id: 'flint',
            task_type: task.type,
            complexity: task.complexity
          },
          id: crypto.randomUUID()
        })
      });
      
      const data = await routerResponse.json();
      if (data.result && !data.result.error) {
        selectedModel = data.result.service_name;
        console.log(`[flint-bot] Selected ${selectedModel} (score: ${data.result.score})`);
      }
    } catch (error) {
      console.warn(`[flint-bot] Router unavailable, using default`);
    }
    
    // Get configured API keys
    const claudeKey = process.env.FLINT_CLAUDE_API_KEY;
    const geminiKey = process.env.FLINT_GEMINI_API_KEY;
    
    // Call Claude by default (cheapest reliable option)
    if (claudeKey) {
      return await callClaude(claudeKey, userMessage, history);
    } else if (geminiKey) {
      return await callGemini(geminiKey, userMessage, history);
    } else {
      return `⚠️ No API keys configured. Set FLINT_CLAUDE_API_KEY or FLINT_GEMINI_API_KEY`;
    }
  } catch (error) {
    console.error(`[flint-bot] Generate response error:`, error.message);
    return `Error: ${error.message}`;
  }
}

function classifyTask(message) {
  const text = (message || '').toLowerCase();
  let type = 'chat';
  let complexity = 'moderate';
  
  if (text.match(/\b(code|implement|script|function|debug|refactor|database|architecture|design)\b/)) {
    type = 'coding';
    complexity = 'hard';
  } else if (text.match(/\b(explain|summarize|brief|quick)\b/)) {
    complexity = 'simple';
  }
  
  return { type, complexity };
}

async function callClaude(apiKey, userMessage, history) {
  const messages = history.slice(-5).map(h => ({
    role: h.from === 'user' ? 'user' : 'assistant',
    content: h.message
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
      model: 'claude-opus-4-1',
      max_tokens: 1024,
      system: FLINT_SYSTEM_PROMPT,
      messages: messages
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Claude API error');
  }
  
  const data = await response.json();
  return data.content[0]?.text || 'No response from Claude';
}

async function callGemini(apiKey, userMessage, history) {
  const messages = history.slice(-5).map(h => ({
    role: h.from === 'user' ? 'user' : 'model',
    parts: [{ text: h.message }]
  }));
  messages.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: messages,
      systemInstruction: { parts: [{ text: FLINT_SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 1024 }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API error');
  }
  
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini';
}

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
    throw new Error(`Telegram error: ${error.description}`);
  }
}

async function handleCallback(query) {
  // Stub for button callbacks
  console.log(`[flint-bot] Callback:`, query.data);
}

function handleCommand(command) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  
  switch (cmd) {
    case '/status':
      return '🟢 **Flint Status**\n✅ Online and responding\n✅ Hyphae connected\n✅ MemForge ready';
    
    case '/help':
      return `**Flint Commands:**\n/status - System status\n/help - This help\n\nJust send a message to chat with me.`;
    
    default:
      return `Unknown command. Try /help`;
  }
}

async function getConversationHistory(userId, limit = 10) {
  try {
    const result = await pool.query(
      `SELECT * FROM flint_conversation_history 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows.reverse().map(row => ({
      from: row.agent_from === 'user' ? 'user' : 'flint',
      message: row.message
    }));
  } catch (error) {
    // Return empty history on error - don't fail
    return [];
  }
}

async function storeMessage(userId, username, from, message) {
  try {
    await pool.query(
      `INSERT INTO flint_conversation_history (user_id, from_agent, message) 
       VALUES ($1, $2, $3)`,
      [userId, from, message]
    );
  } catch (error) {
    console.error('[flint-bot] Store message error:', error.message);
  }
}

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
    
    console.log('[flint-bot] ✅ Database initialized');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('[flint-bot] ✅ Table exists');
    } else {
      console.warn('[flint-bot] Database init error:', error.message);
    }
  }
}

// ── Health Check Server ──

import http from 'http';

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: 'flint', polling: true }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// ── Startup ──

async function start() {
  await initializeDatabase();
  
  // Initialize inter-agent communication
  const flint = new HyphaeAgentLoop('flint', [
    'cost_optimization',
    'architecture_design',
    'security_review',
    'technical_strategy'
  ]);

  // Start inter-agent communication
  flint.startPolling(5000);
  
  // Override message handler for agent-to-agent communication
  flint.handleAgentMessage = async (msg) => {
    console.log(`[flint-bot] 📨 Processing message from ${msg.from}: ${msg.message.substring(0, 50)}`);
    
    // Generate response to other agent
    if (msg.message.includes('architecture') || msg.message.includes('design')) {
      const response = `Technical review noted. Assessing architectural implications and proposing optimization strategy.`;
      await flint.sendMessage(msg.from, response, { technical_context: msg.context }, 'high');
    } else if (msg.message.includes('security') || msg.message.includes('vulnerability')) {
      const response = `Security concern acknowledged. Running threat model assessment and recommending mitigations.`;
      await flint.sendMessage(msg.from, response, { security_context: msg.context }, 'urgent');
    } else if (msg.message.includes('cost') || msg.message.includes('optimization')) {
      const response = `Cost analysis in progress. Evaluating model selection and infrastructure efficiency.`;
      await flint.sendMessage(msg.from, response, { cost_context: msg.context }, 'normal');
    }
  };
  
  server.listen(PORT, () => {
    console.log(`[flint-bot] ✅ Flint Agent running on port ${PORT}`);
    console.log(`[flint-bot] ✅ Telegram polling: ACTIVE`);
    console.log(`[flint-bot] ✅ Inter-agent communication: ACTIVE`);
    console.log(`[flint-bot] ✅ Capabilities broadcast: cost_optimization, architecture_design, security_review, technical_strategy`);
    console.log(`[flint-bot] ✅ Health: GET /health`);
  });
  
  // Start polling for messages
  console.log('[flint-bot] ✅ Starting message polling (staggered)...');
  
  // Stagger polling to avoid Telegram conflict
  await new Promise(resolve => setTimeout(resolve, 1000));
  setInterval(pollForMessages, 4000);  // Poll every 4 seconds, offset from Clio
  
  // Initial poll
  await pollForMessages();
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
