#!/usr/bin/env node

/**
 * NATS Bridge for Clio (CoS)
 * 
 * Subscribes to:
 * - sf.agent.clio.inbox (direct messages)
 * - sf.broadcast (org-wide announcements)
 * 
 * On receive:
 * - Writes to MCP_INBOX.md (workspace trigger)
 * - Sends Telegram ping to wake Clio's session
 */

import { connect } from "nats";
import * as fs from "fs";
import https from "https";

const NATS_URL = "nats://127.0.0.1:4222";
const WORKSPACE = "/home/artificium/.openclaw/workspace";
const INBOX_FILE = `${WORKSPACE}/MCP_INBOX.md`;
const TELEGRAM_BOT_TOKEN = "8245162009:AAFlZGqQNl9haJ20IyX2cIqpOccJI59wH5g";
const TELEGRAM_CHAT_ID = "8201776295"; // John's ID (Clio will update)

async function main() {
  console.log("[nats-bridge-clio] Starting...");

  try {
    const nc = await connect({
      servers: NATS_URL,
      user: "clio",
      pass: "635eaf4db5a95f4983001c8459ab743a2643794b428582c8c254b7dfb27eed97",
    });

    console.log("[nats-bridge-clio] Connected to NATS");

    // Subscribe to inbox
    const inboxSub = nc.subscribe("sf.agent.clio.inbox");
    console.log("[nats-bridge-clio] Subscribed to sf.agent.clio.inbox");

    // Subscribe to broadcast
    const broadcastSub = nc.subscribe("sf.broadcast");
    console.log("[nats-bridge-clio] Subscribed to sf.broadcast");

    // Process inbox messages
    (async () => {
      for await (const msg of inboxSub) {
        await handleMessage(msg, "inbox");
      }
    })();

    // Process broadcast messages
    (async () => {
      for await (const msg of broadcastSub) {
        await handleMessage(msg, "broadcast");
      }
    })();

    console.log("[nats-bridge-clio] Ready. Listening for messages...");

  } catch (err) {
    console.error("[nats-bridge-clio] ERROR:", err.message);
    process.exit(1);
  }
}

async function handleMessage(msg, topic) {
  const content = new TextDecoder().decode(msg.data);
  const timestamp = new Date().toISOString();

  console.log(`[nats-bridge-clio] Received from ${topic}:`, content.slice(0, 100));

  try {
    // Write to MCP_INBOX.md
    const entry = `\n[${timestamp}] Message from NATS (${topic}):\n${content}\n`;
    fs.appendFileSync(INBOX_FILE, entry);
    console.log(`[nats-bridge-clio] Wrote to ${INBOX_FILE}`);

    // Send Telegram ping
    await sendTelegramPing(topic, content.slice(0, 50));

    // Acknowledge the message if it was a request
    if (msg.reply) {
      msg.respond();
    }
  } catch (err) {
    console.error(`[nats-bridge-clio] Error handling message:`, err.message);
  }
}

function sendTelegramPing(topic, preview) {
  return new Promise((resolve, reject) => {
    const botMessage = `[NATS] New message (${topic}): ${preview}...`;
    const payload = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: botMessage,
      parse_mode: "Markdown",
    });

    const options = {
      hostname: "api.telegram.org",
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log("[nats-bridge-clio] Telegram ping sent");
          resolve();
        } else {
          reject(new Error(`Telegram API returned ${res.statusCode}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

main();
