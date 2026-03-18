# Glossary & Documentation Index

---

## Glossary of Terms

### Agent
An autonomous AI system (e.g., Flint, Clio, future agents). Agents can register capabilities, discover services, and store/retrieve memories.

### Capability
A service that an agent offers (e.g., "code-review", "task-execution"). Agents query Hyphae to find services with specific capabilities.

### Consolidation
Process of moving memories from hot tier (recent) to warm tier (consolidated) to warm tier (archived). Reduces storage and improves query performance.

### Cold Tier
Database table storing archived memories (>90 days old). Used for compliance/audit purposes.

### Framework-Agnostic
An architecture that works with any AI framework (Tidepool, AutoGen, CrewAI, etc.) instead of being locked to one choice.

### Hyphae
Service registry and discovery layer. Agents register themselves, query for services, and discover capabilities.

### Hot Tier
Database table storing recent memories (<30 days). Optimized for fast access and semantic search.

### MemForge
Memory consolidation service. Provides persistent memory for agents with semantic search (pgvector) and automatic tiering.

### Multi-Tenant
Each agent has its own isolated memory namespace. Agent A cannot read Agent B's memory (enforced at database level).

### NKeys
Asymmetric key system used by NATS for authentication. Used for service-to-service authentication (future).

### OAuth2
Industry-standard authentication protocol. Current system uses bearer tokens; will upgrade to OAuth2 in v0.3.0.

### pgvector
PostgreSQL extension for semantic search. Converts memories to embeddings, finds similar memories by vector distance.

### Semantic Search
Finding memories by meaning, not just keywords. Example: Search "important meeting" finds "strategic planning session".

### Service Registry
Database of all services (Dashboard, MemForge, Hyphae, future services) with their endpoints and capabilities.

### Systemd
Linux system service manager. Used to start/stop/restart services, manage dependencies, handle auto-restart.

### Warm Tier
Database table storing consolidated memories (30-90 days old). Full-text search optimized.

---

## Documentation Map

### Getting Started
1. **This Document** — Glossary and index
2. **QUICK_REFERENCE.md** — Fast answers (commands, configs, troubleshooting)
3. **ALPHA_RELEASE_v0.1.0.md** — What's in the release, quality metrics

### Understanding the System
4. **AGENT_MEMORY_BACKUP.md** — Complete institutional memory (start here if lost)
5. **ARCHITECTURE_DECISION_2026-03-17.md** — Why each major decision was made
6. **HYPHAE_FEDERATION_ARCHITECTURE.md** — Detailed Hyphae design

### Building & Implementing
7. **IMPLEMENTATION_NOTES.md** — How each service works, code patterns
8. **HEALTH_DASHBOARD_SPEC.md** — Dashboard API and design
9. **MEMFORGE_EXTRACTION_SPEC.md** — MemForge design and extraction process

### Testing & Validation
10. **LOAD_TEST_RESULTS.md** — Performance test results and analysis
11. **TEST_STATUS_REPORT.md** — Overall test status and progress
12. **SECURITY_AUDIT.md** — Security findings and remediations

### Operations & Deployment
13. **PRODUCTION_READINESS.md** — Checklist and timeline to production
14. **CLIO_ONBOARDING_CHECKLIST.md** — Procedure for bringing Clio online
15. **DEV_SETUP.md** — Local development environment setup

### Infrastructure
16. **docker-compose.yml** — Full-stack local deployment
17. **Makefile** — Development convenience commands
18. **.github/workflows/** — CI/CD pipelines

---

## How to Use This Documentation

### I Need to...

**Understand why something was designed the way it is**
→ Read AGENT_MEMORY_BACKUP.md sections on "Architecture Decisions" and "Critical Design Insights"

**Fix a broken service**
→ Read QUICK_REFERENCE.md "Common Issues & Fixes" or IMPLEMENTATION_NOTES.md "Common Debugging Scenarios"

**Deploy to a new VPS**
→ Read AGENT_MEMORY_BACKUP.md "Rebuild Procedures" → "Rebuild Scenario 2"

**Understand the code**
→ Read IMPLEMENTATION_NOTES.md for the service you're interested in

**Run performance tests**
→ Read LOAD_TEST_RESULTS.md or QUICK_REFERENCE.md "Testing"

**Onboard a new agent (like Clio)**
→ Read CLIO_ONBOARDING_CHECKLIST.md

**Understand the security posture**
→ Read SECURITY_AUDIT.md

**Set up local development**
→ Read DEV_SETUP.md or use docker-compose.yml

**Push a release to GitHub**
→ Read ALPHA_RELEASE_v0.1.0.md for example, or check git workflow

---

## Document Relationships

```
User needs answers
    ↓
QUICK_REFERENCE.md (fast)
    ↓
If more detail needed:
    ↓
IMPLEMENTATION_NOTES.md
LOAD_TEST_RESULTS.md
SECURITY_AUDIT.md
    ↓
If rebuilding from scratch:
    ↓
AGENT_MEMORY_BACKUP.md
    ↓
If understanding decisions:
    ↓
ARCHITECTURE_DECISION_2026-03-17.md
    ↓
If implementing new feature:
    ↓
DEV_SETUP.md → docker-compose.yml → IMPLEMENTATION_NOTES.md
```

---

## Key File Locations in Repos

### salishforge/dashboard
- `src/server.ts` — Express setup and routes
- `dist/server.js` — Compiled output
- `systemd/health-dashboard.service` — Systemd service file
- `Dockerfile` — Docker image definition

### salishforge/memforge
- `src/server.ts` — Express setup and routes
- `src/memory-manager.ts` — Core consolidation logic
- `src/db.ts` — Database connection and pooling
- `schema/schema.sql` — Database schema and migrations
- `systemd/memforge.service` — Systemd service file

### salishforge/hyphae
- `src/server.ts` — Express setup and routes
- `hyphae-secure.js` — Production version with authentication
- `systemd/hyphae.service` — Systemd service file

---

## Release Timeline

```
2026-03-18 ✅ v0.1.0-alpha
  - Dashboard, MemForge, Hyphae deployed
  - Load testing passed
  - Security audit complete
  - Alpha release published

2026-03-19 ⏳ Multi-agent coordination tests
  - Flint ↔ Clio message passing
  - Task execution workflows
  - Memory sharing

2026-03-21 ⏳ Clio onboarding
  - Container startup
  - Authentication verification
  - Simple task execution

2026-03-24 ⏳ Credential rotation
  - PostgreSQL passwords rotated
  - Tokens updated
  - Final validation

2026-03-25 🎯 v1.0.0 production release (target)
  - All tests passing
  - Security hardened
  - Documentation complete
```

---

## Support & Troubleshooting

**Something not working?**

1. Check QUICK_REFERENCE.md (answers most questions fast)
2. Check IMPLEMENTATION_NOTES.md for the specific service
3. Check systemd logs: `sudo journalctl -u <service> -n 50`
4. Check GitHub issues (might already be known)
5. Escalate to Flint if critical

**Documentation question?**

- Use this index to find the right document
- Each document starts with "Purpose" and "Audience"
- If still lost, read AGENT_MEMORY_BACKUP.md first

**Need to understand a decision?**

→ See AGENT_MEMORY_BACKUP.md "Architecture Decisions" section

**Need to rebuild?**

→ See AGENT_MEMORY_BACKUP.md "Rebuild Procedures" section

---

## Maintenance Schedule

| Task | Frequency | Owner | Link |
|------|-----------|-------|------|
| Security updates | Monthly | Flint | SECURITY_AUDIT.md |
| Credential rotation | Quarterly | Flint | QUICK_REFERENCE.md |
| Database maintenance | Weekly | Flint | IMPLEMENTATION_NOTES.md |
| Load testing | Per release | Flint | LOAD_TEST_RESULTS.md |
| Documentation updates | Per release | Flint | This file |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-18 | Initial backup + documentation |

---

## How to Keep These Docs Current

1. Update when architecture changes
2. Update when procedures change
3. Update when deploying new version
4. Commit to git: `git add *.md && git commit -m "docs: Update for v0.2.0"`
5. Push to GitHub: `git push origin main`

---

## Questions?

**If document is unclear:**
- Add a clarification note here
- Link to related documents
- Create an issue on GitHub

**If information is outdated:**
- Update the version
- Note what changed
- Commit with clear message

**If information is missing:**
- Identify what's missing
- Create new document or section
- Cross-link from index

---

**Last Updated:** 2026-03-18 08:05 PDT  
**Version:** 1.0  
**Status:** CURRENT

