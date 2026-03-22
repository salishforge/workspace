# MemForge Vector Layer Implementation Plan
## For Public Release (v1.1.0)

**Status:** Ready for implementation  
**Approach:** Option B - Extend core API  
**Timeline:** 4-5 hours to production  
**Quality:** Public release grade  

---

## Phase 1: Type Definitions (types.ts)

### Add Embedding Configuration Types

```typescript
// New interfaces to add to types.ts

export interface EmbeddingConfig {
  /** Embedding provider: 'ollama' or 'openai' */
  provider: 'ollama' | 'openai';
  /** Model name: 'nomic-embed-text-v2-moe' for Ollama, 'text-embedding-3-small' for OpenAI */
  model: string;
  /** Base URL for Ollama (default http://localhost:11434) */
  baseUrl?: string;
  /** API key for OpenAI */
  apiKey?: string;
  /** Vector dimensions (default 768) */
  dimensions: number;
  /** Enable vector embedding during consolidation (default true) */
  enabled: boolean;
}

export interface VectorRow extends WarmRow {
  embedding?: number[];  // or JSONB if storing as array
  embedding_model?: string;
  vector_score?: number;  // Hybrid search score: 0.5*vector + 0.3*keyword + 0.2*recency
}

export interface ConsolidateOptions {
  /** Enable vector embedding for this run (default from config) */
  withVectors?: boolean;
  /** Override embedding model for this run */
  embeddingModel?: string;
}

export interface ConsolidateResult {
  run_id: bigint;
  agent_id: string;
  hot_rows_processed: number;
  warm_rows_created: number;
  vectors_generated?: number;  // NEW
  embedding_model?: string;    // NEW
  status: 'complete' | 'failed';
}

export interface VectorSearchResult {
  id: bigint;
  content: string;
  metadata: Record<string, unknown>;
  consolidated_at: Date;
  vector_score: number;
  vector_rank?: number;
  keyword_rank?: number;
}

// Update MemForgeConfig

export interface MemForgeConfig {
  databaseUrl: string;
  consolidationBatchSize: number;
  consolidationThreshold: number;
  autoRegisterAgents: boolean;
  embedding?: EmbeddingConfig;  // NEW
}
```

---

## Phase 2: Embedding Infrastructure

### Create embedding.ts (new file)

```typescript
// src/embedding.ts

/**
 * Vector embedding support for MemForge
 * Supports Ollama (local, free) and OpenAI (API key required)
 */

import fetch from 'node-fetch';
import type { EmbeddingConfig } from './types.js';

export class EmbeddingProvider {
  private readonly config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
    this.validate();
  }

  private validate(): void {
    if (this.config.provider === 'openai' && !this.config.apiKey) {
      throw new Error('OpenAI embedding requires apiKey in config');
    }
    if (!this.config.model) {
      throw new Error('Embedding model must be specified');
    }
  }

  async embed(text: string): Promise<number[]> {
    if (this.config.provider === 'ollama') {
      return this.embedOllama(text);
    } else if (this.config.provider === 'openai') {
      return this.embedOpenAI(text);
    }
    throw new Error(`Unknown embedding provider: ${this.config.provider}`);
  }

  private async embedOllama(text: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    return data.embeddings[0] || [];
  }

  private async embedOpenAI(text: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
        dimensions: this.config.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0]?.embedding || [];
  }

  /**
   * Compute cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vector dimensions must match');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Normalize vector to unit length
   */
  static normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0)
    );
    return magnitude === 0 ? vector : vector.map(v => v / magnitude);
  }
}
```

---

## Phase 3: Memory Manager Updates (memory-manager.ts)

### Add Embedding Support to MemoryManager

```typescript
// Add to imports
import { EmbeddingProvider } from './embedding.js';
import type { EmbeddingConfig, VectorSearchResult, ConsolidateOptions, VectorRow } from './types.js';

// Update DEFAULTS
const DEFAULTS: MemForgeConfig = {
  databaseUrl: process.env['DATABASE_URL'] ?? '',
  consolidationBatchSize: 500,
  consolidationThreshold: 50,
  autoRegisterAgents: true,
  embedding: {
    provider: process.env['EMBEDDING_PROVIDER'] as 'ollama' | 'openai' ?? 'ollama',
    model: process.env['EMBEDDING_MODEL'] ?? 'nomic-embed-text-v2-moe',
    baseUrl: process.env['EMBEDDING_BASE_URL'],
    apiKey: process.env['EMBEDDING_API_KEY'],
    dimensions: parseInt(process.env['EMBEDDING_DIMENSIONS'] ?? '768'),
    enabled: process.env['EMBEDDING_ENABLED'] !== 'false',
  },
};

export class MemoryManager {
  private readonly pool: Pool;
  private readonly config: MemForgeConfig;
  private readonly embedder?: EmbeddingProvider;

  constructor(config: Partial<MemForgeConfig> = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.pool = getPool(this.config.databaseUrl || undefined);
    
    // Initialize embedding provider if enabled
    if (this.config.embedding?.enabled) {
      try {
        this.embedder = new EmbeddingProvider(this.config.embedding);
      } catch (err) {
        console.warn('Embedding provider initialization failed, vectors disabled:', err);
      }
    }
  }

  // NEW METHOD: Hybrid vector search
  async vectorSearch(
    agentId: string,
    queryText: string,
    limit = 10,
  ): Promise<VectorSearchResult[]> {
    if (!agentId || typeof agentId !== 'string') {
      throw new TypeError('agentId must be a non-empty string');
    }
    if (!queryText || typeof queryText !== 'string') {
      throw new TypeError('queryText must be a non-empty string');
    }
    if (!this.embedder) {
      throw new Error('Vector search requires embedding provider to be enabled');
    }

    // Embed query
    const queryVector = await this.embedder.embed(queryText);
    const queryVectorJson = JSON.stringify(queryVector);

    // Hybrid search: vector (0.5) + keyword (0.3) + recency (0.2)
    const { rows } = await this.pool.query<VectorSearchResult>(
      `SELECT
         id,
         content,
         metadata,
         consolidated_at,
         embedding_model,
         (
           0.5 * (1 - (embedding <-> $2::jsonb)::float / 2) +
           0.3 * similarity(content, $3) +
           0.2 * GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - consolidated_at)) / 2592000)
         ) AS vector_score
       FROM warm_tier
       WHERE agent_id = $1 AND embedding IS NOT NULL
       ORDER BY vector_score DESC
       LIMIT $4`,
      [agentId, queryVectorJson, queryText, limit],
    );

    return rows;
  }

  // UPDATED METHOD: consolidate with vector embedding
  async consolidate(agentId: string, options: ConsolidateOptions = {}): Promise<ConsolidateResult> {
    if (!agentId || typeof agentId !== 'string') {
      throw new TypeError('agentId must be a non-empty string');
    }

    const withVectors = options.withVectors ?? this.config.embedding?.enabled ?? false;
    const embedder = options.embeddingModel ? new EmbeddingProvider({
      ...this.config.embedding!,
      model: options.embeddingModel,
    }) : this.embedder;

    const client = await this.pool.connect();
    let runId: bigint = BigInt(0);
    let vectorsGenerated = 0;

    try {
      await client.query('BEGIN');

      const logRow = await client.query<{ id: bigint }>(
        `INSERT INTO consolidation_log (agent_id) VALUES ($1) RETURNING id`,
        [agentId],
      );
      runId = logRow.rows[0]!.id;

      const hotRows = await client.query<{
        id: bigint;
        content: string;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, content, metadata, created_at
         FROM hot_tier
         WHERE agent_id = $1
         ORDER BY created_at ASC
         LIMIT $2`,
        [agentId, this.config.consolidationBatchSize],
      );

      if (hotRows.rows.length === 0) {
        await client.query(
          `UPDATE consolidation_log
           SET status = 'complete', completed_at = now(), hot_rows_processed = 0, warm_rows_created = 0
           WHERE id = $1`,
          [runId],
        );
        await client.query('COMMIT');
        return {
          run_id: runId,
          agent_id: agentId,
          hot_rows_processed: 0,
          warm_rows_created: 0,
          vectors_generated: 0,
          embedding_model: withVectors ? this.config.embedding?.model : undefined,
          status: 'complete',
        };
      }

      const BATCH_SIZE = 50;
      let warmCreated = 0;

      for (let i = 0; i < hotRows.rows.length; i += BATCH_SIZE) {
        const batch = hotRows.rows.slice(i, i + BATCH_SIZE);
        const combined = batch.map((r) => r.content).join('\n\n---\n\n');
        const ids = batch.map((r) => r.id);

        let embedding = null;
        if (withVectors && embedder) {
          try {
            const vector = await embedder.embed(combined);
            embedding = JSON.stringify(vector);
            vectorsGenerated++;
          } catch (err) {
            console.warn('Embedding generation failed, skipping vector for this batch:', err);
          }
        }

        await client.query(
          `INSERT INTO warm_tier (agent_id, content, source_hot_ids, metadata, embedding, embedding_model)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            agentId,
            combined,
            ids,
            JSON.stringify({
              batch_size: batch.length,
              oldest: batch[0]!.created_at,
              newest: batch[batch.length - 1]!.created_at,
            }),
            embedding,
            withVectors ? this.config.embedding?.model : null,
          ],
        );
        warmCreated++;
      }

      const hotIds = hotRows.rows.map((r) => r.id);
      await client.query(`DELETE FROM hot_tier WHERE agent_id = $1 AND id = ANY($2)`, [
        agentId,
        hotIds,
      ]);

      await client.query(
        `UPDATE consolidation_log
         SET status = 'complete',
             completed_at = now(),
             hot_rows_processed = $2,
             warm_rows_created = $3,
             metadata = $4
         WHERE id = $1`,
        [runId, hotRows.rows.length, warmCreated, JSON.stringify({
          vectors_generated: vectorsGenerated,
          embedding_model: withVectors ? this.config.embedding?.model : null,
        })],
      );

      await client.query('COMMIT');

      return {
        run_id: runId,
        agent_id: agentId,
        hot_rows_processed: hotRows.rows.length,
        warm_rows_created: warmCreated,
        vectors_generated: vectorsGenerated,
        embedding_model: withVectors ? this.config.embedding?.model : undefined,
        status: 'complete',
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (runId) {
        try {
          await this.pool.query(
            `UPDATE consolidation_log
             SET status = 'failed', completed_at = now(), error = $2
             WHERE id = $1`,
            [runId, (err as Error).message],
          );
        } catch {
          // best-effort
        }
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
```

---

## Phase 4: Schema Documentation

### Update schema.sql

Add documentation for vector columns (already added in migration):

```sql
-- Vector embedding support for semantic search
-- Added in MemForge 1.1.0

-- Columns in warm_tier:
--   embedding: JSONB array of floats (768-dimensional vectors)
--   embedding_model: VARCHAR(64) tracking which model generated the embedding
--   vector_score: NUMERIC score from hybrid search (0.5*vector + 0.3*keyword + 0.2*recency)

-- Queries use hybrid search formula:
--   SELECT ... ORDER BY (
--     0.5 * (1 - (embedding <-> query_vector) / 2) +
--     0.3 * similarity(content, query_text) +
--     0.2 * recency_score
--   ) DESC;
```

---

## Phase 5: Testing

### Create tests/vector.test.ts

```typescript
// Comprehensive test suite for vector layer
// - Embedding generation (Ollama + OpenAI fallback)
// - Consolidation with vectors
// - Hybrid search ranking
// - Error handling
```

---

## Phase 6: Documentation Updates

### Update README.md

```markdown
## Vector Embeddings

MemForge 1.1.0 adds optional vector embedding support for semantic memory retrieval.

### Configuration

```bash
export EMBEDDING_PROVIDER=ollama  # or 'openai'
export EMBEDDING_MODEL=nomic-embed-text-v2-moe
export EMBEDDING_BASE_URL=http://localhost:11434  # For Ollama
export EMBEDDING_API_KEY=sk-...  # For OpenAI
export EMBEDDING_ENABLED=true
```

### Usage

```typescript
const manager = new MemoryManager({
  databaseUrl: process.env.DATABASE_URL,
  embedding: {
    provider: 'ollama',
    model: 'nomic-embed-text-v2-moe',
    enabled: true,
  },
});

// Consolidate with vectors
const result = await manager.consolidate('agent-id', { withVectors: true });
console.log(`Generated ${result.vectors_generated} embeddings`);

// Hybrid semantic search
const results = await manager.vectorSearch('agent-id', 'memory query');
results.forEach(r => console.log(`${r.content} (score: ${r.vector_score})`));
```

### Architecture

Hybrid search combines three signals:
- **Vector similarity** (50%): Semantic understanding via embeddings
- **Keyword matching** (30%): Full-text search fallback
- **Temporal recency** (20%): Recent memories weighted higher

### Performance

- Ollama (local): Free, <100ms per embedding
- OpenAI (API): $0.002 per 100K tokens
```

---

## Implementation Checklist

### Phase 1: Types (30 min)
- [ ] Add EmbeddingConfig to types.ts
- [ ] Add VectorRow, VectorSearchResult to types.ts
- [ ] Update ConsolidateResult with vector fields
- [ ] Update ConsolidateOptions type

### Phase 2: Embedding Infrastructure (60 min)
- [ ] Create embedding.ts with EmbeddingProvider class
- [ ] Implement Ollama embedding
- [ ] Implement OpenAI embedding
- [ ] Add cosine similarity + normalization helpers
- [ ] Error handling for provider failures

### Phase 3: Memory Manager (90 min)
- [ ] Update DEFAULTS with embedding config
- [ ] Add embedder initialization
- [ ] Update consolidate() to embed warm rows
- [ ] Add vectorSearch() method
- [ ] Update consolidation_log to track vectors

### Phase 4: Schema (20 min)
- [ ] Document vector columns
- [ ] Add examples to schema.sql
- [ ] Test schema migration

### Phase 5: Testing (90 min)
- [ ] Test embedding generation
- [ ] Test consolidation with vectors
- [ ] Test vector search ranking
- [ ] Test fallbacks (provider unavailable)
- [ ] Performance tests

### Phase 6: Documentation (30 min)
- [ ] Update README with vector section
- [ ] Add configuration examples
- [ ] Document hybrid search formula
- [ ] Add usage examples

### Release (30 min)
- [ ] Update version to 1.1.0
- [ ] Build TypeScript (`npm run build`)
- [ ] Type check (`npm run type-check`)
- [ ] Final testing
- [ ] Tag release

---

## Total Time: 4-5 hours

- Implementation: 3 hours
- Testing: 1.5 hours
- Documentation + Release: 1 hour

---

## Success Criteria

✅ Vector embedding optional but seamless  
✅ Ollama (free) and OpenAI (API) both supported  
✅ Hybrid search working (vector + keyword + recency)  
✅ Backward compatible (existing code works unchanged)  
✅ Performance acceptable (<100ms embedding for 50-event batch)  
✅ Error handling graceful (falls back to keyword search if embedding fails)  
✅ Public release quality (types, tests, docs)  
✅ Semver minor version bump (1.0.0 → 1.1.0)  

---

**Ready to implement. Approve to proceed.**

⚡ Flint
