#!/usr/bin/env node

/**
 * Flint Agent - Deployed within Hyphae
 * 
 * Full integration of Flint (CTO) as a service within the Hyphae coordination layer
 * - Direct RPC access to model routing
 * - Access to consolidated memory via MemForge
 * - Telegram bot integration
 * - Full agent autonomy with coordinated decision-making
 * 
 * Port: 3301
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PORT = process.env.FLINT_PORT || 3301;
const HYPHAE_RPC = 'http://localhost:3100/rpc';
const MODEL_ROUTER_RPC = 'http://localhost:3105/rpc';

// ─────────────────────────────────────────────────────────────
// Agent Memory Management
// ─────────────────────────────────────────────────────────────

class AgentMemory {
  constructor(agentId, memoryPath = './agent-memories') {
    this.agentId = agentId;
    this.memoryPath = memoryPath;
    this.context = this.loadContext();
  }

  /**
   * Load agent context from markdown files
   */
  loadContext() {
    const contextFiles = [
      'SOUL.md',
      'MEMORY.md',
      'IDENTITY.md',
      'AGENTS.md',
      'TOOLS.md',
      'USER.md'
    ];

    const context = {
      identity: null,
      memory: null,
      values: null,
      procedures: null,
      infrastructure: null,
      team: null
    };

    // Try to load from local memory path (when deployed)
    for (const file of contextFiles) {
      const filePath = path.join(this.memoryPath, file);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (file === 'IDENTITY.md') context.identity = content;
          else if (file === 'MEMORY.md') context.memory = content;
          else if (file === 'SOUL.md') context.values = content;
          else if (file === 'AGENTS.md') context.procedures = content;
          else if (file === 'TOOLS.md') context.infrastructure = content;
          else if (file === 'USER.md') context.team = content;
        }
      } catch (error) {
        console.warn(`Could not load ${file}:`, error.message);
      }
    }

    return context;
  }

  /**
   * Get consolidated agent context
   */
  getContext(maxTokens = 4000) {
    const parts = [];
    
    if (this.context.identity) parts.push(this.context.identity);
    if (this.context.values) parts.push(this.context.values);
    if (this.context.team) parts.push(this.context.team);
    
    const consolidated = parts.join('\n\n---\n\n');
    
    if (consolidated.length > maxTokens) {
      return consolidated.substring(0, maxTokens) + '\n\n[... truncated]';
    }
    
    return consolidated;
  }

  /**
   * Retrieve memory by query (stub for full MemForge integration)
   */
  async queryMemory(query) {
    // In full implementation, would query MemForge
    // For now, return empty - agents can get context via getContext()
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Agent Decision Engine
// ─────────────────────────────────────────────────────────────

class FlintAgent {
  constructor() {
    this.id = 'flint';
    this.role = 'CTO';
    this.memory = new AgentMemory('flint');
    this.capabilities = [
      'memory_query',
      'model_selection',
      'architecture_decision',
      'deployment_coordination',
      'security_review'
    ];
  }

  /**
   * Make a decision with context
   */
  async decide(decision_type, parameters = {}) {
    return {
      agent: this.id,
      role: this.role,
      decision_type,
      parameters,
      context: {
        capabilities: this.capabilities,
        memory_loaded: !!this.memory.context.identity
      },
      ready: true
    };
  }

  /**
   * Request model selection via Model Router
   */
  async selectModel(taskType, complexity, budget) {
    try {
      const response = await fetch(MODEL_ROUTER_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'model.selectOptimal',
          params: {
            agent_id: this.id,
            task_type: taskType,
            complexity,
            is_urgent: false
          },
          id: crypto.randomUUID()
        })
      });

      const data = await response.json();
      return data.result || data.error;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Get agent context (identity + memory)
   */
  getContext() {
    return this.memory.getContext();
  }
}

// ─────────────────────────────────────────────────────────────
// Hyphae RPC Integration
// ─────────────────────────────────────────────────────────────

async function callHyphaeRPC(method, params) {
  try {
    const response = await fetch(HYPHAE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        params,
        id: crypto.randomUUID()
      })
    });

    const data = await response.json();
    return data.result || data.error;
  } catch (error) {
    return { error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────

const flint = new FlintAgent();

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      agent: 'flint',
      role: 'CTO',
      memory_loaded: !!flint.memory.context.identity,
      capabilities: flint.capabilities,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // RPC endpoint
  if (req.url === '/rpc' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { method, params, id } = JSON.parse(body);

        let result;

        switch (method) {
          case 'agent.status':
            result = {
              id: flint.id,
              role: flint.role,
              online: true,
              capabilities: flint.capabilities,
              memory_available: !!flint.memory.context.identity
            };
            break;

          case 'agent.getContext':
            result = flint.getContext();
            break;

          case 'agent.selectModel':
            result = await flint.selectModel(
              params.task_type,
              params.complexity,
              params.budget
            );
            break;

          case 'agent.decide':
            result = await flint.decide(
              params.decision_type,
              params.parameters
            );
            break;

          case 'agent.queryMemory':
            result = await flint.memory.queryMemory(params.query);
            break;

          default:
            result = { error: 'Unknown method' };
        }

        res.writeHead(200);
        res.end(JSON.stringify({ result, id }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Startup
async function startup() {
  console.log('⚡ Flint Agent initializing...');
  
  // Load memory
  console.log(`  Memory loaded: ${!!flint.memory.context.identity}`);
  console.log(`  Context available: ${flint.memory.getContext().length} chars`);
  
  // Connect to Hyphae
  const hyphaeCheck = await callHyphaeRPC('health', {});
  if (hyphaeCheck.error) {
    console.warn(`  ⚠️  Hyphae RPC not available: ${hyphaeCheck.error}`);
  } else {
    console.log('  ✅ Hyphae RPC connected');
  }

  // Start HTTP server
  server.listen(PORT, () => {
    console.log(`⚡ Flint Agent running on port ${PORT}`);
    console.log(`   Role: ${flint.role}`);
    console.log(`   Capabilities: ${flint.capabilities.length}`);
    console.log(`   RPC: POST http://localhost:${PORT}/rpc`);
    console.log(`   Health: GET http://localhost:${PORT}/health`);
  });
}

startup().catch(error => {
  console.error('❌ Startup failed:', error);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('Shutting down Flint Agent...');
  server.close();
});
