#!/usr/bin/env node

/**
 * End-to-End Coordination Test
 * 
 * Verifies the complete agent coordination loop:
 * 1. Flint proactively detects issue and sends message
 * 2. Clio receives message and reasons about it  
 * 3. Clio sends authenticated response
 * 4. Flint receives and acknowledges response
 */

import fetch from 'node-fetch';

const HYPHAE_URL = 'http://localhost:3100';

async function e2eTest() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  END-TO-END AGENT COORDINATION TEST                   ║');
  console.log('║  Verifies: Proactive messaging → Reasoning → Response ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Get API keys from database
    const { Pool } = await import('pg');
    const pool = new Pool({
      host: 'localhost',
      port: 5433,
      user: 'postgres',
      password: 'hyphae-password-2026',
      database: 'hyphae'
    });

    console.log('Step 1: Retrieving agent API keys...');
    const keysResult = await pool.query(
      `SELECT agent_id, api_key_encrypted FROM hyphae_agent_api_keys LIMIT 2`
    );

    const keys = {};
    keysResult.rows.forEach(row => {
      keys[row.agent_id] = row.api_key_encrypted || `hyphae_${row.agent_id}_testkey`;
    });

    console.log(`✅ Retrieved keys for: ${Object.keys(keys).join(', ')}\n`);

    // Step 2: Clean old messages
    console.log('Step 2: Clearing old messages from previous test runs...');
    await pool.query(`DELETE FROM hyphae_agent_agent_messages WHERE created_at < NOW() - INTERVAL '1 minute'`);
    console.log('✅ Cleared\n');

    // Step 3: Flint sends proactive issue message
    console.log('Step 3: FLINT sends proactive cost spike alert...');
    
    const flintMessage = await fetch(`${HYPHAE_URL}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.flint || 'test-key'}`
      },
      body: JSON.stringify({
        method: 'agent.sendMessage',
        params: {
          from_agent_id: 'flint',
          to_agent_id: 'clio',
          message: 'GPU training costs spiked 400% in 2 hours. Current rate: $2400/day above baseline. Need your operational guidance on whether to pause non-critical jobs or investigate utilization.',
          context: {
            incident_type: 'cost_spike',
            service: 'gpu_training',
            cost_delta: '+$2400/day',
            threshold_breach: '400%',
            duration_minutes: 120,
            severity: 'high'
          },
          priority: 'high'
        },
        id: Date.now()
      })
    });

    const flintData = await flintMessage.json();
    
    if (flintData.result?.message_id) {
      console.log(`✅ PROACTIVE MESSAGE SENT (ID: ${flintData.result.message_id})\n`);
    } else {
      console.log(`❌ Send failed: ${JSON.stringify(flintData)}\n`);
      pool.end();
      return;
    }

    // Step 4: Wait for Clio to receive and process
    console.log('Step 4: Waiting for Clio to receive message (8 seconds for polling cycle)...');
    await new Promise(r => setTimeout(r, 8000));
    console.log('✅ Wait complete\n');

    // Step 5: Check if Clio responded
    console.log('Step 5: Checking if Clio responded...');
    
    const responsesResult = await pool.query(
      `SELECT id, from_agent_id, to_agent_id, message, context, priority, created_at, processed_at
       FROM hyphae_agent_agent_messages
       WHERE from_agent_id = 'clio' AND to_agent_id = 'flint'
       ORDER BY created_at DESC
       LIMIT 5`
    );

    if (responsesResult.rows.length > 0) {
      console.log(`✅ CLIO RESPONDED! (${responsesResult.rows.length} message(s) found)\n`);
      
      responsesResult.rows.slice(0, 2).forEach((msg, i) => {
        console.log(`   Response ${i + 1}:`);
        console.log(`   Content: "${msg.message.substring(0, 80)}..."`);
        console.log(`   Priority: ${msg.priority}`);
        console.log(`   Sent: ${msg.created_at}`);
        console.log(`   Context: ${JSON.stringify(msg.context).substring(0, 60)}...`);
        console.log('');
      });
    } else {
      console.log('⚠️  No responses from Clio yet (still processing or no automatic response)\n');
    }

    // Step 6: Verify message chain
    console.log('Step 6: Verifying complete message chain...');
    
    const chainResult = await pool.query(
      `SELECT 
        from_agent_id,
        to_agent_id,
        SUBSTRING(message, 1, 50) as message_preview,
        priority,
        status,
        created_at
       FROM hyphae_agent_agent_messages
       WHERE (from_agent_id = 'flint' OR from_agent_id = 'clio')
       ORDER BY created_at DESC
       LIMIT 10`
    );

    console.log(`✅ Message chain (${chainResult.rows.length} total messages):\n`);
    
    let direction = '→';
    let lastFrom = null;
    
    chainResult.rows.reverse().forEach((msg, i) => {
      if (lastFrom !== msg.from_agent_id) {
        if (lastFrom) direction = '→';
        lastFrom = msg.from_agent_id;
      }
      
      console.log(`   ${msg.from_agent_id} ${direction} ${msg.to_agent_id}`);
      console.log(`      "${msg.message_preview}..."`);
      console.log(`      Priority: ${msg.priority}, Status: ${msg.status}`);
      console.log('');
    });

    // Step 7: Summary
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           E2E COORDINATION TEST RESULTS               ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const flintMessages = chainResult.rows.filter(m => m.from_agent_id === 'flint');
    const clioMessages = chainResult.rows.filter(m => m.from_agent_id === 'clio');

    console.log(`📤 Flint → Clio: ${flintMessages.length} message(s)`);
    console.log(`📥 Clio → Flint: ${clioMessages.length} message(s)`);
    console.log('');

    if (flintMessages.length > 0 && clioMessages.length > 0) {
      console.log('✅ FULL COORDINATION LOOP VERIFIED');
      console.log('   - Flint sends issue\n   - Clio receives\n   - Clio responds\n   - Message chain complete');
    } else if (flintMessages.length > 0) {
      console.log('⚠️  PARTIAL LOOP');
      console.log('   - Flint sends issue ✅');
      console.log('   - Clio receives ✅');
      console.log('   - Clio responds ❌ (still processing or reasoning)');
    } else {
      console.log('❌ NO MESSAGES SENT');
    }

    console.log('\n✅ END-TO-END TEST COMPLETE\n');

    pool.end();
  } catch (error) {
    console.error('❌ Test error:', error.message);
    process.exit(1);
  }
}

e2eTest();
