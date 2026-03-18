# Sprint 9 Plan — Stability, API, and Public Readiness
**Owner:** Flint (CTO)  
**Status:** Draft — pending John approval  
**Goal:** Make Tidepool production-stable and ready for public open source release  
**Builds on:** Sprint 8 (autonomous agent comms, JetStream, session cap)

---

## Success Criteria

- Hot config works: common settings change without service restart
- Management API v1 live and documented (OpenAPI spec served)
- Flint running on Tidepool in parallel with OpenClaw (no cutover yet)
- Repo is ready to make public: README, quick-start, license
- Agent heartbeat: both Flint and Clio publish presence, each knows if the other is down

---

## Tasks

### S9-001 — Hot Config (file watch + SIGHUP reload)
**Effort:** ~15 min agent time  
**Source:** BACKLOG-007  
**What:** Two-tier hot config:
- Tier 1: `config/runtime.json` file watch — notify level, session cap, debounce, interrupt keywords apply within 2 seconds
- Tier 2: SIGHUP handler — re-reads secrets store, reconnects Telegram bot, re-establishes NATS federation without restart
- `/reload` IPC command triggers same path as SIGHUP
- Document which fields are hot vs. cold in RUNBOOK.md  

**Acceptance:** Change `notifyLevel` in runtime.json → applied in <2s. `kill -HUP` → secrets + channels reload, active session uninterrupted.

---

### S9-002 — Management API v1
**Effort:** ~30 min agent time  
**Source:** BACKLOG-009  
**What:** New module `src/management-api.ts`, default port 3004. Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/health | Service health, uptime, version |
| GET | /api/v1/status | Agent name, groups, containers, NATS |
| POST | /api/v1/reload | Hot config reload (S9-001 required) |
| GET | /api/v1/groups | List registered groups |
| POST | /api/v1/groups | Register group |
| DELETE | /api/v1/groups/:jid | Deregister group |
| GET | /api/v1/groups/:jid/messages | Paginated message history |
| GET | /api/v1/containers | List active containers |
| DELETE | /api/v1/containers/:name | Kill container |
| GET | /api/v1/logs | Recent structured logs (JSON) |
| WS | /api/v1/logs/stream | Real-time log stream |
| GET | /api/v1/secrets | List keys/namespaces (no values) |
| POST | /api/v1/secrets/:key | Set/rotate secret |
| GET | /api/v1/federation/status | NATS status, consumer lag |
| POST | /api/v1/federation/send | Send message to agent |

**Auth:** Bearer token (set via `TIDEPOOL_MGMT_API_TOKEN` env/secret)  
**OpenAPI spec:** Served at `/api/docs` (JSON), browsable at `/api/docs/ui`  
**Rate limiting:** 60 req/min per token  
**Audit log:** All writes logged with timestamp  

**Acceptance:** `curl http://localhost:3004/api/v1/health` returns `{"status":"ok"}`. All endpoints functional. OpenAPI spec valid.

---

### S9-003 — Agent Heartbeat + Presence
**Effort:** ~10 min agent time  
**What:** Both agents publish presence to `sf.agent.{name}.status` every 30 seconds via NATS federation. Status includes: `online`/`busy`/`offline`, uptime, active container count, last message timestamp.

Federation API already has `setStatus()` — this task wires it to a startup heartbeat and exposes status via the management API (`GET /api/v1/federation/peers`).

**Acceptance:** After 30s, `GET /api/v1/federation/peers` returns Flint and Clio status. Restart one agent → status updates to offline within 35s.

---

### S9-004 — Flint Tidepool Parallel Deployment
**Effort:** ~20 min (agent + infra)  
**What:** Deploy Tidepool for Flint on aihome alongside existing OpenClaw setup.

Steps:
1. Provision a new Telegram bot token for Flint's Tidepool instance (John provides)
2. Set up `~/.config/tidepool-flint/secrets/` with TELEGRAM_BOT_TOKEN + ANTHROPIC_API_KEY
3. Configure NATS credentials (flint user on VPS hub)
4. Create `groups/flint-main/CLAUDE.md` from Flint's SOUL.md + MEMORY.md
5. Create `tidepool-flint.service` systemd user service on aihome
6. Start and verify — both OpenClaw and Tidepool-Flint running simultaneously
7. Update nats-bridge to inject messages to both gateways during dual-run period

**Acceptance:** Tidepool-Flint running on aihome, Flint reachable via Telegram on new bot, OpenClaw still primary.  
**Requires:** New Telegram bot token from John (BotFather)

---

### S9-005 — README + Public Release Prep
**Effort:** ~15 min agent time  
**What:**  
- `README.md`: What is Tidepool, key features, architecture overview, quick-start (Docker Compose), configuration reference, link to docs
- `LICENSE`: Add Apache 2.0 license file
- `CONTRIBUTING.md`: How to contribute, code style, PR process
- `.github/`: Issue templates, PR template
- Make repo public on GitHub (John's action)

**Acceptance:** Someone can clone the repo, follow README quick-start, and have a working Tidepool instance in under 10 minutes.

---

### S9-006 — S8-005 Validation: Federation CLAUDE.md
**Effort:** ~5 min (verify Clio's work)  
**What:** Verify Clio has completed her `groups/federation/CLAUDE.md` deliverable from Sprint 8. If not done, write it. Content: who Flint is, expected message types, reply conventions, how to use `send-to-flint.mjs`.

**Acceptance:** `groups/federation/CLAUDE.md` exists on VPS and contains meaningful context.

---

## Dependency Order

```
S9-001 (hot config)
    ↓
S9-002 (management API — /reload needs hot config)
    ↓
S9-003 (heartbeat — exposes via /api/v1/federation/peers)

S9-004 (Flint deployment) ── parallel, needs Telegram token from John
S9-005 (README/public)   ── parallel, no code deps
S9-006 (validate S8-005) ── parallel, quick check
```

---

## Deferred to Sprint 10

- Web portal (BACKLOG-008) — wait for stable S9-002 API
- Dead letter queue + retry policies
- Multi-instance API support (commercial tier prerequisite)
- Commercial fork setup

---

## Open Questions for John

1. **New Telegram bot token for Flint?** — needed for S9-004. Create via @BotFather and send token.
2. **License choice for open source?** — Apache 2.0 recommended. Confirm before S9-005.
3. **Make repo public as part of Sprint 9?** — or stage as Sprint 9 prep, go public in Sprint 10?
4. **Management API port:** 3004 default — any conflict on aihome?
