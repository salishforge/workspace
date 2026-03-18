/**
 * OAuth2 Authorization Server — RFC 6749 Client Credentials Flow
 *
 * Endpoints:
 *   POST /oauth2/token       — issue access_token + refresh_token
 *   POST /oauth2/introspect  — validate token (RFC 7662)
 *   POST /oauth2/revoke      — revoke token (RFC 7009)
 *   GET  /oauth2/health      — health check
 *
 * Environment:
 *   DATABASE_URL   — PostgreSQL connection string (required)
 *   PORT           — HTTP port (default: 3005)
 *   RATE_LIMIT_WINDOW_MS — rate limit window (default: 60000)
 *   RATE_LIMIT_MAX       — max requests per window (default: 20)
 */

import express from 'express';
import pg from 'pg';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3005', 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[oauth2] DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

// Token TTLs
const ACCESS_TOKEN_TTL_SECONDS = 3600;          // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600; // 7 days

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function generateToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Hash a plaintext secret: returns "salt:hash" using scrypt.
 */
async function hashSecret(plaintext) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(plaintext, salt, 32);
  return `${salt}:${hash.toString('hex')}`;
}

/**
 * Verify plaintext against a stored "salt:hash" string.
 */
async function verifySecret(plaintext, stored) {
  try {
    const [salt, hashHex] = stored.split(':');
    if (!salt || !hashHex) return false;
    const hash = await scryptAsync(plaintext, salt, 32);
    const storedHash = Buffer.from(hashHex, 'hex');
    if (hash.length !== storedHash.length) return false;
    return timingSafeEqual(hash, storedHash);
  } catch {
    return false;
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const RATE_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_MAX = parseInt(process.env.RATE_LIMIT_MAX || '20', 10);
const rateLimits = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_WINDOW;
  } else {
    entry.count++;
  }
  rateLimits.set(key, entry);
  return entry.count <= RATE_MAX;
}

// Clean up rate limit map every minute to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 60_000).unref();

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.disable('x-powered-by');

// Accept both JSON and form-encoded bodies (RFC 6749 uses application/x-www-form-urlencoded)
app.use(express.json({ limit: '4kb' }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));

// ─── POST /oauth2/token ───────────────────────────────────────────────────────

app.post('/oauth2/token', async (req, res) => {
  const ip = req.ip || 'unknown';

  // Rate limit on the token endpoint to prevent brute force
  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      error: 'too_many_requests',
      error_description: 'Rate limit exceeded. Try again later.',
    });
  }

  const { grant_type, client_id, client_secret, refresh_token } = req.body;

  if (!grant_type) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'grant_type is required' });
  }

  // ── Client Credentials Flow ──
  if (grant_type === 'client_credentials') {
    if (!client_id || !client_secret) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and client_secret are required',
      });
    }

    let client;
    try {
      const result = await pool.query(
        'SELECT client_id, client_secret_hash, scopes FROM oauth2_clients WHERE client_id = $1 AND active = true',
        [client_id]
      );
      client = result.rows[0];
    } catch (err) {
      console.error('[oauth2] DB error on client lookup:', err.message);
      return res.status(500).json({ error: 'server_error' });
    }

    if (!client) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Unknown client' });
    }

    const valid = await verifySecret(client_secret, client.client_secret_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Invalid credentials' });
    }

    // Resolve the client's authorized scopes (new normalized table, fallback to legacy column)
    const allowedScopes = await resolveClientScopes(pool, client.client_id, client.scopes);

    // Optional: client requests a specific subset of scopes
    const requestedRaw = typeof req.body.scope === 'string' ? req.body.scope.trim() : null;
    let grantedScopes;
    if (requestedRaw) {
      const requested = requestedRaw.split(/\s+/).filter(Boolean);
      const unauthorized = requested.filter(s => !allowedScopes.includes(s));
      if (unauthorized.length > 0) {
        console.warn(`[oauth2] scope escalation attempt client=${client.client_id} unauthorized=${unauthorized.join(' ')}`);
        return res.status(400).json({
          error: 'invalid_scope',
          error_description: `Client not authorized for scope(s): ${unauthorized.join(' ')}`,
        });
      }
      grantedScopes = requested;
    } else {
      grantedScopes = allowedScopes;
    }

    return await issueTokens(res, client.client_id, grantedScopes.join(' '));

  // ── Refresh Token Flow ──
  } else if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
    }

    let oldToken;
    try {
      const result = await pool.query(
        `SELECT id, client_id, scopes FROM oauth2_tokens
         WHERE refresh_token = $1 AND revoked = false AND refresh_expires_at > NOW()`,
        [refresh_token]
      );
      oldToken = result.rows[0];
    } catch (err) {
      console.error('[oauth2] DB error on refresh_token lookup:', err.message);
      return res.status(500).json({ error: 'server_error' });
    }

    if (!oldToken) {
      return res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
    }

    // Revoke old token (refresh token rotation)
    await pool.query('UPDATE oauth2_tokens SET revoked = true WHERE id = $1', [oldToken.id]);

    return await issueTokens(res, oldToken.client_id, oldToken.scopes);

  } else {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
});

/**
 * Resolve the set of scopes a client is authorized for.
 * Checks the normalized oauth2_client_scopes table first;
 * falls back to the legacy space-separated scopes column.
 */
async function resolveClientScopes(dbPool, clientId, legacyScopes) {
  try {
    const result = await dbPool.query(
      'SELECT scope_name FROM oauth2_client_scopes WHERE client_id = $1',
      [clientId]
    );
    if (result.rows.length > 0) {
      return result.rows.map(r => r.scope_name);
    }
  } catch {
    // oauth2_client_scopes table may not exist yet — fall through to legacy
  }
  // Legacy: parse the space-separated scopes column
  return (legacyScopes || '').split(/\s+/).filter(Boolean);
}

async function issueTokens(res, clientId, scopes) {
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  try {
    await pool.query(
      `INSERT INTO oauth2_tokens (access_token, refresh_token, client_id, scopes, expires_at, refresh_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [accessToken, refreshToken, clientId, scopes, expiresAt, refreshExpiresAt]
    );
  } catch (err) {
    console.error('[oauth2] DB error issuing tokens:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  return res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes,
  });
}

// ─── POST /oauth2/introspect (RFC 7662) ───────────────────────────────────────

app.post('/oauth2/introspect', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
  }

  let row;
  try {
    const result = await pool.query(
      `SELECT client_id, scopes, expires_at FROM oauth2_tokens
       WHERE access_token = $1 AND revoked = false`,
      [token]
    );
    row = result.rows[0];
  } catch (err) {
    console.error('[oauth2] DB error on introspect:', err.message);
    return res.status(500).json({ error: 'server_error' });
  }

  if (!row || new Date(row.expires_at) < new Date()) {
    return res.json({ active: false });
  }

  return res.json({
    active: true,
    client_id: row.client_id,
    scope: row.scopes,
    expires_at: Math.floor(new Date(row.expires_at).getTime() / 1000),
    token_type: 'Bearer',
  });
});

// ─── POST /oauth2/revoke (RFC 7009) ───────────────────────────────────────────

app.post('/oauth2/revoke', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
  }

  try {
    await pool.query(
      'UPDATE oauth2_tokens SET revoked = true WHERE access_token = $1 OR refresh_token = $1',
      [token]
    );
  } catch (err) {
    console.error('[oauth2] DB error on revoke:', err.message);
    // RFC 7009: respond 200 even if token not found
  }

  return res.json({ revoked: true });
});

// ─── GET /oauth2/scopes ───────────────────────────────────────────────────────

app.get('/oauth2/scopes', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT scope, description, restricted FROM oauth2_scope_definitions ORDER BY scope'
    );
    res.json({ scopes: result.rows });
  } catch (err) {
    // Table may not exist yet if migration hasn't run
    res.status(503).json({ error: 'server_error', error_description: err.message });
  }
});

// ─── GET /oauth2/health ───────────────────────────────────────────────────────

app.get('/oauth2/health', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM oauth2_clients WHERE active = true) AS active_clients,
         (SELECT COUNT(*) FROM oauth2_tokens WHERE revoked = false AND expires_at > NOW()) AS active_tokens`
    );
    const { active_clients, active_tokens } = result.rows[0];
    res.json({
      status: 'ok',
      service: 'oauth2-server',
      port: PORT,
      ts: new Date().toISOString(),
      stats: {
        active_clients: parseInt(active_clients, 10),
        active_tokens: parseInt(active_tokens, 10),
      },
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[oauth2] unhandled error:', err);
  res.status(500).json({ error: 'server_error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('[oauth2] PostgreSQL connected');
  } catch (err) {
    console.error('[oauth2] Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[oauth2] Authorization server listening on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`[oauth2] ${signal} — shutting down`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start();
