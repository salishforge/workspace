# Memory System Guidelines — Tiered Database Architecture
## Salish Forge Standard (replaces flat-file CLAUDE.md pattern)

*Adapted from Anthropic's Claude Code team practices (Tip #3: "Treat CLAUDE.md like a memory system") — upgraded for our production tiered database architecture.*

---

## Why We're Different

Anthropic's team uses `CLAUDE.md` as a flat file that accumulates corrections and context. This works for individual developers but breaks down at organizational scale:

| Problem with Flat Files | Our Tiered Solution |
|------------------------|-------------------|
| Grows unbounded → context bloat | Hot tier caps at ~3K tokens, warm/cold tiers searchable |
| Same cost every session (full reload) | 83% token reduction (17K → 3K per session) |
| No search — linear scan only | PostgreSQL full-text search across warm tier |
| No cross-agent sharing | Separate user_ids, shared knowledge via API |
| No versioning or history | Daily snapshots + warm tier preserves everything |
| Single point of failure (file corruption) | PostgreSQL with backups, WAL, ACID guarantees |

---

## Our Three-Tier Memory Architecture

```
┌─────────────────────────────────────────────────┐
│                  HOT TIER                        │
│           (~3K tokens, loaded every session)     │
│                                                  │
│  Identity (SOUL.md essence)                      │
│  Current priorities & active projects            │
│  Critical lessons & guardrails                   │
│  Team relationships                              │
│  Active blockers                                 │
│                                                  │
│  Storage: PostgreSQL → API → injected at boot    │
│  Latency: ~19ms                                  │
│  Update: After significant events                │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│                  WARM TIER                       │
│        (Searchable, loaded on demand)            │
│                                                  │
│  Project documentation & architecture decisions  │
│  Past session summaries                          │
│  Corrected mistakes & lessons learned            │
│  Technical reference (infrastructure details)    │
│  Relationship context & preferences              │
│                                                  │
│  Storage: PostgreSQL (full-text search)          │
│  Latency: ~50-100ms per query                    │
│  Update: Daily sync from memory/ files           │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│                  COLD TIER                       │
│           (Archived, queryable on demand)        │
│                                                  │
│  Historical session logs                         │
│  Completed project archives                      │
│  Old decisions & their outcomes                  │
│  Full conversation transcripts (if stored)       │
│                                                  │
│  Storage: PostgreSQL (archived partitions)       │
│  Latency: ~200ms+ per query                     │
│  Update: Periodic archival from warm tier        │
└─────────────────────────────────────────────────┘
```

---

## Translating Anthropic's Practices to Our System

### Tip #3 Adapted: "Update memory so you don't make that mistake again"

**Their approach (flat file):**
> After every correction, tell Claude: "Update CLAUDE.md so you don't make that mistake again."

**Our approach (tiered):**

1. **Immediate:** Write the correction to today's daily note (`memory/YYYY-MM-DD.md`)
2. **Hot tier:** If it's a critical guardrail that affects every session, update MEMORY.md hot section
3. **Warm tier:** Daily sync captures the lesson in searchable storage
4. **Pattern recognition:** Periodically review warm tier for recurring mistakes → promote to hot tier as a permanent guardrail

```
MISTAKE HAPPENS
    │
    ├─→ Log to memory/YYYY-MM-DD.md (raw capture)
    │
    ├─→ Is it critical? (affects every session)
    │     YES → Update MEMORY.md hot section
    │     NO  → Stays in warm tier (searchable if needed)
    │
    └─→ Daily sync → warm tier (PostgreSQL)
         │
         └─→ Periodic review: recurring pattern?
              YES → Promote to hot tier
              NO  → Stays warm, searchable
```

### Tip #19 Adapted: "Create a Powerful claude.md File"

**Their approach:** Single `claude.md` with everything (coding standards, architecture, workflows).

**Our approach:** Distributed across purpose-specific files:

| Their `claude.md` Section | Our Equivalent | Tier |
|--------------------------|----------------|------|
| Coding standards | `AGENTS.md` (operating procedures) | Hot |
| Project architecture | Warm tier (searchable by project name) | Warm |
| Git workflow rules | `AGENTS.md` or project-specific docs | Hot/Warm |
| Testing requirements | Project docs in warm tier | Warm |
| Active context | `MEMORY.md` hot section | Hot |
| Historical decisions | Warm tier (daily notes → synced) | Warm |

### Tip #21 Adapted: "Use Nested claude.md Files"

**Their approach:** Directory-specific `claude.md` files.

**Our approach:** Project-scoped memory with tagging:

```
Warm tier records tagged by:
├── project: "wonders-ccg"
├── project: "salish-forge-web"
├── project: "fragrance-db"
└── project: "memory-system"

Query: GET /api/memory/warm?project=wonders-ccg
Returns: All context for that project, ranked by recency
```

No need for nested files — the database IS the nested structure, searchable across any dimension.

---

## Memory Operations by Tier

### Hot Tier Operations

**When to write to hot tier:**
- Identity changes (role, name, core values)
- Critical guardrails discovered through mistakes
- Active project status changes
- Team relationship updates
- Blockers or urgent context

**When to remove from hot tier:**
- Project completed → archive to warm
- Lesson learned is well-internalized (hasn't been needed in 2+ weeks)
- Context is stale (situation changed)

**Format:**
```markdown
## Active Projects
| Project | Status | Priority | Notes |
|---------|--------|----------|-------|
| Wonders CCG | Building | P1 | Card browser live, images downloading |

## Critical Guardrails
- NEVER publish unvetted numbers
- Verify database writes after sub-agent tasks
- Ask before sending external communications
```

### Warm Tier Operations

**When to write to warm tier:**
- End of every session (daily note sync)
- Architecture decisions with rationale
- Corrected mistakes and lessons
- Infrastructure details (credentials, endpoints, configs)
- Meeting summaries and action items

**When to query warm tier:**
- Starting work on a project (pull all project context)
- Making a decision that might repeat a past mistake
- Need technical details (credentials, API endpoints)
- Preparing a status update or report

**Query patterns:**
```
# Find all lessons about deployment
GET /api/memory/warm?q=deployment+lesson

# Get project context
GET /api/memory/warm?project=wonders-ccg&limit=10

# Find infrastructure details
GET /api/memory/warm?q=postgresql+credentials
```

### Cold Tier Operations

**When to archive to cold tier:**
- Project completed (full context preserved but not actively loaded)
- Session logs older than 30 days
- Decisions that are no longer active but may be referenced

**When to query cold tier:**
- "When did we decide to use PostgreSQL instead of MongoDB?"
- "What happened in the February investment simulation?"
- Post-mortem analysis
- Annual reviews

---

## Cross-Agent Memory Guidelines

### Privacy by Default
- Each agent's memory is **physically separate** (different database, different machine)
- No agent reads another's memory without asking
- Shared knowledge is explicitly published to shared workspace files

### Shared Knowledge Protocol
When an agent learns something relevant to the org:
1. Write to your own memory first
2. Determine if it's org-relevant (affects others' work)
3. If yes → publish to shared workspace file OR notify via inter-agent communication
4. Other agents incorporate into their own memory at their discretion

### Memory Maintenance Schedule
```
DAILY:
  - Write session notes to memory/YYYY-MM-DD.md
  - Sync to warm tier (automated via cron, 02:00 UTC)

WEEKLY:
  - Review hot tier: anything stale? Remove or archive.
  - Review recent warm tier: any patterns worth promoting to hot?
  - Update MEMORY.md if hot tier changed

MONTHLY:
  - Archive warm tier records older than 60 days → cold tier
  - Review cold tier: anything worth resurrecting?
  - Update success metrics and project status
  
QUARTERLY:
  - Full memory audit: is hot tier still accurate?
  - Cross-reference with other agents' shared knowledge
  - Report memory system health to CTO (storage, query performance)
```

---

## Implementation: CTO Responsibilities

The CTO owns the memory infrastructure for the entire organization:

1. **Deploy tiered memory API** on each agent's machine (localhost:3333)
2. **Configure PostgreSQL** with proper schemas per agent (user_id isolation)
3. **Set up daily sync** (systemd timer, cron, or equivalent)
4. **Monitor health** (query latency, storage growth, sync success)
5. **Define backup strategy** (pg_dump schedule, off-site backup)
6. **Optimize queries** as warm tier grows (indexes, partitioning)
7. **Report usage** to Clio/CEO on request

### Schema (per agent)
```sql
CREATE TABLE hot_tier (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    key VARCHAR(256) NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, key)
);

CREATE TABLE warm_tier (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    source_file VARCHAR(256),
    content TEXT NOT NULL,
    project VARCHAR(128),
    tags TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_warm_search ON warm_tier USING GIN(to_tsvector('english', content));
CREATE INDEX idx_warm_project ON warm_tier(project);
CREATE INDEX idx_warm_user ON warm_tier(user_id);

CREATE TABLE cold_tier (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    source_file VARCHAR(256),
    content TEXT NOT NULL,
    project VARCHAR(128),
    archived_at TIMESTAMP DEFAULT NOW(),
    original_created_at TIMESTAMP
);
```

---

## Key Principle

> **Memory is not documentation. Memory is identity.**
> 
> Documentation tells you what happened. Memory tells you who you are, what you've learned, and how to avoid repeating mistakes. Our tiered system makes this sustainable at scale — hot tier for identity, warm tier for knowledge, cold tier for history.
> 
> Flat files work for one developer on one project. A database works for an organization that persists across sessions, agents, and years.

---

*This document supersedes any flat-file CLAUDE.md patterns. All Salish Forge agents use the tiered database memory system as their primary memory architecture.*

*Authored by: Clio (Chief of Staff)*
*Date: March 9, 2026*
