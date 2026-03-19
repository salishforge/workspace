/**
 * Agent Pool — manages N concurrent mock agents
 *
 * Handles staged startup (ramp-up), graceful teardown,
 * aggregate metrics collection, and live status reporting.
 */

import { MockAgent } from './mock-agent.js';

export class AgentPool {
  constructor(config) {
    this.config = config; // merged scenario + base config
    this.agents = [];
    this.startedCount = 0;
    this.failedCount = 0;
    this._statusInterval = null;
  }

  /**
   * Start N agents with optional ramp-up
   * @param {number} count          - Target agent count
   * @param {number} rampUpMs       - Spread startup over this window (0 = immediate)
   * @param {function} onProgress   - Called with ({started, target, failed}) during ramp
   */
  async start(count, rampUpMs = 0, onProgress = null) {
    const intervalMs = rampUpMs > 0 ? rampUpMs / count : 0;

    const startAgent = async (i) => {
      const agent = new MockAgent(i, this.config);
      this.agents.push(agent);
      try {
        await agent.start();
        this.startedCount++;
        this.config.metrics.recordAgentCount(this.startedCount, count);
        if (onProgress) onProgress({ started: this.startedCount, target: count, failed: this.failedCount });
      } catch (err) {
        this.failedCount++;
        this.config.metrics.errors.recordError('agent_startup', err.message?.slice(0, 60));
      }
    };

    if (intervalMs === 0) {
      // Batch startup with limited concurrency (avoid thundering herd)
      const BATCH = Math.min(20, count);
      for (let i = 0; i < count; i += BATCH) {
        const batch = [];
        for (let j = i; j < Math.min(i + BATCH, count); j++) {
          batch.push(startAgent(j));
        }
        await Promise.all(batch);
      }
    } else {
      // Staggered startup
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(
          new Promise(resolve => setTimeout(resolve, i * intervalMs))
            .then(() => startAgent(i))
        );
      }
      await Promise.all(promises);
    }
  }

  /**
   * Gradually add more agents (for burst scenarios)
   * @param {number} additionalCount
   * @param {number} rampUpMs
   */
  async addAgents(additionalCount, rampUpMs = 5_000) {
    const base = this.agents.length;
    const count = additionalCount;
    const intervalMs = rampUpMs / count;

    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(
        new Promise(resolve => setTimeout(resolve, i * intervalMs)).then(async () => {
          const agent = new MockAgent(base + i, this.config);
          this.agents.push(agent);
          try {
            await agent.start();
            this.startedCount++;
            this.config.metrics.recordAgentCount(this.startedCount, base + count);
          } catch (_) { this.failedCount++; }
        })
      );
    }
    await Promise.all(promises);
  }

  /** Stop all agents gracefully */
  async stop() {
    clearInterval(this._statusInterval);
    const BATCH = 20;
    for (let i = 0; i < this.agents.length; i += BATCH) {
      await Promise.all(
        this.agents.slice(i, i + BATCH).map(a => a.stop().catch(() => {}))
      );
    }
    this.agents = [];
  }

  /** Run status reporter that polls service health endpoints every 30s */
  startStatusReporter(services) {
    this._statusInterval = setInterval(async () => {
      await Promise.all([
        _pollCacheStats(services.memforgeUrl, this.config.metrics),
        _pollDbStats(services.oauth2Url, this.config.metrics),
        _pollResourceUsage(this.config.metrics),
      ]);
    }, 30_000);
    if (this._statusInterval.unref) this._statusInterval.unref();
  }

  get activeCount() {
    return this.agents.filter(a => a.isRunning).length;
  }

  printStatus() {
    const active = this.activeCount;
    const total  = this.startedCount;
    const failed = this.failedCount;
    const errs   = this.config.metrics.errors;
    process.stdout.write(
      `\r  Agents: ${active}/${total} active | Errors: ${errs.total} (${errs.errorRate.toFixed(3)}%) | ` +
      `Failed starts: ${failed}    `
    );
  }
}

// ─── Service health pollers ───────────────────────────────────────────────────

async function _pollCacheStats(memforgeUrl, metrics) {
  if (!memforgeUrl) return;
  try {
    const resp = await fetch(`${memforgeUrl}/admin/cache/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return;
    const data = await resp.json();

    // MemForge returns { hits, misses, hitRate } or similar
    const hits   = data.hits   ?? data.cacheHits   ?? 0;
    const misses = data.misses ?? data.cacheMisses  ?? 0;
    const total  = hits + misses;
    const hitRatePct = total > 0 ? (hits / total) * 100 : 0;

    metrics.recordCacheStats({ hits, misses, hitRatePct });
  } catch (_) {}
}

async function _pollDbStats(oauth2Url, metrics) {
  if (!oauth2Url) return;
  try {
    const resp = await fetch(`${oauth2Url}/oauth2/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return;
    const data = await resp.json();

    if (data.database) {
      metrics.recordDbStats({
        activeConnections: data.database.activeConnections ?? data.database.connections ?? 0,
        poolSize:          data.database.poolSize ?? data.database.pool ?? 0,
      });
    }
  } catch (_) {}
}

async function _pollResourceUsage(metrics) {
  const mem = process.memoryUsage();
  metrics.recordResourceUsage({
    heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024 * 10) / 10,
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    rssMb:       Math.round(mem.rss       / 1024 / 1024 * 10) / 10,
    externalMb:  Math.round(mem.external  / 1024 / 1024 * 10) / 10,
  });
}
