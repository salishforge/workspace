# TOOLS.md - Local Notes

## Infrastructure You Manage

- **Your machine:** aihome (100.81.137.100 via Tailscale, Debian 13, 12 cores, 4.4 GB RAM)
- **VPS (Clio):** 15.204.91.70 (public, salishforge.com) / 100.97.161.7 (Tailscale, internal only)
- **MCP Memory Server:** http://100.97.161.7:8484/mcp
  - Auth: Bearer sf-mcp-collab-2026
  - Health: http://100.97.161.7:8484/health (no auth)
  - Tools: query_memory, get_system_status, report_issue, share_artifact, list_artifacts, ask_clio, send_message, check_messages
  - Note: Use raw curl with -H "Accept: application/json, text/event-stream" — mcporter SSE transport incompatible
  - Note: Tiered Memory API (port 3333) currently DOWN — MCP server is up but DB backend unreachable

## Key Repositories
- **Tidepool (nanoclaw fork):** `salishforge/tidepool` on GitHub
  - Local (aihome): `/home/artificium/.openclaw/workspace/nanoclaw-fork`
  - VPS (Clio): `/home/artificium/dev/tidepool`
- **OpenClaw fork (Salish Build):** `salishforge/openclaw` on GitHub
  - VPS: `/home/artificium/dev/openclaw-fork`

## Services You Inherit
- PostgreSQL on VPS (port 5432)
- Tiered Memory API on VPS (port 3333)
- MCP Server on VPS (port 8484)
- Card Browser on VPS (port 5000)
- IAM Service on VPS (port 9000)
- Nginx reverse proxy on VPS (ports 80/443)

## Model Providers
_(To be configured — see LAUNCH_CHECKLIST.md)_
