# Hyphae Universal Channel Architecture

**Principle:** Hyphae owns all channel communication. Agents never directly poll or write to platforms.

**Status:** Design specification (implementation to follow)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL PLATFORMS                          │
│  Telegram │ Discord │ WhatsApp │ iMessage │ SMS │ Slack │ etc  │
└─────────────────────────────────────────────────────────────────┘
                             ▲
                             │
                    ┌────────┴────────┐
                    │                 │
         Polling    │    Webhooks     │    Cloud APIs
         (Telegram) │   (Discord)     │   (WhatsApp)
                    │                 │
┌───────────────────┴─────────────────┴───────────────────────────┐
│                   HYPHAE CHANNEL LAYER                           │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Universal Channel Registry (Hyphae Service)             │   │
│  │ - Register channels (Telegram, Discord, WhatsApp, etc)  │   │
│  │ - Manage API tokens and credentials                     │   │
│  │ - Health monitoring and reconnection                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ▼                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ Telegram       │  │ Discord        │  │ WhatsApp        │  │
│  │ Adapter        │  │ Adapter        │  │ Adapter         │  │
│  │                │  │                │  │                 │  │
│  │ - Poll msgs    │  │ - Webhook svc  │  │ - Cloud API     │  │
│  │ - Route to RPC │  │ - Route to RPC │  │ - Route to RPC  │  │
│  │ - Send replies │  │ - Send replies │  │ - Send replies  │  │
│  └────────────────┘  └────────────────┘  └─────────────────┘  │
│           ▼                   ▼                    ▼              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Message Queue / Event Bus (RPC)                           │ │
│  │  - hyphae.getMessages(agent_id, channel, limit)           │ │
│  │  - hyphae.sendMessage(agent_id, channel, user, text)      │ │
│  │  - hyphae.ackMessage(message_id)                          │ │
│  │  - hyphae.channelList() → available channels              │ │
│  │  - hyphae.channelInfo(channel_name) → API tokens, etc    │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
         ▲
         │
┌────────┴──────────────────────────────────────────────────────┐
│              AGENTS (Flint, Clio, others)                     │
│                                                                │
│  Agent loop:                                                  │
│  1. RPC call: hyphae.getMessages("flint", "telegram", 10)   │
│  2. Process messages (LLM reasoning, business logic)          │
│  3. RPC call: hyphae.sendMessage(...) to send responses       │
│  4. RPC call: hyphae.ackMessage(...) to mark as processed     │
│                                                                │
│  ✅ Agents NEVER directly access platform APIs               │
│  ✅ Agents NEVER poll external services                       │
│  ✅ Agents just process messages + respond via Hyphae         │
└────────────────────────────────────────────────────────────────┘
```

---

## Channel Adapters (Hyphae Services)

Each channel is a Hyphae service that:
1. **Manages platform connection** (tokens, auth, webhooks)
2. **Translates platform messages** → unified Hyphae message format
3. **Routes incoming messages** to message queue
4. **Sends agent responses** back to platform
5. **Handles platform-specific features** (rich text, attachments, etc.)

### Telegram Adapter

```javascript
// hyphae-channel-telegram.js
// Runs as Hyphae service on port 3200

class TelegramChannelAdapter {
  constructor(tokens) {
    // tokens = {
    //   "flint_hyphae_bot": "8512187116:AAF...",
    //   "cio_hyphae_bot": "8789255068:AAF..."
    // }
    this.tokens = tokens;
    this.bots = {};
  }

  async startPolling() {
    // Single polling loop for all bot tokens
    // No conflicts - Hyphae manages all tokens
    for (const [botName, token] of Object.entries(this.tokens)) {
      this.startBotPoller(botName, token);
    }
  }

  async startBotPoller(botName, token) {
    // This is owned by Hyphae, not by individual agents
    const pollUrl = `https://api.telegram.org/bot${token}/getUpdates`;
    
    while (true) {
      const updates = await fetch(pollUrl);
      for (const update of updates) {
        // Translate to Hyphae message format
        const msg = {
          id: crypto.randomUUID(),
          channel: "telegram",
          platform_id: `${botName}:${update.message.chat.id}`,
          from_user_id: update.message.from.id,
          text: update.message.text,
          timestamp: new Date(),
          metadata: {
            telegram: {
              bot_name: botName,
              chat_id: update.message.chat.id,
              message_id: update.message.message_id
            }
          }
        };

        // Store in Hyphae message queue
        await this.storeMessage(msg);
        
        // Notify agents via RPC
        await this.notifyAgents(msg);
      }
    }
  }

  async sendMessage(platformId, text) {
    // Agent calls: hyphae.sendMessage("telegram", platformId, text)
    // Hyphae calls: telegramAdapter.sendMessage(...)
    
    const [botName, chatId] = platformId.split(':');
    const token = this.tokens[botName];
    
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      body: { chat_id: chatId, text }
    });
  }
}
```

### Discord Adapter

```javascript
// hyphae-channel-discord.js
// Runs as Hyphae service on port 3201

class DiscordChannelAdapter {
  constructor(webhookUrl, botToken) {
    this.webhookUrl = webhookUrl;
    this.botToken = botToken;
    this.client = new Discord.Client();
  }

  async startWebhookServer() {
    // Hyphae hosts the webhook, not individual agents
    // Receives webhook POSTs from Discord
    // Routes messages to message queue
  }

  async sendMessage(channelId, text) {
    // Agent calls: hyphae.sendMessage("discord", channelId, text)
    // Hyphae calls: discordAdapter.sendMessage(...)
    
    const channel = await this.client.channels.fetch(channelId);
    await channel.send(text);
  }
}
```

### WhatsApp Adapter

```javascript
// hyphae-channel-whatsapp.js

class WhatsAppChannelAdapter {
  constructor(cloudApiToken, phoneNumber) {
    this.cloudApiToken = cloudApiToken;
    this.phoneNumber = phoneNumber;
  }

  async startWebhook() {
    // Hyphae hosts webhook for incoming messages
    // Validates signatures from WhatsApp
    // Routes to message queue
  }

  async sendMessage(recipientNumber, text) {
    await fetch('https://graph.instagram.com/v18.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cloudApiToken}` },
      body: {
        messaging_product: 'whatsapp',
        to: recipientNumber,
        type: 'text',
        text: { body: text }
      }
    });
  }
}
```

---

## Unified Message Format

All channels translate to this format in Hyphae:

```javascript
{
  id: "uuid",
  channel: "telegram" | "discord" | "whatsapp" | "sms" | etc,
  platform_id: "channel:user:account",  // Platform-specific identifier
  from_user_id: "8201776295",
  from_username: "john_brooke",
  text: "Your message here",
  attachments: [
    { type: "image", url: "...", mime: "image/jpeg" },
    { type: "file", name: "doc.pdf", url: "..." }
  ],
  timestamp: "2026-03-20T15:36:00Z",
  
  // Platform-specific metadata preserved
  metadata: {
    telegram: { chat_id: 123, message_id: 456 },
    discord: { guild_id: 789, channel_id: 101 },
    whatsapp: { message_id: "wamid.xxx", status_callback: "..." }
  }
}
```

---

## Agent Interface (Simple & Clean)

Agents never think about channels. Just use Hyphae RPC:

```javascript
// Flint Agent loop

async function agentLoop() {
  while (true) {
    // Get messages from all channels
    const messages = await hyphae.rpc('hyphae.getMessages', {
      agent_id: 'flint',
      channels: ['telegram', 'discord', 'whatsapp'],  // optional filter
      limit: 10
    });

    for (const msg of messages) {
      // Process message (LLM, business logic, etc)
      const response = await generateResponse(msg.text);

      // Send response back via Hyphae
      await hyphae.rpc('hyphae.sendMessage', {
        agent_id: 'flint',
        channel: msg.channel,
        platform_id: msg.platform_id,
        text: response
      });

      // Mark as processed
      await hyphae.rpc('hyphae.ackMessage', {
        message_id: msg.id
      });
    }
  }
}
```

---

## Hyphae Channel Registry Service

RPC methods:

```javascript
{
  // List available channels
  'hyphae.channelList': async (params) => {
    return [
      { name: 'telegram', status: 'connected', adapters: 2 },
      { name: 'discord', status: 'connected', adapters: 1 },
      { name: 'whatsapp', status: 'connected', adapters: 1 },
      { name: 'sms', status: 'disconnected', reason: 'no credentials' }
    ];
  },

  // Register a new channel
  'hyphae.registerChannel': async (params) => {
    // params: { channel_type, credentials, config }
    // Returns: { channel_id, adapter_port, status }
  },

  // Get messages for an agent
  'hyphae.getMessages': async (params) => {
    // params: { agent_id, channels?, limit }
    // Returns: Array of unified messages
  },

  // Send message via channel
  'hyphae.sendMessage': async (params) => {
    // params: { agent_id, channel, platform_id, text, attachments? }
    // Routes to appropriate adapter
  },

  // Acknowledge message (mark processed)
  'hyphae.ackMessage': async (params) => {
    // params: { message_id }
  },

  // Get channel info
  'hyphae.channelInfo': async (params) => {
    // params: { channel_name }
    // Returns: { type, status, connected_accounts, rate_limits }
  }
}
```

---

## Implementation Path

### Phase 1: Core Channel Framework
- Refactor `hyphae-communications.js` to host channel adapters
- Implement unified message queue (RPC-based or in-memory + persistent)
- Create channel registry service
- Base adapter class for all channels

### Phase 2: Channel Adapters
- Telegram adapter (multiple bot tokens, polling management)
- Discord adapter (webhook server in Hyphae)
- WhatsApp adapter (cloud API integration)
- SMS adapter (Twilio or similar)

### Phase 3: Agent Integration
- Rewrite Flint bot → Flint agent (RPC-only, no polling)
- Rewrite Clio bot → Clio agent (RPC-only, no polling)
- Update agent loops to use `hyphae.getMessages()` / `hyphae.sendMessage()`
- Remove all direct platform API calls from agent code

### Phase 4: Advanced Features
- iMessage adapter (via Mac bridge)
- Slack adapter (Events API)
- Rich media handling (images, files, embeds)
- Message delivery status tracking
- Rate limiting per channel
- Queue persistence for offline mode

---

## Benefits of This Architecture

✅ **Agents are isolated** — No agent cares about channels  
✅ **Scalable** — Add agents without adding platform conflicts  
✅ **Platform-agnostic** — Same agent code works on all channels  
✅ **Centralized credentials** — Hyphae manages all tokens  
✅ **Easy to add channels** — Just write a new adapter  
✅ **Better error handling** — Hyphae manages retries, timeouts, failures  
✅ **Multi-account support** — Single bot, multiple tokens/accounts  
✅ **Message persistence** — Full audit trail in Hyphae  
✅ **Feature parity** — All platforms support unified message format  
✅ **OpenClaw pattern** — Matches proven agent architecture  

---

## Comparison: Then vs. Now

| Aspect | Old (Broken) | New (Hyphae-Centric) |
|--------|------------|----------------------|
| **Bot polling** | Agent-owned | Hyphae-owned |
| **API credentials** | In agent code | In Hyphae registry |
| **Platform conflicts** | Yes (Telegram) | No (centralized) |
| **Scaling agents** | Breaks (conflicts) | Works (independent) |
| **Multi-account** | Requires new agent | Single adapter, many tokens |
| **Adding channels** | Major refactor | New adapter module |
| **Message format** | Platform-specific | Unified format |
| **Error handling** | In each agent | Centralized in Hyphae |

---

## This is How OpenClaw Does It

In OpenClaw, the framework (not your agent code):
- Manages channel connections
- Handles message polling/webhooks
- Routes messages to agents
- Persists conversation history
- Manages credentials

Your agent code:
- Receives messages via RPC/events
- Processes and responds
- Never touches platform APIs directly

**Hyphae should work the same way.**

---

## Next Steps

1. Refactor Hyphae Communications System to host channel adapters
2. Implement Telegram adapter (manage all bot tokens in one place)
3. Extract Flint/Clio agent code (remove bot logic)
4. Test with Discord adapter (webhook-based, simpler to verify)
5. Scale to WhatsApp, SMS, iMessage

This fixes the architectural flaw and makes the system properly scalable.
