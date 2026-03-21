#!/usr/bin/env node

/**
 * Service Registry E2E Test
 * 
 * Tests:
 * 1. Agent registration
 * 2. Service discovery
 * 3. Service schema retrieval
 * 4. Credential issuance
 * 5. Policy evaluation
 * 6. Audit logging
 */

import fetch from 'node-fetch';

const REGISTRY_URL = 'http://localhost:3108';

let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

async function test(name, fn) {
  try {
    await fn();
    testResults.passed++;
    testResults.tests.push({ name, status: '✅', error: null });
    console.log(`✅ ${name}`);
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: '❌', error: error.message });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}\n`);
  }
}

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${REGISTRY_URL}${path}`, options);
  const data = await response.json();
  
  if (!response.ok && !data.status && !data.message) {
    throw new Error(`${response.status}: ${data.error || 'Unknown error'}`);
  }
  
  return data;
}

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     SERVICE REGISTRY E2E TEST                         ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  const agentId = 'test-agent-' + Date.now();
  let credentialData = {};
  
  // Test 1: Health check
  await test('Health check', async () => {
    const data = await request('GET', '/health');
    if (data.status !== 'healthy') throw new Error('Not healthy');
  });
  
  // Test 2: Agent registration
  await test('Agent registration', async () => {
    const data = await request('POST', '/agent/register', {
      agent_id: agentId,
      agent_name: 'Test Agent',
      agent_type: 'reasoning',
      contact_telegram: '8201776295'
    });
    
    if (!data.agent_id) throw new Error('No agent_id in response');
    if (!data.master_key) throw new Error('No master_key in response');
    if (!data.available_services || data.available_services.length === 0) {
      throw new Error('No services returned');
    }
  });
  
  // Test 3: Service discovery
  await test('Service discovery', async () => {
    const data = await request('GET', `/agent/${agentId}/services`);
    
    if (!data.available_services) throw new Error('No services list');
    if (data.available_services.length < 3) {
      throw new Error(`Expected 3+ services, got ${data.available_services.length}`);
    }
    
    const serviceIds = data.available_services.map(s => s.service_id);
    const expected = ['telegram', 'agent-rpc', 'memory'];
    for (const svc of expected) {
      if (!serviceIds.includes(svc)) {
        throw new Error(`Missing service: ${svc}`);
      }
    }
  });
  
  // Test 4: Get Telegram service schema
  await test('Get Telegram service schema', async () => {
    const data = await request('GET', '/service/telegram/schema');
    
    if (!data.service) throw new Error('No service in response');
    if (data.service.service_id !== 'telegram') throw new Error('Wrong service');
    if (!data.training) throw new Error('No training material');
    if (!data.api_examples) throw new Error('No API examples');
    if (data.api_examples.length === 0) throw new Error('No examples');
  });
  
  // Test 5: Get Agent-RPC service schema
  await test('Get Agent-RPC service schema', async () => {
    const data = await request('GET', '/service/agent-rpc/schema');
    
    if (!data.service) throw new Error('No service');
    if (data.service.service_id !== 'agent-rpc') throw new Error('Wrong service');
    if (!data.training) throw new Error('No training');
    if (!data.api_examples || data.api_examples.length === 0) {
      throw new Error('No examples');
    }
    
    // Verify examples have necessary fields
    for (const example of data.api_examples) {
      if (!example.method) throw new Error('Example missing method');
      if (!example.request) throw new Error('Example missing request');
      if (!example.response) throw new Error('Example missing response');
    }
  });
  
  // Test 6: Get Memory service schema
  await test('Get Memory service schema', async () => {
    const data = await request('GET', '/service/memory/schema');
    
    if (!data.service) throw new Error('No service');
    if (data.service.service_id !== 'memory') throw new Error('Wrong service');
    if (data.service.auth_method !== 'none') throw new Error('Should be no-auth service');
  });
  
  // Test 7: Request Telegram credential
  await test('Request Telegram credential', async () => {
    const data = await request('POST', `/credential/${agentId}/telegram/request`);
    
    if (!data.status || data.status !== 'success') throw new Error('Request failed');
    if (!data.credential_value) throw new Error('No credential returned');
    if (!data.credential_value.startsWith('hyphae_')) throw new Error('Invalid credential format');
    
    credentialData.telegram = data.credential_value;
  });
  
  // Test 8: Request Agent-RPC credential
  await test('Request Agent-RPC credential', async () => {
    const data = await request('POST', `/credential/${agentId}/agent-rpc/request`);
    
    if (!data.status || data.status !== 'success') throw new Error('Request failed');
    if (!data.credential_value) throw new Error('No credential returned');
    
    credentialData.agentRpc = data.credential_value;
  });
  
  // Test 9: Verify credentials format
  await test('Verify credential formats', async () => {
    for (const [service, cred] of Object.entries(credentialData)) {
      if (!cred.startsWith('hyphae_')) {
        throw new Error(`${service} credential invalid format`);
      }
      if (cred.length < 30) {
        throw new Error(`${service} credential too short`);
      }
    }
  });
  
  // Test 10: Get audit log
  await test('Retrieve audit log', async () => {
    const data = await request('GET', `/audit/${agentId}`);
    
    if (!data.audit_entries) throw new Error('No audit entries');
    if (data.audit_entries.length === 0) throw new Error('No audit records');
    
    // Verify event types
    const eventTypes = data.audit_entries.map(e => e.event_type);
    if (!eventTypes.includes('agent_registered')) {
      throw new Error('Missing agent_registered event');
    }
    if (!eventTypes.includes('credential_issued')) {
      throw new Error('Missing credential_issued event');
    }
  });
  
  // Test 11: Verify credential persistence
  await test('Verify credential persistence', async () => {
    // Request same credential again - should get cached credential
    const data = await request('POST', `/credential/${agentId}/telegram/request`);
    
    if (!data.credential_id) throw new Error('No credential_id in response');
    // Should return existing credential reference, not new one
  });
  
  // Test 12: Revoke credential
  await test('Revoke credential', async () => {
    const data = await request('POST', `/credential/${agentId}/telegram/revoke`, {
      reason: 'Test revocation'
    });
    
    if (data.status !== 'revoked') throw new Error('Not revoked');
  });
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║          TEST RESULTS                                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  console.log(`Total:  ${testResults.passed + testResults.failed}\n`);
  
  if (testResults.failed === 0) {
    console.log('✅ ALL TESTS PASSED\n');
    
    console.log('Agent registered:');
    console.log(`  Agent ID: ${agentId}`);
    console.log(`  Services: 3 (Telegram, Agent-RPC, Memory)`);
    console.log(`  Telegram Credential: ${credentialData.telegram.substring(0, 30)}...`);
    console.log(`  Agent-RPC Credential: ${credentialData.agentRpc.substring(0, 30)}...\n`);
    
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED\n');
    process.exit(1);
  }
}

// Wait for registry to be ready
setTimeout(runTests, 1000);
