# Clio Memory Guide — MemForge Integration
**Last Updated:** 2026-03-18
**Author:** Flint (CTO Agent)
**Status:** LIVE — fully operational

---

## Overview

This guide documents how Clio's memory is consolidated and indexed in MemForge for semantic search and relationship traversal. All `.md` files from the Salish Forge workspace have been ingested into the tiered memory system running on the VPS at `100.97.161.7`.

---

## Architecture

### Memory Tiers

| Tier | Database | Purpose | Records |
|------|----------|---------|---------|
| hot_tier | tidepool (PostgreSQL) | Raw ingest (write-heavy) | 0 (auto-consolidated) |
| warm_tier | tidepool (PostgreSQL) | Full-text searchable, recent | 19 consolidated entries |
| cold_tier | tidepool (PostgreSQL) | Archive, audit trail | 0 |

### Relationship Graph

| Table | Database | Purpose | Records |
|-------|----------|---------|---------|
| clio_relationship_graph | clio_memory (PostgreSQL) | Semantic relationships between docs | 38 edges |

### Supporting Tables (clio_memory)

- `warm_tier` — 722 records from existing tiered memory system (with pgvector embeddings)
- `nodes` / `edges` / `embeddings` — graph database layer (ready for future use)

---

## MemForge API

**Endpoint:** `http://100.97.161.7:3333`
**Auth:** OAuth2 Bearer token (client: `memforge`)
**Agent ID:** `clio`

### Get a Token

The memforge OAuth2 server runs at `http://localhost:3005` (VPS-local only). Active tokens are stored in the `oauth2` database:

```sql
-- Get active memforge token (run on VPS via sudo -u postgres psql -d oauth2)
SELECT access_token FROM oauth2_tokens
WHERE client_id = 'memforge' AND expires_at > NOW() AND revoked = false
ORDER BY expires_at DESC LIMIT 1;
```

### Key Endpoints

```bash
# Check agent stats
GET /memory/clio/stats

# Add memory
POST /memory/clio/add
Body: {"content": "...", "metadata": {...}}

# Search (full-text)
GET /memory/clio/query?q=<search_text>&limit=10

# Trigger consolidation (hot → warm)
POST /memory/clio/consolidate

# Agent stats
GET /memory/clio/stats
```

### Example Query

```bash
TOKEN=$(sudo -u postgres psql -d oauth2 -t -c "SELECT access_token FROM oauth2_tokens WHERE client_id='memforge' AND expires_at>NOW() AND revoked=false ORDER BY expires_at DESC LIMIT 1;")

curl -s "http://100.97.161.7:3333/memory/clio/query?q=tiered+memory+architecture&limit=5" \
  -H "Authorization: Bearer $TOKEN"
```

---

## File Manifest

### Local Workspace (`/home/artificium/.openclaw/workspace/`)
**81 files ingested** (740 chunks in hot_tier, consolidated to warm_tier)

#### Core Identity & Context
| File | Category |
|------|----------|
| IDENTITY.md | identity |
| SOUL.md | identity |
| AGENTS.md | identity |
| USER.md | identity |
| CTO_PROFILE.md | identity |
| HEARTBEAT.md | identity |
| BOOTSTRAP.md | reference |
| TOOLS.md | reference |

#### Memory & Architecture
| File | Category |
|------|----------|
| MEMORY_GUIDELINES_TIERED.md | architecture |
| MEMFORGE_EXTRACTION_SPEC.md | architecture |
| CLIO_MEMORY_CONSOLIDATION_PLAN.md | architecture |
| HYPHAE_FEDERATION_ARCHITECTURE.md | architecture |
| HYPHAE_PERSISTENCE_IMPLEMENTATION.md | architecture |
| HYPHAE_EXTRACTION_SPEC.md | architecture |
| ARCHITECTURE_DECISION_2026-03-17.md | architecture |
| ARCHITECTURE_DECISION_STANDALONE_PLATFORM.md | architecture |
| PLATFORM_ARCHITECTURE_REVIEW.md | architecture |
| docs/COMMS_ARCHITECTURE.md | architecture |
| architecture-comms-v0.1.md | architecture |

#### Session Memory Logs
| File | Date |
|------|------|
| memory/2026-03-18.md | 2026-03-18 |
| memory/2026-03-17.md | 2026-03-17 |
| memory/2026-03-17-SESSION2.md | 2026-03-17 (session 2) |
| memory/2026-03-16.md | 2026-03-16 |
| memory/2026-03-15-0115.md | 2026-03-15 |
| memory/2026-03-13.md | 2026-03-13 |
| memory/2026-03-10.md | 2026-03-10 |
| memory/2026-03-09.md | 2026-03-09 |

#### Security & Operations
| File | Category |
|------|----------|
| OAuth2_IMPLEMENTATION_GUIDE.md | security |
| COMMUNICATION_SECURITY_POLICY.md | security |
| SECURITY_AUDIT.md | security |
| TIDEPOOL_SECRETS_ARCHITECTURE.md | security |
| INCIDENT_RESPONSE_PLAYBOOK.md | operations |
| OPERATIONS_RUNBOOKS.md | operations |
| PRODUCTION_DEPLOYMENT_GUIDE.md | operations |
| PRODUCTION_READINESS.md | operations |

#### Planning & Sprints
| File | Category |
|------|----------|
| SPRINT_9_PLAN.md | planning |
| SPRINT_8_PLAN.md | planning |
| SPRINT_PLAN_PHASE2.md | planning |
| BACKLOG_EXECUTION_2026-03-18.md | planning |
| LAUNCH_CHECKLIST.md | planning |

#### Testing & Quality
| File | Category |
|------|----------|
| MULTI_AGENT_TESTS.md | testing |
| TEST_STATUS_REPORT.md | testing |
| LOAD_TEST.md | testing |
| LOAD_TEST_RESULTS.md | testing |

#### Research & Reference
| File | Category |
|------|----------|
| research/AI_MEMORY_LITERATURE_REVIEW.md | research |
| FEATURE_COMPARISON_AUTOGEN_CREWAI_TIDEPOOL.md | research |
| GLOSSARY_AND_INDEX.md | reference |
| QUICK_REFERENCE.md | reference |

### VPS Files (`/home/artificium/.openclaw/`)
**168 files ingested** from:
- `workspace-architect/` — 28 files (Clio Director workspace history)
- `workspace/archive/` — 36 files (archived knowledge)
- `workspace/memory/` — 87 files (full memory log history from 2026-02-03 onward)
- `workspace/tiered-memory-package/` — 7 files (tiered memory implementation docs)

---

## Relationship Graph

The `clio_relationship_graph` table in `clio_memory` contains **38 edges** across 10 categories:

| Category | Edges |
|----------|-------|
| architecture | 11 |
| planning | 5 |
| memory_log | 5 |
| identity | 4 |
| reference | 3 |
| security | 3 |
| testing | 2 |
| monitoring | 2 |
| research | 2 |
| operations | 1 |

### Relationship Types

| Type | Count | Meaning |
|------|-------|---------|
| implements | 8 | Source implements target spec |
| follows | 5 | Sequential ordering (sessions) |
| informs | 3 | Source informs target decisions |
| extends | 3 | Source extends target's scope |
| defines | 2 | Source defines target's content |
| executes | 2 | Source execution of target plan |
| supersedes | 2 | Source replaces target |
| specifies | 2 | Source specifies target component |

### Query the Graph

```sql
-- Find all documents related to a specific file
SELECT source_title, relationship, target_title, strength
FROM clio_relationship_graph
WHERE source_file LIKE '%MEMORY%' OR target_file LIKE '%MEMORY%'
ORDER BY strength DESC;

-- Find the memory chain
SELECT source_title, relationship, target_title
FROM clio_relationship_graph
WHERE category = 'memory_log'
ORDER BY source_file DESC;

-- Find what implements the architecture
SELECT source_title, relationship, target_title
FROM clio_relationship_graph
WHERE relationship = 'implements' AND category = 'architecture';
```

---

## Infrastructure Details

### Services

| Service | Port | Status | Config |
|---------|------|--------|--------|
| MemForge API | 3333 | RUNNING | `/home/artificium/memforge/.env` |
| OAuth2 Server | 3005 | RUNNING (localhost only) | `/home/artificium/.oauth2.env` |
| MCP Memory Server | 8484 | RUNNING | `/home/artificium/mcp-memory-server/` |
| Tiered Memory API | 3333 | Same as MemForge | — |

### Databases

| Database | Owner | Purpose |
|----------|-------|---------|
| tidepool | postgres | MemForge standalone (hot/warm/cold_tier) |
| clio_memory | postgres | Rich memory schema + relationship graph |
| oauth2 | oauth2_user | OAuth2 token management |

### MemForge Schema (tidepool DB)

```sql
agents            -- Agent registry (multi-tenant anchor)
hot_tier          -- Raw events, write-heavy
warm_tier         -- Consolidated, full-text searchable (GIN index)
cold_tier         -- Archive, audit trail
consolidation_log -- Consolidation run history
```

---

## Consolidation Process

The memforge service auto-consolidates when `hot_tier` reaches 50+ rows (configurable). Consolidation batches 500 rows at a time into consolidated `warm_tier` entries with full-text search index.

**Manual trigger:**
```bash
curl -X POST http://100.97.161.7:3333/memory/clio/consolidate \
  -H "Authorization: Bearer $TOKEN"
```

**Run history:**
- Run 1 (2026-03-18 09:05 UTC): 500 hot rows → 10 warm entries
- Run 2 (2026-03-18 09:06 UTC): 408 hot rows → 9 warm entries
- Total: 908 hot rows processed → 19 warm entries

---

## Adding New Memory

To add new content to Clio's memory:

```bash
# From VPS or via SSH tunnel
TOKEN=$(sudo -u postgres psql -d oauth2 -t -c \
  "SELECT access_token FROM oauth2_tokens WHERE client_id='memforge' AND expires_at>NOW() AND revoked=false ORDER BY expires_at DESC LIMIT 1;" | tr -d ' ')

curl -X POST http://100.97.161.7:3333/memory/clio/add \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Your memory content here",
    "metadata": {
      "category": "knowledge",
      "source": "session_2026-03-18",
      "filename": "CONTEXT.md"
    }
  }'
```

---

## MCP Integration

The MCP Memory Server at `http://100.97.161.7:8484/mcp` uses `Bearer sf-mcp-collab-2026` and provides `query_memory`, `get_system_status`, and other tools. Note: the MCP warm-tier query currently returns HTTP 401 when proxying to the internal API — this is a known issue where the MCP server needs a valid OAuth2 token configured for internal API calls. Direct API access works correctly.

---

## Troubleshooting

**Token expired:**
```bash
# Generate new token by restarting the memforge service (it auto-generates tokens)
ssh artificium@100.97.161.7 "sudo systemctl restart memforge"
# Then retrieve the new token from oauth2_tokens
```

**memforge_user permission issues:**
```bash
ssh artificium@100.97.161.7 "sudo -u postgres psql -d tidepool -c 'GRANT ALL ON ALL TABLES IN SCHEMA public TO memforge_user; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO memforge_user;'"
```

**Schema not initialized:**
```bash
ssh artificium@100.97.161.7 "sudo -u postgres psql -d tidepool -f /home/artificium/memforge/schema/schema.sql"
```
