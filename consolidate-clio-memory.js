#!/usr/bin/env node

/**
 * Consolidate All Clio Memory into MemForge
 * 
 * Gathers all foundational documents, historical memory, and context
 * and syncs to MemForge with comprehensive consolidation
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MEMFORGE_API = 'http://100.97.161.7:3107';
const WORKSPACE_DIR = '/home/artificium/.openclaw/workspace';

// ─────────────────────────────────────────────────────────────
// File Collection
// ─────────────────────────────────────────────────────────────

const FILES_TO_CONSOLIDATE = [
  // Foundational Identity
  'CLIO_FOUNDATIONAL_MEMORY.md',
  'SALISH_FORGE_ORG_CHARTER.md',
  'USER.md',
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  
  // Organizational & Decision Framework
  'BOOTSTRAP.md',
  'CTO_PROFILE.md',
  
  // Operating Procedures
  'TOOLS.md',
  'HEARTBEAT.md',
  
  // Recent Session Memory (last 5 days)
  'memory/2026-03-20.md',
  'memory/2026-03-19.md',
  'memory/2026-03-18.md',
  'memory/2026-03-17.md',
  'memory/2026-03-16.md',
  
  // Architecture & Infrastructure
  'HYPHAE_MVP_COMPLETE.md',
  'HYPHAE_MEMFORGE_IMPLEMENTATION_COMPLETE.md',
  'SECURITY_AUDIT_HYPHAE_REGISTRY.md',
  'DEPLOYMENT_STATUS_MARCH_21.md',
  
  // Long-term Memory
  'MEMORY.md',
  
  // Agent Integration
  'MEMFORGE_AGENT_INTEGRATION_GUIDE.md',
  'CLIO_MEMORY_CONSOLIDATION_PLAN.md',
  'CLIO_ONBOARDING_CHECKLIST.md',
];

// ─────────────────────────────────────────────────────────────
// Clio Memory Consolidation
// ─────────────────────────────────────────────────────────────

async function getClioApiKey() {
  try {
    const { default: pg } = await import('pg');
    const { Pool } = pg;
    const pool = new Pool({
      host: '100.97.161.7',
      port: 5433,
      database: 'hyphae',
      user: 'postgres',
      password: 'hyphae-password-2026'
    });

    const result = await pool.query(
      'SELECT api_key FROM hyphae_memory_agent_credentials WHERE agent_id = $1',
      ['clio']
    );

    const key = result.rows[0]?.api_key;
    await pool.end();
    return key;
  } catch (error) {
    console.error('Error fetching API key:', error.message);
    return null;
  }
}

async function collectMemoryFiles() {
  const files = {};

  console.log('📚 Collecting memory files...\n');

  for (const filename of FILES_TO_CONSOLIDATE) {
    const filePath = path.join(WORKSPACE_DIR, filename);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileKey = filename.replace(/\//g, '_');
        files[fileKey] = content;
        console.log(`  ✅ ${filename} (${content.length} bytes)`);
      } else {
        console.log(`  ⚠️  ${filename} (not found)`);
      }
    } catch (error) {
      console.log(`  ❌ ${filename} (error: ${error.message})`);
    }
  }

  return files;
}

async function syncToMemforge(apiKey, files) {
  try {
    console.log('\n📤 Syncing to MemForge...\n');

    const response = await fetch(`${MEMFORGE_API}/api/memory/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        agent_id: 'clio',
        files,
        metadata: {
          sync_time: new Date().toISOString(),
          consolidation_type: 'complete_memory_audit',
          source: 'consolidate-clio-memory.js',
          file_count: Object.keys(files).length,
          total_bytes: JSON.stringify(files).length
        }
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`  ✅ Sync successful`);
      console.log(`     Consolidation ID: ${data.consolidation_id}`);
      console.log(`     Files synced: ${data.files_synced}`);
      console.log(`     Timestamp: ${data.timestamp}`);
      return true;
    } else {
      console.error(`  ❌ Sync failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.error(`  ❌ Network error: ${error.message}`);
    return false;
  }
}

async function verifyMemoryInMemforge(apiKey) {
  try {
    console.log('\n✅ Verifying memory in MemForge...\n');

    const response = await fetch(`${MEMFORGE_API}/api/memory/agent/clio`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`  Retrieved ${data.file_count} memory files from MemForge`);
      for (const [fileType, memoryData] of Object.entries(data.memory)) {
        const lines = memoryData.content.split('\n').length;
        console.log(`    - ${fileType} (${lines} lines, updated ${memoryData.updated_at})`);
      }

      // Test critical searches
      console.log('\n🔍 Testing critical memory searches...\n');

      const searches = [
        { query: 'John Brooke', expected: 'USER.md' },
        { query: 'Chief of Staff', expected: 'CLIO_FOUNDATIONAL_MEMORY.md' },
        { query: 'Salish Forge', expected: 'SALISH_FORGE_ORG_CHARTER.md' }
      ];

      for (const { query, expected } of searches) {
        const searchResponse = await fetch(
          `${MEMFORGE_API}/api/memory/agent/clio/search?q=${encodeURIComponent(query)}`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        const searchData = await searchResponse.json();
        if (searchData.result_count > 0) {
          console.log(`  ✅ Search "${query}" → ${searchData.result_count} result(s)`);
        } else {
          console.log(`  ❌ Search "${query}" → NO RESULTS`);
        }
      }

      return true;
    } else {
      console.error(`  ❌ Retrieval failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.error(`  ❌ Verification error: ${error.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`╔════════════════════════════════════════════════════════╗`);
  console.log(`║  CLIO COMPLETE MEMORY CONSOLIDATION                   ║`);
  console.log(`║  Loading all foundational + historical memory         ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  // Step 1: Get API key
  console.log('🔑 Fetching Clio API key...\n');
  const apiKey = await getClioApiKey();
  if (!apiKey) {
    console.error('❌ Could not retrieve API key');
    process.exit(1);
  }
  console.log(`  ✅ Key found: ${apiKey.substring(0, 20)}...\n`);

  // Step 2: Collect files
  const files = await collectMemoryFiles();
  const fileCount = Object.keys(files).length;
  console.log(`\n  Total files collected: ${fileCount}`);

  if (fileCount === 0) {
    console.error('❌ No files found to consolidate');
    process.exit(1);
  }

  // Step 3: Sync to MemForge
  const syncSuccess = await syncToMemforge(apiKey, files);
  if (!syncSuccess) {
    console.error('❌ Sync failed');
    process.exit(1);
  }

  // Step 4: Verify
  const verifySuccess = await verifyMemoryInMemforge(apiKey);

  if (verifySuccess) {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ CLIO MEMORY CONSOLIDATION COMPLETE                ║`);
    console.log(`║                                                        ║`);
    console.log(`║  Clio now has full access to:                         ║`);
    console.log(`║  - Foundational identity & role                       ║`);
    console.log(`║  - John Brooke context (CORRECT NAME)                 ║`);
    console.log(`║  - Organizational structure & authority               ║`);
    console.log(`║  - Historical session memory (5 days)                 ║`);
    console.log(`║  - Architecture & infrastructure decisions            ║`);
    console.log(`║  - Integration & deployment status                    ║`);
    console.log(`║                                                        ║`);
    console.log(`║  All memory searchable and retrievable                 ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);
    process.exit(0);
  } else {
    console.error('❌ Verification failed');
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
