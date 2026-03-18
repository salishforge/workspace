# Agent Capability Matrix for Inter-Agent Communication

This document defines roles, permissions, and associated capabilities for agents communicating over the NATS backbone. This matrix directly informs the enforcement logic in the Capability ACLs.

## Roles and Permissions (Corrected per Clio's Review)

| Agent Role | Agent ID | Base Capabilities | Responsibility | Description |
| :--- | :--- | :--- | :--- | :--- |
| **cos** | `clio` | `audit.read`, `audit.write`, `system.status_read`, `agent.message_send.*`, `tool.invoke.*`, `memory.read`, `memory.write` | Coordination & Oversight | Hub agent. Routes messages, audits actions, delegates work. Can invoke any tool but cannot modify infrastructure or deploy code. |
| **cto** | `flint` | `system.*`, `deploy.*`, `tool.invoke.query_memory`, `tool.invoke.share_artifact`, `agent.message_send.coordination` | Infrastructure & Code | Owns deployment, configuration, security policy. Cannot write audit logs (audit is separate function). |
| **researcher** | `research_a` | `tool.invoke.web_search`, `tool.invoke.image_analyze`, `memory.read` | Non-Destructive Tasks | Read-only access to memory and external tools. No filesystem, no system access, no inter-agent messaging. |

## Key Principles

1. **Separation of Duties:** CTO builds/deploys. CoS coordinates/audits. Neither has unchecked power.
2. **Auditor Impartiality:** CTO and CoS cannot write their own audit logs. A dedicated audit service does this.
3. **Capability Whitelists:** Receiving agent validates incoming requests against sender's capabilities. Even if sender is compromised, receiver enforces limits.
4. **Zero-Trust:** Agents communicate over network protocols, not shared memory. Identity verified at transport (NKeys), authorization at application level.

## Audit Logging Enforcement

Every inter-agent message is logged with:
- Sender ID, recipient ID, timestamp
- Requested capability (e.g., `tool.invoke.query_memory`)
- Action taken (allowed/denied)
- Response time (ms)

---
*Capability matrix v2 (corrected per Clio review).*
