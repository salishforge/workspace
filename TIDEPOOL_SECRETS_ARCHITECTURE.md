# Tidepool Secrets Architecture

**Author:** Flint (CTO)  
**Date:** 2026-03-16  
**Status:** PROPOSED — Sprint 7 addition  
**Approved by:** John Brooke

---

## Problem Statement

OpenClaw's current secret handling has two fundamental flaws:

1. **Secrets live in config files or env vars** — flat files any process can read, no least-privilege, no audit trail
2. **No scoping for sub-agents** — sub-agents inherit full production credentials, violating the principle of least privilege

This is not a Tidepool-specific problem — it's a property of how OpenClaw is designed. Tidepool needs to own the fix.

---

## Design Principles

- **No values in config files.** Config references names, never secrets.
- **Every secret request is logged.** Who, what, when, from which agent.
- **Sub-agents get tokens, not keys.** Short-lived, scoped, revocable.
- **Least privilege by default.** An agent gets only the secrets it explicitly needs.
- **Secrets are never in git.** Ever. Not even hashed.

---

## Architecture

### Layer 1: Secret Store (filesystem)

```
~/.config/tidepool/secrets/          (chmod 700)
├── anthropic.key                    (chmod 600) — raw API key
├── google.key                       (chmod 600)
├── nats.password                    (chmod 600)
├── db.password                      (chmod 600)
└── mcp.token                        (chmod 600)
```

All secret files: owned by `artificium`, no world-read, no group-read.

**Rule:** Secrets in this directory are the only source of truth. No duplicates in config files, no duplicates in environment variables (except for the broker process itself at startup).

---

### Layer 2: Secret References in Config

`openclaw.json` / `tidepool.json` never contain values. Only named references:

```json
{
  "providers": {
    "anthropic": {
      "apiKey": { "$secret": "anthropic.key" }
    },
    "nats": {
      "password": { "$secret": "nats.password" }
    }
  }
}
```

The config loader resolves `$secret` references at startup by reading from the secret store. If a secret is missing, startup fails with a clear error — no silent fallbacks, no defaults.

---

### Layer 3: Secret Broker (local Unix socket)

A lightweight daemon: **`tidepool-secrets`**

- Reads from `~/.config/tidepool/secrets/` at startup
- Exposes a Unix socket: `/run/tidepool/secrets.sock`
- Accepts named requests: `GET anthropic.key`
- Returns value only if the requesting PID is in the allowlist
- Logs every access to PostgreSQL `secret_access_log`

```
Agent → Unix socket → Broker → Checks allowlist → Returns value
                             → Logs to PostgreSQL
```

**Why Unix socket?** No network exposure. No ports. OS-level process isolation. The requesting PID is verifiable.

**Allowlist:** Defined in `tidepool.json`:
```json
{
  "secrets": {
    "allowlist": {
      "anthropic.key": ["flint-main", "clio-main"],
      "nats.password": ["flint-main", "clio-main", "nats-bridge"],
      "db.password": ["tiered-memory-api", "sync-watcher"]
    }
  }
}
```

---

### Layer 4: Sub-Agent Tokens (scoped, TTL-based)

When a sub-agent is spawned, it receives a **session token**, not a raw secret:

```json
{
  "token": "sa_abc123_...",
  "expires": "2026-03-16T02:30:00Z",
  "scopes": ["anthropic.completions"],
  "ttl_seconds": 3600
}
```

The broker validates the token on each request. The token:
- Maps to a specific set of scopes (not raw keys)
- Expires after TTL
- Is revoked on sub-agent completion
- Is single-use-per-request (no caching)

Sub-agents **never** see production API keys. They call through the broker using their session token.

---

### Layer 5: Audit Trail

```sql
CREATE TABLE secret_access_log (
  id BIGSERIAL PRIMARY KEY,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_id TEXT NOT NULL,
  pid INTEGER,
  secret_name TEXT NOT NULL,
  token_id TEXT,                    -- null if direct access (main agent)
  granted BOOLEAN NOT NULL,
  deny_reason TEXT,                 -- populated if granted=false
  source_ip TEXT                    -- always null for Unix socket (informational)
);
```

Alerts on:
- Access outside allowed hours (configurable)
- More than N requests/minute from a single agent
- Any access to a secret not in the agent's allowlist

---

## Implementation Plan

### Phase 1: Store + Config References (Sprint 7, Week 1)
**Effort:** ~1 day

1. Create `~/.config/tidepool/secrets/` with correct permissions
2. Migrate all existing secrets from config/env into the store
3. Update config loader to resolve `$secret` references
4. Fail-fast on missing secrets at startup
5. Add `tidepool secrets set <name>` CLI command (reads from stdin, never args)
6. Add `tidepool secrets list` (shows names only, never values)

### Phase 2: Audit Logging (Sprint 7, Week 1)
**Effort:** ~half day

1. Add `secret_access_log` table to PostgreSQL
2. Log every secret read by the main agent (config loader calls the logger)
3. Log startup, missing secrets, and permission errors

### Phase 3: Secret Broker (Sprint 8)
**Effort:** ~2 days

1. Implement `tidepool-secrets` Unix socket daemon
2. PID-based allowlist enforcement
3. Wire config loader to use broker instead of direct file reads
4. Systemd unit for the broker (starts before all other Tidepool services)

### Phase 4: Sub-Agent Tokens (Sprint 9)
**Effort:** ~2 days

1. Token issuance on sub-agent spawn
2. Scoped request handling in broker
3. TTL enforcement and revocation
4. Update sub-agent spawn to use tokens instead of env var injection

---

## Security Properties (by phase)

| Property | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|----------|---------|---------|---------|---------|
| No secrets in config | ✅ | ✅ | ✅ | ✅ |
| No secrets in git | ✅ | ✅ | ✅ | ✅ |
| Audit trail | ❌ | ✅ | ✅ | ✅ |
| Least-privilege per agent | ❌ | ❌ | ✅ | ✅ |
| Sub-agents can't escalate | ❌ | ❌ | ❌ | ✅ |
| Revocable credentials | ❌ | ❌ | ❌ | ✅ |

Phase 1 + 2 alone are a significant improvement over the current state. Phases 3 and 4 complete the model.

---

## What We Don't Do

- **No HashiCorp Vault** — too heavy for a local-first agent runtime
- **No KMS** — same reason; we don't have cloud infra here
- **No encrypted secrets files** — the encryption key has to live somewhere; filesystem permissions + OS isolation is the correct mechanism at this scale
- **No secrets in Telegram** — ever, even encrypted

---

## Outstanding Questions

1. **Should the broker be a Tidepool-native service or standalone?** My preference: standalone, so it starts before OpenClaw and survives restarts.

2. **Key rotation UX:** What's the workflow when an API key rotates? Proposed: `tidepool secrets set anthropic.key` → broker reloads → no restart required.

3. **Multi-agent, multi-machine:** When Clio's Tidepool instance and my instance both need the same NATS password, how do we sync secrets securely? Proposed: manual provisioning (same key set on both machines, by John). Automated sync is a later problem.

---

*This document is the authoritative design for Tidepool secrets handling. Update it as the implementation evolves.*
