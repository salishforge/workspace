#!/usr/bin/env node

/**
 * Deploy Agent Credentials
 * 
 * 1. Register Clio and Flint with Hyphae
 * 2. Get Telegram credentials for both
 * 3. Create credentials file for agent use
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGISTRY_URL = 'http://localhost:3108';

async function deployCredentials() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  DEPLOY AGENT CREDENTIALS - CLIO & FLINT              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // =====================================================================
    // STEP 1: Register Agents
    // =====================================================================

    console.log('STEP 1: REGISTER AGENTS WITH HYPHAE');
    console.log('═══════════════════════════════════════════════════════\n');

    const agents = [
      {
        agent_id: 'clio',
        agent_name: 'Clio, Chief of Staff',
        agent_type: 'reasoning',
        contact_telegram: '8201776295'
      },
      {
        agent_id: 'flint',
        agent_name: 'Flint, Chief Technology Officer',
        agent_type: 'reasoning',
        contact_telegram: '8201776295'
      }
    ];

    const agentData = {};

    for (const agent of agents) {
      console.log(`Registering ${agent.agent_id}...`);

      const regResponse = await fetch(`${REGISTRY_URL}/agent/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent)
      });

      const regData = await regResponse.json();

      agentData[agent.agent_id] = {
        agent_id: agent.agent_id,
        agent_name: agent.agent_name,
        master_key: regData.master_key,
        registered_at: new Date().toISOString()
      };

      console.log(`✅ ${agent.agent_id} registered`);
      console.log(`   Master Key: ${regData.master_key.substring(0, 20)}...\n`);
    }

    // =====================================================================
    // STEP 2: Request Telegram Credentials
    // =====================================================================

    console.log('STEP 2: REQUEST TELEGRAM CREDENTIALS');
    console.log('═══════════════════════════════════════════════════════\n');

    for (const agentId of Object.keys(agentData)) {
      console.log(`Getting Telegram credential for ${agentId}...`);

      const credResponse = await fetch(
        `${REGISTRY_URL}/credential/${agentId}/telegram/request`,
        { method: 'POST' }
      );

      const credData = await credResponse.json();

      // Handle both new credential and existing credential responses
      let credentialValue = credData.credential_value;
      let proxyEndpoint = credData.proxy_endpoint;
      
      // If credential already exists, the response won't have credential_value
      // In that case, we need to use what we have
      if (!credentialValue) {
        console.log(`   (Using existing credential)`);
      }

      agentData[agentId].telegram = {
        credential_id: credData.credential_id,
        credential_value: credentialValue || 'N/A - See registry',
        proxy_endpoint: proxyEndpoint || 'http://localhost:3109',
        rate_limit: '30 messages/minute'
      };

      console.log(`✅ ${agentId} credential ready`);
      console.log(`   Credential ID: ${credData.credential_id}`);
      if (credentialValue) {
        console.log(`   Credential Value: ${credentialValue.substring(0, 30)}...`);
      }
      console.log(`   Proxy Endpoint: ${agentData[agentId].telegram.proxy_endpoint}`);
      console.log(`   Rate Limit: ${agentData[agentId].telegram.rate_limit}\n`);
    }

    // =====================================================================
    // STEP 3: Save Credentials File
    // =====================================================================

    console.log('STEP 3: SAVE CREDENTIALS FILE');
    console.log('═══════════════════════════════════════════════════════\n');

    // Create .hyphae directory
    const hyphaePath = path.join('/home/artificium', '.hyphae');
    if (!fs.existsSync(hyphaePath)) {
      fs.mkdirSync(hyphaePath, { recursive: true, mode: 0o700 });
      console.log(`✅ Created ${hyphaePath}`);
    }

    // Save credentials file
    const credFile = path.join(hyphaePath, 'agent-credentials.json');
    fs.writeFileSync(credFile, JSON.stringify(agentData, null, 2), {
      mode: 0o600 // Only readable by owner
    });

    console.log(`✅ Credentials saved to ${credFile}`);
    console.log(`   File permissions: 600 (owner only)\n`);

    // =====================================================================
    // STEP 4: Display Summary
    // =====================================================================

    console.log('═══════════════════════════════════════════════════════');
    console.log('DEPLOYMENT SUMMARY');
    console.log('═══════════════════════════════════════════════════════\n');

    for (const agentId of Object.keys(agentData)) {
      const data = agentData[agentId];
      console.log(`${agentId.toUpperCase()}:`);
      console.log(`  Agent ID: ${data.agent_id}`);
      console.log(`  Status: ✅ Registered`);
      console.log(`  Telegram Credential ID: ${data.telegram.credential_id}`);
      console.log(`  Telegram Proxy: ${data.telegram.proxy_endpoint}`);
      console.log(`  Rate Limit: ${data.telegram.rate_limit}\n`);
    }

    // =====================================================================
    // STEP 5: Test Credentials
    // =====================================================================

    console.log('═══════════════════════════════════════════════════════');
    console.log('STEP 5: TEST CREDENTIALS');
    console.log('═══════════════════════════════════════════════════════\n');

    // Test with Clio's credential
    console.log('Testing Clio credential through proxy...');
    const testResponse = await fetch('http://localhost:3109/telegram/sendMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Credential-ID': agentData.clio.telegram.credential_id
      },
      body: JSON.stringify({
        chat_id: '8201776295',
        message: '✅ [TEST] Clio credentials deployed successfully. Agent authentication works.'
      })
    });

    const testStatus = testResponse.status;
    const testData = await testResponse.json();

    if (testStatus >= 200 && testStatus < 300) {
      console.log(`✅ Credential valid! Proxy accepted request`);
      console.log(`   Status: ${testStatus}`);
      console.log(`   Message forwarded to Telegram\n`);
    } else if (testStatus === 401) {
      console.log(`❌ Credential invalid`);
      console.log(`   Error: ${testData.error}\n`);
    } else {
      console.log(`⚠️  Proxy returned status ${testStatus}`);
      console.log(`   Response: ${JSON.stringify(testData)}\n`);
    }

    // Test with Flint's credential
    console.log('Testing Flint credential through proxy...');
    const flintTest = await fetch('http://localhost:3109/telegram/sendMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Credential-ID': agentData.flint.telegram.credential_id
      },
      body: JSON.stringify({
        chat_id: '8201776295',
        message: '✅ [TEST] Flint credentials deployed successfully. Agent authentication works.'
      })
    });

    const flintStatus = flintTest.status;
    const flintData = await flintTest.json();

    if (flintStatus >= 200 && flintStatus < 300) {
      console.log(`✅ Credential valid! Proxy accepted request`);
      console.log(`   Status: ${flintStatus}`);
      console.log(`   Message forwarded to Telegram\n`);
    } else if (flintStatus === 401) {
      console.log(`❌ Credential invalid`);
      console.log(`   Error: ${flintData.error}\n`);
    } else {
      console.log(`⚠️  Proxy returned status ${flintStatus}`);
      console.log(`   Response: ${JSON.stringify(flintData)}\n`);
    }

    // =====================================================================
    // FINAL STATUS
    // =====================================================================

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ AGENT CREDENTIALS DEPLOYED');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('Next Steps:');
    console.log('1. Agents load credentials from ~/.hyphae/agent-credentials.json');
    console.log('2. Agents make requests to http://localhost:3109/telegram/sendMessage');
    console.log('3. Include X-Credential-ID header in all requests');
    console.log('4. Proxy validates and forwards to Telegram\n');

    process.exit(0);

  } catch (error) {
    console.error(`\n❌ DEPLOYMENT FAILED: ${error.message}\n`);
    process.exit(1);
  }
}

deployCredentials();
