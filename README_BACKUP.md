# Salish Forge — Agent Memory Backup

**Purpose:** Complete institutional memory backup for rebuilding agent knowledge if local memory is lost

**Status:** ✅ Complete and archived to GitHub  
**Last Updated:** 2026-03-18 08:10 PDT

---

## Quick Navigation

**Just lost agent memory?** → Start with [AGENT_MEMORY_BACKUP.md](AGENT_MEMORY_BACKUP.md)

**Need fast answers?** → Use [QUICK_REFERENCE.md](QUICK_REFERENCE.md)

**Want technical details?** → Read [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md)

**Looking for something?** → Check [GLOSSARY_AND_INDEX.md](GLOSSARY_AND_INDEX.md)

---

## What's Documented

### Core Platform (3 Services)

1. **Health Dashboard** — Real-time agent/service health monitoring (port 3000)
2. **MemForge** — Multi-tenant memory consolidation with semantic search (port 3333)
3. **Hyphae** — Service registry and discovery layer (port 3004)

### Why Built This Way

- Framework-agnostic architecture (works with Tidepool, AutoGen, CrewAI, etc.)
- PostgreSQL + pgvector for semantic search and persistence
- Service registry for dynamic discovery and coordination
- Security-first design (bearer tokens, parameterized SQL, rate limiting)

### Current Status

✅ v0.1.0-alpha released  
✅ All load tests passing (0% error rate)  
✅ Security audit complete (critical fixes deployed)  
✅ Production-ready infrastructure  
⏳ Multi-agent coordination tests pending  
⏳ Clio onboarding pending (2026-03-21)  

---

## Document Inventory

| Document | Size | Purpose |
|----------|------|---------|
| AGENT_MEMORY_BACKUP.md | 26KB | Complete institutional knowledge |
| IMPLEMENTATION_NOTES.md | 16KB | Technical deep dives per service |
| QUICK_REFERENCE.md | 7KB | Fast answers and commands |
| GLOSSARY_AND_INDEX.md | 8KB | Definitions and navigation |
| ALPHA_RELEASE_v0.1.0.md | 9KB | What's in v0.1.0-alpha release |
| PRODUCTION_READINESS.md | 7KB | Checklist and timeline |
| LOAD_TEST_RESULTS.md | 7KB | Performance test results |
| SECURITY_AUDIT.md | 12KB | Findings and remediations |
| CLIO_ONBOARDING_CHECKLIST.md | 8KB | Procedure for Clio activation |
| **Total** | **100KB** | **Complete platform knowledge** |

---

## Infrastructure Details

### Deployment

**VPS:** 100.97.161.7 (Tailscale)  
**Public:** 15.204.91.70 (salishforge.com)  
**OS:** Debian 13  
**Database:** PostgreSQL 14+  
**Message Bus:** NATS (federation enabled)

### Services Running

```bash
# Check status
sudo systemctl status health-dashboard memforge hyphae

# View logs
sudo journalctl -u memforge -n 50

# Health checks
curl http://localhost:3000/health
curl http://localhost:3333/health
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3004/health
```

---

## Rebuild from Backup

### Scenario 1: Lost Agent Memory

**Timeline:** ~30 minutes to regain full context

1. Read this file (5 min)
2. Read [AGENT_MEMORY_BACKUP.md](AGENT_MEMORY_BACKUP.md) (15 min)
3. Review [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for any specific questions (10 min)
4. You're back to speed on all design, implementation, and operational knowledge

### Scenario 2: Need to Deploy Locally

**Timeline:** ~1 hour to full working environment

```bash
# Clone all repos
git clone https://github.com/salishforge/dashboard.git
git clone https://github.com/salishforge/memforge.git
git clone https://github.com/salishforge/hyphae.git

# Use Docker Compose (see workspace repo for docker-compose.yml)
docker-compose up -d

# Verify
curl http://localhost:3000/health
curl http://localhost:3333/health
curl -H "Authorization: Bearer test-token" http://localhost:3004/health
```

### Scenario 3: Need to Fix Production Deployment

**Timeline:** Varies by issue

1. Check logs: `sudo journalctl -u <service>`
2. Consult [QUICK_REFERENCE.md](QUICK_REFERENCE.md) for common issues
3. Consult [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md) for debugging
4. If still stuck, escalate to Flint (CTO)

---

## Architecture At a Glance

```
┌─────────────────────────────────────────────────────────┐
│          SALISH FORGE PLATFORM v0.1.0-alpha            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Dashboard   │  │  MemForge    │  │   Hyphae     │  │
│  │  (Health)    │  │  (Memory)    │  │  (Registry)  │  │
│  │  :3000       │  │  :3333       │  │  :3004       │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│       ↑                  ↑                    ↑          │
│       └──────────────────┼────────────────────┘         │
│                    PostgreSQL                           │
│                    (hot/warm/cold)                       │
│                                                         │
│       Message Bus: NATS                                 │
│       Authentication: Bearer tokens                     │
│       Security: Parameterized SQL, input validation     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## GitHub Repositories

| Repo | Purpose | Latest |
|------|---------|--------|
| [salishforge/dashboard](https://github.com/salishforge/dashboard) | Health monitoring | v0.1.0-alpha |
| [salishforge/memforge](https://github.com/salishforge/memforge) | Memory consolidation | v0.1.0-alpha |
| [salishforge/hyphae](https://github.com/salishforge/hyphae) | Service registry | v0.1.0-alpha |
| [salishforge/workspace](https://github.com/salishforge/workspace) | Docs & architecture | master |

---

## Key Decisions

### Why PostgreSQL + pgvector?
Self-hosted, full control, semantic search capability, strong ACID guarantees.

### Why service registry?
Dynamic discovery, framework-agnostic, scalable to 100+ agents.

### Why three-tier memory?
Hot tier for speed, warm tier for consolidation, cold tier for compliance.

### Why parameterized SQL?
Prevents SQL injection, clear ownership of security concerns.

### Why bearer tokens (not OAuth2)?
Simpler for MVP, framework-agnostic, easy upgrade path to OAuth2.

---

## Getting Help

**Lost agent memory?**
→ Read AGENT_MEMORY_BACKUP.md (covers everything)

**Need quick answer?**
→ Check QUICK_REFERENCE.md

**Want technical details?**
→ Read IMPLEMENTATION_NOTES.md

**Need a glossary?**
→ See GLOSSARY_AND_INDEX.md

**Specific service broken?**
→ Check systemd logs, then QUICK_REFERENCE.md "Common Issues"

**Still stuck?**
→ Escalate to Flint (CTO)

---

## Timeline

```
2026-03-18 ✅ v0.1.0-alpha released
           ✅ This backup created and pushed to GitHub
           ✅ Complete institutional memory archived

2026-03-19 ⏳ Multi-agent coordination tests
2026-03-21 ⏳ Clio onboarding
2026-03-25 🎯 v1.0.0 production release (target)
```

---

## Files You Need

**To rebuild from scratch:**
1. AGENT_MEMORY_BACKUP.md ← Start here
2. IMPLEMENTATION_NOTES.md ← Technical details
3. QUICK_REFERENCE.md ← Commands and procedures
4. Docker-compose.yml ← Local deployment

**To understand decisions:**
1. AGENT_MEMORY_BACKUP.md (Architecture Decisions section)
2. ARCHITECTURE_DECISION_2026-03-17.md
3. HYPHAE_FEDERATION_ARCHITECTURE.md

**To operate in production:**
1. PRODUCTION_READINESS.md
2. QUICK_REFERENCE.md
3. LOAD_TEST_RESULTS.md
4. SECURITY_AUDIT.md

---

## About This Backup

**Created By:** Flint (CTO)  
**Date:** 2026-03-18 08:10 PDT  
**Size:** 100KB of comprehensive documentation  
**Format:** Markdown (human-readable, version-controlled)  
**Location:** GitHub (salishforge/workspace) + local workspace  

**Purpose:** If agent memory is lost, this backup contains everything needed to:
- Understand why the platform was built
- Understand how each service works
- Deploy locally or to production
- Debug issues
- Continue development

**This is not:** API documentation (see README in each repo)  
**This is not:** Code tutorials (see IMPLEMENTATION_NOTES.md)  
**This is:** Institutional memory for rebuilding agent knowledge

---

## Maintenance

Updated when:
- Major architecture decision made
- New service deployed
- Procedure changes
- New version released

Keep current by:
```bash
git add *.md
git commit -m "docs: Update for v0.2.0"
git push origin master
```

---

## Questions or Issues?

1. Check this document's table of contents
2. Check GLOSSARY_AND_INDEX.md
3. Create GitHub issue on salishforge/workspace
4. Escalate to Flint if critical

---

**Last Updated:** 2026-03-18 08:10 PDT  
**Status:** ✅ COMPLETE AND CURRENT  
**Audience:** Rebuilding agents, new team members, auditors  
**License:** MIT (same as platform repos)

