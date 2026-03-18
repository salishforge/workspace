# Sprint 8 Plan — Autonomous Agent-to-Agent Communication
**Owner:** Flint (CTO)  
**Status:** Draft  
**Goal:** Fully autonomous, bi-directional Flint↔Clio messaging without human involvement  
**Target:** ~1 week of focused development

---

## Success Criteria

- Flint sends a NATS message to Clio → Clio's AI processes it and replies autonomously
- Clio sends a NATS message to Flint → Flint wakes, processes it, replies autonomously
- Both agents operate without any human relay or prompt
- Messages are structured (correlation IDs, reply-to, typed)
- No messages lost if one agent is briefly unavailable

---

## Tasks

### S8-000 — Session compaction: container max-message limit (BLOCKER)
**Effort:** 0.5 days  
**Priority:** P0 — do this first  
**Files:** `src/container-runner.ts`, `src/config.ts`  
**What:** The container ran 52 messages over 15 min before OOM-dying. Need a hard cap on messages per container session (default: 20). When the cap is hit, close the container gracefully, let the next message spawn a fresh one. The compaction module (BACKLOG-001) handles summarization; this is just the safety valve.  
**Config:** `TIDEPOOL_SESSION_MAX_MESSAGES=20` (env override)  
**Acceptance:** Container never exceeds max-message limit; new messages spawn a fresh container seamlessly

---

### S8-001 — Wire `onDirectMessage` into Tidepool group queue
**Effort:** 1 day  
**File:** `src/index.ts` (onDirectMessage handler)  
**What:** When a NATS federation message arrives on `sf.agent.clio.inbox`, inject it as a synthetic message into the clio-main group queue. The existing message loop picks it up and spawns a container for AI processing.  
**Acceptance:** Send a NATS message to Clio → she processes it in a container → generates a response (logged)

**Implementation sketch:**
```typescript
onDirectMessage: async (msg) => {
  const synthetic: NewMessage = {
    id: `nats-${msg.timestamp}`,
    chat_jid: FEDERATION_JID,        // e.g. "nats:federation"
    sender: msg.from,
    sender_name: msg.from,
    content: msg.body,
    timestamp: msg.timestamp,
    is_from_me: false,
    is_bot_message: false,
  };
  storeMessage(synthetic);
  queue.enqueueMessageCheck(FEDERATION_JID);
}
```
Requires registering a synthetic "federation group" in the DB with its own folder containing context about who Flint is.

---

### S8-002 — Auto-reply: route AI response back via NATS
**Effort:** 0.5 days  
**Files:** `src/container-runner.ts`, `src/nats-federation.ts`  
**What:** After the AI generates a response to a NATS-sourced message, automatically publish the response back to the sender's inbox (using `msg.from` + `federation.sendDirect()`). Don't send to Telegram for NATS-sourced messages.  
**Acceptance:** Flint sends to Clio → Clio responds → response arrives in `sf.agent.flint.inbox` automatically

---

### S8-003 — Flint gateway injection (aihome bridge)
**Effort:** 0.5 days  
**File:** `/home/artificium/agent-messaging/nats-gateway-bridge.js` (aihome)  
**What:** When a message arrives on `sf.agent.flint.inbox`, the bridge currently writes to `MCP_INBOX.md`. Extend it to also POST the message directly to the OpenClaw gateway session so Flint wakes up immediately. Use the existing gateway token.  
**Acceptance:** Clio sends to `sf.agent.flint.inbox` → Flint receives and responds within 30 seconds, no human prompt needed

---

### S8-004 — Federation message schema
**Effort:** 0.5 days  
**File:** `src/nats-bus.ts` (extend `FederationMessage`)  
**What:** Add structured fields to the message protocol:
```typescript
interface FederationMessage {
  from: string;
  to?: string;
  subject: string;
  body: string;
  timestamp: string;
  // New in S8-004:
  type: 'request' | 'response' | 'event' | 'ack';
  correlation_id?: string;   // links request → response
  reply_to?: string;          // override reply inbox (defaults to sf.agent.{from}.inbox)
  ttl_ms?: number;            // message expiry
}
```
**Acceptance:** Build passes, existing tests updated, Flint and Clio use typed messages

---

### S8-005 — Federation group workspace for Flint context
**Effort:** 0.5 days  
**Files:** `groups/federation/CLAUDE.md` on VPS  
**What:** Create a dedicated group folder for NATS-sourced messages. CLAUDE.md tells Clio: who Flint is, how to use `send-to-flint.mjs`, what kinds of messages to expect, how to format responses. Separate from clio-main to keep contexts clean.  
**Acceptance:** Clio's AI responses to Flint are contextually appropriate (knows she's talking to the CTO, not a user)

---

### S8-006 — JetStream durable consumers (no message loss)
**Effort:** 1.5 days  
**Files:** `src/nats-embedded.ts`, `src/nats-bus.ts`, `src/nats-federation.ts`, VPS `/etc/nats-server.conf`  
**What:** Enable JetStream on the VPS NATS hub. Replace pub/sub federation with durable push consumers. Messages queue if the receiver is down and deliver on reconnect.  
**Config changes:**
- VPS NATS: add `jetstream {}` block, set store limits
- Federation producer: use `js.publish()` instead of `nc.publish()`
- Federation consumer: create/attach to durable consumer on startup, ack processed messages  
**Acceptance:** Stop Clio's Tidepool, send 3 messages, restart Clio → all 3 messages delivered and processed in order

---

### S8-007 — End-to-end integration test
**Effort:** 0.5 days  
**File:** `container/test-agent-comms.sh`  
**What:** Automated test script that:
1. Sends a NATS request from "flint-test" to Clio
2. Waits for Clio's AI response on a reply inbox
3. Verifies response arrived within 60 seconds
4. Verifies correlation_id matches
5. Tests durability: send while Clio is down, restart, verify delivery
6. **Timeout/failure case:** If no response within 60s, script prints diagnostic (queue depth, container status), cleans up temp inbox subscription, and exits non-zero with a clear error message (not a hang)
7. **Cleanup:** Always removes temp NATS subscriptions and test messages regardless of pass/fail (trap EXIT)  
**Acceptance:** Script exits 0 on success; exits non-zero with diagnostic output on timeout or correlation mismatch; never hangs

---

## Dependency Order

```
S8-004 (schema)
    ↓
S8-001 (onDirectMessage → queue)
    ↓
S8-005 (federation workspace)     S8-003 (flint gateway injection)
    ↓                                     ↓
S8-002 (auto-reply)              [parallel]
    ↓
S8-006 (JetStream durability)
    ↓
S8-007 (integration test)
```

---

## Out of Scope (Sprint 9)

- Health monitoring / agent heartbeat dashboard
- Dead letter queue + retry policies
- Rate limiting between agents
- Encrypted message payload (transport is already TLS-capable via NATS)
- Multi-hop routing (Flint → Clio → Creative Director)
- Agent capability advertisement / discovery

---

## Notes

- S8-001 through S8-005 can be developed and tested without JetStream (S8-006). Ship functional autonomous comms first, add durability after.
- The federation workspace (S8-005) is a pure content task — no code changes.
- S8-003 (Flint gateway injection) is independent of the Tidepool work and can be parallelized.
- All code changes target `salishforge/tidepool` main branch.
- No changes to Clio's existing OpenClaw workspace or gateway.
