/**
 * K6 Load Test — Memory Operations (MemForge)
 *
 * Tests memory read/write/consolidation under concurrent agent load.
 * Focuses on cache hit rates and query latency degradation.
 *
 * Run:
 *   k6 run --env TOKEN=<bearer-token> \
 *           --env BASE_URL=http://localhost:3001 \
 *           k6/memory-queries.js
 *
 * Or with auto-auth:
 *   k6 run --env CLIENT_ID=sf-test-client --env CLIENT_SECRET=secret \
 *           --env OAUTH2_URL=http://localhost:3005 \
 *           --env BASE_URL=http://localhost:3001 \
 *           k6/memory-queries.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const queryLatency     = new Trend('memory_query_latency_ms', true);
const writeLatency     = new Trend('memory_write_latency_ms', true);
const consolidateLatency = new Trend('memory_consolidate_latency_ms', true);
const memoryErrors     = new Counter('memory_errors');
const memorySuccess    = new Rate('memory_success_rate');
const activeAgents     = new Gauge('active_agents');

// Realistic query pool
const QUERIES = new SharedArray('queries', function() {
  return [
    'what tasks did I complete yesterday',
    'summarize recent user interactions',
    'retrieve last deployment configuration',
    'find relevant context for authentication flow',
    'what is the current project status',
    'locate performance optimization notes',
    'retrieve architecture decision history',
    'find recent error patterns in logs',
    'summarize team communication threads',
    'retrieve API integration guidelines',
    'what are the current security policies',
    'find database migration history',
    'retrieve code review feedback',
    'summarize recent feature requests',
    'find documentation for OAuth2',
    'check service health status',
    'review last sprint deliverables',
    'identify bottlenecks in pipeline',
    'list pending approvals',
    'summarize this week\'s incidents',
  ];
});

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    read_heavy: {
      executor:  'constant-vus',
      vus:       80,
      duration:  '10m',
      tags: { scenario: 'read_heavy' },
    },
    write_mixed: {
      executor:  'constant-vus',
      vus:       30,
      duration:  '10m',
      tags: { scenario: 'write_mixed' },
    },
    peak_queries: {
      executor:   'ramping-vus',
      startVUs:   10,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 150 },
        { duration: '3m', target: 150 },
        { duration: '2m', target: 10  },
      ],
      startTime:   '11m',
      gracefulRampDown: '30s',
      tags: { scenario: 'peak_queries' },
    },
  },
  thresholds: {
    memory_query_latency_ms:   ['p(99)<100', 'p(95)<50', 'p(50)<20'],
    memory_write_latency_ms:   ['p(99)<150', 'p(95)<80'],
    memory_success_rate:       ['rate>0.999'],
    memory_errors:             ['count<50'],
    http_req_failed:           ['rate<0.001'],
  },
};

const BASE_URL   = __ENV.BASE_URL   || 'http://localhost:3001';
const TOKEN      = __ENV.TOKEN      || '';
const OAUTH2_URL = __ENV.OAUTH2_URL || 'http://localhost:3005';
const CLIENT_ID  = __ENV.CLIENT_ID  || 'sf-test-client';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || 'change-me-in-env';

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  if (TOKEN) return { token: TOKEN };

  // Auto-acquire token
  const res = http.post(
    `${OAUTH2_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope:         'memory:read memory:write',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (res.status !== 200) {
    throw new Error(`Failed to acquire token: ${res.status} ${res.body}`);
  }

  return { token: res.json('access_token') };
}

// ─── Default (read-heavy) ─────────────────────────────────────────────────────

export default function readHeavy(data) {
  const agentId = `k6-agent-${__VU}`;
  activeAgents.add(1);

  group('memory_query', () => {
    const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
    const url   = `${BASE_URL}/memory/${agentId}/query?q=${encodeURIComponent(query)}&limit=10`;

    const res = http.get(url, {
      headers: { 'Authorization': `Bearer ${data.token}` },
      tags:    { operation: 'memory_query' },
    });

    const ok = check(res, {
      'status 200':       (r) => r.status === 200,
      'has results key':  (r) => r.json() !== null,
    });

    queryLatency.add(res.timings.duration);
    memorySuccess.add(ok ? 1 : 0);
    if (!ok) memoryErrors.add(1);
  });

  sleep(0.5 + Math.random() * 1.5); // 0.5–2s think time
}

// ─── Write-mixed ─────────────────────────────────────────────────────────────

export function writeMixed(data) {
  const agentId = `k6-agent-${__VU}`;
  const roll = Math.random();

  if (roll < 0.6) {
    // Read
    const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
    const res = http.get(
      `${BASE_URL}/memory/${agentId}/query?q=${encodeURIComponent(query)}`,
      { headers: { 'Authorization': `Bearer ${data.token}` } }
    );
    const ok = check(res, { 'read ok': (r) => r.status === 200 });
    queryLatency.add(res.timings.duration);
    memorySuccess.add(ok ? 1 : 0);
    if (!ok) memoryErrors.add(1);
  } else {
    // Write
    const res = http.post(
      `${BASE_URL}/memory/${agentId}/add`,
      JSON.stringify({
        content: `k6 scale test event at ${new Date().toISOString()} vu=${__VU}`,
        metadata: {
          type:       'scale_test',
          category:   'system',
          importance: 0.5,
          agentId,
        },
      }),
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${data.token}`,
        },
        tags: { operation: 'memory_write' },
      }
    );

    const ok = check(res, { 'write ok': (r) => r.status === 200 || r.status === 201 });
    writeLatency.add(res.timings.duration);
    memorySuccess.add(ok ? 1 : 0);
    if (!ok) memoryErrors.add(1);
  }

  sleep(1 + Math.random());
}

// ─── Peak queries ─────────────────────────────────────────────────────────────

export function peakQueries(data) {
  // Aggressive query burst — minimal think time
  const agentId = `k6-peak-${__VU}`;
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  const res = http.get(
    `${BASE_URL}/memory/${agentId}/query?q=${encodeURIComponent(query)}&limit=5`,
    {
      headers: { 'Authorization': `Bearer ${data.token}` },
      tags:    { operation: 'memory_query_peak' },
    }
  );

  const ok = check(res, { 'peak query ok': (r) => r.status === 200 });
  queryLatency.add(res.timings.duration);
  if (!ok) memoryErrors.add(1);

  sleep(0.2);
}
