/**
 * K6 Load Test — Hyphae Service Registry
 *
 * Tests service registration, discovery, heartbeat, and deregistration
 * under concurrent agent load. Validates the service registry doesn't
 * become a bottleneck as agent count increases.
 *
 * Run:
 *   k6 run --env CLIENT_ID=sf-test-client --env CLIENT_SECRET=secret \
 *           --env OAUTH2_URL=http://localhost:3005 \
 *           --env HYPHAE_URL=http://localhost:3006 \
 *           k6/service-registry.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomUUID } from 'k6/crypto';

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const regLatency       = new Trend('svc_registration_latency_ms', true);
const heartbeatLatency = new Trend('svc_heartbeat_latency_ms', true);
const discoveryLatency = new Trend('svc_discovery_latency_ms', true);
const deregLatency     = new Trend('svc_deregistration_latency_ms', true);
const hyphaeErrors     = new Counter('hyphae_errors');
const hyphaeSuccess    = new Rate('hyphae_success_rate');

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // 100 agents registering + regular heartbeats (sustained)
    agent_lifecycle: {
      executor:  'constant-vus',
      vus:       100,
      duration:  '10m',
      tags: { scenario: 'agent_lifecycle' },
    },
    // Burst: agents all joining at once (cold-start thundering herd)
    join_burst: {
      executor:   'shared-iterations',
      vus:        150,
      iterations: 150,
      maxDuration: '3m',
      startTime:  '11m',
      tags: { scenario: 'join_burst' },
    },
  },
  thresholds: {
    svc_registration_latency_ms:   ['p(99)<200', 'p(95)<100'],
    svc_heartbeat_latency_ms:      ['p(99)<50',  'p(95)<20'],
    svc_discovery_latency_ms:      ['p(99)<100', 'p(95)<50'],
    hyphae_success_rate:           ['rate>0.999'],
    hyphae_errors:                 ['count<20'],
    http_req_failed:               ['rate<0.001'],
  },
};

const OAUTH2_URL    = __ENV.OAUTH2_URL    || 'http://localhost:3005';
const HYPHAE_URL    = __ENV.HYPHAE_URL    || 'http://localhost:3006';
const CLIENT_ID     = __ENV.CLIENT_ID     || 'sf-test-client';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || 'change-me-in-env';

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  const res = http.post(
    `${OAUTH2_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope:         'hyphae:read hyphae:admin',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (res.status !== 200) {
    throw new Error(`Token acquisition failed: ${res.status}`);
  }
  return { token: res.json('access_token') };
}

// ─── Agent Lifecycle (default) ────────────────────────────────────────────────

export default function agentLifecycle(data) {
  const agentId   = `k6-agent-${__VU}-${__ITER}`;
  let serviceId   = null;

  // Register
  group('service_registration', () => {
    const res = http.post(
      `${HYPHAE_URL}/services`,
      JSON.stringify({
        name:         agentId,
        description:  `K6 test agent VU=${__VU}`,
        capabilities: ['memory:read', 'task:execute'],
        metadata: { k6: true, vu: __VU },
      }),
      {
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${data.token}`,
        },
      }
    );

    const ok = check(res, {
      'registration 200/201': (r) => r.status === 200 || r.status === 201,
    });

    regLatency.add(res.timings.duration);
    hyphaeSuccess.add(ok ? 1 : 0);
    if (!ok) { hyphaeErrors.add(1); return; }

    const body = res.json();
    serviceId = body?.id ?? body?.serviceId;
  });

  sleep(0.5);

  // Discover services
  group('service_discovery', () => {
    const res = http.get(
      `${HYPHAE_URL}/services`,
      { headers: { 'Authorization': `Bearer ${data.token}` } }
    );
    const ok = check(res, { 'discovery ok': (r) => r.status === 200 });
    discoveryLatency.add(res.timings.duration);
    hyphaeSuccess.add(ok ? 1 : 0);
    if (!ok) hyphaeErrors.add(1);
  });

  sleep(1);

  // Heartbeat (simulate running agent)
  if (serviceId) {
    for (let i = 0; i < 3; i++) {
      group('heartbeat', () => {
        const res = http.put(
          `${HYPHAE_URL}/services/${serviceId}/heartbeat`,
          JSON.stringify({ status: 'healthy', load: Math.random().toFixed(2) }),
          {
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${data.token}`,
            },
          }
        );
        const ok = check(res, { 'heartbeat ok': (r) => r.status === 200 });
        heartbeatLatency.add(res.timings.duration);
        hyphaeSuccess.add(ok ? 1 : 0);
        if (!ok) hyphaeErrors.add(1);
      });
      sleep(2);
    }
  }

  // Deregister
  if (serviceId) {
    group('deregistration', () => {
      const res = http.del(
        `${HYPHAE_URL}/services/${serviceId}`,
        null,
        { headers: { 'Authorization': `Bearer ${data.token}` } }
      );
      const ok = check(res, { 'deregister ok': (r) => r.status === 200 || r.status === 204 });
      deregLatency.add(res.timings.duration);
      hyphaeSuccess.add(ok ? 1 : 0);
      if (!ok) hyphaeErrors.add(1);
    });
  }

  sleep(0.5);
}

// ─── Join Burst ───────────────────────────────────────────────────────────────

export function joinBurst(data) {
  // All agents try to register simultaneously (thundering herd)
  const agentId = `k6-burst-${__VU}`;

  const res = http.post(
    `${HYPHAE_URL}/services`,
    JSON.stringify({
      name:         agentId,
      description:  `K6 burst agent VU=${__VU}`,
      capabilities: ['memory:read'],
    }),
    {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${data.token}`,
      },
    }
  );

  const ok = check(res, { 'burst registration ok': (r) => r.status === 200 || r.status === 201 });
  regLatency.add(res.timings.duration);
  if (!ok) hyphaeErrors.add(1);

  // Immediately discover to simulate agent startup
  const discRes = http.get(
    `${HYPHAE_URL}/services`,
    { headers: { 'Authorization': `Bearer ${data.token}` } }
  );
  discoveryLatency.add(discRes.timings.duration);

  sleep(0.1);
}
