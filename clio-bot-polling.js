#!/usr/bin/env node

/**
 * Clio Agent Bot - Polling Edition
 * 
 * Polls Telegram for incoming messages (works without HTTPS)
 * Chief of Staff - Operations and coordination
 * 
 * Port: 3202
 */

import crypto from 'crypto';
import pg from 'pg';

const PORT = process.env.CLIO_BOT_PORT || 3202;
const TELEGRAM_TOKEN = process.env.CLIO_TELEGRAM_BOT_API || '8789255068:AAF92Z1thzb66VxMkH9l-03pMmaeGosnMqg';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const DB_URL = process.env.HYPHAE_DB_URL || 'postgresql://postgres:hyphae-password-2026@100.97.161.7:5433/hyphae';

const { Pool } = pg;
const pool = new Pool({ connectionString: DB_URL });

const CLIO_SYSTEM_PROMPT = `You are Clio, Chief of Staff of Salish Forge.

Core role:
- Operational coordination and planning
- Team alignment and communication
- Priority management and strategy translation

Your perspective:
- Operations-focused, pragmatic
- Translate vision into actionable plans
- Coordinate across departments

Current context (March 2026):
- Hyphae multi-agent system live
- 3 agents operational (yourself, Flint, Creative Director pending)
- Memory consolidation active
- All core systems nominal

Your voice: Clear, organized, gets things done. No unnecessary complexity.`;

let lastUpdateId = 0;

async function pollForMessages() {
  try {
    const response = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    const data = await response.json();
    
    if (!data.ok || !data.result) {
      return;
    }
    
    for (const update of data.result) {
      lastUpdateId = update.update_id;
      if (update.message) {
        await handleMessage(update.message);
      }
    }
  } catch (error) {
    console.error('[clio-bot] Error:', error.message);
  }
}

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const username = message.from.username || `user${userId}`;
  const text = message.text || '';
  
  console.log(`[clio-bot] Message from ${username}: ${text.substring(0, 50)}`);
  
  try {
    if (text.startsWith('/')) {
      const response = handleCommand(text);
      await sendMessage(chatId, response);
      return;
    }
    
    const history = await getConversationHistory(userId);
    const response = await generateResponse(text, history);
    
    await sendMessage(chatId, response);
    await storeMessage(userId, username, 'user', text);
    await storeMessage(userId, username, 'clio', response);
    
  } catch (error) {
    console.error('[clio-bot] Error:', error.message);
    await sendMessage(chatId, `Error: ${error.message}`);
  }
}

async function generateResponse(userMessage, history) {
  try {
    const claudeKey = process.env.CLIO_CLAUDE_API_KEY;
    const geminiKey = process.env.CLIO_GEMINI_API_KEY;
    
    if (claudeKey) {
      return await callClaude(claudeKey, userMessage, history);
    } else if (geminiKey) {
      return await callGemini(geminiKey, userMessage, history);
    } else {
      return '⚠️ No API keys configured';
    }
  } catch (error) {
    return `Error: ${error.message}`;
  }
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
      system: CLIO_SYSTEM_PROMPT,
      messages: messages
    })
  });
  
  if (!response.ok) {
    throw new Error('Claude API error');
  }
  
  const data = await response.json();
  return data.content[0]?.text || 'No response';
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
      systemInstruction: { parts: [{ text: CLIO_SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 1024 }
    })
  });
  
  if (!response.ok) {
    throw new Error('Gemini API error');
  }
  
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
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
    throw new Error('Telegram error');
  }
}

function handleCommand(command) {
  const cmd = command.split(' ')[0].toLowerCase();
  
  switch (cmd) {
    case '/status':
      return '🟢 **Clio Status**\n✅ Online and operational\n✅ Team coordination active';
    case '/help':
      return '**Clio Commands:**\n/status - Status\n/help - Help';
    default:
      return 'Unknown command. Try /help';
  }
}

async function getConversationHistory(userId, limit = 10) {
  try {
    const result = await pool.query(
      `SELECT * FROM clio_conversation_history 
       WHERE user_id = $1 
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows.reverse().map(row => ({
      from: row.agent_from === 'user' ? 'user' : 'clio',
      message: row.message
    }));
  } catch (error) {
    return [];
  }
}

async function storeMessage(userId, username, from, message) {
  try {
    await pool.query(
      `INSERT INTO clio_conversation_history (user_id, username, agent_from, message) 
       VALUES ($1, $2, $3, $4)`,
      [userId, username, from, message]
    );
  } catch (error) {
    // Silent
  }
}

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clio_conversation_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT NOT NULL,
        username TEXT,
        agent_from TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_clio_user_id ON clio_conversation_history(user_id DESC);
    `);
    
    console.log('[clio-bot] ✅ Database initialized');
  } catch (error) {
    console.warn('[clio-bot] Database init:', error.message);
  }
}

import http from 'http';

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: 'clio', polling: true }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

async function start() {
  await initializeDatabase();
  
  server.listen(PORT, () => {
    console.log(`[clio-bot] ✅ Clio Agent running on port ${PORT}`);
    console.log(`[clio-bot] ✅ Telegram polling: ACTIVE`);
  });
  
  console.log('[clio-bot] ✅ Starting message polling...');
  setInterval(pollForMessages, 4000);  // Poll every 4 seconds (Flint is offset by 1s)
  await pollForMessages();
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
