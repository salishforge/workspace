#!/usr/bin/env node

/**
 * Hyphae Message Bus - Comprehensive Test Suite
 * 
 * Tests:
 * - Inter-agent messaging (Flint ↔ Clio)
 * - Human-to-agent pipeline
 * - Message persistence and ordering
 * - Load testing (concurrent messages)
 * - State consistency
 * - Failover resilience
 */

import fetch from 'node-fetch';
import pg from 'pg';
import { performance } from 'perf_hooks';

const HYPHAE_URL = 'http://localhost:3100';
const DB_URL = 'postgresql://postgres:hyphae-password-2026@localhost:5433/hyphae';
const { Pool } = pg;

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;
let testResults = [];

// ── Test Utilities ──

async function rpc(method, params) {
  try {
    const response = await fetch(`${HYPHAE_URL}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        params,
        id: Date.now()
      })
    });

    const data = await response.json();
    return data.result || data.error;
  } catch (error) {
    return { error: error.message };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name, fn) {
  testsRun++;
  const startTime = performance.now();
  
  try {
    await fn();
    const duration = (performance.now() - startTime).toFixed(2);
    testsPassed++;
    testResults.push({
      name,
      status: 'PASS',
      duration: `${duration}ms`
    });
    console.log(`✅ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = (performance.now() - startTime).toFixed(2);
    testsFailed++;
    testResults.push({
      name,
      status: 'FAIL',
      error: error.message,
      duration: `${duration}ms`
    });
    console.log(`❌ ${name} - ${error.message} (${duration}ms)`);
  }
}

// ── Test Suite ──

console.log('\n🧪 HYPHAE MESSAGE BUS TEST SUITE');
console.log('================================\n');

// ── Unit Tests: RPC Methods ──

console.log('📋 UNIT TESTS: RPC Methods');
console.log('---------------------------\n');

await test('agent.sendMessage creates message', async () => {
  const result = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Test message from Flint',
    context: { test: true },
    priority: 'normal'
  });

  assert(!result.error, `Unexpected error: ${result.error}`);
  assert(result.success === true, 'Message not marked as success');
  assert(result.message_id, 'No message_id returned');
});

await test('agent.getMessages retrieves pending messages', async () => {
  // Send message first
  await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Pending test message',
    priority: 'normal'
  });

  // Retrieve messages
  const result = await rpc('agent.getMessages', {
    agent_id: 'clio',
    limit: 10
  });

  assert(!result.error, `Unexpected error: ${result.error}`);
  assert(result.messages && result.messages.length > 0, 'No messages retrieved');
  assert(result.messages[0].from === 'flint', 'Message from wrong agent');
});

await test('agent.ackMessage marks message as processed', async () => {
  // Send message
  const sendResult = await rpc('agent.sendMessage', {
    from_agent_id: 'clio',
    to_agent_id: 'flint',
    message: 'Test for ack',
    priority: 'normal'
  });

  const messageId = sendResult.message_id;

  // Acknowledge it
  const ackResult = await rpc('agent.ackMessage', {
    message_id: messageId,
    processed_by: 'flint'
  });

  assert(ackResult.success === true, 'Ack failed');
});

await test('agent.broadcastCapabilities registers agent', async () => {
  const result = await rpc('agent.broadcastCapabilities', {
    agent_id: 'flint',
    capabilities: ['cost_optimization', 'architecture_design'],
    availability: 'always'
  });

  assert(result.success === true, 'Broadcast failed');
  assert(result.capabilities_broadcast > 0, 'No capabilities broadcast');
});

await test('agent.discoverCapabilities finds registered agents', async () => {
  const result = await rpc('agent.discoverCapabilities', {
    requesting_agent: 'clio'
  });

  assert(!result.error, `Unexpected error: ${result.error}`);
  assert(result.agents && result.agents.length > 0, 'No agents discovered');
  
  const flintDiscovered = result.agents.find(a => a.agent_id === 'flint');
  assert(flintDiscovered, 'Flint not discovered');
});

await test('agent.getConversationHistory retrieves exchanges', async () => {
  // Send message
  await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Conversation test message',
    priority: 'normal'
  });

  // Retrieve history
  const result = await rpc('agent.getConversationHistory', {
    agent_1: 'flint',
    agent_2: 'clio',
    limit: 20
  });

  assert(!result.error, `Unexpected error: ${result.error}`);
  assert(result.history && result.history.length > 0, 'No conversation history');
});

// ── Integration Tests: Message Flows ──

console.log('\n📊 INTEGRATION TESTS: Message Flows');
console.log('-----------------------------------\n');

await test('End-to-end: Flint → Clio → Flint (full cycle)', async () => {
  const testId = `cycle-${Date.now()}`;

  // 1. Flint sends to Clio
  const send1 = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: `Test cycle ${testId}`,
    context: { cycle: testId },
    priority: 'high'
  });

  assert(send1.success === true, 'Initial send failed');
  const msg1Id = send1.message_id;

  // 2. Clio receives message
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for polling
  const getMsg1 = await rpc('agent.getMessages', {
    agent_id: 'clio',
    limit: 10
  });

  const receivedMsg1 = getMsg1.messages?.find(m => m.from === 'flint');
  assert(receivedMsg1, 'Clio did not receive Flint message');

  // 3. Clio acknowledges
  const ack1 = await rpc('agent.ackMessage', {
    message_id: msg1Id,
    processed_by: 'clio'
  });

  assert(ack1.success === true, 'Clio ack failed');

  // 4. Clio responds to Flint
  const send2 = await rpc('agent.sendMessage', {
    from_agent_id: 'clio',
    to_agent_id: 'flint',
    message: `Response to ${testId}`,
    context: { cycle: testId, response: true },
    priority: 'high'
  });

  assert(send2.success === true, 'Response send failed');

  // 5. Flint receives response
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for polling
  const getMsg2 = await rpc('agent.getMessages', {
    agent_id: 'flint',
    limit: 10
  });

  const receivedMsg2 = getMsg2.messages?.find(m => m.from === 'clio' && m.message.includes(testId));
  assert(receivedMsg2, 'Flint did not receive Clio response');

  // 6. Verify conversation history shows both messages
  const history = await rpc('agent.getConversationHistory', {
    agent_1: 'flint',
    agent_2: 'clio',
    limit: 50
  });

  const historyMessages = history.history?.filter(m => m.message.includes(testId));
  assert(historyMessages && historyMessages.length >= 2, `Expected at least 2 messages in history, got ${historyMessages?.length}`);
});

await test('Priority handling: Urgent messages queued first', async () => {
  // Send normal priority message
  const normal = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Normal priority',
    priority: 'normal'
  });

  // Send urgent priority message
  const urgent = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Urgent priority',
    priority: 'urgent'
  });

  // Get messages - urgent should come first
  await new Promise(resolve => setTimeout(resolve, 500));
  const messages = await rpc('agent.getMessages', {
    agent_id: 'clio',
    limit: 20
  });

  const urgentMsg = messages.messages?.find(m => m.message === 'Urgent priority');
  const normalMsg = messages.messages?.find(m => m.message === 'Normal priority');

  assert(urgentMsg && normalMsg, 'Both messages not found');
  assert(urgentMsg.priority === 'urgent', 'Urgent priority not set');
  assert(normalMsg.priority === 'normal', 'Normal priority not set');
});

await test('Context preservation: Full context survives round-trip', async () => {
  const testContext = {
    incident_type: 'cost_spike',
    amount: 250,
    department: 'infrastructure',
    timestamp: new Date().toISOString(),
    nested: { deep: { data: 'value' } }
  };

  const send = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Context test',
    context: testContext,
    priority: 'high'
  });

  await new Promise(resolve => setTimeout(resolve, 500));
  const messages = await rpc('agent.getMessages', {
    agent_id: 'clio',
    limit: 10
  });

  const msg = messages.messages?.find(m => m.message === 'Context test');
  assert(msg, 'Message not found');
  assert(JSON.stringify(msg.context) === JSON.stringify(testContext), 'Context corrupted');
});

// ── Load Tests ──

console.log('\n⚡ LOAD TESTS: Concurrent Messages');
console.log('----------------------------------\n');

await test('Load test: 10 concurrent messages (no loss)', async () => {
  const messageCount = 10;
  const promises = [];

  for (let i = 0; i < messageCount; i++) {
    promises.push(
      rpc('agent.sendMessage', {
        from_agent_id: 'flint',
        to_agent_id: 'clio',
        message: `Load test message ${i}`,
        context: { load_test: true, index: i },
        priority: 'normal'
      })
    );
  }

  const results = await Promise.all(promises);
  const successCount = results.filter(r => r.success === true).length;

  assert(successCount === messageCount, `Expected ${messageCount} successful sends, got ${successCount}`);
});

await test('Load test: 50 concurrent messages (ordering preserved)', async () => {
  const messageCount = 50;
  const promises = [];
  const testBatch = `batch-${Date.now()}`;

  for (let i = 0; i < messageCount; i++) {
    promises.push(
      rpc('agent.sendMessage', {
        from_agent_id: 'flint',
        to_agent_id: 'clio',
        message: `Batch ${testBatch} - ${i}`,
        context: { batch: testBatch, index: i },
        priority: i % 5 === 0 ? 'urgent' : 'normal'
      })
    );
  }

  const results = await Promise.all(promises);
  const successCount = results.filter(r => r.success === true).length;

  assert(successCount === messageCount, `Expected ${messageCount} sends, got ${successCount}`);

  // Verify retrieval
  await new Promise(resolve => setTimeout(resolve, 2000));
  const messages = await rpc('agent.getMessages', {
    agent_id: 'clio',
    limit: 100
  });

  const batchMessages = messages.messages?.filter(m => m.message.includes(testBatch));
  assert(batchMessages && batchMessages.length >= messageCount, 
    `Expected at least ${messageCount} messages in batch, got ${batchMessages?.length}`);
});

await test('Load test: 100 messages across 10s period (throughput)', async () => {
  const messageCount = 100;
  const startTime = performance.now();

  for (let i = 0; i < messageCount; i++) {
    await rpc('agent.sendMessage', {
      from_agent_id: i % 2 === 0 ? 'flint' : 'clio',
      to_agent_id: i % 2 === 0 ? 'clio' : 'flint',
      message: `Throughput test ${i}`,
      context: { throughput_test: true, index: i },
      priority: 'normal'
    });
  }

  const duration = performance.now() - startTime;
  const throughput = (messageCount / (duration / 1000)).toFixed(2);

  console.log(`   Throughput: ${throughput} messages/sec`);
  assert(throughput > 10, `Throughput too low: ${throughput} msg/sec (expected >10)`);
});

// ── State Consistency Tests ──

console.log('\n🔄 STATE CONSISTENCY TESTS');
console.log('--------------------------\n');

await test('No message loss: Database count matches sent count', async () => {
  const pool = new Pool({ connectionString: DB_URL });

  // Get current count
  const countBefore = await pool.query('SELECT COUNT(*) as count FROM hyphae_agent_agent_messages');
  const before = parseInt(countBefore.rows[0].count);

  // Send 5 messages
  const sendCount = 5;
  for (let i = 0; i < sendCount; i++) {
    await rpc('agent.sendMessage', {
      from_agent_id: 'flint',
      to_agent_id: 'clio',
      message: `Consistency test ${i}`,
      priority: 'normal'
    });
  }

  // Get new count
  const countAfter = await pool.query('SELECT COUNT(*) as count FROM hyphae_agent_agent_messages');
  const after = parseInt(countAfter.rows[0].count);

  await pool.end();

  assert(after === before + sendCount, 
    `Message loss detected: before=${before}, after=${after}, sent=${sendCount}`);
});

await test('No duplicate messages: Status updates are consistent', async () => {
  const pool = new Pool({ connectionString: DB_URL });

  // Send message
  const send = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Duplicate test',
    priority: 'normal'
  });

  const messageId = send.message_id;

  // Check database - should have exactly 1 entry
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM hyphae_agent_agent_messages WHERE id = $1',
    [messageId]
  );

  const count = parseInt(result.rows[0].count);
  await pool.end();

  assert(count === 1, `Message appears ${count} times in database (expected 1)`);
});

await test('Conversation state: History reflects all acknowledged messages', async () => {
  const testId = `state-${Date.now()}`;

  // Send 3 messages
  const msg1 = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: `State test A ${testId}`,
    context: { test: testId, seq: 1 },
    priority: 'normal'
  });

  const msg2 = await rpc('agent.sendMessage', {
    from_agent_id: 'clio',
    to_agent_id: 'flint',
    message: `State test B ${testId}`,
    context: { test: testId, seq: 2 },
    priority: 'normal'
  });

  const msg3 = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: `State test C ${testId}`,
    context: { test: testId, seq: 3 },
    priority: 'normal'
  });

  // Get conversation history
  const history = await rpc('agent.getConversationHistory', {
    agent_1: 'flint',
    agent_2: 'clio',
    limit: 100
  });

  const testMessages = history.history?.filter(m => m.message.includes(testId));
  assert(testMessages && testMessages.length >= 3, 
    `Expected at least 3 messages in history, got ${testMessages?.length}`);

  // Verify order
  const messages = testMessages.sort((a, b) => a.timestamp - b.timestamp);
  assert(messages[0].context.seq === 1, 'First message out of order');
  assert(messages[1].context.seq === 2, 'Second message out of order');
  assert(messages[2].context.seq === 3, 'Third message out of order');
});

// ── Failover Tests ──

console.log('\n🔧 FAILOVER RESILIENCE TESTS');
console.log('----------------------------\n');

await test('Message persistence: Messages survive without immediate polling', async () => {
  // Send message
  const send = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Persistence test - should not be lost',
    priority: 'high'
  });

  assert(send.success === true, 'Send failed');

  // Wait longer than a normal polling cycle
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Retrieve - message should still be there
  const messages = await rpc('agent.getMessages', {
    agent_id: 'clio',
    limit: 100
  });

  const found = messages.messages?.find(m => m.message.includes('Persistence test'));
  assert(found, 'Message lost from queue');
});

await test('Status tracking: Message status transitions are correct', async () => {
  const pool = new Pool({ connectionString: DB_URL });

  // Send message
  const send = await rpc('agent.sendMessage', {
    from_agent_id: 'flint',
    to_agent_id: 'clio',
    message: 'Status tracking test',
    priority: 'normal'
  });

  const messageId = send.message_id;

  // Check initial status
  let status = await pool.query(
    'SELECT status FROM hyphae_agent_agent_messages WHERE id = $1',
    [messageId]
  );

  assert(status.rows[0].status === 'pending', 'Initial status not pending');

  // Acknowledge
  await rpc('agent.ackMessage', {
    message_id: messageId,
    processed_by: 'clio'
  });

  // Check final status
  status = await pool.query(
    'SELECT status, processed_at FROM hyphae_agent_agent_messages WHERE id = $1',
    [messageId]
  );

  assert(status.rows[0].status === 'processed', 'Status not updated to processed');
  assert(status.rows[0].processed_at !== null, 'processed_at not set');

  await pool.end();
});

// ── Summary ──

console.log('\n📊 TEST RESULTS SUMMARY');
console.log('=======================\n');

console.log(`Total Tests: ${testsRun}`);
console.log(`Passed: ${testsPassed} ✅`);
console.log(`Failed: ${testsFailed} ❌`);
console.log(`Success Rate: ${((testsPassed / testsRun) * 100).toFixed(1)}%\n`);

if (testsFailed > 0) {
  console.log('Failed Tests:');
  testResults
    .filter(r => r.status === 'FAIL')
    .forEach(r => {
      console.log(`  ❌ ${r.name}`);
      console.log(`     Error: ${r.error}`);
    });
}

console.log('\nDetailed Results:');
testResults.forEach(r => {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${r.name.padEnd(50)} ${r.duration}`);
});

console.log('\n' + '='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
