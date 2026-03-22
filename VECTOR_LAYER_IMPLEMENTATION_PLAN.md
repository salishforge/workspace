# Vector Layer Implementation Plan - Complete Integration

**Status:** Ready to implement (all design complete, just needs execution)
**Timeline:** 6-8 hours to production
**Owner:** Flint, CTO

---

## The Architecture (Recap)

MemForge uses a **sleep-cycle memory consolidation model** inspired by neuroscience:

```
WAKING HOURS
  └─ Episodic buffer appends raw events (tool calls, decisions, observations)
     Zero processing overhead
         │
         ▼ (Scheduled downtime, e.g., 02:00 UTC)
SLEEP CYCLE - Consolidation Agent runs
  Step 1: INGEST
    └─ Parse episodic buffer raw events
  
  Step 2: CONSOLIDATE
    ├─ Entity extraction (who/what appeared?)
    ├─ Relationship inference (how connected?)
    ├─ Contradiction detection (conflicts?)
    ├─ Importance scoring (hot/warm/cold)
    ├─ Graph update (persist explicit relationships)
    └─ ✨ VECTOR EMBEDDING (NEW) ← new step
         └─ Embed consolidated concepts → pgvector
  
  Step 3: DISTILL
    ├─ Hot tier distillation (compress context)
    ├─ Generate CLAUDE.md
    └─ Archive episodic buffer
         │
         ▼
NEXT SESSION WAKES
  ├─ Hot tier loaded (~3K tokens, pre-distilled)
  ├─ MCP tools can retrieve semantically similar memories
  └─ Vector + keyword + temporal hybrid search available
```

---

## Three Complete Memory Tiers

| Tier | Purpose | Content | Lifespan |
|------|---------|---------|----------|
| **Hot** | Working memory | Identity, priorities, active context | Loaded each session, updated after sleep |
| **Vector Store** | Semantic retrieval | pgvector embeddings of consolidated concepts | Persistent, queried via hybrid search |
| **Episodic Buffer** | Session append-only log | Raw events: tool calls, decisions, observations | One session, archived to cold at sleep |
| **Graph Store** | Explicit relationships | Nodes + temporal edges (valid_from/valid_until) | Persistent, supports causality queries |
| **Cold Archive** | Long-term preservation | Raw episodic records, never deleted | Forever |

---

## Part 1: Embedding Step in Consolidation Agent

**File:** `/home/artificium/nanoclaw-fork/memforge/consolidation/consolidation_agent.js`

**Location:** After "Graph update" step (around line 450-500)

**What to add:**

```javascript
// ── Step 6b: VECTOR EMBEDDING (NEW) ──────────────────────
async function runEmbeddingStep() {
  console.log(`[consolidation] Step 6b: Vector embedding...`);
  
  try {
    // Create embedder (Ollama local, fallback to OpenAI)
    const embedder = await createEmbedder(config.embedding.model || 'nomic-embed-text:v2-moe');
    
    // Get entities extracted in Step 2
    const entities = consolidationState.partialResults.entities || [];
    
    let embeddedCount = 0;
    for (const entity of entities) {
      // Skip if already has embedding
      const existing = await pool.query(
        'SELECT id FROM memory_vectors WHERE agent_id = $1 AND summary = $2',
        [AGENT_ID, entity.summary]
      );
      
      if (existing.rows.length > 0) {
        continue; // Already embedded, skip
      }
      
      // Create embedding
      const embedding = await embedder.embed(entity.summary || entity.description);
      const pgVector = toPgVector(embedding); // Helper converts to pgvector format
      
      // Insert into vector_store
      await pool.query(
        `INSERT INTO memory_vectors 
          (agent_id, content, summary, embedding, source_type, source_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (agent_id, source_id) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           updated_at = NOW()`,
        [
          AGENT_ID,
          entity.description || entity.summary,
          entity.summary,
          pgVector,
          entity.type || 'consolidation',
          entity.id
        ]
      );
      
      embeddedCount++;
    }
    
    // Track token usage
    const usage = embedder.getTokenUsage();
    trackTokens('embedding', usage);
    
    consolidationState.partialResults.embeddedCount = embeddedCount;
    consolidationState.stepsCompleted.push('embedding');
    
    console.log(`[consolidation] ✅ Embedded ${embeddedCount} concepts in ${usage.elapsedMs}ms`);
    
    return { status: 'success', embeddedCount, tokens: usage };
    
  } catch (error) {
    console.error(`[consolidation] ❌ Embedding step failed: ${error.message}`);
    consolidationState.stepsFailed.push({ step: 'embedding', error: error.message });
    
    // Partial consolidation still succeeds (graph was updated, just no vectors)
    return { status: 'partial', error: error.message };
  }
}

// Call this in the main consolidation sequence
await runEmbeddingStep();
```

**Cost:** Zero tokens if using Ollama (local embedding)  
**Latency:** ~15-50ms per concept (depends on corpus size)

---

## Part 2: Hybrid Search in MCP Tools

**File:** `/home/artificium/nanoclaw-fork/memforge/mcp/server.js`

**Update the `memory_recall` tool:**

```javascript
async function memory_recall(agentId, query) {
  try {
    // Create embedder for query
    const queryEmbedding = await embedder.embed(query);
    const pgQueryVector = toPgVector(queryEmbedding);
    
    // Hybrid search: vector + keyword + temporal
    const results = await pool.query(`
      SELECT 
        id,
        summary,
        source_type,
        created_at,
        
        -- Vector similarity (cosine distance)
        (1 - (embedding <=> $1::vector)) as vector_score,
        
        -- Keyword similarity (pg_trgm)
        similarity(content, $2) as keyword_score,
        
        -- Recency score (exponential decay, 30-day half-life)
        exp(-0.0231 * EXTRACT(EPOCH FROM (now() - created_at)) / 86400) as recency_score,
        
        -- Composite score
        (0.5 * (1 - (embedding <=> $1::vector))) +
        (0.3 * similarity(content, $2)) +
        (0.2 * exp(-0.0231 * EXTRACT(EPOCH FROM (now() - created_at)) / 86400))
        as composite_score
        
      FROM memory_vectors
      WHERE agent_id = $3
        AND embedding IS NOT NULL  -- Only use vectors with embeddings
      ORDER BY composite_score DESC
      LIMIT $4
    `, [pgQueryVector, query, agentId, 10]);
    
    return {
      status: 'success',
      results: results.rows.map(row => ({
        summary: row.summary,
        source_type: row.source_type,
        created_at: row.created_at,
        score: row.composite_score,
        breakdown: {
          vector: row.vector_score,
          keyword: row.keyword_score,
          recency: row.recency_score
        }
      }))
    };
    
  } catch (error) {
    console.error(`[mcp/memory] Hybrid search failed: ${error.message}`);
    
    // Fallback to keyword-only search
    return fallbackKeywordSearch(agentId, query);
  }
}
```

**Cost:** Database query only (no tokens)  
**Latency:** <200ms per query

---

## Part 3: Hot Tier Distillation Using Hybrid Search

**File:** `/home/artificium/nanoclaw-fork/memforge/consolidation/consolidation_agent.js`

**Update the DISTILL phase:**

```javascript
async function runDistillStep() {
  console.log(`[consolidation] Step 8: Hot tier distillation...`);
  
  try {
    // Get session context signals for relevance scoring
    const sessionSignals = consolidationState.partialResults.sessionSignals || {
      topics: [],
      tools_used: [],
      decisions_made: []
    };
    
    // Use hybrid search to select what goes in hot tier
    // Instead of pure LLM importance scoring, combine multiple signals
    const distilledMemory = await pool.query(`
      SELECT 
        summary,
        source_type,
        
        -- LLM importance score (from Phase 2)
        importance_score,
        
        -- Retrieval frequency (how often queried?)
        access_count,
        
        -- Recency
        exp(-0.0231 * EXTRACT(EPOCH FROM (now() - created_at)) / 86400) as recency,
        
        -- Semantic relevance to session signals
        CASE 
          WHEN content ILIKE ANY(ARRAY[$1, $2, $3]) THEN 0.5
          ELSE 0
        END as relevance_to_signals,
        
        -- Composite score for hot tier selection
        (0.4 * importance_score) +
        (0.3 * (access_count::numeric / 100.0)) +  -- normalize access count
        (0.2 * recency) +
        (0.1 * relevance_to_signals)
        as hot_tier_score
        
      FROM memory_vectors
      WHERE agent_id = $4
        AND hot_tier_score >= 0.5  -- Only high-scoring items
      ORDER BY hot_tier_score DESC
      LIMIT 50  -- Keep hot tier to ~3K tokens
    `, [
      sessionSignals.topics[0] || 'x',
      sessionSignals.topics[1] || 'x', 
      sessionSignals.topics[2] || 'x',
      AGENT_ID
    ]);
    
    // Generate CLAUDE.md with selected memories
    const claudeMd = generateClaudeMd(distilledMemory.rows);
    
    // Write to hot tier
    await fs.promises.writeFile(
      path.join(AGENT_WORKSPACE, 'CLAUDE.md'),
      claudeMd,
      'utf8'
    );
    
    consolidationState.stepsCompleted.push('distill');
    console.log(`[consolidation] ✅ Hot tier distilled (${distilledMemory.rows.length} items, ~3K tokens)`);
    
    return { status: 'success', items_selected: distilledMemory.rows.length };
    
  } catch (error) {
    console.error(`[consolidation] ❌ Distill step failed: ${error.message}`);
    consolidationState.stepsFailed.push({ step: 'distill', error: error.message });
    return { status: 'partial', error: error.message };
  }
}
```

**Cost:** Database query only  
**Latency:** <500ms per consolidation cycle

---

## Testing Checklist

- [ ] Embedding step runs without errors (use test consolidation data)
- [ ] pgvector table correctly stores embeddings (SELECT COUNT(*) ... WHERE embedding IS NOT NULL)
- [ ] Hybrid search returns relevant results (test with "what did we decide about X?")
- [ ] Composite score ranking matches semantic relevance
- [ ] Hot tier contains only high-score items
- [ ] Token cost stays under budget
- [ ] Fallback to keyword-only works if Ollama unavailable

---

## Rollout Plan

### Phase 1: Local Testing (2 hours)
1. Load test consolidation data
2. Run embedding step
3. Verify pgvector table
4. Test hybrid search queries
5. Measure latency & token cost

### Phase 2: VPS Integration (2 hours)
1. Deploy embedding step to production consolidation agent
2. Run first production consolidation with vectors
3. Test MCP hybrid search
4. Verify hot tier distillation

### Phase 3: Agent Verification (2 hours)
1. Run Clio with new hot tier + vector access
2. Verify semantic retrieval quality
3. Compare token usage vs baseline
4. Test contradiction detection with vectors

---

## Success Criteria

✅ Embedding step completes in <500ms per consolidation  
✅ Hybrid search latency <200ms  
✅ Vector embeddings correctly stored (768-dim pgvector)  
✅ Hot tier size ≤3K tokens  
✅ Semantic queries return relevant results  
✅ Token cost reduction ≥50% vs flat-file baseline  
✅ Fallback works if Ollama unavailable  

---

## Cost Analysis

| Operation | Cost | Frequency |
|-----------|------|-----------|
| Embed ~500 concepts (Ollama) | $0.00 | Per consolidation (nightly) |
| Embed ~500 concepts (OpenAI fallback) | $0.002 | If Ollama unavailable |
| Hybrid search query | $0.00 | Per MCP tool call |
| Storage: pgvector (768-dim, 10K vectors) | ~30MB | One-time |

**Monthly cost:** $0.00 - $0.06 (essentially free with Ollama)

---

## Files to Modify

1. `consolidation_agent.js` — Add embedding step + helpers
2. `mcp/server.js` — Update memory_recall tool for hybrid search
3. `embedding.js` — Ensure toPgVector helper exists (it does)
4. Tests — Add embedding + hybrid search tests

---

## Next Steps

1. Read Part 1 implementation above
2. Understand the composite scoring formula
3. Start with embedding step (simplest, most isolated)
4. Then hybrid search in MCP
5. Finally hot tier integration
6. Test end-to-end with Clio

---

**Estimated time to production:** 6-8 hours  
**Confidence level:** High (all design complete, proven in research)  
**Risk level:** Low (fallback to keyword-only search, partial consolidation succeeds)

Ready to start?

⚡ Flint
