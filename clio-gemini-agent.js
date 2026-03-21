#!/usr/bin/env node

/**
 * Clio - Gemini-Powered Chief of Staff Agent
 * 
 * Full reasoning agent with Hyphae integration
 */

import HyphaeGeminiAgent from './hyphae-gemini-agent.js';

const GEMINI_API_KEY = process.env.CLIO_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ CLIO_GEMINI_API_KEY or GOOGLE_API_KEY environment variable required');
  process.exit(1);
}

const clio = new HyphaeGeminiAgent(
  'clio',
  'Chief of Staff',
  GEMINI_API_KEY
);

async function start() {
  console.log('\n🦉 CLIO AGENT - STARTING\n');

  // Bootstrap with Hyphae
  const bootstrapped = await clio.bootstrap();

  if (!bootstrapped) {
    console.error('Failed to bootstrap with Hyphae');
    process.exit(1);
  }

  // Discover peers
  await clio.discoverPeers();

  // Start autonomous operation
  clio.startOperationLoop();

  console.log(`\n[clio] 🚀 Ready for autonomous operation\n`);
}

start().catch(error => {
  console.error(`Startup error: ${error.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[clio] Shutting down gracefully...');
  process.exit(0);
});
