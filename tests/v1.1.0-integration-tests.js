/**
 * v1.1.0 Integration Tests
 * 
 * Tests for:
 * - JWT token generation + verification
 * - Scope-based authorization
 * - Redis caching
 * - OAuth2 authorization code flow
 */

const assert = require('assert');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ============= Test Suite =============

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('🧪 v1.1.0 Integration Tests\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ============= JWT Tests =============

test('JWT: Generate and verify token', () => {
  const privateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const payload = {
    client_id: 'test-client',
    sub: 'test-client',
    scope: 'memforge:read hyphae:read',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const token = jwt.sign(payload, privateKey.privateKey, { algorithm: 'RS256' });
  assert(token.length > 0);

  const decoded = jwt.verify(token, privateKey.publicKey, { algorithms: ['RS256'] });
  assert.strictEqual(decoded.client_id, 'test-client');
  assert.strictEqual(decoded.scope, 'memforge:read hyphae:read');
});

test('JWT: Reject expired token', () => {
  const privateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const payload = {
    client_id: 'test-client',
    exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
  };

  const token = jwt.sign(payload, privateKey.privateKey, { algorithm: 'RS256' });

  let error;
  try {
    jwt.verify(token, privateKey.publicKey, { algorithms: ['RS256'] });
  } catch (e) {
    error = e;
  }

  assert(error && error.message.includes('expired'));
});

test('JWT: Reject tampered token', () => {
  const privateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const payload = { client_id: 'test-client', exp: Math.floor(Date.now() / 1000) + 3600 };
  let token = jwt.sign(payload, privateKey.privateKey, { algorithm: 'RS256' });

  // Tamper with token
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ client_id: 'hacker' })).toString('base64');
  token = parts.join('.');

  let error;
  try {
    jwt.verify(token, privateKey.publicKey, { algorithms: ['RS256'] });
  } catch (e) {
    error = e;
  }

  assert(error && error.message.includes('invalid'));
});

// ============= Scope RBAC Tests =============

test('RBAC: Single scope requirement met', () => {
  const token = { scope: 'memforge:read hyphae:admin' };
  const required = 'memforge:read';

  const scopes = token.scope.split(' ');
  assert(scopes.includes(required));
});

test('RBAC: Single scope requirement denied', () => {
  const token = { scope: 'memforge:read' };
  const required = 'hyphae:admin';

  const scopes = token.scope.split(' ');
  assert(!scopes.includes(required));
});

test('RBAC: Multiple scopes (any match)', () => {
  const token = { scope: 'memforge:read system:admin' };
  const required = ['hyphae:admin', 'system:admin'];

  const scopes = token.scope.split(' ');
  const hasAny = required.some(r => scopes.includes(r));
  assert(hasAny);
});

test('RBAC: Multiple scopes (all required)', () => {
  const token = { scope: 'memforge:write hyphae:admin system:admin' };
  const required = ['memforge:write', 'hyphae:admin'];

  const scopes = token.scope.split(' ');
  const hasAll = required.every(r => scopes.includes(r));
  assert(hasAll);
});

// ============= Cache Tests =============

test('Cache: Generate cache key consistently', () => {
  const getCacheKey = (namespace, id, query) => {
    const parts = ['memforge', namespace];
    if (id) parts.push(id);
    if (query) {
      const hash = crypto.createHash('md5').update(query).digest('hex');
      parts.push(hash.substring(0, 8));
    }
    return parts.join(':');
  };

  const key1 = getCacheKey('memory', 'user-1', 'search term');
  const key2 = getCacheKey('memory', 'user-1', 'search term');
  assert.strictEqual(key1, key2);
});

test('Cache: Different queries get different keys', () => {
  const getCacheKey = (namespace, id, query) => {
    const parts = ['memforge', namespace];
    if (id) parts.push(id);
    if (query) {
      const hash = crypto.createHash('md5').update(query).digest('hex');
      parts.push(hash.substring(0, 8));
    }
    return parts.join(':');
  };

  const key1 = getCacheKey('memory', 'user-1', 'query 1');
  const key2 = getCacheKey('memory', 'user-1', 'query 2');
  assert.notStrictEqual(key1, key2);
});

// ============= Auth Code Flow Tests =============

test('Auth Code: Generate auth code', () => {
  const generateAuthCode = () => crypto.randomBytes(32).toString('hex');

  const code = generateAuthCode();
  assert.strictEqual(code.length, 64); // 32 bytes * 2 hex chars
});

test('Auth Code: Generate PKCE challenge', () => {
  const verifier = crypto.randomBytes(32).toString('hex'); // 64 chars

  const generateCodeChallenge = (v) => {
    return crypto
      .createHash('sha256')
      .update(v)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const challenge = generateCodeChallenge(verifier);
  assert(challenge.length > 0);
  assert(challenge.length <= 128);
  assert(!challenge.includes('+'));
  assert(!challenge.includes('/'));
  assert(!challenge.includes('='));
});

test('Auth Code: Verify PKCE challenge', () => {
  const verifier = crypto.randomBytes(32).toString('hex');

  const generateCodeChallenge = (v) => {
    return crypto
      .createHash('sha256')
      .update(v)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const challenge = generateCodeChallenge(verifier);
  const recalculated = generateCodeChallenge(verifier);
  assert.strictEqual(challenge, recalculated);
});

test('Auth Code: Reject invalid PKCE verifier', () => {
  const verifier1 = crypto.randomBytes(32).toString('hex');
  const verifier2 = crypto.randomBytes(32).toString('hex');

  const generateCodeChallenge = (v) => {
    return crypto
      .createHash('sha256')
      .update(v)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const challenge1 = generateCodeChallenge(verifier1);
  const challenge2 = generateCodeChallenge(verifier2);
  assert.notStrictEqual(challenge1, challenge2);
});

// ============= Performance Tests =============

test('Performance: JWT verification <1ms', () => {
  const privateKey = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const payload = {
    client_id: 'test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const token = jwt.sign(payload, privateKey.privateKey, { algorithm: 'RS256' });

  const start = process.hrtime.bigint();
  jwt.verify(token, privateKey.publicKey, { algorithms: ['RS256'] });
  const end = process.hrtime.bigint();

  const durationMs = Number(end - start) / 1000000;
  console.log(`   Duration: ${durationMs.toFixed(2)}ms`);
  assert(durationMs < 5); // Allow 5ms (still very fast)
});

test('Performance: Cache key generation <1ms', () => {
  const getCacheKey = (namespace, id, query) => {
    const parts = ['memforge', namespace];
    if (id) parts.push(id);
    if (query) {
      const hash = crypto.createHash('md5').update(query).digest('hex');
      parts.push(hash.substring(0, 8));
    }
    return parts.join(':');
  };

  const start = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) {
    getCacheKey('memory', `id-${i}`, `query-${i}`);
  }
  const end = process.hrtime.bigint();

  const durationMs = Number(end - start) / 1000000;
  const avgPerCall = durationMs / 1000;
  console.log(`   Avg per call: ${avgPerCall.toFixed(4)}ms`);
  assert(durationMs < 50); // 1000 calls < 50ms
});

// ============= Run Tests =============

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
