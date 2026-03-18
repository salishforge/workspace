/**
 * Peak Burst Scenario — 100 agents + 50% spike for 5 minutes
 *
 * Purpose: Validate behavior during sudden load spikes.
 * Timeline:
 *   0:00 – 5:00   Ramp to 100 agents (baseline)
 *   5:00 – 15:00  Sustain 100 agents
 *   15:00 – 20:00 Burst: add 50 more agents (150 total)
 *   20:00 – 25:00 Sustain burst (150 agents)
 *   25:00 – 30:00 Scale back to 100 (natural attrition)
 */

import { AgentPool }       from '../lib/agent-pool.js';
import { MetricsRegistry } from '../lib/metrics.js';

export const config = {
  name:        'peak-burst',
  description: '100 agents baseline → +50% burst spike → sustained burst',
  workloadIntervalMs:      1_000,
  heartbeatIntervalMs:    12_000,
  consolidationIntervalMs: 90_000,
  requestTimeoutMs:        10_000,
};

export async function run(baseConfig) {
  const merged = { ...config, ...baseConfig };
  const metrics = new MetricsRegistry(merged.name);

  console.log(`\n▶  ${merged.description}`);
  console.log('   Timeline: 5m ramp | 10m baseline | 5m add burst | 5m sustain burst | 5m scale-down\n');

  metrics.start();
  const pool = new AgentPool({ ...merged, metrics });
  pool.startStatusReporter({
    memforgeUrl: merged.memforgeUrl,
    oauth2Url:   merged.oauth2Url,
  });

  const statusInterval = setInterval(() => pool.printStatus(), 15_000);

  // Phase 1: Ramp to 100 (5 minutes ramp)
  console.log('   Phase 1: Ramping to 100 agents...');
  await pool.start(100, 5 * 60_000, ({ started, target }) => {
    process.stdout.write(`\r   Ramp-up: ${started}/${target}   `);
  });
  console.log(`\n   ${pool.startedCount} agents active.`);
  _annotate(metrics, 'ramp_complete', 100);

  // Phase 2: Sustain baseline (10 minutes)
  console.log('   Phase 2: Sustain baseline 100 agents for 10 minutes...');
  await sleep(10 * 60_000);
  _annotate(metrics, 'baseline_end', 100);

  // Phase 3: Burst — add 50 more agents over 2 minutes
  console.log('\n   Phase 3: BURST — adding 50 agents (150 total)...');
  await pool.addAgents(50, 2 * 60_000);
  console.log(`   ${pool.startedCount} agents active (burst).`);
  _annotate(metrics, 'burst_start', 150);

  // Phase 4: Sustain burst (5 minutes)
  console.log('   Phase 4: Sustaining burst load for 5 minutes...');
  await sleep(5 * 60_000);
  _annotate(metrics, 'burst_peak_end', 150);

  // Phase 5: Scale back — stop 50 burst agents over 5 minutes
  console.log('\n   Phase 5: Scaling back to 100 agents...');
  await _stopAgentsGradually(pool, 50, 5 * 60_000);
  _annotate(metrics, 'scale_down_complete', 100);
  console.log(`   ${pool.activeCount} agents active (post-burst).`);

  clearInterval(statusInterval);

  console.log('\n   Stopping remaining agents...');
  await pool.stop();
  metrics.stop();

  metrics.printSummary();
  const path = metrics.save();
  console.log(`   Results saved: ${path}\n`);

  return metrics;
}

async function _stopAgentsGradually(pool, count, durationMs) {
  const intervalMs = durationMs / count;
  const agents = pool.agents.filter(a => a.isRunning).slice(0, count);
  for (const agent of agents) {
    await agent.stop();
    await sleep(intervalMs);
  }
}

function _annotate(metrics, phase, agentCount) {
  // Record a phase marker in agent snapshots with a special flag
  metrics.agentSnapshots.push({
    ts:    Date.now(),
    phase,
    active: agentCount,
    total:  agentCount,
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
