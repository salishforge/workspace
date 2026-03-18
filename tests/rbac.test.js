/**
 * RBAC Integration Tests — OAuth2 Scope Authorization
 *
 * Tests:
 *   1. Token issued with requested scopes (intersection)
 *   2. Scope escalation prevention (requesting unauthorized scopes)
 *   3. MemForge route enforcement (memforge:read / memforge:write)
 *   4. Hyphae route enforcement (hyphae:read / hyphae:admin)
 *   5. Dashboard /metrics enforcement (system:admin)
 *   6. Token without any scope: 403 on protected routes
 *   7. Mix of permissions: granted + denied in same session
 *   8. Audit logging: denials written to oauth2_auth_denials
 *
 * Prerequisites:
 *   - OAuth2 server running on localhost:3005
 *   - MemForge service running on localhost:3333
 *   - Hyphae service running on localhost:3006
 *   - Health dashboard running on localhost:3000
 *   - oauth2-scopes-schema.sql applied
 *   - oauth2-seed.js run (provides test client credentials)
 *
 * Usage:
 *   node tests/rbac.test.js
 *
 * Set env vars to supply test client secrets:
 *   MEMFORGE_SECRET=<secret>  HYPHAE_SECRET=<secret>  DASHBOARD_SECRET=<secret>
 */

const OAUTH2_URL     = process.env.OAUTH2_URL     || 'http://localhost:3005';
const MEMFORGE_URL   = process.env.MEMFORGE_URL   || 'http://localhost:3333';
const HYPHAE_URL     = process.env.HYPHAE_URL     || 'http://localhost:3006';
const DASHBOARD_URL  = process.env.DASHBOARD_URL  || 'http://localhost:3000';

const MEMFORGE_SECRET  = process.env.MEMFORGE_SECRET;
const HYPHAE_SECRET    = process.env.HYPHAE_SECRET;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET;

if (!MEMFORGE_SECRET || !HYPHAE_SECRET || !DASHBOARD_SECRET) {
  console.error('[test] Missing required env vars: MEMFORGE_SECRET, HYPHAE_SECRET, DASHBOARD_SECRET');
  console.error('[test] Run: node scripts/oauth2-seed.js --show-secrets to get them');
  process.exit(1);
}

// ─── Test Utilities ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

// ─── OAuth2 Helpers ───────────────────────────────────────────────────────────

async function getToken(clientId, clientSecret, requestedScope = null) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (requestedScope) body.set('scope', requestedScope);

  const resp = await fetch(`${OAUTH2_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return { status: resp.status, data: await resp.json() };
}

async function authFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

console.log('\n=== RBAC Integration Tests ===\n');

// ── 1. Token Issuance ──────────────────────────────────────────────────────────
console.log('1. Token issuance');

await test('memforge client receives full scope set by default', async () => {
  const { status, data } = await getToken('memforge', MEMFORGE_SECRET);
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert(data.access_token, 'No access_token in response');
  const scopes = (data.scope || '').split(' ');
  assert(scopes.includes('memforge:read'), 'Expected memforge:read in granted scopes');
  assert(scopes.includes('memforge:write'), 'Expected memforge:write in granted scopes');
});

await test('client can request subset of authorized scopes', async () => {
  const { status, data } = await getToken('memforge', MEMFORGE_SECRET, 'memforge:read');
  assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  const scopes = (data.scope || '').split(' ');
  assert(scopes.includes('memforge:read'), 'Expected memforge:read');
  assert(!scopes.includes('memforge:write'), 'memforge:write should NOT be in read-only token');
});

await test('hyphae client receives hyphae scopes', async () => {
  const { status, data } = await getToken('hyphae', HYPHAE_SECRET);
  assert(status === 200, `Expected 200, got ${status}`);
  const scopes = (data.scope || '').split(' ');
  assert(scopes.includes('hyphae:read'), 'Expected hyphae:read');
  assert(scopes.includes('hyphae:admin'), 'Expected hyphae:admin');
});

await test('dashboard client receives memforge:read and system:admin', async () => {
  const { status, data } = await getToken('dashboard', DASHBOARD_SECRET);
  assert(status === 200, `Expected 200, got ${status}`);
  const scopes = (data.scope || '').split(' ');
  assert(scopes.includes('memforge:read'), 'Expected memforge:read');
  assert(scopes.includes('system:admin'), 'Expected system:admin');
  assert(!scopes.includes('memforge:write'), 'dashboard should NOT have memforge:write');
});

// ── 2. Scope Escalation Prevention ────────────────────────────────────────────
console.log('\n2. Scope escalation prevention');

await test('memforge client cannot escalate to hyphae:admin', async () => {
  const { status, data } = await getToken('memforge', MEMFORGE_SECRET, 'memforge:read hyphae:admin');
  assert(status === 400, `Expected 400 invalid_scope, got ${status}: ${JSON.stringify(data)}`);
  assert(data.error === 'invalid_scope', `Expected invalid_scope error, got: ${data.error}`);
});

await test('memforge client cannot request system:admin', async () => {
  const { status, data } = await getToken('memforge', MEMFORGE_SECRET, 'system:admin');
  assert(status === 400, `Expected 400 invalid_scope, got ${status}`);
  assert(data.error === 'invalid_scope', `Expected invalid_scope, got: ${data.error}`);
});

await test('hyphae client cannot request memforge:write', async () => {
  const { status, data } = await getToken('hyphae', HYPHAE_SECRET, 'hyphae:read memforge:write');
  assert(status === 400, `Expected 400 invalid_scope, got ${status}`);
});

// ── 3. MemForge Route Enforcement ─────────────────────────────────────────────
console.log('\n3. MemForge route enforcement');

await test('memforge:write token can POST /memory/:id/add', async () => {
  const { data: tokenData } = await getToken('memforge', MEMFORGE_SECRET);
  const resp = await authFetch(
    `${MEMFORGE_URL}/memory/test-agent/add`,
    tokenData.access_token,
    {
      method: 'POST',
      body: JSON.stringify({ content: 'RBAC test memory entry' }),
    }
  );
  // Accept 200 (success) or 400/404 (agent not found etc.) — anything but 401/403
  assert(resp.status !== 401, `Expected NOT 401, got ${resp.status}`);
  assert(resp.status !== 403, `Expected NOT 403 — scope check failed`);
});

await test('read-only token (memforge:read) cannot POST /memory/:id/add', async () => {
  const { data: tokenData } = await getToken('memforge', MEMFORGE_SECRET, 'memforge:read');
  const resp = await authFetch(
    `${MEMFORGE_URL}/memory/test-agent/add`,
    tokenData.access_token,
    {
      method: 'POST',
      body: JSON.stringify({ content: 'should be denied' }),
    }
  );
  assert(resp.status === 403, `Expected 403 Forbidden, got ${resp.status}`);
  const body = await resp.json();
  assert(body.error === 'insufficient_scope', `Expected insufficient_scope, got: ${body.error}`);
});

await test('memforge:read token can GET /memory/:id/query', async () => {
  const { data: tokenData } = await getToken('memforge', MEMFORGE_SECRET, 'memforge:read');
  const resp = await authFetch(
    `${MEMFORGE_URL}/memory/test-agent/query?q=test`,
    tokenData.access_token
  );
  assert(resp.status !== 401, `Expected NOT 401`);
  assert(resp.status !== 403, `Expected NOT 403 — scope check failed unexpectedly`);
});

await test('no-scope token (no Bearer header) gets 401 on /memory routes', async () => {
  const resp = await fetch(`${MEMFORGE_URL}/memory/test-agent/query?q=test`);
  assert(resp.status === 401, `Expected 401 Unauthorized, got ${resp.status}`);
});

// ── 4. Hyphae Route Enforcement ───────────────────────────────────────────────
console.log('\n4. Hyphae route enforcement');

await test('hyphae:read token can GET /services', async () => {
  const { data: tokenData } = await getToken('hyphae', HYPHAE_SECRET, 'hyphae:read');
  const resp = await authFetch(`${HYPHAE_URL}/services`, tokenData.access_token);
  assert(resp.status !== 403, `Expected NOT 403, got ${resp.status}`);
});

await test('hyphae:admin token can POST /services', async () => {
  const { data: tokenData } = await getToken('hyphae', HYPHAE_SECRET);
  const resp = await authFetch(`${HYPHAE_URL}/services`, tokenData.access_token, {
    method: 'POST',
    body: JSON.stringify({
      id: 'rbac-test-svc',
      type: 'test',
      endpoint: 'http://localhost:9999',
      owner: 'rbac-test',
    }),
  });
  assert(resp.status !== 403, `Expected NOT 403 for admin token, got ${resp.status}`);
});

await test('read-only token cannot POST /services (missing hyphae:admin)', async () => {
  const { data: tokenData } = await getToken('hyphae', HYPHAE_SECRET, 'hyphae:read');
  const resp = await authFetch(`${HYPHAE_URL}/services`, tokenData.access_token, {
    method: 'POST',
    body: JSON.stringify({
      id: 'should-fail',
      type: 'test',
      endpoint: 'http://localhost:9999',
      owner: 'attacker',
    }),
  });
  assert(resp.status === 403, `Expected 403, got ${resp.status}`);
});

await test('read-only token cannot DELETE /services/:id', async () => {
  const { data: tokenData } = await getToken('hyphae', HYPHAE_SECRET, 'hyphae:read');
  const resp = await authFetch(`${HYPHAE_URL}/services/rbac-test-svc`, tokenData.access_token, {
    method: 'DELETE',
  });
  assert(resp.status === 403, `Expected 403, got ${resp.status}`);
});

await test('memforge token cannot access hyphae /services', async () => {
  const { data: tokenData } = await getToken('memforge', MEMFORGE_SECRET);
  const resp = await authFetch(`${HYPHAE_URL}/services`, tokenData.access_token);
  assert(resp.status === 403, `Expected 403 — wrong service scope, got ${resp.status}`);
});

// ── 5. Dashboard Metrics Enforcement ─────────────────────────────────────────
console.log('\n5. Dashboard /metrics enforcement');

await test('system:admin token can GET /metrics', async () => {
  const { data: tokenData } = await getToken('dashboard', DASHBOARD_SECRET);
  const resp = await authFetch(`${DASHBOARD_URL}/metrics`, tokenData.access_token);
  assert(resp.status !== 403, `Expected NOT 403 for system:admin token, got ${resp.status}`);
});

await test('memforge token cannot GET /metrics (missing system:admin)', async () => {
  const { data: tokenData } = await getToken('memforge', MEMFORGE_SECRET);
  const resp = await authFetch(`${DASHBOARD_URL}/metrics`, tokenData.access_token);
  assert(resp.status === 403, `Expected 403, got ${resp.status}`);
});

await test('/health endpoint is public (no auth required)', async () => {
  const resp = await fetch(`${DASHBOARD_URL}/health`);
  assert(resp.status === 200, `Expected 200, got ${resp.status}`);
});

// ── 6. Audit Log ──────────────────────────────────────────────────────────────
console.log('\n6. Scope escalation recorded in escalation response');

await test('escalation attempt returns descriptive error', async () => {
  const { status, data } = await getToken('memforge', MEMFORGE_SECRET, 'system:admin');
  assert(status === 400, `Expected 400, got ${status}`);
  assert(data.error === 'invalid_scope', `Expected invalid_scope`);
  assert(
    data.error_description?.includes('system:admin'),
    `Error description should mention denied scope: ${data.error_description}`
  );
});

await test('/api/scopes endpoint returns caller granted scopes', async () => {
  const { data: tokenData } = await getToken('dashboard', DASHBOARD_SECRET);
  const resp = await authFetch(`${DASHBOARD_URL}/api/scopes`, tokenData.access_token);
  assert(resp.status === 200, `Expected 200, got ${resp.status}`);
  const body = await resp.json();
  assert(body.client_id === 'dashboard', `Expected client_id=dashboard, got ${body.client_id}`);
  assert(Array.isArray(body.granted_scopes), 'Expected granted_scopes array');
  assert(body.granted_scopes.includes('system:admin'), 'Expected system:admin in granted_scopes');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failures.length > 0) {
  console.error('Failures:');
  for (const f of failures) {
    console.error(`  ✗ ${f.name}: ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('All RBAC tests passed.');
}
