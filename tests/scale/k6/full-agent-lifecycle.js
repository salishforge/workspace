/**
 * K6 Load Test — Full Agent Lifecycle (Integration Scenario)
 *
 * Simulates the complete lifecycle of a Salish Forge agent:
 *   1. Acquire token (OAuth2 client_credentials)
 *   2. Register with Hyphae
 *   3. Write initial memory context
 *   4. Run query/write loop (realistic workload)
 *   5. Send heartbeats
 *   6. Refresh token
 *   7. Deregister on teardown
 *
 * This is the most realistic test — use for validating 100+ concurrent agents.
 *
 * Run:
 *   k6 run --env CLIENT_ID=sf-test-client --env CLIENT_SECRET=secret \
 *           --env OAUTH2_URL=http://localhost:3005 \
 *           --env HYPHAE_URL=http://localhost:3006 \
 *           --env MEMFORGE_URL=http://localhost:3001 \
 *           k6/full-agent-lifecycle.js
 */

import http from 'k6/http';
import { check, sleep, group, fail } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const tokenLatency  = new Trend('full_token_latency_ms', true);
const memRLatency   = new Trend('full_memory_read_latency_ms', true);
const memWLatency   = new Trend('full_memory_write_latency_ms', true);
const hbLatency     = new Trend('full_heartbeat_latency_ms', true);
const svcRegLatency = new Trend('full_svc_reg_latency_ms', true);
const errorCount    = new Counter('full_lifecycle_errors');
const successRate   = new Rate('full_lifecycle_success_rate');
const concurrentAgents = new Gauge('concurrent_agents');

// Workload query pool
const QUERIES = [
  'recent tasks and status',
  'deployment history',
  'error log summary',
  'team communications',
  'project roadmap items',
  'security policy review',
  'code review pending',
  'system performance metrics',
  'resource utilization trends',
  'upcoming deadlines',
];

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Core: 100 concurrent agents running full lifecycle
    hundred_agents: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '15m',
      tags: { scenario: '100_agents' },
    },
    // Scale: ramp to 150 then back down
    scale_test: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '5m',  target: 150 },
        { duration: '10m', target: 150 },
        { duration: '5m',  target: 100 },
      ],
      startTime: '16m',
      gracefulRampDown: '1m',
      tags: { scenario: 'scale_test' },
    },
  },
  thresholds: {
    // Core success criteria (v1.2.0)
    full_token_latency_ms:       ['p(99)<100', 'p(95)<50'],
    full_memory_read_latency_ms: ['p(99)<100', 'p(95)<50'],
    full_memory_write_latency_ms:['p(99)<150', 'p(95)<80'],
    full_heartbeat_latency_ms:   ['p(99)<50'],
    full_svc_reg_latency_ms:     ['p(99)<200'],
    full_lifecycle_success_rate: ['rate>0.999'],
    full_lifecycle_errors:       ['count<100'],
    http_req_failed:             ['rate<0.001'],
  },
};

const OAUTH2_URL    = __ENV.OAUTH2_URL    || 'http://localhost:3005';
const HYPHAE_URL    = __ENV.HYPHAE_URL    || 'http://localhost:3006';
const MEMFORGE_URL  = __ENV.MEMFORGE_URL  || 'http://localhost:3001';
const CLIENT_ID     = __ENV.CLIENT_ID     || 'sf-test-client';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || 'change-me-in-env';

// ─── Main agent simulation ────────────────────────────────────────────────────

export default function agentLifecycle() {
  const agentId = `k6-full-${__VU}`;
  concurrentAgents.add(1);

  // ── 1. Authenticate ──────────────────────────────────────────────────────

  let token, refreshToken, serviceId;

  group('authenticate', () => {
    const res = http.post(
      `${OAUTH2_URL}/oauth2/token`,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'memory:read memory:write hyphae:read hyphae:admin',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const ok = check(res, {
      'token 200': (r) => r.status === 200,
      'has token': (r) => r.json('access_token') != null,
    });

    tokenLatency.add(res.timings.duration);
    successRate.add(ok ? 1 : 0);

    if (!ok) {
      errorCount.add(1);
      concurrentAgents.add(-1);
      return; // bail on this iteration
    }

    token        = res.json('access_token');
    refreshToken = res.json('refresh_token');
  });

  if (!token) { sleep(1); return; }

  // ── 2. Register with Hyphae ───────────────────────────────────────────────

  group('register', () => {
    const res = http.post(
      `${HYPHAE_URL}/services`,
      JSON.stringify({
        name:         agentId,
        description:  `Full lifecycle agent VU=${__VU}`,
        capabilities: ['memory:read', 'memory:write', 'task:execute'],
        metadata: { k6: true, scenario: 'full_lifecycle' },
      }),
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const ok = check(res, {
      'register ok': (r) => r.status === 200 || r.status === 201,
    });

    svcRegLatency.add(res.timings.duration);
    successRate.add(ok ? 1 : 0);
    if (!ok) errorCount.add(1);
    else {
      const body = res.json();
      serviceId = body?.id ?? body?.serviceId;
    }
  });

  sleep(0.3);

  // ── 3. Write initial memory ───────────────────────────────────────────────

  group('memory_init', () => {
    const res = http.post(
      `${MEMFORGE_URL}/memory/${agentId}/add`,
      JSON.stringify({
        content: `Agent ${agentId} started session at ${new Date().toISOString()}`,
        metadata: { type: 'session_start', agentId, k6: true },
      }),
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    const ok = check(res, { 'init write ok': (r) => r.status === 200 || r.status === 201 });
    memWLatency.add(res.timings.duration);
    successRate.add(ok ? 1 : 0);
    if (!ok) errorCount.add(1);
  });

  // ── 4. Workload loop (simulate ~2 minutes of agent activity) ──────────────

  const workloadIterations = 8;
  for (let i = 0; i < workloadIterations; i++) {
    const roll = Math.random();

    if (roll < 0.50) {
      // Read memory (most common)
      group('memory_query', () => {
        const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];
        const res = http.get(
          `${MEMFORGE_URL}/memory/${agentId}/query?q=${encodeURIComponent(q)}&limit=10`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const ok = check(res, { 'query ok': (r) => r.status === 200 });
        memRLatency.add(res.timings.duration);
        successRate.add(ok ? 1 : 0);
        if (!ok) errorCount.add(1);
      });

    } else if (roll < 0.80) {
      // Write memory
      group('memory_write', () => {
        const res = http.post(
          `${MEMFORGE_URL}/memory/${agentId}/add`,
          JSON.stringify({
            content: `Task completed: iteration ${i} by ${agentId} at ${Date.now()}`,
            metadata: { type: 'task_complete', iteration: i, agentId },
          }),
          {
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${token}`,
            },
          }
        );
        const ok = check(res, { 'write ok': (r) => r.status === 200 || r.status === 201 });
        memWLatency.add(res.timings.duration);
        successRate.add(ok ? 1 : 0);
        if (!ok) errorCount.add(1);
      });

    } else {
      // Discover other services
      group('discover', () => {
        const res = http.get(
          `${HYPHAE_URL}/services`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        check(res, { 'discover ok': (r) => r.status === 200 });
      });
    }

    // Heartbeat every 3rd iteration
    if (i % 3 === 0 && serviceId) {
      group('heartbeat', () => {
        const res = http.put(
          `${HYPHAE_URL}/services/${serviceId}/heartbeat`,
          JSON.stringify({ status: 'healthy', iteration: i }),
          {
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${token}`,
            },
          }
        );
        const ok = check(res, { 'heartbeat ok': (r) => r.status === 200 });
        hbLatency.add(res.timings.duration);
        if (!ok) errorCount.add(1);
      });
    }

    sleep(1 + Math.random() * 2); // 1–3s between operations
  }

  // ── 5. Deregister ─────────────────────────────────────────────────────────

  if (serviceId) {
    group('deregister', () => {
      const res = http.del(
        `${HYPHAE_URL}/services/${serviceId}`,
        null,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      check(res, { 'deregister ok': (r) => r.status === 200 || r.status === 204 });
    });
  }

  concurrentAgents.add(-1);
  sleep(0.5);
}
