/**
 * Linear Scale Scenario — 25 → 50 → 100 → 150 agents
 *
 * Purpose: Measure how latency and error rates scale as agent count increases.
 * Each step runs for 10 minutes then ramps to the next level.
 */

import { AgentPool }       from '../lib/agent-pool.js';
import { MetricsRegistry } from '../lib/metrics.js';

const STEPS = [
  { agentCount: 25,  durationMs: 10 * 60 * 1000 },
  { agentCount: 50,  durationMs: 10 * 60 * 1000 },
  { agentCount: 100, durationMs: 10 * 60 * 1000 },
  { agentCount: 150, durationMs: 10 * 60 * 1000 },
];

export const config = {
  name:        'linear-scale',
  description: 'Linear scale 25→50→100→150 agents — latency/error scaling analysis',
  workloadIntervalMs:      1_500,
  heartbeatIntervalMs:    15_000,
  consolidationIntervalMs: 90_000,
  requestTimeoutMs:        10_000,
};

export async function run(baseConfig) {
  const merged = { ...config, ...baseConfig };
  const results = [];

  console.log(`\n▶  ${merged.description}`);
  console.log(`   Steps: ${STEPS.map(s => s.agentCount).join(' → ')} agents\n`);

  for (const step of STEPS) {
    console.log(`\n─── Step: ${step.agentCount} agents ─────────────────────────────────`);

    const stepName = `linear-scale-${step.agentCount}`;
    const metrics  = new MetricsRegistry(stepName);
    metrics.start();

    const pool = new AgentPool({ ...merged, metrics });
    pool.startStatusReporter({
      memforgeUrl: merged.memforgeUrl,
      oauth2Url:   merged.oauth2Url,
    });

    await pool.start(step.agentCount, Math.min(30_000, step.agentCount * 200), ({ started, target }) => {
      process.stdout.write(`\r   Ramp-up: ${started}/${target}   `);
    });
    console.log(`\n   ${pool.startedCount} agents active. Running for ${step.durationMs / 60000}m...`);

    const statusInterval = setInterval(() => pool.printStatus(), 15_000);
    await sleep(step.durationMs);
    clearInterval(statusInterval);

    console.log('\n   Stopping agents...');
    await pool.stop();
    metrics.stop();

    metrics.printSummary();
    const path = metrics.save();
    console.log(`   Results saved: ${path}`);
    results.push(metrics);
  }

  // Cross-step comparison
  _printScalingComparison(results);

  return results;
}

function _printScalingComparison(metricsList) {
  console.log('\n' + '═'.repeat(72));
  console.log('  SCALING COMPARISON');
  console.log('═'.repeat(72));
  console.log(
    '  ' + 'Agents'.padEnd(10) +
    'RPS'.padStart(10) +
    'Error%'.padStart(10) +
    'Mem p99'.padStart(10) +
    'Tok p99'.padStart(10)
  );
  console.log('  ' + '─'.repeat(40));

  for (const m of metricsList) {
    const d = m.toJSON();
    const agentCount = d.scenario.split('-').pop();
    console.log(
      '  ' + agentCount.padEnd(10) +
      String(d.overallRps).padStart(10) +
      String(d.errors.errorRatePct.toFixed(3) + '%').padStart(10) +
      String((d.latency.memoryQuery?.p99 ?? '—') + 'ms').padStart(10) +
      String((d.latency.tokenGeneration?.p99 ?? '—') + 'ms').padStart(10)
    );
  }
  console.log('═'.repeat(72) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
