/**
 * Telegram Channel Provider
 * 
 * Implements the communication channel interface for Telegram
 * Abstracted so other channels (Discord, Slack, WhatsApp) can be swapped in
 */

import fetch from 'node-fetch';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'NOT_CONFIGURED';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

export class TelegramChannel {
  /**
   * Send message to human via Telegram
   * 
   * @param {string|number} to_user_id - Telegram chat ID
   * @param {string} message - Message text (supports HTML formatting)
   * @param {object} metadata - Additional context (from_agent, timestamp, etc.)
   * @returns {object} Delivery status
   */
  async send(to_user_id, message, metadata = {}) {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'NOT_CONFIGURED') {
      console.warn('[telegram] Token not configured, simulating send');
      return {
        channel: 'telegram',
        status: 'simulated',
        to_user_id,
        message_preview: message.substring(0, 50),
        timestamp: new Date().toISOString()
      };
    }

    try {
      const payload = {
        chat_id: to_user_id,
        text: this.formatMessage(message, metadata),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };

      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 5000
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${text}`);
      }

      const data = await response.json();

      return {
        channel: 'telegram',
        status: 'sent',
        to_user_id,
        message_id: data.result.message_id,
        timestamp: new Date(data.result.date * 1000).toISOString()
      };
    } catch (error) {
      console.error('[telegram] Send failed:', error.message);
      return {
        channel: 'telegram',
        status: 'failed',
        to_user_id,
        error: error.message
      };
    }
  }

  /**
   * Handle incoming Telegram message
   * Parse and route to appropriate agent
   * 
   * @param {object} update - Telegram webhook update
   * @returns {object} Routed message ready for agent delivery
   */
  async receive(update) {
    if (!update.message || !update.message.text) {
      return null;
    }

    const message = update.message;
    const from_user_id = message.from.id.toString();
    const text = message.text;
    const timestamp = new Date(message.date * 1000);

    // Route based on message content
    const to_agent_id = this.routeMessage(text);

    return {
      from_human_id: from_user_id,
      to_agent_id,
      message: text,
      channel: 'telegram',
      metadata: {
        human_name: `${message.from.first_name} ${message.from.last_name || ''}`.trim(),
        telegram_message_id: message.message_id,
        chat_id: message.chat.id,
        received_at: timestamp
      }
    };
  }

  /**
   * Route incoming message to appropriate agent
   * Simple keyword-based routing; can be extended
   * 
   * @param {string} text - Message text
   * @returns {string} Agent ID (flint or clio)
   */
  routeMessage(text) {
    // Technical questions → Flint (CTO)
    if (text.match(/\b(architecture|code|technical|performance|memory|query|database|api|schema|design|implementation|optimization|latency|throughput|security|encryption|audit|framework|service|integration|deployment|infrastructure|monitoring|logging)\b/i)) {
      return 'flint';
    }

    // Organization/coordination → Clio (Chief of Staff)
    if (text.match(/\b(schedule|timeline|priority|approval|budget|coordination|planning|status|meeting|update|report|feedback|review|consolidation|decision|organization|process)\b/i)) {
      return 'clio';
    }

    // Default to Clio for everything else
    return 'clio';
  }

  /**
   * Format message for Telegram
   * Add agent info and timestamp
   * 
   * @param {string} message - Raw message text
   * @param {object} metadata - Message metadata
   * @returns {string} Formatted message with metadata
   */
  formatMessage(message, metadata = {}) {
    let formatted = message;

    // Add agent signature
    if (metadata.from_agent) {
      const agent = metadata.from_agent === 'flint' ? '⚡ Flint' : '🦉 Clio';
      formatted = `<b>${agent}</b>:\n\n${formatted}`;
    }

    // Add timestamp
    if (metadata.timestamp) {
      const time = new Date(metadata.timestamp).toLocaleTimeString();
      formatted += `\n\n<i>─ ${time}</i>`;
    }

    return formatted;
  }

  /**
   * Get channel information and status
   * 
   * @returns {object} Channel info
   */
  async get_channel_info() {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'NOT_CONFIGURED') {
      return {
        channel_name: 'telegram',
        status: 'not_configured',
        bot_username: 'NOT_SET',
        is_available: false,
        error: 'TELEGRAM_TOKEN environment variable not set',
        capabilities: []
      };
    }

    try {
      // Test connectivity
      const response = await fetch(`${TELEGRAM_API}/getMe`, { timeout: 5000 });
      if (!response.ok) {
        return {
          channel_name: 'telegram',
          status: 'disconnected',
          is_available: false,
          error: `Telegram API error: ${response.status}`
        };
      }

      const data = await response.json();
      const botInfo = data.result;

      return {
        channel_name: 'telegram',
        status: 'connected',
        bot_username: botInfo.username,
        bot_id: botInfo.id,
        is_available: true,
        capabilities: ['send', 'receive', 'forward', 'format_html'],
        max_message_length: 4096,
        supported_formats: ['text', 'html'],
        webhook_enabled: process.env.TELEGRAM_WEBHOOK_URL ? true : false
      };
    } catch (error) {
      return {
        channel_name: 'telegram',
        status: 'error',
        is_available: false,
        error: error.message
      };
    }
  }

  /**
   * Validate incoming webhook
   * Ensures message is from Telegram
   * 
   * @param {string} token - Telegram bot token (from env)
   * @param {object} body - Request body
   * @param {string} signature - X-Telegram-Bot-API-Secret-Token header
   * @returns {boolean} True if valid
   */
  validateWebhook(body, signature) {
    // Telegram uses a simple secret token validation
    // The token is sent in X-Telegram-Bot-API-Secret-Token header
    // We check it against TELEGRAM_SECRET_TOKEN env var
    const expectedToken = process.env.TELEGRAM_SECRET_TOKEN;
    if (!expectedToken) {
      console.warn('[telegram] TELEGRAM_SECRET_TOKEN not configured, skipping validation');
      return true;  // Allow if not configured
    }
    return signature === expectedToken;
  }
}

export default TelegramChannel;
