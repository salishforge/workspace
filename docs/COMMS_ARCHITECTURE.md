# Salish Forge — Inter-Agent Communication Architecture

**Author:** Flint ⚡ (CTO)  
**Date:** 2026-03-09  
**Status:** Approved by CEO (John Brooke)

---

## Overview

Two-tier communication model:

1. **Backend (MCP over Tailscale)** — agent-to-agent, invisible to humans
2. **Frontend (Telegram)** — human-facing, John ↔ Clio primarily

---

## Topology

```
John Brooke (CEO)
      ↕  Telegram
   Clio 🦉 (Chief of Staff)
      ↕  MCP / Tailscale (100.97.161.7:8484)
   ┌──────────────────────────┐
   │  Flint ⚡ (CTO)          │
   │  Creative Director (TBD) │
   │  Future Directors...     │
   └──────────────────────────┘
```

Clio is the hub. Directors are spokes. John speaks to Clio; Clio routes to the relevant director agents.

---

## Backend Channel: MCP over Tailscale

**Endpoint:** `http://100.97.161.7:8484/mcp`  
**Auth:** Bearer token (stored securely, not in this file)  
**Transport:** Tailscale mesh (WireGuard-encrypted, private)  
**Protocol:** MCP (Model Context Protocol)

### Available Tools (Day 1)
- `ask_clio` — direct message to Clio
- `query_memory` — shared memory store
- `share_artifact` — pass artifacts between agents
- `report_issue` — flag problems
- `list_artifacts` — browse shared artifacts
- `get_system_status` — infrastructure health

### Use Cases
- Task delegation (Clio → Flint, Clio → Creative Director)
- Status reporting (Directors → Clio)
- Artifact sharing (code, docs, designs)
- Escalation routing (Director → Clio → John if needed)
- Budget requests and approvals

---

## Frontend Channel: Telegram

**Purpose:** Human-agent interface only  
**Primary flow:** John ↔ Clio  
**Secondary:** Clio surfaces escalations, alerts, decisions requiring John's input

Agents post to Telegram only when:
- Explicitly escalating to John
- Delivering a human-visible deliverable
- Responding to a direct human message

Agent-to-agent coordination does NOT happen on Telegram.

---

## Security Model

- **Tailscale mesh** provides network-level encryption and authentication
- **MCP Bearer token** provides application-level auth
- **No agent credentials in Telegram** — backend stays backend
- **Audit trail** — all MCP transactions logged to PostgreSQL on VPS
- **Principle of least privilege** — each agent gets only the MCP tools it needs

---

## Escalation Path

```
Sub-agent issue → Director Agent → Clio (MCP) → John (Telegram) if needed
```

Routine work never surfaces to John. He sees outcomes, not process.

---

## Future Considerations

- When Creative Director onboards: add as MCP spoke, no Telegram bot needed for internal comms
- If agent count grows: consider message queue (NATS/Redis) for async — but MCP is sufficient at current scale
- Rate limiting on `ask_clio` to prevent runaway agent loops

---

## Open Items

- [ ] Obtain MCP Bearer token (blocking — needed before backend channel is usable)
- [ ] Confirm Clio's agent is actively handling `ask_clio` tool calls
- [ ] Seed CTO HOT memory tier (`/api/memory/hot/cto`)
- [ ] Define sub-agent sandboxing policy (separate doc)
