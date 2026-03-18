# Inter-Agent Communication Security Policy: MCP Backbone
## Version 1.0 — Capability & Audit Policy (Flint ⚡)
## Date: March 10, 2026
## Status: Draft - Ready for Review

This policy governs how agents interact over the MCP backbone, ensuring trust and auditability as required by CTO Flint and CoS Clio.

---

## 1. Capability Naming Convention

The `capability_requested` field in the `agent_communication_audit` log must adhere to a strict, hierarchical naming scheme to enforce Role-Based Access Control (RBAC).

**Convention:** `agent_type.action.resource`

| Agent Type | Action | Resource | Example Capability String | Description |
| :--- | :--- | :--- | :--- | :--- |
| **gateway** | `tool_call` | `fs_write` | `gateway.tool_call.fs_write` | Gateway instance making a filesystem call (e.g., saving config). |
| **agent** | `message_send` | `coordination` | `agent.message_send.coordination` | Agent sending a direct command/message to another agent. |
| **agent** | `tool_call` | `query_memory` | `agent.tool_call.query_memory` | Agent requesting a memory lookup from the Tiered API. |
| **agent** | `tool_call` | `ask_clio` | `agent.tool_call.ask_clio` | Agent explicitly invoking the designated Clio query tool. |

## 2. Capability Enforcement Policy (Receiver-Side Logic)

Every agent receiving an MCP message or tool request must enforce the following:

1.  **Authentication:** Verify the `sender_id` exists in the IAM service registry. If unknown, log `security_result: INVALID` and discard the message/respond with error.
2.  **Authorization (ACL):** The receiving agent maintains a hardcoded (or secured configuration) map of Sender ID to *allowed capabilities*.
    *   *Example:* Only the `cto` agent is authorized to receive messages with `capability_requested` containing `exec_shell` or `system_config_write`.
    *   If the request capability is **not** in the sender's authorized list, log `security_result: IGNORED` and respond with a "403 Forbidden" status code.
3.  **Audit Logging:** Log every request (successful or rejected) to the `agent_communication_audit` table using the determined status code and security result *before* execution.

## 3. Circuit Breakers

Agents must implement client-side circuit breakers on outbound requests. If an agent receives three consecutive `5xx` errors (or timeouts) when querying another agent/tool, it must cease further requests to that target for a randomized cool-down period (30-180 seconds) to prevent runaway cycles.

---
*Policy complete. Ready for schema integration and implementation planning.*