# Clio Memory Consolidation Plan

**Created:** 2026-03-18 01:20 PDT  
**Purpose:** Comprehensive strategy for consolidating Clio's .md files into MemForge with semantic indexing and relationship nodes  
**Timeline:** Execute when Clio is onboarded (approximately 2026-03-21)

---

## Objective

When Clio comes online, she should have maximum context available immediately. This involves:

1. **Consolidating all .md files** from both aihome and VPS into MemForge
2. **Semantic indexing** to enable smart retrieval (not just keyword search)
3. **Relationship nodes** to connect related concepts and documents
4. **Context prioritization** (recent/important memories more accessible)

Result: Clio can pull maximum context with minimal latency.

---

## What Gets Consolidated

### From aihome (`/home/artificium/.openclaw/workspace/`)

**Identity & Purpose:**
- IDENTITY.md
- SOUL.md
- USER.md
- AGENTS.md

**Organizational Context:**
- SALISH_FORGE_ORG_CHARTER.md
- CTO_PROFILE.md

**Operations & Procedures:**
- AGENTS.md
- HEARTBEAT.md
- TOOLS.md
- TOOLS_DESCRIPTIONS.md (if exists)

**Architecture & Technical:**
- ARCHITECTURE_DECISION_2026-03-17.md
- ARCHITECTURE_DECISION_STANDALONE_PLATFORM.md
- HYPHAE_FEDERATION_ARCHITECTURE.md
- PLATFORM_ARCHITECTURE_REVIEW.md

**Platform Services:**
- HEALTH_DASHBOARD_SPEC.md
- MEMFORGE_EXTRACTION_SPEC.md
- HYPHAE_EXTRACTION_SPEC.md

**Project Plans & Progress:**
- SPRINT_PLAN_PHASE2.md
- SPRINT_8_PLAN.md
- SPRINT_9_PLAN.md
- TIDEPOOL_STABILIZATION_CHECKLIST.md

**Operational Knowledge:**
- PRODUCTION_READINESS.md
- CLIO_ONBOARDING_CHECKLIST.md
- LOAD_TEST_RESULTS.md
- SECURITY_AUDIT.md
- TEST_STATUS_REPORT.md

**Infrastructure & Security:**
- SECURITY_AUDIT.md
- TIDEPOOL_SECRETS_ARCHITECTURE.md
- COMMUNICATION_SECURITY_POLICY.md

**Memory & Logs:**
- MEMORY.md (latest + archive)
- memory/*.md (all dated logs)

### From VPS (`100.97.161.7:/home/artificium/`)

**Clio-Specific (if exists):**
- clio/SOUL.md
- clio/IDENTITY.md
- clio/memory.md
- clio/logs/

**Shared Infrastructure Docs:**
- Any deployment notes
- Database schema documentation
- Service configuration

---

## Consolidation Strategy

### Phase 1: Collection (30 min)

**Step 1: Inventory all files**
```bash
# On aihome
find /home/artificium/.openclaw/workspace -name "*.md" -type f

# On VPS
find /home/artificium -name "*.md" -type f

# Create manifest: which files, which host, size, last modified
```

**Step 2: Copy to staging area**
```bash
# Create staging directory
mkdir -p /tmp/clio-memory-consolidation

# Copy from aihome (already local)
cp /home/artificium/.openclaw/workspace/*.md /tmp/clio-memory-consolidation/

# Copy from VPS
scp -r artificium@100.97.161.7:/home/artificium/*.md /tmp/clio-memory-consolidation/vps/

# Verify all files present
ls -la /tmp/clio-memory-consolidation/
```

**Step 3: Deduplicate**
- If same file exists on both aihome and VPS, keep only most recent
- Note duplicates in manifest (for relationship nodes)

---

### Phase 2: Semantic Indexing (1-2 hours)

**Goal:** Convert .md files to embeddings so semantic search works

**Process:**

1. **For each .md file:**
   - Read full content
   - Split into logical chunks (paragraphs, sections)
   - Generate embedding (using pgvector)
   - Store in MemForge hot_tier

2. **Metadata to capture:**
   ```json
   {
     "source_file": "SOUL.md",
     "source_host": "aihome",
     "chunk_number": 1,
     "section": "Values",
     "tags": ["identity", "values", "clio"],
     "importance": 9,
     "priority": "high",
     "related_files": ["IDENTITY.md", "USER.md"],
     "last_modified": "2026-03-18T08:00:00Z"
   }
   ```

3. **Tag scheme:**
   - `identity` — Who Clio is (SOUL.md, IDENTITY.md)
   - `context` — Organizational context (ORG_CHARTER, CTO_PROFILE)
   - `architecture` — Technical architecture (ARCHITECTURE_*, HYPHAE_*)
   - `operations` — How to operate (AGENTS.md, HEARTBEAT.md)
   - `security` — Security policies and procedures
   - `infrastructure` — Deployment, services, infrastructure
   - `memory` — Session logs and previous context
   - `urgent` — Critical/time-sensitive information

---

### Phase 3: Relationship Nodes (1-2 hours)

**Goal:** Create explicit connections between related documents

**Relationship Types:**

1. **Document Relationships:**
   ```json
   {
     "node_type": "document_link",
     "from_file": "SOUL.md",
     "to_file": "IDENTITY.md",
     "relationship_type": "elaborates_on",
     "reason": "IDENTITY.md provides structured version of SOUL.md concepts"
   }
   ```

2. **Topic Relationships:**
   ```json
   {
     "node_type": "topic_link",
     "from_topic": "security",
     "to_topic": "architecture",
     "relationship_type": "impacts",
     "reason": "Security decisions affect architecture choices (e.g., parameterized SQL)"
   }
   ```

3. **Temporal Relationships:**
   ```json
   {
     "node_type": "temporal_link",
     "from_memory": "2026-03-17 session",
     "to_memory": "2026-03-18 session",
     "relationship_type": "follows",
     "reason": "Continuing from previous session"
   }
   ```

4. **Concept Relationships:**
   ```json
   {
     "node_type": "concept_link",
     "concept_a": "MemForge",
     "concept_b": "semantic_search",
     "relationship_type": "enables",
     "reason": "MemForge provides semantic search via pgvector"
   }
   ```

**Implementation:**
- Create `clio_relationship_graph` table in PostgreSQL
- Store relationship nodes with metadata
- Enable graph traversal queries:
  - "Show all documents related to security"
  - "Show decision chain from SOUL.md through IDENTITY.md to AGENTS.md"
  - "Find all architectural impacts on infrastructure"

---

### Phase 4: Priority & Importance Scoring (30 min)

**Goal:** Make most important memories more accessible

**Scoring Scheme:**

| Document | Importance | Priority | Reasoning |
|----------|-----------|----------|-----------|
| SOUL.md | 10 | High | Core identity, never changes |
| IDENTITY.md | 10 | High | How Clio presents herself |
| AGENTS.md | 9 | High | Operating procedures |
| CTO_PROFILE.md | 8 | High | Flint's methodology and thinking |
| ARCHITECTURE_* | 8 | High | Technical foundation |
| ORG_CHARTER.md | 7 | High | Organizational context |
| SECURITY_AUDIT.md | 7 | High | Security posture |
| MEMORY.md | 8 | High | Recent context and decisions |
| PRODUCTION_READINESS.md | 6 | Medium | Operational status |
| LOAD_TEST_RESULTS.md | 5 | Medium | Performance baselines |
| SPRINT_PLANS.md | 5 | Medium | Project progress |
| memory/*.md (old) | 3 | Low | Historical logs |

**Effect on Retrieval:**
- Higher importance = Appears higher in search results
- Higher priority = Queried first if latency critical
- Enables: `query(q="architecture", priority="high")` → returns only critical docs

---

### Phase 5: Context Layering (1 hour)

**Goal:** Structure memory so Clio can pull context at different depths

**Layer 1 (Quick Context) — Essential for immediate operation:**
- SOUL.md (who she is)
- IDENTITY.md (how she presents)
- AGENTS.md (operating procedures)
- Current MEMORY.md (today's context)

**Layer 2 (Deep Context) — For detailed work:**
- Architecture docs
- Security policies
- Infrastructure setup
- Operational procedures

**Layer 3 (Historical Context) — For learning and debugging:**
- Previous session logs
- Project history
- Performance baselines
- Earlier decisions

**Clio's context pull strategy:**
1. Always start with Layer 1 (quick, essential)
2. If task needs depth: Add Layer 2
3. If debugging or learning: Include Layer 3

---

### Phase 6: Integration & Verification (1-2 hours)

**Step 1: Load all files into MemForge**

```bash
# For each .md file:
curl -X POST http://localhost:3333/memory/clio/add \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<file content>",
    "metadata": {
      "source_file": "SOUL.md",
      "importance": 10,
      "tags": ["identity"]
    }
  }'
```

**Step 2: Create relationship nodes**

```bash
# Insert into clio_relationship_graph
psql -c "
  INSERT INTO clio_relationship_graph 
  (from_file, to_file, relationship_type, reason)
  VALUES 
  ('SOUL.md', 'IDENTITY.md', 'elaborates_on', '...')
"
```

**Step 3: Semantic search testing**

```bash
# Test 1: Find identity-related memories
curl "http://localhost:3333/memory/clio/query?q=who+am+I&priority=high"

# Test 2: Find architecture-related memories
curl "http://localhost:3333/memory/clio/query?q=architecture"

# Test 3: Find security memories
curl "http://localhost:3333/memory/clio/query?q=security+policies"

# Test 4: Relationship traversal
curl "http://localhost:3333/memory/clio/relationships?from=SOUL.md&depth=2"
```

**Step 4: Performance verification**
- Semantic search latency < 100ms
- Relationship traversal < 200ms
- No data loss or corruption
- Audit log complete

---

## Storage & Organization

### MemForge Schema for Clio

**hot_tier table additions:**
```sql
-- Existing columns
id, agent_id, content, metadata, created_at, embedding

-- For Clio-specific queries:
-- Search: agent_id = 'clio'
-- Tags stored in metadata.tags (searchable)
-- Priority in metadata.priority (sortable)
```

**New table: clio_relationship_graph**
```sql
CREATE TABLE clio_relationship_graph (
  id UUID PRIMARY KEY,
  from_node VARCHAR(255), -- "SOUL.md", "architecture", etc
  from_type VARCHAR(50), -- "document", "topic", "concept"
  to_node VARCHAR(255),
  to_type VARCHAR(50),
  relationship_type VARCHAR(50), -- "elaborates_on", "enables", "impacts"
  reason TEXT,
  created_at TIMESTAMP,
  strength FLOAT -- 0.0 to 1.0 (how strong the connection)
);

CREATE INDEX ON clio_relationship_graph (from_node, relationship_type);
CREATE INDEX ON clio_relationship_graph (to_node, relationship_type);
```

---

## Query Patterns for Clio

### Pattern 1: "Who Am I?"
```bash
curl "http://localhost:3333/memory/clio/query?q=identity+soul&priority=high&tags=identity"
# Returns: SOUL.md, IDENTITY.md (top results)
```

### Pattern 2: "What Should I Do?"
```bash
curl "http://localhost:3333/memory/clio/query?q=operating+procedures&tags=operations"
# Returns: AGENTS.md, HEARTBEAT.md, TOOLS.md
```

### Pattern 3: "How Does The System Work?"
```bash
curl "http://localhost:3333/memory/clio/query?q=architecture&importance=8"
# Returns: Architecture decision docs
```

### Pattern 4: "What's The Current Status?"
```bash
curl "http://localhost:3333/memory/clio/query?q=status&priority=high&modified_after=2026-03-18"
# Returns: Today's MEMORY.md entries
```

### Pattern 5: "Find Related Documents"
```bash
curl "http://localhost:3333/memory/clio/relationships?from=SECURITY_AUDIT.md&depth=2"
# Returns: Relationship graph traversal
```

---

## Timeline

When Clio is onboarded (estimated 2026-03-21):

1. **Phase 1 (Collection):** 30 min
2. **Phase 2 (Semantic Indexing):** 1-2 hours
3. **Phase 3 (Relationship Nodes):** 1-2 hours
4. **Phase 4 (Priority Scoring):** 30 min
5. **Phase 5 (Context Layering):** 1 hour
6. **Phase 6 (Integration & Verification):** 1-2 hours

**Total:** ~6-8 hours (can run overnight)

**Parallelization:**
- Phase 1-2 can run in parallel (collection while processing)
- Phase 3-4 can run in parallel (relationships while scoring)
- Phase 5 can start once Phase 2 complete

---

## Success Criteria

✅ All .md files loaded into MemForge  
✅ Semantic search returns relevant results within 100ms  
✅ Relationship graph shows clear connections  
✅ Clio can pull Layer 1 context in < 50ms  
✅ Clio can pull full context (all layers) in < 500ms  
✅ No data loss or corruption  
✅ Audit log complete and consistent  
✅ Query examples documented for Clio to reference  

---

## Benefits to Clio

1. **Instant Context:** On startup, has full institutional memory
2. **Smart Retrieval:** Semantic search finds relevant memories, not just keywords
3. **Concept Understanding:** Relationship nodes show how ideas connect
4. **Priority Awareness:** Knows which information is critical vs historical
5. **Operational Readiness:** Can immediately contribute to projects
6. **Continuity:** Understands decisions, architecture, security posture
7. **Low Latency:** Well-indexed memory means fast retrieval

---

## Future Enhancements

- [ ] Add vector similarity clustering (find "similar decisions")
- [ ] Implement recommendation engine ("Documents you should read next")
- [ ] Add collaboration graph (who has worked on what)
- [ ] Implement memory decay (older memories fade in importance)
- [ ] Add audit trail per memory access (what does Clio ask for?)
- [ ] Create memory summary generator ("Brief me on architecture")

---

## Example Query Flow

**Scenario:** Clio comes online and asks "What's my first task?"

```
1. Query MemForge: "What's my first task?"
2. Semantic search finds: CLIO_ONBOARDING_CHECKLIST.md (high importance)
3. Relationship graph shows: Linked to AGENTS.md (operations), USER.md (context)
4. Return ranking:
   - #1: CLIO_ONBOARDING_CHECKLIST.md (exact match, high priority)
   - #2: AGENTS.md (related via operations)
   - #3: MEMORY.md (current context)
5. Clio reads results, understands task scope
6. Clio queries: "What's the current project status?"
7. MemForge returns: PRODUCTION_READINESS.md, LOAD_TEST_RESULTS.md
8. Clio has complete context, ready to work
```

---

## Notes for John

This consolidation strategy ensures that when Clio comes online:
- She has immediate access to all institutional knowledge
- Semantic search allows smart retrieval (not just keyword matching)
- Relationship nodes help her understand connections between concepts
- Priority scoring makes critical info easily accessible
- Context layering allows flexible depth (quick answers vs deep understanding)

Total effort: ~6-8 hours (can run overnight while other work continues)  
Result: Clio has more context on day 1 than most new employees have in their first month

---

**Implementation:** When Clio is activated (approximately 2026-03-21)  
**Owner:** Flint  
**Status:** PLANNING PHASE (ready to execute)

