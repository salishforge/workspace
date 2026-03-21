#!/usr/bin/env node

/**
 * Hyphae Agent Memory Sync
 * 
 * Agents use this to:
 * 1. Read their local memory files (SOUL.md, USER.md, MEMORY.md, daily notes)
 * 2. Push to Memforge for consolidation
 * 3. Retrieve consolidated memory for context injection
 * 
 * Usage:
 *   const sync = require('./hyphae-agent-memory-sync.js');
 *   await sync.syncMemory('clio', 'memforge_clio_xxx');
 *   const memory = await sync.retrieveMemory('clio', 'memforge_clio_xxx');
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const MEMFORGE_API = process.env.MEMFORGE_API_URL || 'http://100.97.161.7:3106';
const AGENT_WORKSPACE = process.env.AGENT_WORKSPACE || '/home/artificium/.openclaw/workspace';

class AgentMemorySync {
  constructor(agentId, apiKey) {
    this.agentId = agentId;
    this.apiKey = apiKey;
  }

  /**
   * Read agent memory files from workspace
   */
  async readMemoryFiles() {
    const files = {};
    const filesToRead = [
      'SOUL.md',
      'USER.md',
      'CLIO_FOUNDATIONAL_MEMORY.md',
      'MEMORY.md',
      'AGENTS.md'
    ];

    // Also read today's and yesterday's daily notes
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];

    filesToRead.push(`memory/${today}.md`, `memory/${yesterday}.md`);

    for (const filename of filesToRead) {
      try {
        const filePath = path.join(AGENT_WORKSPACE, filename);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          files[filename.replace(/\//g, '_')] = content;
          console.log(`[MEMORY] ✅ Read ${filename} (${content.length} chars)`);
        }
      } catch (error) {
        console.warn(`[MEMORY] ⚠️ Could not read ${filename}:`, error.message);
      }
    }

    return files;
  }

  /**
   * Sync memory to Memforge
   */
  async syncMemory() {
    try {
      console.log(`[SYNC] Starting memory sync for ${this.agentId}...`);

      const files = await this.readMemoryFiles();
      if (Object.keys(files).length === 0) {
        console.warn('[SYNC] No memory files found');
        return { status: 'warning', message: 'No files to sync' };
      }

      const response = await fetch(`${MEMFORGE_API}/api/memory/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          agent_id: this.agentId,
          files,
          metadata: {
            sync_time: new Date().toISOString(),
            file_count: Object.keys(files).length,
            total_bytes: JSON.stringify(files).length
          }
        })
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`[SYNC] ✅ Memory synced (${Object.keys(files).length} files)`);
        return { status: 'success', ...data };
      } else {
        console.error(`[SYNC] ❌ Sync failed:`, data);
        return { status: 'error', ...data };
      }
    } catch (error) {
      console.error('[SYNC] Network error:', error.message);
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Retrieve consolidated memory from Memforge
   */
  async retrieveMemory() {
    try {
      console.log(`[RETRIEVE] Fetching memory for ${this.agentId}...`);

      const response = await fetch(`${MEMFORGE_API}/api/memory/agent/${this.agentId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      const data = await response.json();

      if (response.ok) {
        console.log(`[RETRIEVE] ✅ Retrieved ${data.file_count} memory files`);
        return { status: 'success', memory: data.memory };
      } else {
        console.warn(`[RETRIEVE] ❌ Retrieval failed:`, data);
        return { status: 'error', ...data };
      }
    } catch (error) {
      console.error('[RETRIEVE] Network error:', error.message);
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Search memory for a query
   */
  async searchMemory(query) {
    try {
      console.log(`[SEARCH] Searching for "${query}"...`);

      const response = await fetch(
        `${MEMFORGE_API}/api/memory/agent/${this.agentId}/search?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      const data = await response.json();

      if (response.ok) {
        console.log(`[SEARCH] ✅ Found ${data.result_count} results`);
        return { status: 'success', ...data };
      } else {
        console.warn(`[SEARCH] ❌ Search failed:`, data);
        return { status: 'error', ...data };
      }
    } catch (error) {
      console.error('[SEARCH] Network error:', error.message);
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Get memory as formatted context for injection into agent
   */
  async getMemoryContext() {
    const result = await this.retrieveMemory();
    if (result.status !== 'success') {
      return null;
    }

    let context = '## Agent Memory Context\n\n';
    for (const [fileType, memoryData] of Object.entries(result.memory)) {
      context += `### ${fileType}\n\n`;
      context += `${memoryData.content.substring(0, 1000)}\n\n`;
    }

    return context;
  }
}

// Export for use in agents
export default AgentMemorySync;

// CLI interface for testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const agentId = process.argv[2] || 'clio';
  const apiKey = process.argv[3];

  if (!apiKey) {
    console.error('Usage: node hyphae-agent-memory-sync.js <agent_id> <api_key>');
    process.exit(1);
  }

  const sync = new AgentMemorySync(agentId, apiKey);

  console.log(`\n╔════════════════════════════════════════════╗`);
  console.log(`║  AGENT MEMORY SYNC TEST                   ║`);
  console.log(`║  Agent: ${agentId.padEnd(30)} ║`);
  console.log(`╚════════════════════════════════════════════╝\n`);

  // Test sync
  await sync.syncMemory();

  console.log('');

  // Test retrieval
  const memory = await sync.retrieveMemory();
  console.log('\n[RESULT] Memory retrieval:', memory.status);
  if (memory.status === 'success') {
    console.log(`Files: ${Object.keys(memory.memory).length}`);
  }

  process.exit(0);
}
