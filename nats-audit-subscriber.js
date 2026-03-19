#!/usr/bin/env node

/**
 * NATS Audit Subscriber
 * 
 * Subscribes to all NATS topics (sf.>) and logs every message to PostgreSQL.
 * 
 * Table: agent_communication_audit
 * Logs: timestamp, sender_id, recipient_id, action_type, message_content_hash
 */

import { connect } from "nats";
import pkg from "pg";
const { Client } = pkg;
import crypto from "crypto";

const NATS_URL = "nats://127.0.0.1:4222";
const DB_CONNECTION = {
  user: "postgres",
  password: "postgres", // TODO: Use secure credentials from environment
  host: "localhost",
  port: 5432,
  database: "salish_forge",
};

async function main() {
  console.log("[nats-audit] Starting...");

  // Connect to NATS
  const nc = await connect({
    servers: NATS_URL,
    user: "audit",
    pass: "df64934ded70a473802d6a60468135bf37817fcde7d33c70665c86d1172d511c",
  });

  console.log("[nats-audit] Connected to NATS");

  // Connect to PostgreSQL
  const dbClient = new Client(DB_CONNECTION);
  await dbClient.connect();
  console.log("[nats-audit] Connected to PostgreSQL");

  // Subscribe to all topics
  const sub = nc.subscribe("sf.>");
  console.log("[nats-audit] Subscribed to sf.> (all topics)");

  // Process all messages
  (async () => {
    for await (const msg of sub) {
      await logMessage(msg, dbClient);
    }
  })();

  console.log("[nats-audit] Ready. Logging all NATS traffic...");
}

async function logMessage(msg, dbClient) {
  try {
    const content = new TextDecoder().decode(msg.data);
    const timestamp = new Date();
    const contentHash = crypto.createHash("sha256").update(content).digest("hex");

    // Parse topic to extract sender/recipient info
    // Topic format: sf.agent.{sender}.{action} or sf.broadcast
    const topicParts = msg.subject.split(".");
    const sender = topicParts[2] || "system";
    const action = topicParts[3] || "broadcast";

    const query = `
      INSERT INTO agent_communication_audit 
      (timestamp, sender_id, recipient_id, action_type, capability_requested, status_code, content_hash, security_result, raw_payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const values = [
      timestamp,
      sender,
      action === "inbox" ? "flint" : action === "status" ? "system" : "broadcast",
      "nats_publish",
      msg.subject, // Use full subject as capability for now
      200, // Assume successful delivery
      contentHash,
      "VALID",
      JSON.stringify({
        subject: msg.subject,
        reply: msg.reply,
        size: msg.data.length,
        timestamp: timestamp.toISOString(),
      }),
    ];

    await dbClient.query(query, values);
    console.log(`[nats-audit] Logged: ${msg.subject} from ${sender}`);

  } catch (err) {
    console.error(`[nats-audit] Error logging message:`, err.message);
  }
}

main().catch(err => {
  console.error("[nats-audit] FATAL:", err);
  process.exit(1);
});
