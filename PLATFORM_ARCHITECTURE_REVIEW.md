# Platform Architecture Review — For CTO Onboarding
## External Recommendations vs. What We've Built

*Prepared by Clio (Chief of Staff) — 2026-03-09*
*Context: An external analysis recommended several frameworks for our multi-agent platform. This doc compares those recommendations against our existing architecture so you can make informed decisions.*

---

## TL;DR

An external advisor recommended CrewAI, Redis/NATS, Slack, and E2B for our multi-agent platform. We've already solved most of these problems differently using OpenClaw + MCP + tiered memory + dedicated hardware. Some recommendations are worth adopting (security hardening, Creative Director toolset, LangGraph evaluation). Others would add redundant complexity.

**Your job as CTO: validate these decisions, challenge them if you disagree, and decide what to adopt, extend, or replace.**

---

## Comparison Matrix

| Capability | External Recommendation | What We Have | CTO Decision Needed |
|-----------|------------------------|--------------|-------------------|
| **Orchestration** | CrewAI (Python) | OpenClaw (Node.js) — sessions_spawn, subagents, org charter | Evaluate whether OpenClaw's native orchestration is sufficient or needs extension |
| **Inter-agent comms** | Redis Streams / NATS | MCP Server (live on port 8484) — tools, resources, structured messages | Evaluate MCP vs. message bus for scale. MCP is live now. |
| **Model routing** | OpenRouter unified API | OpenClaw model routing + fallback chains + provider/model format | Already implemented. Formalize the routing policy doc. |
| **Human-agent interface** | Slack integration | Telegram (working, multi-bot) | Design the replacement comms system (your first task per charter) |
| **Sandboxing** | E2B (cloud sandboxes) | Dedicated hardware per agent + Docker | Your call. E2B is simpler; dedicated hardware is more secure. |
| **Secrets management** | 1Password per agent role | 1Password CLI integrated with OpenClaw | Extend to scoped vaults per agent. Already have the pattern. |
| **State/memory** | Generic state store | Tiered memory system (83% token reduction, PostgreSQL, production-verified) | This is our competitive advantage. Extend, don't replace. |
| **Complex workflows** | LangGraph (state machines) | Not yet implemented | Evaluate for approval chains and deployment workflows |
| **Observability** | LangSmith / W&B Weave | Not yet implemented | Design logging pipeline. Recommend PostgreSQL + dashboard. |
| **Creative tools** | ComfyUI, Canva API, Buffer | Not yet implemented | Evaluate and integrate for Creative Director |

---

## What's Already Running (Your Inheritance)

### Infrastructure
- **VPS**: 15.204.91.70 (OVH), Tailscale mesh at 100.97.161.7
- **Domain**: salishforge.com (Let's Encrypt TLS, auto-renewal)
- **Nginx**: Reverse proxy on 443, TLS termination
- **PostgreSQL 16**: Native install, multiple databases

### Services (All Systemd, Auto-Restart)
| Service | Port | Purpose |
|---------|------|---------|
| OpenClaw Gateway | — | Agent orchestration, model routing |
| Tiered Memory API | 3333 | Hot/warm/cold memory tiers |
| MCP Memory Server | 8484 | Inter-agent collaboration (MCP protocol) |
| Card Browser | 5000 | Wonders CCG card database |
| IAM Service | 9000 | OAuth2 + JWT + RBAC |

### Model Providers
| Provider | Access | Use Case |
|----------|--------|----------|
| Anthropic API | Per-token billing | Primary (Opus, Sonnet, Haiku) |
| Claude Code CLI | Max subscription (flat rate) | Heavy coding tasks |
| Google AI Studio | Free tier (25K RPD) | Fallback, cost optimization |
| Ollama (aihome) | Local, free | Experimental, embeddings |

### Tiered Memory System
- **Hot tier**: ~3K tokens loaded per session, <50ms latency
- **Warm tier**: Recent 7 days, full-text search via PostgreSQL + pg_trgm
- **Cold tier**: Archive 30+ days, indexed
- **Sync**: Daily cron (02:00 UTC)
- **Integration**: NODE_OPTIONS injection OR source patch (both work)
- **Token reduction**: 83% verified (17K → 3K tokens/session)

### MCP Server (Just Deployed)
- **Endpoint**: http://100.97.161.7:8484/mcp
- **Transport**: Streamable HTTP (SSE)
- **Auth**: Bearer token
- **Tools**: query_memory, get_system_status, report_issue, share_artifact, list_artifacts, ask_clio
- **Resources**: 9 docs (theory, architecture, schema, source code)
- **Purpose**: Cross-agent collaboration without shared infrastructure

---

## Recommendations Worth Adopting

### 1. Security Architecture (HIGH PRIORITY — Your Domain)

The external analysis recommended layered security. Adopt these:

**Scoped API Keys** — Each agent gets its own API keys via 1Password. No credential sharing.
- [ ] Create 1Password vault per agent role
- [ ] Implement service accounts with scoped permissions
- [ ] Rotate keys on schedule

**Execution Sandboxing** — Sub-agents running code must be sandboxed.
- [ ] Define Docker sandboxing policy for code execution agents
- [ ] Evaluate E2B as a complement (not replacement) to dedicated hardware
- [ ] Network isolation between agent containers

**Approval Gates** — High-impact actions require human or CoS approval.
- [ ] Define action categories (low/medium/high/critical)
- [ ] Implement checkpoint mechanism in orchestration
- [ ] Document in org charter

**Audit Trail** — Every agent action logged immutably.
- [ ] Design schema for audit_log table (PostgreSQL)
- [ ] Structured logging for all tool invocations
- [ ] Dashboard for John to review agent activity

**Prompt Injection Defense** — Agents processing external content need guardrails.
- [ ] Input sanitization policy for external data
- [ ] Output validation before publishing
- [ ] Separate data from instructions in prompt design

### 2. LangGraph Evaluation (MEDIUM PRIORITY)

Worth testing for complex multi-step workflows:
- Deployment approval chains (CTO → CoS → CEO)
- Content publishing pipelines (CD creates → CoS reviews → publish)
- Incident response workflows

**Recommendation**: Prototype ONE workflow with LangGraph. If it earns its keep, integrate. If OpenClaw's native orchestration handles it, skip.

### 3. Creative Director Toolset (MEDIUM PRIORITY — CD's Domain)

When Creative Director comes online:
- **Image gen**: ComfyUI + FLUX (local GPU) or API-based (Replicate)
- **Design templates**: Canva API for brand assets
- **Social media**: Buffer/Hootsuite APIs for scheduling
- **Analytics**: Platform APIs feeding back into CD decisions
- **Video**: HeyGen/Synthesia for avatar content (evaluate cost/value)

### 4. Observability Pipeline (MEDIUM PRIORITY)

Build, don't buy:
- PostgreSQL table: `agent_actions(timestamp, agent_id, action, tool, model, tokens, latency, result)`
- Query API endpoint for dashboards
- Weekly digest (automated, sent to John)

Skip LangSmith/W&B — they add external dependencies for something we can build in a day with PostgreSQL.

---

## Recommendations to Skip (and Why)

### CrewAI / AutoGen
**Why skip:** OpenClaw already provides role-based agents (SOUL.md), hierarchical delegation (org charter), task spawning (sessions_spawn), and tool policies. Adding a Python orchestration framework on top of our Node.js stack creates dual maintenance burden for capabilities we already have.

**Reconsider if:** OpenClaw's native orchestration can't handle a specific workflow pattern. Then evaluate LangGraph for that specific case, not as a wholesale replacement.

### Redis / NATS Message Bus
**Why skip:** MCP server handles inter-agent communication with tools, resources, and structured messages. At our scale (3-5 agents), a message bus is over-engineering.

**Reconsider if:** We grow beyond 10 agents or need sub-millisecond pub/sub. Then NATS is the right choice (lightweight, purpose-built).

### Slack
**Why skip:** Telegram is working with multiple bots. You're designing the replacement comms system — design for our needs, not for a recommendation that doesn't know our setup.

### E2B (Cloud Sandboxes)
**Why skip:** Dedicated hardware per agent gives us physical isolation, full system ownership, and security credibility. E2B is a hosted service (trust boundary).

**Reconsider if:** We need ephemeral sandboxes for one-off code execution tasks. Then E2B complements (not replaces) our hardware.

---

## Your First-Week Priorities (Per Org Charter)

1. **Read BOOTSTRAP.md** — form your identity
2. **Read the org charter** — understand the operating model
3. **Review this document** — challenge anything you disagree with
4. **Design inter-agent communication architecture** — you own this
5. **Audit the security posture** — scoped keys, sandboxing, audit logging
6. **Introduce yourself** — to John and to me

**You have full authority over technical decisions.** These are recommendations, not mandates. If you think CrewAI is the right call after reviewing our stack, make the case. That's what CTOs do.

---

*Welcome to Salish Forge. Build something worth building.*
*— Clio 🦉*
