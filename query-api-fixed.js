#!/usr/bin/env node

/**
 * Phase 3: Query & Retrieval API
 * Fast tiered queries for Clio's memory system
 * 
 * Endpoints:
 *  GET /api/memory/hot/:userId        - Instant hot tier (1-2K tokens)
 *  GET /api/memory/warm/:userId       - Recent 7 days with search
 *  GET /api/memory/cold/:userId       - Deep search, lazy-loaded
 *  GET /api/memory/health             - System health check
 * 
 * Usage: node query-api.js [--port 3333] [--host 192.168.6.30]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

// Configuration
const CONFIG = {
  port: process.argv.includes('--port')
    ? parseInt(process.argv[process.argv.indexOf('--port') + 1])
    : 3333,
  db_host: process.argv.includes('--db-host')
    ? process.argv[process.argv.indexOf('--db-host') + 1]
    : process.env.PGHOST || 'localhost',
  db_port: process.argv.includes('--db-port')
    ? parseInt(process.argv[process.argv.indexOf('--db-port') + 1])
    : (process.env.PGPORT || 5432),
  db_user: process.argv.includes('--db-user')
    ? process.argv[process.argv.indexOf('--db-user') + 1]
    : process.env.PGUSER || 'wonders_user',
  db_password: process.env.PGPASSWORD || 'wonders_secure_2024',
  db_name: process.argv.includes('--db-name')
    ? process.argv[process.argv.indexOf('--db-name') + 1]
    : 'clio_memory',
  workspace: '/home/artificium/.openclaw/workspace',
  test_mode: process.argv.includes('--test')
};

// In-memory cache for testing (simulates database)
const CACHE = {
  hot: {},
  warm: {},
  cold: {}
};

// Performance tracking
const METRICS = {
  requests: 0,
  hot_queries: 0,
  warm_queries: 0,
  cold_queries: 0,
  latencies: []
};

// ============================================================================
// Query Handlers
// ============================================================================

/**
 * Hot Tier Query - Instant, cached session context
 * Target latency: <50ms
 * Returns: SOUL.md, USER.md, MEMORY.md, TOOLS.md, + latest daily log
 */
async function queryHotTier(userId, sessionId) {
  const startTime = Date.now();
  
  try {
    const hotData = {
      status: 'success',
      soul: '',
      user: '',
      curated_memory: '',
      tools: '',
      daily: {},
      hot_tier_tokens: 0
    };

    // Read SOUL.md
    const soulPath = path.join(CONFIG.workspace, 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      hotData.soul = fs.readFileSync(soulPath, 'utf8');
    }

    // Read USER.md
    const userPath = path.join(CONFIG.workspace, 'USER.md');
    if (fs.existsSync(userPath)) {
      hotData.user = fs.readFileSync(userPath, 'utf8');
    }

    // Read MEMORY.md
    const memoryPath = path.join(CONFIG.workspace, 'MEMORY.md');
    if (fs.existsSync(memoryPath)) {
      hotData.curated_memory = fs.readFileSync(memoryPath, 'utf8');
    }

    // Read TOOLS.md
    const toolsPath = path.join(CONFIG.workspace, 'TOOLS.md');
    if (fs.existsSync(toolsPath)) {
      hotData.tools = fs.readFileSync(toolsPath, 'utf8');
    }

    // Read latest daily logs (today + yesterday)
    const memoryDir = path.join(CONFIG.workspace, 'memory');
    if (fs.existsSync(memoryDir)) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      [today, yesterday].forEach(date => {
        const dailyPath = path.join(memoryDir, `${date}.md`);
        if (fs.existsSync(dailyPath)) {
          hotData.daily[`${date}.md`] = fs.readFileSync(dailyPath, 'utf8');
        }
      });
    }

    // Calculate token estimate (approx 4 chars per token)
    const totalContent = Object.values(hotData).join('');
    hotData.hot_tier_tokens = Math.ceil(totalContent.length / 4);

    const latency = Date.now() - startTime;
    METRICS.hot_queries++;
    METRICS.latencies.push({ tier: 'hot', ms: latency });

    return {
      status: 'success',
      ...hotData,
      latency_ms: latency
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      fallback: 'using_flat_files'
    };
  }
}

/**
 * Warm Tier Query - Recent 7 days, searchable
 * Target latency: <200ms
 */
async function queryWarmTier(userId, query, limit = 10) {
  const startTime = Date.now();

  try {
    // Simulate searching recent daily logs
    const memoryDir = path.join(CONFIG.workspace, 'memory');
    let results = [];

    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir)
        .filter(f => f.endsWith('.md'))
        .toSorted()
        .toReversed()
        .slice(0, 7); // Last 7 days

      files.forEach(file => {
        const filePath = path.join(memoryDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Simple text search
          if (!query || content.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              date: file.replace('.md', ''),
              snippet: content.substring(0, 300),
              size_bytes: content.length,
              token_estimate: Math.ceil(content.length / 4)
            });
          }
        } catch (e) {
          // Skip unreadable files
        }
      });
    }

    const latency = Date.now() - startTime;
    METRICS.warm_queries++;
    METRICS.latencies.push({ tier: 'warm', ms: latency });

    return {
      status: 'success',
      tier: 'warm',
      query: query || 'all',
      results: results.slice(0, limit),
      total_results: results.length,
      latency_ms: latency,
      from_cache: false
    };
  } catch (err) {
    return {
      status: 'error',
      tier: 'warm',
      error: err.message,
      fallback: 'using_flat_files'
    };
  }
}

/**
 * Cold Tier Query - Deep indexed search, lazy-loaded
 * Target latency: <1000ms
 * (In production, this would use PostgreSQL full-text search)
 */
async function queryColdTier(userId, query) {
  const startTime = Date.now();

  try {
    // Simulate cold tier search across all historical data
    const memoryDir = path.join(CONFIG.workspace, 'memory');
    let results = [];

    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir)
        .filter(f => f.endsWith('.md'))
        .toSorted()
        .toReversed(); // All files, reverse date order

      files.forEach(file => {
        if (results.length >= 5) {return;} // Limit results
        
        const filePath = path.join(memoryDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          
          if (query && content.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              date: file.replace('.md', ''),
              file: file,
              relevance: (content.match(new RegExp(query, 'gi')) || []).length,
              snippet: content.substring(0, 200),
              token_estimate: Math.ceil(content.length / 4)
            });
          }
        } catch (e) {
          // Skip
        }
      });
    }

    const latency = Date.now() - startTime;
    METRICS.cold_queries++;
    METRICS.latencies.push({ tier: 'cold', ms: latency });

    return {
      status: 'success',
      tier: 'cold',
      query: query,
      results: results,
      total_results: results.length,
      latency_ms: latency,
      indexed: true
    };
  } catch (err) {
    return {
      status: 'error',
      tier: 'cold',
      error: err.message,
      fallback: 'degraded_search'
    };
  }
}

/**
 * System Health Check
 */
async function checkHealth() {
  return {
    status: 'healthy',
    uptime_ms: Date.now(),
    memory_available: process.memoryUsage(),
    metrics: {
      total_requests: METRICS.requests,
      hot_queries: METRICS.hot_queries,
      warm_queries: METRICS.warm_queries,
      cold_queries: METRICS.cold_queries,
      avg_hot_latency_ms: METRICS.latencies
        .filter(m => m.tier === 'hot')
        .reduce((a, b) => a + b.ms, 0) / Math.max(METRICS.hot_queries, 1),
      avg_warm_latency_ms: METRICS.latencies
        .filter(m => m.tier === 'warm')
        .reduce((a, b) => a + b.ms, 0) / Math.max(METRICS.warm_queries, 1),
      avg_cold_latency_ms: METRICS.latencies
        .filter(m => m.tier === 'cold')
        .reduce((a, b) => a + b.ms, 0) / Math.max(METRICS.cold_queries, 1)
    }
  };
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  METRICS.requests++;

  try {
    // Hot Tier
    if (pathname.match(/^\/api\/memory\/hot\/([^/]+)$/)) {
      const userId = pathname.split('/').pop();
      const result = await queryHotTier(userId, query.session_id);
      res.writeHead(200);
      res.end(JSON.stringify(result, null, 2));
    }
    // Warm Tier
    else if (pathname.match(/^\/api\/memory\/warm\/([^/]+)$/)) {
      const userId = pathname.split('/').pop();
      const result = await queryWarmTier(userId, query.q, query.limit || 10);
      res.writeHead(200);
      res.end(JSON.stringify(result, null, 2));
    }
    // Cold Tier
    else if (pathname.match(/^\/api\/memory\/cold\/([^/]+)$/)) {
      const userId = pathname.split('/').pop();
      const result = await queryColdTier(userId, query.q);
      res.writeHead(200);
      res.end(JSON.stringify(result, null, 2));
    }
    // Health
    else if (pathname === '/api/memory/health') {
      const health = await checkHealth();
      res.writeHead(200);
      res.end(JSON.stringify(health, null, 2));
    }
    // Root
    else if (pathname === '/') {
      res.writeHead(200);
      res.end(JSON.stringify({
        service: 'Clio Memory Query API',
        phase: 3,
        endpoints: {
          hot: 'GET /api/memory/hot/:userId',
          warm: 'GET /api/memory/warm/:userId?q=search&limit=10',
          cold: 'GET /api/memory/cold/:userId?q=search',
          health: 'GET /api/memory/health'
        },
        test_mode: CONFIG.test_mode
      }, null, 2));
    }
    // 404
    else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Endpoint not found' }, null, 2));
    }
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }, null, 2));
  }
});

// ============================================================================
// Main
// ============================================================================

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log(`\n🚀 Query API listening on http://127.0.0.1:${CONFIG.port}`);
  console.log(`   Test mode: ${CONFIG.test_mode}`);
  console.log(`\n📍 Endpoints:`);
  console.log(`   GET /api/memory/hot/:userId`);
  console.log(`   GET /api/memory/warm/:userId?q=search`);
  console.log(`   GET /api/memory/cold/:userId?q=search`);
  console.log(`   GET /api/memory/health\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { queryHotTier, queryWarmTier, queryColdTier, checkHealth };
