/**
 * K6 Load Test — Token Generation (OAuth2 /oauth2/token)
 *
 * Tests OAuth2 token issuance at scale. Simulates concurrent agents
 * authenticating simultaneously (e.g. cold-start scenario).
 *
 * Run:
 *   k6 run --env CLIENT_ID=sf-test-client --env CLIENT_SECRET=secret \
 *           --env BASE_URL=http://localhost:3005 \
 *           k6/token-generation.js
 *
 * Scenarios:
 *   cold-start: 100 VUs acquiring tokens concurrently (thundering herd)
 *   steady:     Continuous token refresh at 50 VUs
 */

import http   from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const tokenLatency    = new Trend('token_latency_ms', true);
const tokenErrors     = new Counter('token_errors');
const tokenSuccess    = new Rate('token_success_rate');
const refreshLatency  = new Trend('refresh_latency_ms', true);

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    cold_start: {
      executor:   'shared-iterations',
      vus:        100,
      iterations: 100,
      maxDuration: '2m',
      gracefulStop: '30s',
      tags: { scenario: 'cold-start' },
    },
    steady_refresh: {
      executor:   'constant-vus',
      vus:        50,
      duration:   '10m',
      startTime:  '2m', // starts after cold-start
      gracefulRampDown: '30s',
      tags: { scenario: 'steady-refresh' },
    },
  },
  thresholds: {
    token_latency_ms:   ['p(99)<100', 'p(95)<50'],
    token_success_rate: ['rate>0.999'],
    token_errors:       ['count<10'],
    http_req_failed:    ['rate<0.001'],
  },
};

const BASE_URL      = __ENV.BASE_URL      || 'http://localhost:3005';
const CLIENT_ID     = __ENV.CLIENT_ID     || 'sf-test-client';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || 'change-me-in-env';

// ─── Cold Start ───────────────────────────────────────────────────────────────

export default function coldStart() {
  const res = http.post(
    `${BASE_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope:         'memory:read memory:write hyphae:read hyphae:admin',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      tags:    { operation: 'token_generation' },
    }
  );

  const ok = check(res, {
    'status 200':         (r) => r.status === 200,
    'has access_token':   (r) => r.json('access_token') !== undefined,
    'token type bearer':  (r) => r.json('token_type') === 'Bearer',
    'expires_in present': (r) => r.json('expires_in') > 0,
  });

  tokenLatency.add(res.timings.duration);
  tokenSuccess.add(ok ? 1 : 0);
  if (!ok) tokenErrors.add(1);

  sleep(0.1);
}

// ─── Steady Refresh ───────────────────────────────────────────────────────────

export function steadyRefresh() {
  // First acquire a token
  const tokenRes = http.post(
    `${BASE_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope:         'memory:read memory:write',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (tokenRes.status !== 200) {
    tokenErrors.add(1);
    sleep(1);
    return;
  }

  tokenLatency.add(tokenRes.timings.duration);
  tokenSuccess.add(1);

  const refreshToken = tokenRes.json('refresh_token');
  if (!refreshToken) {
    sleep(5);
    return;
  }

  // Simulate token refresh before expiry
  sleep(3); // think time

  const refreshRes = http.post(
    `${BASE_URL}/oauth2/token`,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      tags:    { operation: 'token_refresh' },
    }
  );

  const refreshOk = check(refreshRes, {
    'refresh status 200':       (r) => r.status === 200,
    'refresh has access_token': (r) => r.json('access_token') !== undefined,
  });

  refreshLatency.add(refreshRes.timings.duration);
  if (!refreshOk) tokenErrors.add(1);

  sleep(2);
}
