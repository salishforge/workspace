#!/usr/bin/env node

/**
 * Agent Telegram Integration Test
 * 
 * Verify that:
 * 1. Clio can send messages through proxy to Telegram
 * 2. Flint can send messages through proxy to Telegram
 * 3. Rate limiting is enforced
 * 4. Credentials are validated
 */

import fetch from 'node-fetch';
import fs from 'fs';

const PROXY_URL = 'http://localhost:3109';
const CREDENTIALS_FILE = '/home/artificium/.hyphae/agent-credentials.json';

let credentials;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    return false;
  }
}

async function sendTelegramMessage(agentId, message) {
  const cred = credentials[agentId].telegram;

  const response = await fetch(`${PROXY_URL}/telegram/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Credential-ID': cred.credential_id
    },
    body: JSON.stringify({
      chat_id: '8201776295',
      message: message
    })
  });

  const data = await response.json();

  return {
    status: response.status,
    data: data,
    rateLimitRemaining: response.headers.get('x-rate-limit-remaining'),
    latency: response.headers.get('x-proxy-latency')
  };
}

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     AGENT TELEGRAM INTEGRATION TEST                   ║');
  console.log('║     Verify: Agents can send via Hyphae Proxy          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Load credentials
    console.log('Loading agent credentials...');
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      throw new Error(`Credentials file not found: ${CREDENTIALS_FILE}`);
    }

    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    console.log('✅ Credentials loaded\n');

    let passed = 0;
    let failed = 0;

    // Test 1: Clio can send message
    if (await test('Clio sends deployment notification', async () => {
      const result = await sendTelegramMessage(
        'clio',
        '✅ [DEPLOYED] Clio is now operational via Hyphae. Agent-to-Telegram pipeline working.'
      );
      
      if (result.status >= 200 && result.status < 300) {
        console.log(`      Status: ${result.status}`);
        console.log(`      Rate Limit Remaining: ${result.rateLimitRemaining}`);
        console.log(`      Latency: ${result.latency}`);
      } else {
        throw new Error(`Status ${result.status}: ${JSON.stringify(result.data)}`);
      }
    })) {
      passed++;
    } else {
      failed++;
    }

    // Test 2: Flint can send message
    if (await test('Flint sends deployment notification', async () => {
      const result = await sendTelegramMessage(
        'flint',
        '✅ [DEPLOYED] Flint is now operational via Hyphae. CTO automation pipeline ready.'
      );
      
      if (result.status >= 200 && result.status < 300) {
        console.log(`      Status: ${result.status}`);
        console.log(`      Rate Limit Remaining: ${result.rateLimitRemaining}`);
        console.log(`      Latency: ${result.latency}`);
      } else {
        throw new Error(`Status ${result.status}: ${JSON.stringify(result.data)}`);
      }
    })) {
      passed++;
    } else {
      failed++;
    }

    // Test 3: Invalid credential rejected
    if (await test('Proxy rejects invalid credential', async () => {
      const response = await fetch(`${PROXY_URL}/telegram/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Credential-ID': 'invalid-credential-id'
        },
        body: JSON.stringify({
          chat_id: '8201776295',
          message: 'This should fail'
        })
      });

      if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
      }
    })) {
      passed++;
    } else {
      failed++;
    }

    // Test 4: Rate limit enforced
    if (await test('Proxy enforces rate limiting', async () => {
      const cred = credentials.flint.telegram;

      // Try to send 35 messages (limit is 30)
      let hitLimit = false;
      for (let i = 0; i < 35; i++) {
        const response = await fetch(`${PROXY_URL}/telegram/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Credential-ID': cred.credential_id
          },
          body: JSON.stringify({
            chat_id: '8201776295',
            message: `Rate limit test ${i + 1}`
          })
        });

        if (response.status === 429) {
          hitLimit = true;
          break;
        }
      }

      if (!hitLimit) {
        throw new Error('Rate limit not enforced (may need slower test)');
      }
    })) {
      passed++;
    } else {
      failed++;
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║          TEST RESULTS                                  ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}\n`);

    if (failed === 0) {
      console.log('✅ ALL TESTS PASSED');
      console.log('\nAgent Deployment Status:');
      console.log('  🦉 Clio: Deployed via Hyphae, Telegram credentials active');
      console.log('  ⚡ Flint: Deployed via Hyphae, Telegram credentials active');
      console.log('\nAgents can now:');
      console.log('  1. Send messages to John (8201776295) via Telegram');
      console.log('  2. All messages routed through Hyphae Proxy (port 3109)');
      console.log('  3. Rate limited to 30 messages/minute');
      console.log('  4. All requests audited and logged\n');

      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED\n');
      process.exit(1);
    }

  } catch (error) {
    console.error(`\n❌ TEST ERROR: ${error.message}\n`);
    process.exit(1);
  }
}

runTests();
