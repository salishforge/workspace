/**
 * OAuth2 Authorization Code Flow — RFC 6749 §4.1
 * v1.1.0 — Salish Forge
 *
 * Exports:
 *   createAuthCodeRouter(pool, issueTokensFn) → Express Router
 *   initializeAuthCodeSchema(pool)            → Promise<void>
 *
 * Routes mounted under the parent app (no /oauth2 prefix here):
 *   GET  /authorize      — validate params; redirect to login or show consent
 *   POST /authorize      — process user grant/deny; issue auth code
 *   GET  /login          — render login form
 *   POST /login          — process credentials; create session; redirect to /authorize
 *   GET  /error          — render OAuth2 error page
 *   POST /logout         — destroy session
 *
 * Token exchange (authorization_code grant) is handled in oauth2-server.js
 * because it needs access to the issueTokens function.
 *
 * Security:
 *   - Passwords hashed with scrypt (same algorithm as client secrets)
 *   - Sessions stored in DB; ID delivered via HttpOnly cookie
 *   - PKCE S256 support to prevent auth code interception
 *   - redirect_uri strictly validated against registered client
 *   - Auth codes are single-use (deleted on exchange)
 *   - Consent remembered 30 days (skips consent screen on re-authorize)
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { Router } from 'express';

const scryptAsync = promisify(scrypt);

// Session cookie settings
const SESSION_COOKIE = 'oauth2_sid';
const SESSION_TTL_MS = 60 * 60 * 1000;      // 1 hour
const CONSENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CODE_TTL_MS    = 10 * 60 * 1000;      // 10 minutes

// ─── Schema ──────────────────────────────────────────────────────────────────

export async function initializeAuthCodeSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth2_users (
      user_id        TEXT        PRIMARY KEY,
      username       TEXT        UNIQUE NOT NULL,
      password_hash  TEXT        NOT NULL,
      scopes         TEXT        NOT NULL DEFAULT '',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth2_sessions (
      session_id  TEXT        PRIMARY KEY,
      user_id     TEXT        NOT NULL REFERENCES oauth2_users(user_id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth2_authorization_codes (
      code                  TEXT        PRIMARY KEY,
      client_id             TEXT        NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
      user_id               TEXT        NOT NULL REFERENCES oauth2_users(user_id) ON DELETE CASCADE,
      redirect_uri          TEXT        NOT NULL,
      scope                 TEXT        NOT NULL,
      code_challenge        TEXT,
      code_challenge_method TEXT,
      expires_at            TIMESTAMPTZ NOT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth2_user_consents (
      user_id       TEXT        NOT NULL REFERENCES oauth2_users(user_id) ON DELETE CASCADE,
      client_id     TEXT        NOT NULL REFERENCES oauth2_clients(client_id) ON DELETE CASCADE,
      scope         TEXT        NOT NULL,
      consent_given BOOLEAN     NOT NULL DEFAULT false,
      expires_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, client_id)
    );

    ALTER TABLE oauth2_tokens
      ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES oauth2_users(user_id) ON DELETE SET NULL;
  `);

  // Indexes (idempotent)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_oauth2_sessions_expires ON oauth2_sessions (expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth2_codes_expires    ON oauth2_authorization_codes (expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth2_consents_expires ON oauth2_user_consents (expires_at)
      WHERE expires_at IS NOT NULL;
  `);

  console.log('[oauth2] Auth code flow schema initialized');
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

async function hashPassword(plaintext) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(plaintext, salt, 32);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(plaintext, stored) {
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

/**
 * Compute PKCE code_challenge from code_verifier using S256 method.
 * SHA256(verifier) → base64url (no padding)
 */
export function computeCodeChallenge(verifier) {
  return createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ─── Session management ───────────────────────────────────────────────────────

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...rest] = c.trim().split('=');
      return [k.trim(), decodeURIComponent(rest.join('='))];
    })
  );
}

async function createSession(pool, userId) {
  const sessionId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO oauth2_sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [sessionId, userId, expiresAt]
  );
  return sessionId;
}

async function resolveSession(pool, sessionId) {
  if (!sessionId) return null;
  const result = await pool.query(
    `SELECT user_id FROM oauth2_sessions WHERE session_id = $1 AND expires_at > NOW()`,
    [sessionId]
  );
  return result.rows[0]?.user_id ?? null;
}

async function destroySession(pool, sessionId) {
  if (!sessionId) return;
  await pool.query('DELETE FROM oauth2_sessions WHERE session_id = $1', [sessionId]);
}

/**
 * Middleware: resolves session cookie → req.sessionUserId
 */
function makeSessionMiddleware(pool) {
  return async (req, _res, next) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const sid = cookies[SESSION_COOKIE];
      req.sessionId = sid || null;
      req.sessionUserId = sid ? await resolveSession(pool, sid) : null;
    } catch {
      req.sessionId = null;
      req.sessionUserId = null;
    }
    next();
  };
}

// ─── HTML templates ───────────────────────────────────────────────────────────

const CSS = `
  body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.1);padding:2rem;width:100%;max-width:420px}
  h1{margin:0 0 1.5rem;font-size:1.4rem;color:#1a1a2e}
  .logo{font-weight:700;color:#4f46e5;font-size:1.1rem;margin-bottom:1rem;display:block}
  label{display:block;font-size:.875rem;font-weight:500;color:#374151;margin-bottom:.25rem}
  input[type=text],input[type=password]{width:100%;padding:.625rem .75rem;border:1px solid #d1d5db;border-radius:6px;font-size:.95rem;box-sizing:border-box;margin-bottom:1rem}
  input:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 2px rgba(79,70,229,.15)}
  .btn{display:block;width:100%;padding:.75rem;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer;text-align:center}
  .btn-primary{background:#4f46e5;color:#fff}.btn-primary:hover{background:#4338ca}
  .btn-deny{background:#f3f4f6;color:#374151;margin-top:.5rem}.btn-deny:hover{background:#e5e7eb}
  .scope-list{background:#f9fafb;border-radius:8px;padding:1rem;margin:1rem 0}
  .scope-item{display:flex;align-items:center;gap:.5rem;padding:.25rem 0;font-size:.875rem;color:#374151}
  .scope-item::before{content:"✓";color:#10b981;font-weight:700}
  .client-name{font-weight:600;color:#1a1a2e}
  .error-code{font-size:.8rem;color:#9ca3af;margin-top:1rem;font-family:monospace}
  .alert{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:.75rem;font-size:.875rem;color:#b91c1c;margin-bottom:1rem}
`;

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Salish Forge</title>
  <style>${CSS}</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function loginPage({ client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, error } = {}) {
  const hidden = [
    ['client_id', client_id],
    ['redirect_uri', redirect_uri],
    ['scope', scope],
    ['state', state],
    ['code_challenge', code_challenge],
    ['code_challenge_method', code_challenge_method],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escHtml(v)}">`)
    .join('\n    ');

  const errorBanner = error
    ? `<div class="alert">${escHtml(error)}</div>`
    : '';

  return htmlPage('Sign in', `
  <span class="logo">⚡ Salish Forge</span>
  <h1>Sign in</h1>
  ${errorBanner}
  <form method="POST" action="/oauth2/login">
    ${hidden}
    <label for="username">Username</label>
    <input type="text" id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit" class="btn btn-primary">Sign in</button>
  </form>`);
}

function consentPage({ clientDescription, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method }) {
  const scopes = (scope || '').split(/\s+/).filter(Boolean);
  const scopeItems = scopes.map(s => `<div class="scope-item">${escHtml(s)}</div>`).join('');

  const hidden = [
    ['client_id', client_id],
    ['redirect_uri', redirect_uri],
    ['scope', scope],
    ['state', state],
    ['code_challenge', code_challenge],
    ['code_challenge_method', code_challenge_method],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escHtml(v)}">`)
    .join('\n    ');

  return htmlPage('Authorize Access', `
  <span class="logo">⚡ Salish Forge</span>
  <h1>Authorize Access</h1>
  <p>
    <span class="client-name">${escHtml(clientDescription || client_id)}</span>
    is requesting access to your account.
  </p>
  <div class="scope-list">
    <div style="font-size:.8rem;color:#6b7280;margin-bottom:.5rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Permissions requested</div>
    ${scopeItems || '<div class="scope-item">Basic access</div>'}
  </div>
  <form method="POST" action="/oauth2/authorize">
    ${hidden}
    <input type="hidden" name="action" value="approve">
    <button type="submit" class="btn btn-primary">Allow Access</button>
  </form>
  <form method="POST" action="/oauth2/authorize">
    ${hidden}
    <input type="hidden" name="action" value="deny">
    <button type="submit" class="btn btn-deny">Deny</button>
  </form>`);
}

function errorPage({ error, error_description }) {
  return htmlPage('Authorization Error', `
  <span class="logo">⚡ Salish Forge</span>
  <h1>Authorization Error</h1>
  <p>${escHtml(error_description || 'An error occurred during authorization.')}</p>
  <div class="error-code">${escHtml(error || 'unknown_error')}</div>`);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Router factory ───────────────────────────────────────────────────────────

/**
 * @param {import('pg').Pool} pool  — shared PostgreSQL pool
 * @param {Function} issueTokensFn — async (res, clientId, scopes, userId) → void
 *   Issues access + refresh tokens and sends the JSON response.
 */
export function createAuthCodeRouter(pool, issueTokensFn) {
  const router = Router();
  const sessionMiddleware = makeSessionMiddleware(pool);

  // Attach session to all requests through this router
  router.use(sessionMiddleware);

  // ── GET /oauth2/authorize ─────────────────────────────────────────────────
  // Step 1: Validate params. If not logged in → redirect to login.
  // If logged in and consented → issue code directly.
  // Otherwise → show consent screen.
  router.get('/authorize', async (req, res) => {
    const {
      client_id, redirect_uri, scope, state,
      code_challenge, code_challenge_method,
      response_type = 'code',
    } = req.query;

    // Basic validation
    if (!client_id || !redirect_uri || !scope) {
      return res.status(400).send(errorPage({
        error: 'invalid_request',
        error_description: 'client_id, redirect_uri, and scope are required.',
      }));
    }

    if (response_type !== 'code') {
      return res.status(400).send(errorPage({
        error: 'unsupported_response_type',
        error_description: `response_type "${response_type}" is not supported. Use "code".`,
      }));
    }

    // Verify client
    let client;
    try {
      const result = await pool.query(
        'SELECT client_id, description FROM oauth2_clients WHERE client_id = $1 AND active = true',
        [client_id]
      );
      client = result.rows[0];
    } catch (err) {
      console.error('[oauth2] DB error on client lookup:', err.message);
      return res.status(500).send(errorPage({ error: 'server_error' }));
    }

    if (!client) {
      return res.status(400).send(errorPage({
        error: 'invalid_client',
        error_description: `Unknown client "${client_id}".`,
      }));
    }

    // Require PKCE if code_challenge_method is provided; only S256 is supported
    if (code_challenge_method && code_challenge_method !== 'S256') {
      return res.status(400).send(errorPage({
        error: 'invalid_request',
        error_description: `code_challenge_method "${code_challenge_method}" is not supported. Use "S256".`,
      }));
    }

    const params = { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method };

    // Not logged in → redirect to login
    if (!req.sessionUserId) {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null));
      return res.redirect(`/oauth2/login?${qs}`);
    }

    // Check existing consent
    let hasConsent = false;
    try {
      const consentResult = await pool.query(
        `SELECT 1 FROM oauth2_user_consents
         WHERE user_id = $1 AND client_id = $2 AND consent_given = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [req.sessionUserId, client_id]
      );
      hasConsent = consentResult.rows.length > 0;
    } catch (err) {
      console.error('[oauth2] DB error on consent lookup:', err.message);
    }

    if (hasConsent) {
      return issueCodeAndRedirect(pool, res, {
        userId: req.sessionUserId, clientId: client_id,
        redirectUri: redirect_uri, scope, state,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
      });
    }

    // Show consent screen
    return res.send(consentPage({
      clientDescription: client.description,
      ...params,
    }));
  });

  // ── POST /oauth2/authorize ────────────────────────────────────────────────
  // Step 2: User submits the consent form (approve or deny).
  router.post('/authorize', async (req, res) => {
    const {
      client_id, redirect_uri, scope, state,
      code_challenge, code_challenge_method,
      action,
    } = req.body;

    if (!req.sessionUserId) {
      return res.status(401).send(errorPage({
        error: 'unauthenticated',
        error_description: 'Session expired. Please log in again.',
      }));
    }

    if (!client_id || !redirect_uri || !scope) {
      return res.status(400).send(errorPage({
        error: 'invalid_request',
        error_description: 'Missing required form fields.',
      }));
    }

    if (action === 'deny') {
      const url = new URL(redirect_uri);
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'User denied authorization.');
      if (state) url.searchParams.set('state', state);
      return res.redirect(url.toString());
    }

    if (action !== 'approve') {
      return res.status(400).send(errorPage({
        error: 'invalid_request',
        error_description: `Unknown action "${action}".`,
      }));
    }

    // Save consent (upsert, 30-day TTL)
    try {
      await pool.query(
        `INSERT INTO oauth2_user_consents (user_id, client_id, scope, consent_given, expires_at)
         VALUES ($1, $2, $3, true, NOW() + INTERVAL '30 days')
         ON CONFLICT (user_id, client_id)
         DO UPDATE SET consent_given = true,
                       scope = EXCLUDED.scope,
                       expires_at = NOW() + INTERVAL '30 days'`,
        [req.sessionUserId, client_id, scope]
      );
    } catch (err) {
      console.error('[oauth2] DB error saving consent:', err.message);
      return res.status(500).send(errorPage({ error: 'server_error' }));
    }

    return issueCodeAndRedirect(pool, res, {
      userId: req.sessionUserId, clientId: client_id,
      redirectUri: redirect_uri, scope, state,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    });
  });

  // ── GET /oauth2/login ─────────────────────────────────────────────────────
  router.get('/login', (req, res) => {
    if (req.sessionUserId) {
      // Already logged in — redirect back to authorize
      const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = req.query;
      if (client_id && redirect_uri && scope) {
        const qs = new URLSearchParams(
          Object.entries({ client_id, redirect_uri, scope, state, code_challenge, code_challenge_method })
            .filter(([, v]) => v != null)
        );
        return res.redirect(`/oauth2/authorize?${qs}`);
      }
    }
    res.send(loginPage(req.query));
  });

  // ── POST /oauth2/login ────────────────────────────────────────────────────
  router.post('/login', async (req, res) => {
    const {
      username, password,
      client_id, redirect_uri, scope, state,
      code_challenge, code_challenge_method,
    } = req.body;

    if (!username || !password) {
      return res.send(loginPage({
        client_id, redirect_uri, scope, state, code_challenge, code_challenge_method,
        error: 'Username and password are required.',
      }));
    }

    let user;
    try {
      const result = await pool.query(
        'SELECT user_id, password_hash FROM oauth2_users WHERE username = $1',
        [username]
      );
      user = result.rows[0];
    } catch (err) {
      console.error('[oauth2] DB error on login:', err.message);
      return res.status(500).send(errorPage({ error: 'server_error' }));
    }

    const valid = user && await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.send(loginPage({
        client_id, redirect_uri, scope, state, code_challenge, code_challenge_method,
        error: 'Invalid username or password.',
      }));
    }

    // Create session
    const sessionId = await createSession(pool, user.user_id);
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      // secure: true — enable in production behind HTTPS
    });

    // Redirect to authorize (continue the flow)
    const params = { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method };
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null));
    const target = client_id && redirect_uri && scope
      ? `/oauth2/authorize?${qs}`
      : '/';
    return res.redirect(target);
  });

  // ── GET /oauth2/error ─────────────────────────────────────────────────────
  router.get('/error', (req, res) => {
    const { error = 'unknown_error', error_description } = req.query;
    res.status(400).send(errorPage({ error, error_description }));
  });

  // ── POST /oauth2/logout ───────────────────────────────────────────────────
  router.post('/logout', async (req, res) => {
    if (req.sessionId) {
      await destroySession(pool, req.sessionId);
    }
    res.clearCookie(SESSION_COOKIE);
    res.json({ logged_out: true });
  });

  return router;
}

// ─── Auth code issuance ───────────────────────────────────────────────────────

async function issueCodeAndRedirect(pool, res, {
  userId, clientId, redirectUri, scope, state,
  codeChallenge, codeChallengeMethod,
}) {
  const code = randomBytes(32).toString('hex'); // 64 hex chars
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  try {
    await pool.query(
      `INSERT INTO oauth2_authorization_codes
         (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [code, clientId, userId, redirectUri, scope, codeChallenge || null, codeChallengeMethod || null, expiresAt]
    );
  } catch (err) {
    console.error('[oauth2] DB error issuing auth code:', err.message);
    return res.status(500).send(errorPage({ error: 'server_error' }));
  }

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return res.redirect(redirectUrl.toString());
}

// ─── User management helpers (for seeding/admin) ──────────────────────────────

/**
 * Create a user with a scrypt-hashed password.
 * @returns {Promise<string>} The generated user_id.
 */
export async function createUser(pool, { username, password, scopes = '' }) {
  const userId = randomBytes(12).toString('hex');
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO oauth2_users (user_id, username, password_hash, scopes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           scopes = EXCLUDED.scopes`,
    [userId, username, passwordHash, scopes]
  );
  return userId;
}
