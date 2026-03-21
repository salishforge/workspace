#!/usr/bin/env node

/**
 * Hyphae MemForge Agent API
 * 
 * Extends the memory consolidator with agent-facing APIs:
 * - Memory sync (agents push memory to consolidation)
 * - Memory retrieval (agents query their own context)
 * - Credential validation
 * 
 * Port: 3106
 * 
 * Endpoints:
 *   POST /api/memory/sync (agent pushes memory)
 *   GET /api/memory/agent/{agent_id} (retrieve context)
 *   GET /api/memory/agent/{agent_id}/search?q=query
 *   POST /api/memory/agent/{agent_id}/consolidate (force consolidation)
 */

import http from 'http';
import pg from 'pg';
import url from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { Pool } = pg;

const PORT = process.env.MEMFORGE_AGENT_API_PORT || 3106;

const db = new Pool({
  host: process.env.DB_HOST || '100.97.161.7',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026'
});

// ─────────────────────────────────────────────────────────────
// Credential Validation
// ─────────────────────────────────────────────────────────────

async function validateCredential(apiKey) {
  try {
    const result = await db.query(
      'SELECT agent_id, permissions FROM hyphae_memory_agent_credentials WHERE api_key = $1 AND status = $2',
      [apiKey, 'active']
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[ERROR] Credential validation failed:', error.message);
    return null;
  }
}

async function updateLastUsed(agentId) {
  try {
    await db.query(
      'UPDATE hyphae_memory_agent_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE agent_id = $1',
      [agentId]
    );
  } catch (error) {
    console.log('[WARN] Could not update last_used_at:', error.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Memory Sync Endpoint
// ─────────────────────────────────────────────────────────────

async function handleMemorySyncRequest(apiKey, agentId, body) {
  try {
    const credential = await validateCredential(apiKey);
    if (!credential) {
      return { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (credential.agent_id !== agentId) {
      return { status: 403, body: JSON.stringify({ error: 'Agent ID mismatch' }) };
    }

    const { files, metadata } = body;
    if (!files || typeof files !== 'object') {
      return { status: 400, body: JSON.stringify({ error: 'Missing or invalid files' }) };
    }

    const consolidationId = crypto.randomUUID();
    const timestamp = new Date();

    // Store consolidated memory
    for (const [fileType, content] of Object.entries(files)) {
      try {
        await db.query(
          `INSERT INTO hyphae_agent_memory (agent_id, memory_type, content, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (agent_id, memory_type) DO UPDATE SET
             content = EXCLUDED.content,
             updated_at = CURRENT_TIMESTAMP`,
          [agentId, fileType, content, timestamp, timestamp]
        );
      } catch (error) {
        console.error(`[ERROR] Failed to store ${fileType}:`, error.message);
      }
    }

    await updateLastUsed(agentId);

    console.log(`[SYNC] ✅ Agent ${agentId} synced memory (${Object.keys(files).length} files)`);
    return {
      status: 200,
      body: JSON.stringify({
        status: 'success',
        consolidation_id: consolidationId,
        files_synced: Object.keys(files).length,
        timestamp
      })
    };
  } catch (error) {
    console.error('[ERROR] Memory sync failed:', error.message);
    return {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Memory Retrieval Endpoints
// ─────────────────────────────────────────────────────────────

async function handleMemoryRetrievalRequest(apiKey, agentId) {
  try {
    const credential = await validateCredential(apiKey);
    if (!credential) {
      return { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (credential.agent_id !== agentId) {
      return { status: 403, body: JSON.stringify({ error: 'Agent ID mismatch' }) };
    }

    // Retrieve all consolidated memory for this agent
    const result = await db.query(
      `SELECT memory_type, content, created_at, updated_at
       FROM hyphae_agent_memory
       WHERE agent_id = $1
       ORDER BY updated_at DESC`,
      [agentId]
    );

    const memory = {};
    for (const row of result.rows) {
      memory[row.memory_type] = {
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    }

    await updateLastUsed(agentId);

    console.log(`[RETRIEVAL] ✅ Retrieved ${result.rows.length} memory files for ${agentId}`);
    return {
      status: 200,
      body: JSON.stringify({
        status: 'success',
        agent_id: agentId,
        memory,
        file_count: result.rows.length
      })
    };
  } catch (error) {
    console.error('[ERROR] Memory retrieval failed:', error.message);
    return {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleMemorySearchRequest(apiKey, agentId, query) {
  try {
    const credential = await validateCredential(apiKey);
    if (!credential) {
      return { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (credential.agent_id !== agentId) {
      return { status: 403, body: JSON.stringify({ error: 'Agent ID mismatch' }) };
    }

    // Full-text search in memory
    const result = await db.query(
      `SELECT memory_type, content, created_at, updated_at
       FROM hyphae_agent_memory
       WHERE agent_id = $1
         AND content ILIKE $2
       ORDER BY updated_at DESC
       LIMIT 50`,
      [agentId, `%${query}%`]
    );

    await updateLastUsed(agentId);

    console.log(`[SEARCH] ✅ Found ${result.rows.length} results for "${query}" (agent: ${agentId})`);
    return {
      status: 200,
      body: JSON.stringify({
        status: 'success',
        query,
        results: result.rows.map(row => ({
          memory_type: row.memory_type,
          content: row.content.substring(0, 500), // Truncate for response
          timestamp: row.updated_at
        })),
        result_count: result.rows.length
      })
    };
  } catch (error) {
    console.error('[ERROR] Memory search failed:', error.message);
    return {
      status: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Extract API key from Authorization header
  const authHeader = req.headers.authorization || '';
  const apiKey = authHeader.replace('Bearer ', '').trim();

  // Routes
  if (req.method === 'POST' && pathname === '/api/memory/sync') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const agentId = data.agent_id;
        const result = await handleMemorySyncRequest(apiKey, agentId, data);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (req.method === 'GET' && pathname.match(/^\/api\/memory\/agent\/([a-z0-9_-]+)$/)) {
    const agentId = pathname.split('/').pop();
    const result = await handleMemoryRetrievalRequest(apiKey, agentId);
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(result.body);
  } else if (req.method === 'GET' && pathname.match(/^\/api\/memory\/agent\/([a-z0-9_-]+)\/search/)) {
    const agentId = pathname.split('/')[4];
    const searchQuery = query.q || '';
    const result = await handleMemorySearchRequest(apiKey, agentId, searchQuery);
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(result.body);
  } else if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'memforge-agent-api',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║  MEMFORGE AGENT API                           ║`);
  console.log(`║  Listening on port ${PORT}                       ║`);
  console.log(`║  Agent memory sync + retrieval                ║`);
  console.log(`╚════════════════════════════════════════════════╝`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /api/memory/sync (agent memory push)');
  console.log('  GET  /api/memory/agent/{id} (retrieve all)');
  console.log('  GET  /api/memory/agent/{id}/search?q=query');
  console.log('  GET  /health');
  console.log('');
});

process.on('SIGINT', async () => {
  console.log('\n[SHUTDOWN] Closing database connections...');
  await db.end();
  process.exit(0);
});
