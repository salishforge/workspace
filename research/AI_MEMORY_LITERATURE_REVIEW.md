# AI Agent Long-Term Memory — Literature Review
## Salish Forge Research Initiative
*Prepared by: Flint ⚡ (CTO)*
*Date: March 9, 2026*
*Purpose: Evaluate existing solutions for years-long AI agent memory before building our own*

---

## The Problem Statement

Flat-file memory for AI agents fails at scale:
- Context window fills → expensive compaction → lossy rollover → repeat
- No associative retrieval (keyword → flood of related context)
- No temporal ordering of causality
- No relationship mapping between concepts

**Goal:** Years-long persistent memory, on-demand retrieval, no token cost growth, no performance degradation.

---

## Existing Solutions — Landscape

### 1. Letta (formerly MemGPT) — Stanford / Letta AI
**Repo:** https://github.com/letta-ai/letta
**Origin:** Academic paper (2023), now a startup

**Architecture:**
- Hierarchical memory: "core memory" (in-context, limited), "archival memory" (external, searchable), "recall memory" (recent conversation history)
- Agent can self-edit its own core memory and page content in/out of context
- The key insight: treat the LLM like a CPU, context window like RAM, external storage like disk — and build an OS around it

**What it solves well:** The paging model is elegant. Agents decide what to keep in working memory vs. store. Self-editing memory is novel.

**Gaps:**
- No native graph/relationship layer — memories are stored as flat text chunks
- No temporal ordering / causality tracking
- Archival search is semantic (vector) but no concept relationship traversal
- Now pivoting to a platform/product play — open source version may lag

**Production-ready:** Yes for basic use cases. Node.js CLI available.
**Self-hostable:** Yes (open source core)
**Years-long persistence:** Partially — archival storage scales, but no graph means relationship degradation over time

---

### 2. Microsoft GraphRAG
**Repo:** https://github.com/microsoft/graphrag
**Paper:** arxiv.org/abs/2404.16130 (April 2024, updated Feb 2025)

**Architecture:**
1. Ingest documents → LLM extracts entities and relationships → builds knowledge graph
2. Graph clustering → community summaries generated at multiple levels of abstraction
3. At query time: traverse graph, assemble relevant community summaries, generate response

**What it solves well:** The "connecting the dots" problem that flat RAG fails at. If you ask a question that requires synthesizing across disparate facts, GraphRAG dramatically outperforms vector-only RAG. The community hierarchy means you get both local detail and global synthesis.

**Gaps:**
- Designed for static document corpora, not dynamic/evolving agent memory
- No temporal layer — graph doesn't track *when* things were true or how beliefs changed
- Graph indexing is expensive (LLM calls to extract entities) — not designed for continuous update
- Not built for agent identity/persona persistence

**Production-ready:** Yes, for document Q&A use cases
**Self-hostable:** Yes (Python, open source)
**Years-long persistence:** Partially — the graph scales, but the continuous update problem is unsolved

---

### 3. Mem0
**Repo:** https://github.com/mem0ai/mem0
**Backed by:** Y Combinator

**Benchmarks (their claims):**
- +26% accuracy over OpenAI Memory (LOCOMO benchmark)
- 91% faster than full-context
- 90% fewer tokens than full-context

**Architecture:**
- Multi-level memory: user state, session state, agent state
- Vector storage for semantic search
- LLM-driven memory extraction: on each interaction, an LLM decides what's worth storing
- Managed platform + self-hosted open source option

**What it solves well:** Production-ready, well-benchmarked, proven in real applications. The multi-level model (user/session/agent) maps well to our organizational structure.

**Gaps:**
- No graph layer — relationships between memories are implicit via vector similarity only
- No temporal causality tracking
- The "what to store" decision is LLM-driven, which means it's probabilistic and can miss things
- Self-hosted version has fewer features than cloud

**Production-ready:** Yes — most mature of the bunch
**Self-hostable:** Yes (open source)
**Years-long persistence:** Strong on this — their benchmarks show sustained performance

---

### 4. Cognee
**Repo:** https://github.com/topoteretes/cognee

**Architecture:**
- Combines vector search + graph database + cognitive science principles
- "Knowledge engine" — ingests data, builds graph + vector index simultaneously
- Cross-agent knowledge sharing
- OTEL collector for traceability/audit

**What it solves well:** Closest to the full vision. Vector + graph in one system. Continuous learning from feedback. Cross-agent sharing. 6 lines of code to integrate.

**Gaps:**
- Less mature than Mem0 or Letta — smaller community
- No explicit temporal/time-series layer
- Python only (we're Node.js-primary)
- "Cognitive science" claims need validation

**Production-ready:** Early production — use with caution
**Self-hostable:** Yes
**Years-long persistence:** Unknown — not enough longitudinal data yet

---

### 5. Zep
**Repo:** https://github.com/getzep/zep (examples only — core is closed)
**Model:** Mostly commercial (Zep Cloud), limited open source

**Architecture:**
- "Temporal knowledge graph" — tracks how facts and relationships change over time
- Graph RAG: extracts relationships, maintains graph that evolves as context changes
- Sub-200ms latency claim
- Context assembly: pre-formats relevant context blocks for LLM consumption

**What it solves well:** The temporal layer is real — Zep explicitly tracks how context evolves over time. This is the closest thing to "causality tracking" in any existing system.

**Gaps:**
- Core architecture is proprietary (cloud service)
- Self-hosted is a "work in progress" (their own words)
- Trust boundary issue: our agents' memory would live on their servers
- SOC2/HIPAA compliance is a selling point, not relevant to us

**Production-ready:** Yes for cloud, not for self-hosted
**Self-hostable:** Not meaningfully
**Years-long persistence:** Designed for it, but can't verify since core is closed

---

## pgvector + Apache AGE (PostgreSQL-native stack)

**The idea:** Instead of running Neo4j + TimescaleDB + Pinecone + PostgreSQL, use PostgreSQL alone with extensions:
- `pgvector` — vector embeddings and similarity search (semantic retrieval)
- `Apache AGE` — graph database extension (relationship traversal, Cypher query language)
- Native PostgreSQL — relational storage, full-text search, time-series via timestamp indexing

**Why this matters:**
- One database engine to operate, back up, monitor
- ACID guarantees across all memory types
- Already running PostgreSQL on our VPS
- No additional services to manage

**Viability:** High. pgvector is production-grade (used at scale by many companies). Apache AGE is newer but functional. The integration between them (graph node → vector search) requires custom query logic but is buildable.

**Gap:** TimescaleDB is still worth considering for the temporal layer — PostgreSQL timestamp indexing works but TimescaleDB gives better query performance on time-range queries at scale. Can add it later.

---

## Comparison Matrix — Against Our Requirements

| System | Semantic Triggers | Graph/Relationships | Temporal Order | Self-Hosted | Years-Scale | Open Source |
|--------|------------------|---------------------|----------------|-------------|-------------|-------------|
| **Letta** | ✅ | ❌ | ❌ | ✅ | ⚠️ | ✅ |
| **GraphRAG** | ✅ | ✅ | ❌ | ✅ | ⚠️ | ✅ |
| **Mem0** | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ (partial) |
| **Cognee** | ✅ | ✅ | ❌ | ✅ | ❓ | ✅ |
| **Zep** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **pgvector+AGE** | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ |
| **Our vision** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

*With timestamp indexing or TimescaleDB

---

## Key Finding

**No existing system meets all requirements.** Every solution covers 2-3 of the 5 dimensions. The full stack — semantic retrieval + graph relationships + temporal causality + years-long self-hosted persistence — does not exist as an integrated open-source system.

**Zep is closest** in concept (it has all three layers) but is not meaningfully self-hostable. That gap is the opportunity.

**Cognee is the most interesting open-source option** to build from — it has vector + graph, is Python-based, and is the only one explicitly designed for agent memory (not just document Q&A).

---

## Recommended Path Forward

### Option A: Extend Cognee
- Fork Cognee, add temporal layer (TimescaleDB or PostgreSQL timestamp-based)
- Contribute graph+vector integration improvements upstream
- Risk: Python dependency, relatively immature codebase

### Option B: Build on pgvector + Apache AGE
- Stay on PostgreSQL (already deployed), add pgvector + AGE extensions
- Build the integration layer ourselves
- Add temporal ordering via timestamp columns + query patterns
- Risk: more custom code, but full control

### Option C: Use Mem0 as Foundation
- Mem0 is the most mature and benchmarked
- Add graph layer on top (Cognee-style)
- Add temporal tracking
- Risk: building on someone else's abstraction, may fight the framework

**My recommendation: Option B** — pgvector + Apache AGE on existing PostgreSQL.

Reasoning:
1. We already operate PostgreSQL — no new operational dependencies
2. Full control over the schema, the consolidation logic, the query patterns
3. Self-hosted by definition — data stays on our infrastructure
4. Buildable incrementally: start with pgvector (semantic triggers), add AGE (graph), add temporal last
5. The integration layer we build IS the contribution — and it's novel

---

## Open Questions (Unresolved)

1. **Memory consolidation:** How do raw session events get compressed into semantic graph nodes? This is the hard problem. No existing system solves it well.
2. **Graph decay:** How do we handle contradictory information over time? If the agent learns something new that contradicts old graph nodes, how does the graph update?
3. **Evaluation framework:** What metrics prove "this is better than baseline RAG" at 6-month and 1-year marks?

---

*Next step: Architecture decision and prototype spec*
