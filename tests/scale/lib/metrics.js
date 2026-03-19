/**
 * Metrics Collection for Salish Forge Scale Tests
 *
 * Collects latency histograms, throughput counters, error rates, and
 * resource snapshots during load tests. Thread-safe for concurrent agents.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Histogram ───────────────────────────────────────────────────────────────

export class Histogram {
  constructor(name) {
    this.name = name;
    this.values = [];
    this.overflowCount = 0;
    this.MAX_SAMPLES = 200_000; // cap memory at ~1.6MB per histogram
  }

  record(valueMs) {
    if (this.values.length >= this.MAX_SAMPLES) {
      this.overflowCount++;
      // reservoir sampling: replace random existing sample
      const idx = Math.floor(Math.random() * this.MAX_SAMPLES);
      this.values[idx] = valueMs;
    } else {
      this.values.push(valueMs);
    }
  }

  percentile(p) {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return Math.round(sorted[idx] * 100) / 100;
  }

  get count() { return this.values.length + this.overflowCount; }
  get sum()   { return this.values.reduce((a, b) => a + b, 0); }
  get mean()  { return this.values.length > 0 ? this.sum / this.values.length : 0; }
  get min()   { return this.values.length > 0 ? Math.min(...this.values) : 0; }
  get max()   { return this.values.length > 0 ? Math.max(...this.values) : 0; }

  summary() {
    return {
      count: this.count,
      mean:  Math.round(this.mean * 100) / 100,
      min:   this.min,
      max:   this.max,
      p50:   this.percentile(50),
      p95:   this.percentile(95),
      p99:   this.percentile(99),
    };
  }
}

// ─── Counter ─────────────────────────────────────────────────────────────────

export class Counter {
  constructor(name) {
    this.name = name;
    this._value = 0;
    this._rate_window = []; // [{ts, value}] for rate calculation
  }

  inc(amount = 1) {
    this._value += amount;
    this._rate_window.push({ ts: Date.now(), value: amount });
    // keep only last 60 seconds of samples
    const cutoff = Date.now() - 60_000;
    this._rate_window = this._rate_window.filter(s => s.ts >= cutoff);
  }

  get value() { return this._value; }

  /** Returns requests per second over the last N seconds */
  ratePerSecond(windowMs = 10_000) {
    const cutoff = Date.now() - windowMs;
    const recent = this._rate_window.filter(s => s.ts >= cutoff);
    const total = recent.reduce((a, s) => a + s.value, 0);
    return Math.round((total / (windowMs / 1000)) * 100) / 100;
  }
}

// ─── ErrorTracker ─────────────────────────────────────────────────────────────

export class ErrorTracker {
  constructor() {
    this.errors = {}; // { errorType: count }
    this.total = 0;
    this.requests = 0;
  }

  recordRequest() { this.requests++; }

  recordError(type = 'unknown', detail = '') {
    const key = `${type}${detail ? `:${detail}` : ''}`;
    this.errors[key] = (this.errors[key] || 0) + 1;
    this.total++;
  }

  get errorRate() {
    return this.requests > 0 ? (this.total / this.requests) * 100 : 0;
  }

  summary() {
    return {
      total: this.total,
      requests: this.requests,
      errorRatePct: Math.round(this.errorRate * 1000) / 1000,
      byType: { ...this.errors },
    };
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/** Captures point-in-time system state every N seconds */
export class SnapshotCollector {
  constructor(intervalMs = 30_000) {
    this.intervalMs = intervalMs;
    this.snapshots = [];
    this._timer = null;
    this._getStatsFn = null;
  }

  start(getStatsFn) {
    this._getStatsFn = getStatsFn;
    this._timer = setInterval(async () => {
      try {
        const stats = await getStatsFn();
        this.snapshots.push({ ts: Date.now(), ...stats });
      } catch (_) { /* non-fatal */ }
    }, this.intervalMs);
    // Unref so it doesn't block process exit
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  get latest() { return this.snapshots[this.snapshots.length - 1] ?? null; }
}

// ─── MetricsRegistry ─────────────────────────────────────────────────────────

export class MetricsRegistry {
  constructor(scenarioName) {
    this.scenarioName = scenarioName;
    this.startTime = null;
    this.endTime = null;

    // Per-operation histograms
    this.latency = {
      tokenGeneration:      new Histogram('token_generation_ms'),
      tokenRefresh:         new Histogram('token_refresh_ms'),
      serviceRegistration:  new Histogram('service_registration_ms'),
      serviceHeartbeat:     new Histogram('service_heartbeat_ms'),
      serviceDiscovery:     new Histogram('service_discovery_ms'),
      serviceDeregistration:new Histogram('service_deregistration_ms'),
      memoryWrite:          new Histogram('memory_write_ms'),
      memoryQuery:          new Histogram('memory_query_ms'),
      memoryConsolidate:    new Histogram('memory_consolidate_ms'),
      scopeValidation:      new Histogram('scope_validation_ms'),
      cacheHit:             new Histogram('cache_hit_ms'),
      cacheMiss:            new Histogram('cache_miss_ms'),
    };

    // Counters
    this.throughput = {
      total:               new Counter('total_requests'),
      tokenGeneration:     new Counter('token_gen_requests'),
      memoryOps:           new Counter('memory_ops'),
      serviceOps:          new Counter('service_ops'),
    };

    // Errors
    this.errors = new ErrorTracker();

    // Agent tracking
    this.agentSnapshots  = []; // [{ts, active, total}]
    this.resourceSnapshots = []; // [{ts, memMb, cpuPct, ...}]

    // Cache + DB snapshots from service health endpoints
    this.cacheSnapshots = []; // [{ts, hitRate, hits, misses}]
    this.dbSnapshots    = []; // [{ts, activeConnections, poolSize}]
  }

  start() {
    this.startTime = Date.now();
  }

  stop() {
    this.endTime = Date.now();
  }

  recordAgentCount(active, total) {
    this.agentSnapshots.push({ ts: Date.now(), active, total });
  }

  recordCacheStats(stats) {
    this.cacheSnapshots.push({ ts: Date.now(), ...stats });
  }

  recordDbStats(stats) {
    this.dbSnapshots.push({ ts: Date.now(), ...stats });
  }

  recordResourceUsage(stats) {
    this.resourceSnapshots.push({ ts: Date.now(), ...stats });
  }

  get durationMs() {
    return (this.endTime ?? Date.now()) - (this.startTime ?? Date.now());
  }

  /** Full metrics snapshot for reporting */
  toJSON() {
    const latencySummaries = {};
    for (const [op, hist] of Object.entries(this.latency)) {
      if (hist.count > 0) latencySummaries[op] = hist.summary();
    }

    const throughputSummaries = {};
    for (const [op, ctr] of Object.entries(this.throughput)) {
      throughputSummaries[op] = {
        total: ctr.value,
        rps: ctr.ratePerSecond(),
      };
    }

    const overallRps = this.throughput.total.value / (this.durationMs / 1000);

    return {
      scenario:       this.scenarioName,
      startTime:      new Date(this.startTime).toISOString(),
      endTime:        this.endTime ? new Date(this.endTime).toISOString() : null,
      durationMs:     this.durationMs,
      overallRps:     Math.round(overallRps * 100) / 100,
      latency:        latencySummaries,
      throughput:     throughputSummaries,
      errors:         this.errors.summary(),
      agentSnapshots: this.agentSnapshots,
      cacheSnapshots: this.cacheSnapshots,
      dbSnapshots:    this.dbSnapshots,
      resourceSnapshots: this.resourceSnapshots,
    };
  }

  /** Save results to disk */
  save(outputDir = resolve(__dirname, '../results')) {
    mkdirSync(outputDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${this.scenarioName}-${ts}.json`;
    const filepath = resolve(outputDir, filename);
    writeFileSync(filepath, JSON.stringify(this.toJSON(), null, 2));
    return filepath;
  }

  /** Print a formatted summary table to stdout */
  printSummary() {
    const data = this.toJSON();
    const dur = (data.durationMs / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(72));
    console.log(`  SCALE TEST: ${data.scenario.toUpperCase()}`);
    console.log(`  Duration: ${dur}s | Total RPS: ${data.overallRps} | Error Rate: ${data.errors.errorRatePct}%`);
    console.log('═'.repeat(72));

    // Latency table
    const ops = Object.entries(data.latency);
    if (ops.length > 0) {
      console.log('\n  LATENCY (ms)');
      console.log('  ' + '─'.repeat(68));
      console.log('  ' + 'Operation'.padEnd(28) + 'Count'.padStart(8) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'Mean'.padStart(8));
      console.log('  ' + '─'.repeat(68));
      for (const [op, s] of ops) {
        const name = op.replace(/([A-Z])/g, ' $1').trim();
        console.log(
          '  ' +
          name.padEnd(28) +
          String(s.count).padStart(8) +
          String(s.p50).padStart(8) +
          String(s.p95).padStart(8) +
          String(s.p99).padStart(8) +
          String(s.mean).padStart(8)
        );
      }
    }

    // Errors
    console.log('\n  ERRORS');
    console.log('  ' + '─'.repeat(68));
    console.log(`  Total: ${data.errors.total} / ${data.errors.requests} requests (${data.errors.errorRatePct}%)`);
    if (data.errors.total > 0) {
      for (const [type, count] of Object.entries(data.errors.byType)) {
        console.log(`    ${type}: ${count}`);
      }
    }

    // Success criteria evaluation
    console.log('\n  SUCCESS CRITERIA');
    console.log('  ' + '─'.repeat(68));
    const p99Memory = data.latency.memoryQuery?.p99 ?? 0;
    const p99Token  = data.latency.tokenGeneration?.p99 ?? 0;
    const errRate   = data.errors.errorRatePct;
    const lastCache = data.cacheSnapshots[data.cacheSnapshots.length - 1];
    const hitRate   = lastCache?.hitRatePct ?? null;

    _check('Error rate <0.1%',       errRate < 0.1,       `${errRate.toFixed(3)}%`);
    _check('Memory query p99 <100ms', p99Memory < 100,    `${p99Memory}ms`);
    _check('Token gen p99 <100ms',    p99Token < 100,      `${p99Token}ms`);
    if (hitRate !== null)
      _check('Cache hit rate >70%',   hitRate > 70,        `${hitRate.toFixed(1)}%`);

    console.log('═'.repeat(72) + '\n');
  }
}

function _check(label, pass, value) {
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} ${label.padEnd(30)} ${value}`);
}
