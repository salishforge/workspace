#!/usr/bin/env node

/**
 * MemForge Agent Integration Test Suite
 * 
 * Tests complete memory sync/retrieval pipeline
 * - Credential validation
 * - Memory sync
 * - Memory retrieval
 * - Search functionality
 * - Agent bootstrap integration
 */

import fetch from 'node-fetch';

const MEMFORGE_API = 'http://100.97.161.7:3107';
const DB_CONFIG = {
  host: '100.97.161.7',
  port: 5433,
  database: 'hyphae',
  user: 'postgres',
  password: 'hyphae-password-2026'
};

let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────

async function getAgentApiKey(agentId) {
  const pg = await import('pg');
  const { Pool } = pg.default;
  const pool = new Pool(DB_CONFIG);

  try {
    const result = await pool.query(
      'SELECT api_key FROM hyphae_memory_agent_credentials WHERE agent_id = $1',
      [agentId]
    );
    const key = result.rows[0]?.api_key;
    await pool.end();
    return key;
  } catch (error) {
    console.error('Error fetching API key:', error.message);
    await pool.end();
    return null;
  }
}

async function test(name, fn) {
  try {
    await fn();
    testResults.passed++;
    testResults.tests.push({ name, status: 'PASS' });
    console.log(`✅ ${name}`);
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: 'FAIL', error: error.message });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log(`╔════════════════════════════════════════════════════════╗`);
  console.log(`║  MEMFORGE AGENT INTEGRATION TEST SUITE                ║`);
  console.log(`║  Testing memory sync + retrieval pipeline             ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  // Test 1: Health check
  await test('Memforge API is responding', async () => {
    const response = await fetch(`${MEMFORGE_API}/health`);
    assert(response.ok, 'Health endpoint not responding');
    const data = await response.json();
    assert(data.status === 'ok', 'Health check failed');
  });

  // Test 2: Get Clio API key
  let clioApiKey;
  await test('Fetch Clio credentials from database', async () => {
    clioApiKey = await getAgentApiKey('clio');
    assert(clioApiKey, 'Could not fetch Clio API key');
  });

  // Test 3: Memory sync
  let consolidationId;
  await test('Sync memory to MemForge (Clio)', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clioApiKey}`
      },
      body: JSON.stringify({
        agent_id: 'clio',
        files: {
          'SOUL.md': '# Clio - Chief of Staff\nI coordinate the organization.',
          'USER.md': '# John Brooke - CEO\nCybersecurity strategist, father, tinkerer.',
          'MEMORY.md': '# Long-term memory from March 21, 2026\nMemForge integration complete.'
        },
        metadata: {
          sync_time: new Date().toISOString(),
          source: 'test-memforge-agent-integration.js'
        }
      })
    });

    assert(response.ok, `Sync failed: ${response.status}`);
    const data = await response.json();
    assert(data.status === 'success', 'Sync response not success');
    assert(data.files_synced === 3, 'Not all files synced');
    consolidationId = data.consolidation_id;
  });

  // Test 4: Memory retrieval
  let retrievedMemory;
  await test('Retrieve memory from MemForge (Clio)', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/agent/clio`, {
      headers: {
        'Authorization': `Bearer ${clioApiKey}`
      }
    });

    assert(response.ok, `Retrieval failed: ${response.status}`);
    const data = await response.json();
    assert(data.status === 'success', 'Retrieval response not success');
    assert(data.file_count === 3, 'Not all files retrieved');
    assert(data.memory['SOUL.md'], 'SOUL.md not in memory');
    assert(data.memory['USER.md'], 'USER.md not in memory');
    assert(data.memory['MEMORY.md'], 'MEMORY.md not in memory');
    retrievedMemory = data.memory;
  });

  // Test 5: Verify content
  await test('Verify retrieved memory content is correct', async () => {
    assert(
      retrievedMemory['SOUL.md'].content.includes('Chief of Staff'),
      'SOUL.md content incorrect'
    );
    assert(
      retrievedMemory['USER.md'].content.includes('CEO'),
      'USER.md content incorrect'
    );
    assert(
      retrievedMemory['MEMORY.md'].content.includes('integration'),
      'MEMORY.md content incorrect'
    );
  });

  // Test 6: Search functionality
  await test('Search memory for "CEO"', async () => {
    const response = await fetch(
      `${MEMFORGE_API}/api/memory/agent/clio/search?q=CEO`,
      {
        headers: {
          'Authorization': `Bearer ${clioApiKey}`
        }
      }
    );

    assert(response.ok, `Search failed: ${response.status}`);
    const data = await response.json();
    assert(data.status === 'success', 'Search response not success');
    assert(data.result_count > 0, 'No results found for CEO');
  });

  // Test 7: Unauthorized access
  await test('Reject unauthorized access (bad API key)', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/agent/clio`, {
      headers: {
        'Authorization': 'Bearer invalid_key_12345'
      }
    });

    assert(response.status === 401, 'Should return 401 for bad API key');
  });

  // Test 8: Agent ID mismatch
  await test('Reject agent ID mismatch', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clioApiKey}`
      },
      body: JSON.stringify({
        agent_id: 'flint', // Mismatch - Clio key with Flint agent ID
        files: { 'test.md': 'content' }
      })
    });

    assert(response.status === 403, 'Should return 403 for agent ID mismatch');
  });

  // Test 9: Flint credentials
  let flintApiKey;
  await test('Fetch Flint credentials', async () => {
    flintApiKey = await getAgentApiKey('flint');
    assert(flintApiKey, 'Could not fetch Flint API key');
  });

  // Test 10: Flint memory sync
  await test('Sync Flint memory', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${flintApiKey}`
      },
      body: JSON.stringify({
        agent_id: 'flint',
        files: {
          'SOUL.md': '# Flint - CTO\nI make infrastructure decisions.',
          'MEMORY.md': 'Flint operational memory March 21, 2026'
        }
      })
    });

    assert(response.ok, 'Flint sync failed');
    const data = await response.json();
    assert(data.status === 'success', 'Flint sync not success');
  });

  // Test 11: Flint retrieval
  await test('Retrieve Flint memory', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/agent/flint`, {
      headers: {
        'Authorization': `Bearer ${flintApiKey}`
      }
    });

    assert(response.ok, 'Flint retrieval failed');
    const data = await response.json();
    assert(data.memory['SOUL.md'], 'Flint SOUL.md not found');
  });

  // Test 12: Memory isolation (Clio cannot access Flint's memory)
  await test('Enforce memory isolation (Clio cannot access Flint memory)', async () => {
    const response = await fetch(`${MEMFORGE_API}/api/memory/agent/flint`, {
      headers: {
        'Authorization': `Bearer ${clioApiKey}` // Clio's key
      }
    });

    assert(response.status === 403, 'Should prevent cross-agent access');
  });
}

// ─────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────

async function printResults() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  TEST RESULTS                                          ║`);
  console.log(`╚════════════════════════════════════════════════════════╝\n`);

  for (const test of testResults.tests) {
    const icon = test.status === 'PASS' ? '✅' : '❌';
    console.log(`${icon} ${test.name}`);
    if (test.error) {
      console.log(`   ${test.error}`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Passed: ${testResults.passed}`);
  console.log(`  Failed: ${testResults.failed}`);
  console.log(`  Total:  ${testResults.passed + testResults.failed}`);

  const passRate = (testResults.passed / (testResults.passed + testResults.failed) * 100).toFixed(1);
  console.log(`  Pass Rate: ${passRate}%`);

  if (testResults.failed === 0) {
    console.log(`\n🎉 ALL TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(`\n⚠️  SOME TESTS FAILED`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

(async () => {
  await runTests();
  await printResults();
})();
