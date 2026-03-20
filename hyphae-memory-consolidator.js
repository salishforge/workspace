#!/usr/bin/env node

/**
 * Hyphae Memory Consolidator
 * 
 * Consolidates all agent markdown files into MemForge (PostgreSQL warm tier)
 * - Imports agent identity, memory, procedures, etc.
 * - Makes memories available via query API
 * - Tracks consolidation status and versioning
 * 
 * Port: 3106
 * 
 * Usage:
 *   POST /consolidate { agent_id: 'flint', file_paths: [...] }
 *   GET /status?agent_id=flint
 */

import http from 'http';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { Pool } = pg;

const PORT = process.env.CONSOLIDATOR_PORT || 3106;

const db = new Pool({
  host: process.env.DB_HOST || '100.97.161.7',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026'
});

// ─────────────────────────────────────────────────────────────
// Memory Consolidation
// ─────────────────────────────────────────────────────────────

class MemoryConsolidator {
  constructor(db) {
    this.db = db;
  }

  /**
   * Initialize consolidation tables if they don't exist
   */
  async initializeSchema() {
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS hyphae_agent_memories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL,
          memory_type TEXT NOT NULL,
          file_name TEXT,
          content TEXT,
          content_hash TEXT,
          consolidated_at TIMESTAMPTZ DEFAULT NOW(),
          version INT DEFAULT 1
        );
      `);
      
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_memories 
        ON hyphae_agent_memories(agent_id);
      `);
      
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_memories_type 
        ON hyphae_agent_memories(agent_id, memory_type);
      `);

      await this.db.query(`
        CREATE TABLE IF NOT EXISTS hyphae_consolidation_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id TEXT NOT NULL,
          action TEXT,
          file_count INT,
          total_size_bytes BIGINT,
          status TEXT,
          notes TEXT,
          completed_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      
      await this.db.query(`
        CREATE INDEX IF NOT EXISTS idx_consolidation_log 
        ON hyphae_consolidation_log(agent_id);
      `);
      
      console.log('✅ Consolidation schema initialized');
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * Consolidate markdown files for an agent
   */
  async consolidateAgent(agentId, filePaths, fileContents = {}) {
    const consolidationId = crypto.randomUUID();
    let successCount = 0;
    let totalSize = 0;

    try {
      console.log(`\n📚 Consolidating ${filePaths.length} files for agent: ${agentId}`);

      for (const filePath of filePaths) {
        try {
          let content;
          
          // Get content from provided map or read from filesystem
          if (fileContents[filePath]) {
            content = fileContents[filePath];
          } else {
            content = fs.readFileSync(filePath, 'utf-8');
          }

          const fileName = path.basename(filePath);
          const contentHash = this.hashContent(content);
          const memoryType = this.classifyMemory(fileName);

          // Check if already consolidated with same content
          const existing = await this.db.query(
            `SELECT id FROM hyphae_agent_memories 
             WHERE agent_id = $1 AND file_name = $2 AND content_hash = $3`,
            [agentId, fileName, contentHash]
          );

          if (existing.rows.length === 0) {
            // New or updated
            const version = existing.rows.length > 0 ? (existing.rows[0].version + 1) : 1;
            
            await this.db.query(
              `INSERT INTO hyphae_agent_memories 
               (agent_id, memory_type, file_name, content, content_hash, version)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [agentId, memoryType, fileName, content, contentHash, version]
            );

            successCount++;
            totalSize += content.length;
            console.log(`  ✅ ${fileName} (${memoryType}) - ${content.length} chars`);
          } else {
            console.log(`  ⏭️  ${fileName} - unchanged`);
          }
        } catch (error) {
          console.error(`  ❌ ${filePath}:`, error.message);
        }
      }

      // Log consolidation
      await this.db.query(
        `INSERT INTO hyphae_consolidation_log 
         (agent_id, action, file_count, total_size_bytes, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          agentId,
          'import',
          successCount,
          totalSize,
          successCount === filePaths.length ? 'success' : 'partial',
          `Consolidated ${successCount}/${filePaths.length} files`
        ]
      );

      console.log(`\n✅ Consolidation complete: ${successCount}/${filePaths.length} files`);
      
      return {
        consolidation_id: consolidationId,
        agent_id: agentId,
        files_processed: filePaths.length,
        files_consolidated: successCount,
        total_size_bytes: totalSize,
        status: successCount === filePaths.length ? 'success' : 'partial'
      };

    } catch (error) {
      console.error('Consolidation failed:', error);
      throw error;
    }
  }

  /**
   * Query consolidated memories
   */
  async queryMemories(agentId, query = null, limit = 10) {
    try {
      let sql = 'SELECT id, memory_type, file_name, content FROM hyphae_agent_memories WHERE agent_id = $1';
      const params = [agentId];

      if (query) {
        sql += ' AND (file_name ILIKE $2 OR memory_type = $2)';
        params.push(`%${query}%`);
      }

      sql += ` ORDER BY consolidated_at DESC LIMIT ${limit}`;

      const result = await this.db.query(sql, params);
      return result.rows;
    } catch (error) {
      console.error('Query failed:', error);
      return [];
    }
  }

  /**
   * Get consolidation status
   */
  async getStatus(agentId) {
    try {
      const memories = await this.db.query(
        `SELECT COUNT(*) as total, memory_type FROM hyphae_agent_memories 
         WHERE agent_id = $1 GROUP BY memory_type`,
        [agentId]
      );

      const log = await this.db.query(
        `SELECT * FROM hyphae_consolidation_log WHERE agent_id = $1 ORDER BY completed_at DESC LIMIT 5`,
        [agentId]
      );

      return {
        agent_id: agentId,
        memories_consolidated: memories.rows,
        consolidation_history: log.rows
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Classify memory type from filename
   */
  classifyMemory(fileName) {
    if (fileName === 'SOUL.md') return 'values';
    if (fileName === 'IDENTITY.md') return 'identity';
    if (fileName === 'MEMORY.md') return 'long_term_memory';
    if (fileName === 'USER.md') return 'team_context';
    if (fileName === 'AGENTS.md') return 'procedures';
    if (fileName === 'TOOLS.md') return 'infrastructure';
    if (fileName.startsWith('2026-') && fileName.endsWith('.md')) return 'daily_log';
    return 'general';
  }

  /**
   * Hash content for deduplication
   */
  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────

const consolidator = new MemoryConsolidator(db);

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Health check
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      service: 'memory-consolidator',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // Consolidate endpoint
  if (req.url === '/consolidate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agent_id, file_paths, files } = JSON.parse(body);

        if (!agent_id) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing agent_id' }));
          return;
        }

        const result = await consolidator.consolidateAgent(
          agent_id,
          file_paths || [],
          files || {}
        );

        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Query endpoint
  if (req.url.startsWith('/query')) {
    const params = new URL(`http://localhost${req.url}`).searchParams;
    const agent_id = params.get('agent_id');
    const query = params.get('q');

    if (!agent_id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing agent_id' }));
      return;
    }

    try {
      const results = await consolidator.queryMemories(agent_id, query);
      res.writeHead(200);
      res.end(JSON.stringify({
        agent_id,
        query,
        results,
        count: results.length
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Status endpoint
  if (req.url.startsWith('/status')) {
    const params = new URL(`http://localhost${req.url}`).searchParams;
    const agent_id = params.get('agent_id');

    if (!agent_id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing agent_id' }));
      return;
    }

    try {
      const status = await consolidator.getStatus(agent_id);
      res.writeHead(200);
      res.end(JSON.stringify(status));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Startup
async function startup() {
  try {
    await consolidator.initializeSchema();
    
    server.listen(PORT, () => {
      console.log(`✅ Memory Consolidator running on port ${PORT}`);
      console.log(`   POST /consolidate - Import agent memories`);
      console.log(`   GET /query?agent_id=flint&q=search - Query memories`);
      console.log(`   GET /status?agent_id=flint - Get consolidation status`);
    });
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

startup();

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await db.end();
  server.close();
});
