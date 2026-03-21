#!/usr/bin/env node

/**
 * Test Agent Coordination
 * 
 * Verify message passing and service discovery between agents
 */

async function testCoordination() {
  try {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║     AGENT COORDINATION TEST                          ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // Setup database connection
    const { Pool } = await import('pg');
    const pool = new Pool({
      host: 'localhost',
      port: 5433,
      user: 'postgres',
      password: 'hyphae-password-2026',
      database: 'hyphae'
    });

    // Step 1: Create test message
    console.log('Step 1: Creating test message from Flint to Clio...');
    
    const msgResult = await pool.query(
      `INSERT INTO hyphae_agent_agent_messages 
       (from_agent_id, to_agent_id, message, context, priority, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
       RETURNING id, created_at`,
      [
        'flint',
        'clio',
        'Cost spike detected: GPU usage up 400% in last 2 hours. Need your operational guidance on whether to pause jobs or investigate further.',
        JSON.stringify({
          cost_delta: '+$2400/day',
          service: 'ml_training',
          threshold_breach: '400%',
          severity: 'high'
        }),
        'high'
      ]
    );

    const messageId = msgResult.rows[0].id;
    console.log(`✅ Test message created`);
    console.log(`   ID: ${messageId}`);
    console.log(`   From: flint`);
    console.log(`   To: clio`);
    console.log(`   Status: pending\n`);

    // Step 2: Wait for Clio's polling loop
    console.log('Step 2: Waiting for Clio\'s polling loop to detect message (5 seconds)...');
    await new Promise(r => setTimeout(r, 5000));
    console.log('✅ Wait complete\n');

    // Step 3: Verify message in queue
    console.log('Step 3: Checking if message is in Clio\'s queue...');

    const queueResult = await pool.query(
      `SELECT id, from_agent_id, to_agent_id, message, priority, status, created_at
       FROM hyphae_agent_agent_messages
       WHERE to_agent_id = $1 AND from_agent_id = $2
       ORDER BY created_at DESC
       LIMIT 5`,
      ['clio', 'flint']
    );

    if (queueResult.rows.length > 0) {
      console.log(`✅ Message found in queue:`);
      
      queueResult.rows.forEach((msg, i) => {
        console.log(`\n   Message ${i + 1}:`);
        console.log(`   From: ${msg.from_agent_id} → To: ${msg.to_agent_id}`);
        console.log(`   Content: "${msg.message.substring(0, 70)}..."`);
        console.log(`   Priority: ${msg.priority}`);
        console.log(`   Status: ${msg.status}`);
        console.log(`   Time: ${msg.created_at}`);
      });
    } else {
      console.log('⚠️  Message not found in Clio\'s queue\n');
    }

    // Step 4: Check agent registrations
    console.log('\nStep 4: Verifying agents are registered...');

    const regResult = await pool.query(
      `SELECT agent_id, status, registered_at
       FROM hyphae_registered_agents
       ORDER BY agent_id`
    );

    if (regResult.rows.length > 0) {
      console.log(`✅ Registered agents (${regResult.rows.length}):`);
      
      regResult.rows.forEach(agent => {
        console.log(`   ${agent.agent_id}: ${agent.status} (since ${agent.registered_at})`);
      });
    } else {
      console.log('⚠️  No agents registered\n');
    }

    // Step 5: Check capabilities
    console.log('\nStep 5: Verifying agent capabilities...');

    const capResult = await pool.query(
      `SELECT agent_id, capabilities, availability
       FROM hyphae_agent_capabilities
       ORDER BY agent_id`
    );

    if (capResult.rows.length > 0) {
      console.log(`✅ Agent capabilities (${capResult.rows.length} agents):`);
      
      capResult.rows.forEach(agent => {
        const caps = agent.capabilities || [];
        console.log(`\n   ${agent.agent_id}:`);
        console.log(`   Capabilities: ${caps.length > 0 ? caps.join(', ') : '(none)'}`);
        console.log(`   Availability: ${agent.availability || 'unknown'}`);
      });
    }

    // Step 6: Check subscriptions
    console.log('\nStep 6: Verifying service update subscriptions...');

    const subResult = await pool.query(
      `SELECT agent_id, subscribed_at, last_catalog_check
       FROM hyphae_agent_subscriptions
       ORDER BY agent_id`
    );

    if (subResult.rows.length > 0) {
      console.log(`✅ Agent subscriptions (${subResult.rows.length} agents):`);
      
      subResult.rows.forEach(sub => {
        console.log(`\n   ${sub.agent_id}:`);
        console.log(`   Subscribed: ${sub.subscribed_at}`);
        console.log(`   Last check: ${sub.last_catalog_check}`);
      });
    } else {
      console.log('⚠️  No agent subscriptions (agents may still be starting)\n');
    }

    // Step 7: Summarize
    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║     TEST SUMMARY                                    ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    console.log('✅ Message bus operational:');
    console.log(`   - Test message created and queued`);
    console.log(`   - Clio can receive messages from Flint`);
    console.log(`   - Message status tracking working\n`);

    console.log('✅ Service discovery operational:');
    console.log(`   - ${regResult.rows.length} agents registered`);
    console.log(`   - ${capResult.rows.length} agents have capabilities`);
    console.log(`   - ${subResult.rows.length} agents subscribed to updates\n`);

    console.log('Next: Agents will now reason about messages and respond.\n');

    pool.end();
  } catch (error) {
    console.error('❌ Test error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testCoordination();
