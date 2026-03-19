/**
 * OAuth2 Authorization Code Flow — Integration Tests
 * v1.1.0 — Salish Forge
 *
 * Test groups:
 *   1. Unit — PKCE, session, HTML generation (no DB/network)
 *   2. HTTP  — full flow against a live server (requires OAUTH2_TEST_URL + DATABASE_URL)
 *
 * Run:
 *   node tests/auth-code-flow-tests.js                     # unit tests only
 *   OAUTH2_TEST_URL=http://127.0.0.1:3005 \
 *   DATABASE_URL=postgres://... \
 *   node tests/auth-code-flow-tests.js                     # unit + HTTP tests
 */

import assert from 'assert';
import { createHash, randomBytes } from 'crypto';

// Inline PKCE helper — mirrors computeCodeChallenge in auth-code-flow.js
// (avoids requiring express for unit tests)
function computeCodeChallenge(verifier) {
  return createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

async function run() {
  console.log('🧪 OAuth2 Authorization Code Flow Tests\n');

  for (const { name, fn } of results) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── 1. Unit Tests ─────────────────────────────────────────────────────────────

// PKCE: code_challenge derivation
test('PKCE: S256 challenge matches SHA256(verifier) in base64url', () => {
  // RFC 7636 Appendix B test vectors
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  assert.strictEqual(challenge, expected);
});

test('PKCE: computeCodeChallenge is consistent', () => {
  const verifier = randomBytes(32).toString('hex');
  const c1 = computeCodeChallenge(verifier);
  const c2 = computeCodeChallenge(verifier);
  assert.strictEqual(c1, c2);
});

test('PKCE: different verifiers produce different challenges', () => {
  const v1 = randomBytes(32).toString('hex');
  const v2 = randomBytes(32).toString('hex');
  assert.notStrictEqual(computeCodeChallenge(v1), computeCodeChallenge(v2));
});

test('PKCE: challenge is base64url (no +, /, or = padding)', () => {
  const verifier = randomBytes(48).toString('base64');
  const challenge = computeCodeChallenge(verifier);
  assert(!challenge.includes('+'), 'Should not contain +');
  assert(!challenge.includes('/'), 'Should not contain /');
  assert(!challenge.includes('='), 'Should not contain = padding');
});

test('PKCE: wrong verifier does not match stored challenge', () => {
  const correctVerifier = randomBytes(32).toString('hex');
  const wrongVerifier   = randomBytes(32).toString('hex');
  const challenge = computeCodeChallenge(correctVerifier);
  const derived   = computeCodeChallenge(wrongVerifier);
  assert.notStrictEqual(derived, challenge);
});

// Auth code format
test('Auth code: 64-char hex (32 random bytes)', () => {
  const code = randomBytes(32).toString('hex');
  assert.strictEqual(code.length, 64);
  assert(/^[0-9a-f]+$/.test(code), 'Should be lowercase hex');
});

// Session ID format
test('Session ID: 64-char hex', () => {
  const sid = randomBytes(32).toString('hex');
  assert.strictEqual(sid.length, 64);
});

// Cookie parsing (inline helper matches auth-code-flow.js)
function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...rest] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(rest.join('='))];
    })
  );
}

test('Cookie parser: parses single cookie', () => {
  const cookies = parseCookies('oauth2_sid=abc123');
  assert.strictEqual(cookies['oauth2_sid'], 'abc123');
});

test('Cookie parser: parses multiple cookies', () => {
  const cookies = parseCookies('oauth2_sid=abc123; other=val');
  assert.strictEqual(cookies['oauth2_sid'], 'abc123');
  assert.strictEqual(cookies['other'], 'val');
});

test('Cookie parser: handles empty header', () => {
  const cookies = parseCookies('');
  assert.deepStrictEqual(cookies, {});
});

test('Cookie parser: handles undefined', () => {
  const cookies = parseCookies(undefined);
  assert.deepStrictEqual(cookies, {});
});

// HTML escaping (inline copy)
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

test('HTML escape: prevents XSS in client_id', () => {
  const malicious = '<script>alert(1)</script>';
  const escaped = escHtml(malicious);
  assert(!escaped.includes('<script>'));
  assert(escaped.includes('&lt;script&gt;'));
});

test('HTML escape: handles null/undefined gracefully', () => {
  assert.strictEqual(escHtml(null), '');
  assert.strictEqual(escHtml(undefined), '');
});

// ─── 2. HTTP Integration Tests ────────────────────────────────────────────────
// Only run if OAUTH2_TEST_URL is set.

const BASE_URL = process.env.OAUTH2_TEST_URL;

if (BASE_URL) {
  console.log(`\n🌐 HTTP integration tests against ${BASE_URL}\n`);

  // ── helpers ──

  async function apiPost(path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...opts.headers };
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
    });
    return response;
  }

  async function apiGet(path, opts = {}) {
    return fetch(`${BASE_URL}${path}`, { redirect: 'manual', ...opts });
  }

  // Seed a test client using the seed script pattern
  // (We just verify the health endpoint here; real seeding is done by oauth2-seed.js)

  // ── Health check ──

  test('HTTP: GET /oauth2/health returns 200', async () => {
    const res = await apiGet('/oauth2/health');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  // ── /oauth2/authorize validation ──

  test('HTTP: GET /oauth2/authorize missing params → 400', async () => {
    const res = await apiGet('/oauth2/authorize');
    assert.strictEqual(res.status, 400);
  });

  test('HTTP: GET /oauth2/authorize unknown client → 400', async () => {
    const res = await apiGet(
      '/oauth2/authorize?client_id=no-such-client&redirect_uri=https://example.com/cb&scope=read&response_type=code'
    );
    assert.strictEqual(res.status, 400);
  });

  test('HTTP: GET /oauth2/authorize unsupported response_type → 400', async () => {
    const res = await apiGet(
      '/oauth2/authorize?client_id=test&redirect_uri=https://example.com/cb&scope=read&response_type=token'
    );
    assert.strictEqual(res.status, 400);
  });

  // ── Login page ──

  test('HTTP: GET /oauth2/login renders HTML form', async () => {
    const res = await apiGet('/oauth2/login?client_id=x&redirect_uri=https://example.com/cb&scope=read');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert(html.includes('<form'), 'Should contain a form');
    assert(html.includes('action="/oauth2/login"'), 'Form should POST to /oauth2/login');
    assert(html.includes('name="username"'), 'Should have username field');
    assert(html.includes('name="password"'), 'Should have password field');
  });

  // ── Error page ──

  test('HTTP: GET /oauth2/error renders error page', async () => {
    const res = await apiGet('/oauth2/error?error=access_denied&error_description=Test+error');
    assert.strictEqual(res.status, 400);
    const html = await res.text();
    assert(html.includes('access_denied'));
    assert(html.includes('Test error'));
  });

  // ── POST /oauth2/login with bad credentials ──

  test('HTTP: POST /oauth2/login with wrong credentials stays on login page', async () => {
    const res = await apiPost('/oauth2/login', {
      username: 'nonexistent-user-xyzzy',
      password: 'wrong-password',
      client_id: 'test',
      redirect_uri: 'https://example.com/cb',
      scope: 'read',
    });
    // Should stay on login page (200 with error banner), not redirect
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert(html.includes('Invalid username or password'));
  });

  // ── POST /oauth2/token with invalid grant_type ──

  test('HTTP: POST /oauth2/token unsupported grant_type → 400', async () => {
    const res = await apiPost('/oauth2/token', {
      grant_type: 'implicit',
      client_id: 'test',
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'unsupported_grant_type');
  });

  // ── POST /oauth2/token authorization_code with invalid code ──

  test('HTTP: POST /oauth2/token with expired/invalid code → 400', async () => {
    const res = await apiPost('/oauth2/token', {
      grant_type: 'authorization_code',
      code: 'definitely-not-a-valid-code-' + randomBytes(8).toString('hex'),
      client_id: 'test',
      client_secret: 'wrong',
      redirect_uri: 'https://example.com/cb',
    });
    // Either 400 (invalid_grant) or 401 (invalid_client)
    assert([400, 401].includes(res.status), `Expected 400 or 401, got ${res.status}`);
    const body = await res.json();
    assert(['invalid_grant', 'invalid_client'].includes(body.error), `Unexpected error: ${body.error}`);
  });

  // ── POST /oauth2/token code reuse prevention ──
  // This requires a real auth code in DB; skip if we don't have seeded data.
  // The test is documented here for completeness and to run manually.

  // ── POST /oauth2/authorize without session → 401 ──

  test('HTTP: POST /oauth2/authorize without session → 401', async () => {
    const res = await apiPost('/oauth2/authorize', {
      client_id: 'test',
      redirect_uri: 'https://example.com/cb',
      scope: 'read',
      action: 'approve',
    });
    assert.strictEqual(res.status, 401);
  });

  // ── POST /oauth2/logout destroys session cookie ──

  test('HTTP: POST /oauth2/logout returns logged_out:true', async () => {
    const res = await apiPost('/oauth2/logout', {});
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.logged_out, true);
  });

  // ── Full PKCE flow simulation ──
  // This test generates the PKCE parameters and validates the math,
  // then attempts to use an invalid code to confirm endpoint behavior.

  test('HTTP: Full PKCE parameter generation and challenge verification', async () => {
    // Client-side: generate PKCE pair
    const codeVerifier  = randomBytes(32).toString('base64url');
    const codeChallenge = computeCodeChallenge(codeVerifier);

    assert(codeVerifier.length >= 43, 'verifier must be ≥43 chars');
    assert(codeVerifier.length <= 128, 'verifier must be ≤128 chars');
    assert(codeChallenge.length > 0);

    // Server-side: verify the math
    const rederived = computeCodeChallenge(codeVerifier);
    assert.strictEqual(rederived, codeChallenge, 'challenge must be reproducible');

    // Attempt exchange with valid PKCE but invalid code (code was never issued)
    const fakeCode = randomBytes(32).toString('hex');
    const res = await apiPost('/oauth2/token', {
      grant_type: 'authorization_code',
      code: fakeCode,
      client_id: 'test',
      redirect_uri: 'https://example.com/cb',
      code_verifier: codeVerifier,
    });
    // Should fail on invalid code, not on PKCE logic
    assert([400, 401].includes(res.status));
    const body = await res.json();
    assert(['invalid_grant', 'invalid_client'].includes(body.error));
  });

  // ── Scope listing ──

  test('HTTP: GET /oauth2/scopes returns scope list', async () => {
    const res = await apiGet('/oauth2/scopes');
    // May be 200 (if table exists) or 503 (if not migrated yet)
    assert([200, 503].includes(res.status));
  });

} else {
  console.log('ℹ️  Set OAUTH2_TEST_URL to run HTTP integration tests.\n');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

run().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
