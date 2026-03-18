/**
 * Sustained Load Scenario — 100 agents for 1 hour
 *
 * Purpose: Detect memory leaks, connection pool exhaustion, and performance
 * degradation under extended load. Resource snapshots taken every 30s.
 *
 * Key signals to watch:
 *   - Heap memory growth (should plateau, not trend upward)
 *   - Error rate over time (should stay near zero)
 *   - Cache hit rate (should remain >70%)
 *   - DB connection pool (should not exhaust)
 *   - p99 latency drift (should stay <100ms)
 */

import { AgentPool }       from '../lib/agent-pool.js';
import { MetricsRegistry } from '../lib/metrics.js';

export const config = {
  name:        'sustained',
  description: '100 agents sustained for 1 hour — memory leak + degradation detection',
  agentCount:  100,
  durationMs:  60 * 60 * 1000, // 1 hour
  rampUpMs:    5 * 60_000,      // 5 min ramp
  workloadIntervalMs:      1_200,
  heartbeatIntervalMs:    15_000,
  consolidationIntervalMs: 60_000,
  requestTimeoutMs:        10_000,
};

export async function run(baseConfig) {
  const merged = { ...config, ...baseConfig };
  const metrics = new MetricsRegistry(merged.name);

  console.log(`\n▶  ${merged.description}`);
  console.log(`   Agents: ${merged.agentCount} | Duration: 1 hour | Snapshot interval: 30s\n`);

  metrics.start();
  const pool = new AgentPool({ ...merged, metrics });
  pool.startStatusReporter({
    memforgeUrl: merged.memforgeUrl,
    oauth2Url:   merged.oauth2Url,
  });

  // Ramp up
  await pool.start(merged.agentCount, merged.rampUpMs, ({ started, target }) => {
    process.stdout.write(`\r   Ramp-up: ${started}/${target}   `);
  });
  console.log(`\n   ${pool.startedCount} agents running. Monitoring for 1 hour...`);
  console.log('   (Metrics collected every 30s — press Ctrl+C to stop early)\n');

  // Live status + memory trend every 5 minutes
  let checkpoint = 0;
  const checkpointInterval = setInterval(() => {
    checkpoint++;
    const elapsed = (checkpoint * 5).toString().padStart(3);
    const heap = process.memoryUsage().heapUsed;
    const heapMb = (heap / 1024 / 1024).toFixed(1);
    const errs = metrics.errors;
    const snapshots = metrics.agentSnapshots;
    const active = snapshots.length > 0 ? snapshots[snapshots.length - 1].active : pool.activeCount;
    console.log(
      `   [${elapsed}m] Agents: ${active} | Heap: ${heapMb}MB | ` +
      `Errors: ${errs.total} (${errs.errorRate.toFixed(3)}%) | ` +
      `Mem queries: ${metrics.throughput.memoryOps.value}`
    );
  }, 5 * 60_000);

  // Run for duration
  await sleep(merged.durationMs);

  clearInterval(checkpointInterval);

  console.log('\n   Stopping agents...');
  await pool.stop();
  metrics.stop();

  // Memory leak analysis
  _analyzeMemoryTrend(metrics);

  metrics.printSummary();
  const path = metrics.save();
  console.log(`   Results saved: ${path}\n`);

  return metrics;
}

/**
 * Analyzes resource snapshots to detect memory leak patterns.
 * Uses linear regression on heap usage over time.
 */
function _analyzeMemoryTrend(metrics) {
  const snapshots = metrics.resourceSnapshots;
  if (snapshots.length < 4) return;

  const points = snapshots.map((s, i) => ({ x: i, y: s.heapUsedMb }));
  const n = points.length;
  const sumX  = points.reduce((a, p) => a + p.x, 0);
  const sumY  = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const interceptY = (sumY - slope * sumX) / n;

  // Slope in MB per snapshot (snapshot every 30s)
  const mbPerMinute = slope * 2; // 2 snapshots per minute

  const first = snapshots[0].heapUsedMb;
  const last  = snapshots[snapshots.length - 1].heapUsedMb;
  const delta = last - first;

  console.log('\n  MEMORY LEAK ANALYSIS');
  console.log('  ' + '─'.repeat(50));
  console.log(`  Heap start: ${first.toFixed(1)}MB`);
  console.log(`  Heap end:   ${last.toFixed(1)}MB`);
  console.log(`  Total growth: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}MB`);
  console.log(`  Growth rate: ${mbPerMinute > 0 ? '+' : ''}${mbPerMinute.toFixed(2)}MB/min`);

  if (Math.abs(mbPerMinute) < 0.5 && delta < 100) {
    console.log('  ✅ No memory leak detected (heap stable)');
  } else if (delta < 100) {
    console.log('  ⚠️  Minor heap growth — monitor in production');
  } else {
    console.log('  ❌ Potential memory leak — heap grew >100MB');
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
