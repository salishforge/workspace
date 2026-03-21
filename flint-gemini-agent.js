#!/usr/bin/env node

/**
 * Flint - Gemini-Powered CTO Agent
 * 
 * Full reasoning agent with Hyphae integration
 */

import HyphaeGeminiAgent from './hyphae-gemini-agent.js';

const GEMINI_API_KEY = process.env.FLINT_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ FLINT_GEMINI_API_KEY or GOOGLE_API_KEY environment variable required');
  process.exit(1);
}

const flint = new HyphaeGeminiAgent(
  'flint',
  'Chief Technology Officer',
  GEMINI_API_KEY
);

async function start() {
  console.log('\n⚡ FLINT AGENT - STARTING\n');

  // Bootstrap with Hyphae
  const bootstrapped = await flint.bootstrap();

  if (!bootstrapped) {
    console.error('Failed to bootstrap with Hyphae');
    process.exit(1);
  }

  // Discover peers
  await flint.discoverPeers();

  // Start autonomous operation
  flint.startOperationLoop();

  console.log(`\n[flint] 🚀 Ready for autonomous operation\n`);
}

start().catch(error => {
  console.error(`Startup error: ${error.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[flint] Shutting down gracefully...');
  process.exit(0);
});
