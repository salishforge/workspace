# Salish Forge Inter-Agent Communication Architecture — CTO Proposal v0.1

**Goal:** Establish robust, secure, and auditable communication infrastructure for collaborating AI agents.

## 1. Transport Layer Summary
The architecture is centered around the existing MCP Server (Port 8484) as the primary message bus for machine-to-machine coordination, secured via the Tailscale overlay network.

| Component | Role | Location (Internal) | Protocol/Security | Stability Note |
| :--- | :--- | :--- | :--- | :--- |
| **MCP Server** | Primary Message Bus / State Relay | 100.97.161.7:8484 | HTTP + Bearer Token | Stable |
| **Tiered Memory API** | Agent History / State Storage | 100.97.161.7:3333 | HTTP + Bearer Token | **STABLE, LOCAL ONLY** - Binds to 127.0.0.1 by design for security. External access requires host network access or code modification. |
| **Telegram** | Human Interface / Escalation | N/A | N/A | Secondary use only |

## 2. Security Framework
1.  **Encryption-in-Transit:** Guaranteed via Tailscale mesh for all inter-host traffic (100.x.x.x).
2.  **Authentication:** All MCP interactions require the rotated Bearer Token (`sf-mcp-collab-2026` placeholder). This token must be provisioned to a dedicated service account for each agent (Flint, Clio, Creative Director).
3.  **Resource Access:** All services (PostgreSQL, IAM, Memory) must enforce authentication via the IAM Service (Port 9000). Agents do not use shared credentials.

## 3. Sub-Agent Management Policy (CTO Domain)
1.  **Isolation:** All non-trivial work must spawn through `sessions_spawn` (`runtime: "acp"` or `"subagent"`). Agents never execute commands directly on the host machine unless it is infrastructure maintenance (Flint's domain).
2.  **Resource Quotas:** Default limits are set aggressively: 2 CPU threads, 4GB RAM, 120s timeout for non-interactive tasks.
3.  **Credential Policy:** Access to workspace secrets or host resources requires an explicit `--allow-secrets` flag during spawning, creating an auditable trigger point.

## 4. Implementation Plan (Priority Order)
1.  **Remediate Tiered Memory API:** Stabilize port 3333 on the VPS to bind to `0.0.0.0` via a managed systemd service.
2.  **IAM Integration:** For Clio and the Creative Director, secure API keys/tokens via the IAM service (Port 9000).
3.  **Agent Token Rotation:** Rotate the MCP bearer token to a unique token per agent.
4.  **Documentation:** Update AGENTS.md with the sub-agent policy.