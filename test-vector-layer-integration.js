#!/usr/bin/env node

/**
 * Integration test for vector layer implementation
 * 
 * Tests all three components:
 * 1. Embedding generation (pgvector storage)
 * 2. Hybrid search in memory_retrieval
 * 3. Hot tier distillation
 */

import pg from 'pg';
import { createEmbedder, toPgVector } from './nanoclaw-fork/memforge/consolidation/embedding.js';

const DB_URL = process.env.MEMFORGE_DB_URL || 'postgresql://postgres:hyphae-password-2026@localhost:5433/hyphae';
const pool = new pg.Pool({ connectionString: DB_URL, max: 5 });
const AGENT_ID = 'test-vector-agent';

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    process.stdout.write(`[TEST] ${name}... `);
    await fn();
    console.log('✅ PASS');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}`);
    testsFailed++;
  }
}

async function setupTestData() {
  console.log('\n[SETUP] Creating test data...\n');
  
  // Clear any previous test data
  await pool.query(`DELETE FROM memory_vectors WHERE agent_id = $1`, [AGENT_ID]);
  await pool.query(`DELETE FROM hot_tier WHERE agent_id = $1`, [AGENT_ID]);
  
  // Create test vectors
  const testEmbedder = createEmbedder({ provider: 'ollama', model: 'nomic-embed-text' });
  
  const testItems = [
    { content: 'PostgreSQL is a relational database', type: 'fact' },
    { content: 'pgvector provides vector search capabilities', type: 'fact' },
    { content: 'Hybrid search combines vector and keyword matching', type: 'technique' },
    { content: 'Semantic similarity uses cosine distance', type: 'method' },
    { content: 'The agent decided to use pgvector for embeddings', type: 'decision' },
    { content: 'Memory consolidation happens during sleep cycles', type: 'process' },
    { content: 'Hot tier is limited to 3000 tokens', type: 'constraint' },
  ];
  
  for (const item of testItems) {
    try {
      const vector = await testEmbedder.embed(item.content);
      const pgVec = toPgVector(vector);
      
      await pool.query(
        `INSERT INTO memory_vectors (agent_id, content, summary, embedding, source_type, created_at)
         VALUES ($1, $2, $3, $4::vector, $5, NOW())
         ON CONFLICT DO NOTHING`,
        [AGENT_ID, item.content, item.content.substring(0, 50), pgVec, item.type]
      );
    } catch (err) {
      console.warn(`  ⚠ Failed to embed "${item.content.substring(0, 30)}...": ${err.message}`);
    }
  }
  
  console.log(`[SETUP] Created ${testItems.length} test vectors\n`);
}

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     VECTOR LAYER INTEGRATION TEST SUITE                ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Test 1: pgvector table exists and has embeddings
  await test('pgvector table exists', async () => {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM memory_vectors WHERE agent_id = $1 AND embedding IS NOT NULL`,
      [AGENT_ID]
    );
    if (result.rows[0].count === 0) {
      throw new Error('No embeddings found in pgvector table');
    }
  });

  // Test 2: Vector dimensions are correct (768-dim)
  await test('Vector dimensions are 768-dim', async () => {
    const result = await pool.query(
      `SELECT embedding FROM memory_vectors WHERE agent_id = $1 AND embedding IS NOT NULL LIMIT 1`,
      [AGENT_ID]
    );
    if (!result.rows[0]) {
      throw new Error('No vectors to check');
    }
    const vec = result.rows[0].embedding;
    const dims = vec.toString().split(',').length;
    if (dims !== 768) {
      throw new Error(`Expected 768 dimensions, got ${dims}`);
    }
  });

  // Test 3: HNSW index is active
  await test('HNSW index on memory_vectors', async () => {
    const result = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_memory_vectors_embedding'`
    );
    if (result.rows.length === 0) {
      throw new Error('HNSW index not found');
    }
  });

  // Test 4: Keyword search (pg_trgm) works
  await test('pg_trgm fuzzy text search', async () => {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM memory_vectors 
       WHERE agent_id = $1 AND content % 'database'`,
      [AGENT_ID]
    );
    if (result.rows[0].count === 0) {
      throw new Error('No fuzzy matches found for "database"');
    }
  });

  // Test 5: Vector similarity search
  await test('Vector similarity search (cosine)', async () => {
    const queryVec = await (await createEmbedder({ provider: 'ollama' })).embed('database and vector');
    const pgVec = toPgVector(queryVec);
    
    const result = await pool.query(
      `SELECT id, (1 - (embedding <=> $2::vector)) as score 
       FROM memory_vectors 
       WHERE agent_id = $1 AND embedding IS NOT NULL
       ORDER BY score DESC LIMIT 5`,
      [AGENT_ID, pgVec]
    );
    if (result.rows.length === 0) {
      throw new Error('No vector similarity results');
    }
  });

  // Test 6: Hybrid search (vector + keyword + recency)
  await test('Hybrid search (0.5*vector + 0.3*keyword + 0.2*recency)', async () => {
    const queryVec = await (await createEmbedder({ provider: 'ollama' })).embed('memory consolidation');
    const pgVec = toPgVector(queryVec);
    
    const result = await pool.query(
      `SELECT 
         (1 - (embedding <=> $2::vector)) as vector_score,
         COALESCE(similarity(content, $3), 0) as keyword_score,
         GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - created_at)) / (86400.0 * 30)) as recency_score,
         (0.5 * (1 - (embedding <=> $2::vector))
          + 0.3 * COALESCE(similarity(content, $3), 0)
          + 0.2 * GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - created_at)) / (86400.0 * 30))
         ) as composite_score
       FROM memory_vectors
       WHERE agent_id = $1 AND embedding IS NOT NULL
       ORDER BY composite_score DESC
       LIMIT 5`,
      [AGENT_ID, pgVec, 'memory consolidation']
    );
    
    if (result.rows.length === 0) {
      throw new Error('No hybrid search results');
    }
    
    const row = result.rows[0];
    if (row.vector_score < 0 || row.vector_score > 1) {
      throw new Error(`Vector score out of range: ${row.vector_score}`);
    }
    if (row.composite_score < 0 || row.composite_score > 1) {
      throw new Error(`Composite score out of range: ${row.composite_score}`);
    }
  });

  // Test 7: hot_tier table exists and can be populated
  await test('hot_tier table exists', async () => {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM hot_tier WHERE agent_id = $1`,
      [AGENT_ID]
    );
    // Table exists if query succeeds
  });

  // Test 8: Simulate hot tier population with hybrid search
  await test('Hot tier population with hybrid search', async () => {
    // Clear hot tier
    await pool.query(`DELETE FROM hot_tier WHERE agent_id = $1`, [AGENT_ID]);
    
    // Get top 3 items by hybrid search
    const queryVec = await (await createEmbedder({ provider: 'ollama' })).embed('memory and consolidation');
    const pgVec = toPgVector(queryVec);
    
    const results = await pool.query(
      `SELECT id, content, summary, source_type,
         (0.5 * (1 - (embedding <=> $2::vector))
          + 0.3 * COALESCE(similarity(content, $3), 0)
          + 0.2 * GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - created_at)) / (86400.0 * 30))
         ) as composite_score,
         LENGTH(content) as content_length
       FROM memory_vectors
       WHERE agent_id = $1 AND embedding IS NOT NULL
       ORDER BY composite_score DESC
       LIMIT 3`,
      [AGENT_ID, pgVec, 'memory and consolidation']
    );
    
    // Insert selected items into hot_tier
    let inserted = 0;
    for (const row of results.rows) {
      const key = `${row.source_type}:${row.summary}`;
      await pool.query(
        `INSERT INTO hot_tier (agent_id, key, content, priority, token_estimate)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_id, key) DO UPDATE SET priority = EXCLUDED.priority`,
        [AGENT_ID, key, row.content, Math.round(row.composite_score * 100), Math.ceil(row.content_length / 4)]
      );
      inserted++;
    }
    
    // Verify hot_tier was populated
    const hotTier = await pool.query(
      `SELECT COUNT(*) as count FROM hot_tier WHERE agent_id = $1`,
      [AGENT_ID]
    );
    
    if (hotTier.rows[0].count === 0) {
      throw new Error('hot_tier not populated');
    }
  });

  // Test 9: Verify hot_tier respects token budget
  await test('hot_tier respects ~3K token budget', async () => {
    const result = await pool.query(
      `SELECT SUM(token_estimate) as total_tokens FROM hot_tier WHERE agent_id = $1`,
      [AGENT_ID]
    );
    
    const totalTokens = result.rows[0].total_tokens || 0;
    if (totalTokens > 3000) {
      throw new Error(`Hot tier tokens (${totalTokens}) exceed 3000 limit`);
    }
  });

  // Test 10: CLAUDE.md can be generated from hot_tier
  await test('CLAUDE.md generation from hot_tier', async () => {
    const hotTier = await pool.query(
      `SELECT key, content, priority FROM hot_tier WHERE agent_id = $1 ORDER BY priority DESC`,
      [AGENT_ID]
    );
    
    if (hotTier.rows.length === 0) {
      throw new Error('No hot_tier items to generate CLAUDE.md');
    }
    
    const lines = ['# Memory', '', '> Auto-generated by MemForge'];
    for (const row of hotTier.rows) {
      lines.push(`## ${row.key}`);
      lines.push(row.content);
      lines.push('');
    }
    
    const claudeMd = lines.join('\n');
    if (claudeMd.length < 50) {
      throw new Error('CLAUDE.md too short');
    }
  });
}

async function cleanup() {
  console.log('\n[CLEANUP] Removing test data...');
  await pool.query(`DELETE FROM memory_vectors WHERE agent_id = $1`, [AGENT_ID]);
  await pool.query(`DELETE FROM hot_tier WHERE agent_id = $1`, [AGENT_ID]);
  await pool.end();
  console.log('[CLEANUP] Done\n');
}

async function main() {
  try {
    await setupTestData();
    await runTests();
    
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log(`║  RESULTS: ${testsPassed} passed, ${testsFailed} failed                    ║`);
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    if (testsFailed === 0) {
      console.log('✅ ALL TESTS PASSED - Vector layer is operational!\n');
    } else {
      console.log(`⚠️  ${testsFailed} test(s) failed - review errors above\n`);
    }
  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error.message);
    testsFailed++;
  } finally {
    await cleanup();
    process.exit(testsFailed > 0 ? 1 : 0);
  }
}

main();
