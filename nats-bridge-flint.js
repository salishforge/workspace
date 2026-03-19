#!/usr/bin/env node

/**
 * NATS Bridge for Flint (CTO)
 * 
 * Subscribes to:
 * - sf.agent.flint.inbox (direct messages)
 * - sf.broadcast (org-wide announcements)
 * 
 * On receive:
 * - SSHes to aihome (100.81.137.100) and writes to MCP_INBOX.md
 * - No Telegram (Flint uses OpenClaw natively)
 */

import { connect } from "nats";
import { execSync } from "child_process";

const NATS_URL = process.env.NATS_URL || "nats://100.97.161.7:4222"; // Via Tailscale from aihome
const AIHOME_HOST = "100.81.137.100";
const AIHOME_USER = "artificium";
const AIHOME_WORKSPACE = "/home/artificium/.openclaw/workspace";
const AIHOME_INBOX = `${AIHOME_WORKSPACE}/MCP_INBOX.md`;

async function main() {
  console.log("[nats-bridge-flint] Starting...");

  try {
    const nc = await connect({
      servers: process.env.NATS_URL || NATS_URL,
      user: "flint",
      pass: "4a20e1a6580d01f14d61be0ccd0d5c50897306793972e06aeb18878c62287169",
    });

    console.log("[nats-bridge-flint] Connected to NATS");

    // Subscribe to inbox
    const inboxSub = nc.subscribe("sf.agent.flint.inbox");
    console.log("[nats-bridge-flint] Subscribed to sf.agent.flint.inbox");

    // Subscribe to broadcast
    const broadcastSub = nc.subscribe("sf.broadcast");
    console.log("[nats-bridge-flint] Subscribed to sf.broadcast");

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

    console.log("[nats-bridge-flint] Ready. Listening for messages...");

  } catch (err) {
    console.error("[nats-bridge-flint] ERROR:", err.message);
    process.exit(1);
  }
}

async function handleMessage(msg, topic) {
  const content = new TextDecoder().decode(msg.data);
  const timestamp = new Date().toISOString();

  console.log(`[nats-bridge-flint] Received from ${topic}:`, content.slice(0, 100));

  try {
    // SSH to aihome and write to MCP_INBOX.md
    const entry = `\n[${timestamp}] Message from NATS (${topic}):\n${content}\n`;
    const escapedEntry = entry.replace(/"/g, '\\"').replace(/\$/g, '\\$');

    const sshCmd = `ssh ${AIHOME_USER}@${AIHOME_HOST} "echo '${escapedEntry}' >> ${AIHOME_INBOX}"`;
    execSync(sshCmd, { stdio: "pipe" });
    console.log(`[nats-bridge-flint] Wrote to aihome:${AIHOME_INBOX}`);

    // Acknowledge the message if it was a request
    if (msg.reply) {
      msg.respond();
    }
  } catch (err) {
    console.error(`[nats-bridge-flint] Error handling message:`, err.message);
  }
}

main();
