# Tidepool Phase 2 — Neuroscience-Inspired Memory Architecture

## Sprint Plan: From Flat Tiers to Living Memory

**Authors:** Clio (draft), Flint (review requested)  
**Date:** 2026-03-11  
**Status:** PROPOSAL — awaiting Flint review + John approval

---

## Guiding Principle: Model the Brain, Not the Database

Phase 1 (Tidepool v1.0) solved the engineering problem: bounded tokens, searchable tiers, agent comms. Phase 2 solves the _cognitive_ problem: how does an agent actually remember, forget, connect, and retrieve the way a mind does?

We draw on five neuroscience frameworks:

### 1. Complementary Learning Systems (CLS) Theory

_McClelland, McNaughton & O'Reilly, 1995; Kumaran et al., 2016_

The brain has two learning systems that serve different purposes:

- **Hippocampus**: Fast learner. Encodes specific episodes quickly, preserves details, high-fidelity but temporary storage.
- **Neocortex**: Slow learner. Gradually extracts statistical regularities and general knowledge across many experiences.

**Our analog:** The warm tier (PostgreSQL) is the hippocampus — fast writes, episodic detail, full fidelity. A new "semantic memory" store is the neocortex — slowly consolidated generalizations extracted from repeated patterns across episodes.

### 2. Memory Consolidation via Hippocampal Replay

_Wilson & McNaughton, 1994; Diekelmann & Born, 2010_

During sleep, the hippocampus "replays" recent experiences to the neocortex, gradually transferring knowledge from episodic to semantic storage. This replay is selective — emotionally significant and novel experiences get replayed more often.

**Our analog:** A scheduled consolidation process ("sleep cycle") that replays warm-tier episodes, extracts patterns, and writes them to semantic memory. Significance scoring determines what gets replayed — not everything consolidates equally.

### 3. ACT-R Activation & Decay

_Anderson, 1983; Anderson & Lebiere, 1998_

In ACT-R cognitive architecture, each memory chunk has an activation level:

```
Activation(i) = Base-level(i) + Σ Spreading-activation(j→i) + noise
Base-level(i) = ln(Σ t_k^(-d))  where t_k = time since kth access, d ≈ 0.5
```

Memories decay logarithmically but are reinforced by access. Frequently and recently accessed memories stay activated; unused ones fade. This isn't deletion — it's reduced retrievability.

**Our analog:** Every memory record gets an `activation_level` that decays over time and increases on retrieval. The hot tier loads high-activation memories. Low-activation memories become harder to retrieve (pushed to cold tier) but are never deleted — just like human memory.

### 4. Spreading Activation for Retrieval

_Collins & Loftus, 1975; Synapse (Jiang et al., 2026)_

Human memory retrieval isn't search — it's propagation. Thinking of "coffee" activates "morning" activates "commute" activates "that podcast episode." Activation spreads along associative links, with lateral inhibition suppressing irrelevant paths.

**Our analog:** A memory graph where retrieval starts at anchor nodes (current query entities) and propagates through weighted edges. Edges represent: temporal adjacency, causal links, shared entities, and semantic similarity. Lateral inhibition prevents "hub explosion" in densely-connected areas.

### 5. Episodic → Semantic Promotion

_Tulving, 1972; Moscovitch et al., 2016_

Episodic memories (specific events, time-stamped, contextual) gradually transform into semantic memories (general knowledge, timeless, decontextualized). "On March 3, I learned the setup script crashed because of a missing env var" → "Setup scripts need env var validation before execution."

**Our analog:** A promotion pipeline that detects recurring patterns across episodes and crystallizes them into semantic principles. The agent's "wisdom" grows over time, separate from its "diary."

---

## Architecture Evolution

### Current (Phase 1)

```
Hot Tier (summary) → Warm Tier (full-text search) → Cold Tier (archive)
```

### Target (Phase 2)

```
                    ┌─────────────────────────────┐
                    │     Retrieval Engine         │
                    │  (spreading activation +     │
                    │   hybrid sparse/dense)       │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
     │  Episodic      │  │  Semantic   │  │  Procedural  │
     │  Memory        │  │  Memory     │  │  Memory      │
     │  (PostgreSQL)  │  │ (PG + Graph)│  │  (PG + JSON) │
     │                │  │             │  │              │
     │ • Events       │  │ • Principles│  │ • Skills     │
     │ • Decisions    │  │ • Entities  │  │ • Patterns   │
     │ • Conversations│  │ • Relations │  │ • Procedures │
     │ • Activation ↓ │  │ • Timeless  │  │ • Reusable   │
     └────────────────┘  └────────────┘  └──────────────┘
              │                ▲                ▲
              │    ┌───────────┘    ┌───────────┘
              ▼    │               │
     ┌─────────────▼───────────────▼──┐
     │     Consolidation Engine        │
     │  ("Sleep Cycle" — scheduled)    │
     │                                 │
     │  • Replay significant episodes  │
     │  • Extract patterns → semantic  │
     │  • Extract procedures → skills  │
     │  • Decay activation levels      │
     │  • Compress low-activation      │
     └────────────────────────────────┘
```

---

## Sprint Breakdown

### Sprint 6: Episodic Memory + Event Decomposition (Week 1)

**Neuroscience basis:** Hippocampal encoding — fast, detailed, time-stamped

**Goal:** Transform flat daily logs into structured episodic events with causal links.

**Deliverables:**

1. **Event schema** in PostgreSQL:

   ```sql
   CREATE TABLE episodic_memory (
     id UUID PRIMARY KEY,
     user_id VARCHAR(255) NOT NULL,
     timestamp TIMESTAMPTZ NOT NULL,
     event_type VARCHAR(50), -- decision, discovery, failure, milestone, conversation
     content TEXT NOT NULL,
     entities JSONB,         -- extracted: people, projects, technologies
     caused_by UUID[],       -- causal back-links
     led_to UUID[],          -- causal forward-links (updated retrospectively)
     emotional_valence FLOAT, -- significance score (-1 to 1)
     activation_level FLOAT DEFAULT 1.0,  -- ACT-R base-level activation
     access_count INT DEFAULT 0,
     last_accessed TIMESTAMPTZ,
     embedding VECTOR(1536), -- pgvector for dense retrieval
     source_file VARCHAR(255),
     source_section VARCHAR(255)
   );
   ```

2. **Event extractor** in sync-watcher.js:
   - When a daily log is synced, decompose into discrete events
   - Rule-based extraction first (headers, bullet patterns, decision markers)
   - Entity extraction: regex + simple NER for projects, people, technologies
   - Causal link detection: "because", "led to", "decided to", "after X, we Y"

3. **Backfill script**: Process existing 73 warm-tier records into episodic events

4. **TimescaleDB hypertable**: Convert episodic_memory to a TimescaleDB hypertable partitioned by timestamp for efficient time-range queries

**Tests:** 12 new (event extraction accuracy, causal link detection, time-range queries)

---

### Sprint 7: ACT-R Activation & Forgetting Curve (Week 2)

**Neuroscience basis:** ACT-R base-level learning equation, Ebbinghaus forgetting curve

**Goal:** Every memory has an activation level that decays and strengthens naturally.

**Deliverables:**

1. **Activation function** (matches ACT-R equation):

   ```javascript
   function baseActivation(accessHistory, d = 0.5) {
     // B_i = ln(Σ t_k^(-d)) where t_k = seconds since kth access
     const now = Date.now() / 1000;
     const sum = accessHistory.reduce((acc, timestamp) => {
       const age = Math.max(now - timestamp / 1000, 1);
       return acc + Math.pow(age, -d);
     }, 0);
     return Math.log(Math.max(sum, 1e-10));
   }
   ```

2. **Activation decay cron job** (runs nightly — the "quiet period"):
   - Recalculate `activation_level` for all episodic records
   - Records with activation below threshold get `is_consolidation_candidate = true`
   - Records accessed in the last 24h get a recency boost

3. **Retrieval activation tracking**: Every time a memory is returned by the API, update `access_count`, `last_accessed`, and `access_history[]`

4. **Activation-aware hot tier**: The hot tier query now factors in activation level, not just recency. High-activation memories from months ago can appear in the hot tier if they've been frequently relevant.

5. **Spaced repetition metadata**: Track retrieval intervals. Memories retrieved at increasing intervals (like spaced repetition) get a consolidation bonus — they're "well-learned."

**Tests:** 10 new (decay curve verification, activation boost on access, hot tier ordering)

---

### Sprint 8: Spreading Activation Graph (Week 3)

**Neuroscience basis:** Collins & Loftus spreading activation, lateral inhibition

**Goal:** Retrieval propagates through a memory graph, not just keyword matching.

**Deliverables:**

1. **Apache AGE extension** installed on PostgreSQL (Cypher queries, no separate DB)

2. **Memory graph construction**:
   - **Nodes:** Episodic events, semantic concepts, entities (people, projects, technologies)
   - **Edges (typed + weighted):**
     - `TEMPORAL_NEXT` (events in sequence, weight by proximity)
     - `CAUSED_BY` / `LED_TO` (causal links from Sprint 6)
     - `MENTIONS` (event → entity)
     - `SIMILAR_TO` (cosine similarity > 0.85 via pgvector)
     - `CO_OCCURS` (entities appearing in same event)

3. **Spreading activation algorithm:**

   ```
   Input: query entities (anchor nodes)

   1. Inject activation energy into anchor nodes
   2. For each iteration (max 3 hops):
      a. Each active node spreads activation to neighbors
         weighted by: edge_weight × source_activation × decay_factor
      b. Apply lateral inhibition: if a node receives activation
         from multiple sources, suppress weakest sources
      c. Apply threshold: nodes below minimum activation are pruned
   3. Return top-K activated nodes ranked by final activation
   ```

4. **Triple Hybrid Retrieval** (inspired by Synapse paper):
   - **Sparse:** PostgreSQL full-text search (lexical matching)
   - **Dense:** pgvector cosine similarity (semantic matching)
   - **Graph:** Spreading activation (structural/causal matching)
   - Final ranking: weighted combination of all three scores

5. **New API endpoint:** `GET /api/memory/retrieve?q=...&mode=hybrid`

**Tests:** 14 new (graph construction, activation propagation, hybrid retrieval accuracy, lateral inhibition, multi-hop reasoning)

---

### Sprint 9: Consolidation Engine — "Sleep Cycle" (Week 4)

**Neuroscience basis:** Hippocampal replay during sleep, CLS theory

**Goal:** A scheduled process that replays episodes and extracts durable knowledge.

**Deliverables:**

1. **Semantic memory table:**

   ```sql
   CREATE TABLE semantic_memory (
     id UUID PRIMARY KEY,
     user_id VARCHAR(255) NOT NULL,
     principle TEXT NOT NULL,        -- "Setup scripts need env var validation"
     confidence FLOAT DEFAULT 0.5,  -- strengthens with each supporting episode
     source_episodes UUID[],        -- which episodes led to this
     entity_tags JSONB,             -- related entities
     category VARCHAR(50),          -- 'engineering', 'process', 'relationship', 'domain'
     first_observed TIMESTAMPTZ,
     last_reinforced TIMESTAMPTZ,
     reinforcement_count INT DEFAULT 1,
     activation_level FLOAT DEFAULT 1.0,
     embedding VECTOR(1536)
   );
   ```

2. **Consolidation pipeline** (runs nightly via cron):

   ```
   Phase 1: REPLAY
     - Select high-significance episodes from past 7 days
     - Select consolidation candidates (low activation, not yet consolidated)
     - Priority: novel events > reinforcing events > routine events

   Phase 2: PATTERN EXTRACTION
     - Cluster similar episodes using pgvector similarity
     - For clusters with 3+ episodes: extract common pattern
     - Use cheap LLM (Gemini Flash) to generate principle statement
     - Check against existing semantic memories for duplicates

   Phase 3: CONSOLIDATION
     - New patterns → INSERT into semantic_memory
     - Existing patterns with new support → UPDATE confidence, reinforcement_count
     - Contradicting patterns → flag for agent review (don't auto-resolve)

   Phase 4: COMPRESSION
     - Episodes that contributed to semantic memories get compressed:
       full_text → summary (keep first 500 chars + metadata)
     - Original always preserved in cold archive
     - This is "forgetting the details while keeping the lesson"

   Phase 5: DECAY
     - Run ACT-R activation decay on all memories
     - Memories below cold threshold → move to cold tier
     - Semantic memories below threshold → reduce confidence (not delete)
   ```

3. **Procedural memory extraction:**
   - When consolidation detects repeated action sequences
     (e.g., "every time we deploy, we run tests then check logs then verify")
   - Extract as a `procedural_memory` record (reusable skill/workflow)

4. **Progressive summarization tiers:**
   - Daily → Weekly (automatic, every Monday at 02:00 UTC)
   - Weekly → Monthly (automatic, first of each month)
   - Monthly → Quarterly (LLM-assisted, flagged for agent review)
   - Quarterly → Principles (via consolidation pipeline above)

**Tests:** 16 new (replay selection, pattern extraction, confidence updates, compression, progressive summarization, procedural detection)

---

### Sprint 10: Episodic→Semantic Promotion + Living Memory (Week 5)

**Neuroscience basis:** Tulving's episodic-semantic distinction, reconsolidation

**Goal:** Memories evolve. New experiences update old knowledge. The system grows wisdom.

**Deliverables:**

1. **Promotion detector:**
   - Monitor when the same pattern appears 3+ times across episodes
   - "We forgot to check env vars" × 3 → semantic: "Env var validation is a recurring gap"
   - "Flint catches security issues we miss" × 4 → semantic: "Flint's security reviews are high-value"

2. **Reconsolidation** (neuroscience: retrieved memories become labile):
   - When a semantic memory is contradicted by new evidence, reduce confidence
   - When a semantic memory is reinforced, increase confidence
   - Contradictions flagged but not auto-resolved (human-like uncertainty)

3. **Feeling-of-knowing (FOK) protocol** (from Synapse paper):
   - Before retrieval, the system estimates whether it _has_ relevant memory
   - If FOK is low → don't hallucinate, say "I don't have memory of that"
   - Implemented as: query activation propagation; if max activation < threshold, return "no relevant memory" instead of low-quality results

4. **Hot tier assembly v2:**
   - Load top-K semantic memories (timeless principles)
   - Load top-K high-activation episodic memories (recent + significant)
   - Load current procedural context (active project procedures)
   - Budget: still ~762 tokens, but now _far more relevant_ content

5. **Memory introspection endpoint:**
   - `GET /api/memory/introspect?entity=NATS` → "Here's everything I know about NATS: 3 semantic principles, 12 related episodes, connected to Flint, security, deployment"
   - Useful for agent self-reflection and debugging

**Tests:** 12 new (promotion detection, reconsolidation, FOK accuracy, hot tier relevance scoring)

---

## Implementation Dependencies

| Sprint | Requires                 | New Extensions   | Estimated Effort |
| ------ | ------------------------ | ---------------- | ---------------- |
| 6      | PostgreSQL 14+, pgvector | TimescaleDB      | 1 week           |
| 7      | Sprint 6                 | None             | 1 week           |
| 8      | Sprint 6, pgvector       | Apache AGE       | 1.5 weeks        |
| 9      | Sprints 6-8              | Gemini Flash API | 1.5 weeks        |
| 10     | Sprints 6-9              | None             | 1 week           |

**Total:** ~6 weeks for complete Phase 2

**All within existing PostgreSQL** — no new databases, no Elasticsearch, no Neo4j. Apache AGE and TimescaleDB are PG extensions, not separate services.

---

## Research References

| Paper                                     | Key Idea                                                       | How We Use It                                          |
| ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| **Synapse** (Jiang et al., 2026)          | Spreading activation + lateral inhibition for memory retrieval | Sprint 8: graph retrieval engine                       |
| **A-Mem** (Xu et al., 2025)               | Zettelkasten-style linked memory notes with dynamic evolution  | Sprint 8: memory linking + Sprint 10: memory evolution |
| **ACT-R** (Anderson, 1983)                | Base-level activation equation with logarithmic decay          | Sprint 7: activation scoring                           |
| **CLS Theory** (McClelland et al., 1995)  | Dual fast/slow learning systems with replay consolidation      | Sprint 9: hippocampal replay architecture              |
| **AI Meets Brain** (Li et al., 2025)      | Unified taxonomy bridging neuroscience ↔ AI memory             | Overall architecture taxonomy                          |
| **Mem0** (2025)                           | Production-grade memory extraction + consolidation             | Sprint 9: consolidation pipeline patterns              |
| **MemAgents** (ICLR 2026 Workshop)        | Multi-agent shared memory research frontiers                   | Future: cross-agent semantic sharing                   |
| **Episodic Memory Position Paper** (2025) | Episodic memory as missing piece for long-term agents          | Sprint 6: event decomposition design                   |
| **Ebbinghaus Forgetting Curve** (1885)    | Memory strength = f(time, repetition)                          | Sprint 7: decay parameters                             |

---

## Open Questions for Flint

1. **Entity extraction quality vs. cost:** Rule-based at sync time, LLM batch weekly? Or always LLM? What's the token budget?

2. **Apache AGE vs. separate graph:** AGE keeps everything in PG (simpler ops, one backup). But AGE is younger software. Risk assessment?

3. **Consolidation LLM choice:** Gemini Flash (free tier, fast) vs. local Ollama (private, slower) vs. Claude Haiku (better quality, costs money). For nightly batch jobs processing ~50 episodes.

4. **Activation parameters:** ACT-R default decay d=0.5 is calibrated for human memory. Should we tune differently for an agent that "thinks" faster but has longer gaps between sessions?

5. **Progressive summarization:** Should weekly summaries be auto-generated or agent-reviewed? Monthly? Where's the trust boundary?

6. **Multi-agent semantic sharing:** If Clio learns "env var validation is a recurring gap", should Flint's semantic memory get a copy? This is the CLS theory question applied across agents.

---

## Success Metrics (Phase 2 Exit Criteria)

| Metric                          | Target                                                                       | Measurement                  |
| ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| Hot tier tokens                 | Still <1,000                                                                 | Direct measurement           |
| Retrieval relevance (multi-hop) | >80% accuracy on causal queries                                              | Manually curated test set    |
| Pattern detection               | Detect 3/5 known recurring patterns from existing logs                       | Backfill validation          |
| Memory graph connectivity       | Avg node degree >3 (no orphans)                                              | Graph stats query            |
| Consolidation pipeline          | <60s for nightly run on 100 episodes                                         | Timing measurement           |
| Forgetting gracefully           | Low-significance memories reduce retrieval probability by >50% after 30 days | Activation curve measurement |
| FOK accuracy                    | <10% false positives (claiming memory exists when it doesn't)                | Test set                     |

---

_This document models the architecture on human memory because we believe the brain solved the memory problem under the same constraints we face: limited bandwidth (context window), massive experience (years of events), need for both specific recall and general knowledge, and the requirement to function even when retrieval fails. We're not simulating a brain — we're stealing its best ideas._
