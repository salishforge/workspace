#!/usr/bin/env node

/**
 * Telegram Message Coordinator
 * 
 * Central polling service that manages Telegram updates for all agents
 * Prevents conflicts when multiple bots try to poll simultaneously
 * 
 * Routes incoming messages to appropriate agent endpoints
 */

const FLINT_TOKEN = process.env.FLINT_TELEGRAM_BOT_API || '8512187116:AAFPkeNNpGIAEiY117OQw7l75CHabUH3ZU8';
const CLIO_TOKEN = process.env.CLIO_TELEGRAM_BOT_API || '8789255068:AAF92Z1thzb66VxMkH9l-03pMmaeGosnMqg';

const FLINT_ENDPOINT = 'http://localhost:3201/handle-message';
const CLIO_ENDPOINT = 'http://localhost:3202/handle-message';

let lastUpdateId = 0;

// Map of which agent handles which chat
const agentRouting = {};

async function pollMessages() {
  try {
    // Poll from Clio's token (arbitrary choice - could be either)
    const url = `https://api.telegram.org/bot${CLIO_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.ok || !data.result) {
      return;
    }
    
    for (const update of data.result) {
      lastUpdateId = update.update_id;
      
      if (update.message) {
        await routeMessage(update.message);
      }
    }
  } catch (error) {
    console.error('[coordinator] Polling error:', error.message);
  }
}

async function routeMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text || '';
  
  console.log(`[coordinator] Message from ${userId}: ${text.substring(0, 40)}`);
  
  // Route to both agents (they decide independently)
  const endpoints = [
    { agent: 'flint', url: FLINT_ENDPOINT, token: FLINT_TOKEN },
    { agent: 'clio', url: CLIO_ENDPOINT, token: CLIO_TOKEN }
  ];
  
  for (const endpoint of endpoints) {
    try {
      await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          chatId,
          userId,
          text,
          token: endpoint.token
        })
      });
    } catch (error) {
      console.warn(`[coordinator] Failed to route to ${endpoint.agent}:`, error.message);
    }
  }
}

// Start polling
console.log('[coordinator] ✅ Telegram coordinator started');
console.log('[coordinator] Polling for messages...');

setInterval(pollMessages, 2000);
pollMessages();
