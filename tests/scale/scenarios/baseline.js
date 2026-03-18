/**
 * Baseline Scenario — 10 agents for 10 minutes
 *
 * Purpose: Establish baseline performance with minimal load.
 * Provides reference metrics for comparison with higher-load scenarios.
 */

import { AgentPool }       from '../lib/agent-pool.js';
import { MetricsRegistry } from '../lib/metrics.js';

export const config = {
  name:        'baseline',
  description: '10 agents, 10 minutes — baseline performance reference',
  agentCount:  10,
  durationMs:  10 * 60 * 1000, // 10 minutes
  rampUpMs:    10_000,          // 10s ramp-up
  workloadIntervalMs:    2_000, // each agent fires every 2s
  heartbeatIntervalMs:  15_000,
  consolidationIntervalMs: 120_000,
  requestTimeoutMs:     10_000,
};

export async function run(baseConfig) {
  const merged = { ...config, ...baseConfig };
  const metrics = new MetricsRegistry(merged.name);

  console.log(`\n▶  ${merged.description}`);
  console.log(`   Agents: ${merged.agentCount} | Duration: ${merged.durationMs / 60000}m | Ramp: ${merged.rampUpMs / 1000}s\n`);

  metrics.start();
  const pool = new AgentPool({ ...merged, metrics });
  pool.startStatusReporter({
    memforgeUrl: merged.memforgeUrl,
    oauth2Url:   merged.oauth2Url,
  });

  // Ramp up agents
  await pool.start(merged.agentCount, merged.rampUpMs, ({ started, target }) => {
    process.stdout.write(`\r   Starting agents: ${started}/${target}   `);
  });
  console.log(`\n   All ${pool.startedCount} agents running. Collecting metrics for ${merged.durationMs / 60000} minutes...`);

  // Print live status every 15s
  const statusInterval = setInterval(() => pool.printStatus(), 15_000);

  // Run for duration
  await sleep(merged.durationMs);

  clearInterval(statusInterval);

  console.log('\n   Stopping agents...');
  await pool.stop();
  metrics.stop();

  metrics.printSummary();
  const path = metrics.save();
  console.log(`   Results saved: ${path}\n`);

  return metrics;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
