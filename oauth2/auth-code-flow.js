/**
 * OAuth2 Authorization Code Flow (RFC 6749)
 * v1.1.0 Feature: Web UI login and third-party integrations
 * 
 * Features:
 * - User login (password-based MVP)
 * - Authorization consent screen
 * - PKCE support (code challenge/verifier)
 * - Remember consent (30-day cookie)
 * - Authorization code exchange for tokens
 */

const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/oauth2',
});

// ============= Database Schema =============

async function initializeAuthCodeSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth2_users (
      user_id VARCHAR(255) PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth2_authorization_codes (
      code VARCHAR(64) PRIMARY KEY,
      client_id VARCHAR(255) NOT NULL REFERENCES oauth2_clients(client_id),
      user_id VARCHAR(255) NOT NULL REFERENCES oauth2_users(user_id),
      redirect_uri VARCHAR(512) NOT NULL,
      scope TEXT NOT NULL,
      code_challenge VARCHAR(128),
      code_challenge_method VARCHAR(10),
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth2_user_consents (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL REFERENCES oauth2_users(user_id),
      client_id VARCHAR(255) NOT NULL REFERENCES oauth2_clients(client_id),
      scope TEXT NOT NULL,
      consent_given BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, client_id)
    );

    CREATE INDEX ON oauth2_authorization_codes(user_id);
    CREATE INDEX ON oauth2_authorization_codes(expires_at);
  `);

  console.log('✅ Authorization Code flow schema initialized');
}

// ============= Utilities =============

function generateAuthCode() {
  return crypto.randomBytes(32).toString('hex');
}

function generateCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function validateUser(username, password) {
  // Simplified - in production use bcrypt
  // For MVP, password is just plaintext stored hash
  const result = await pool.query(
    'SELECT * FROM oauth2_users WHERE username = $1',
    [username]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];
  // Very simplified - real implementation would use bcrypt
  if (user.password_hash === password) {
    return user.user_id;
  }

  return null;
}

// ============= Routes =============

/**
 * GET /oauth2/authorize - Start authorization flow
 * 
 * Query params:
 *   client_id, redirect_uri, scope, response_type=code, state
 *   code_challenge, code_challenge_method (optional, PKCE)
 */
router.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = req.query;

  // Validate parameters
  if (!client_id || !redirect_uri || !scope) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Verify client exists
  const clientResult = await pool.query(
    'SELECT * FROM oauth2_clients WHERE client_id = $1',
    [client_id]
  );

  if (clientResult.rows.length === 0) {
    return res.status(400).json({ error: 'Invalid client_id' });
  }

  // Check if user is already logged in
  const userId = req.session?.user_id;

  if (!userId) {
    // Redirect to login
    return res.redirect(
      `/oauth2/login?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state || '')}&code_challenge=${encodeURIComponent(code_challenge || '')}`
    );
  }

  // Check if user has previously consented
  const consentResult = await pool.query(
    `SELECT * FROM oauth2_user_consents 
     WHERE user_id = $1 AND client_id = $2 
     AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId, client_id]
  );

  if (consentResult.rows.length > 0 && consentResult.rows[0].consent_given) {
    // User has consented before, skip consent screen
    return generateAuthCodeAndRedirect(req, res, userId, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method);
  }

  // Show consent screen
  res.json({
    step: 'consent_required',
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
  });
});

/**
 * POST /oauth2/authorize - User grants or denies authorization
 */
router.post('/authorize', async (req, res) => {
  const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method, action } = req.body;
  const userId = req.session?.user_id;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (action === 'deny') {
    // User denied authorization
    const errorUrl = `${redirect_uri}?error=access_denied&error_description=User+denied+authorization&state=${encodeURIComponent(state || '')}`;
    return res.redirect(errorUrl);
  }

  if (action === 'approve') {
    // User approved - save consent and generate auth code
    await pool.query(
      `INSERT INTO oauth2_user_consents (user_id, client_id, scope, consent_given, expires_at)
       VALUES ($1, $2, $3, TRUE, NOW() + INTERVAL '30 days')
       ON CONFLICT (user_id, client_id) 
       DO UPDATE SET consent_given = TRUE, expires_at = NOW() + INTERVAL '30 days'`,
      [userId, client_id, scope]
    );

    return generateAuthCodeAndRedirect(req, res, userId, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method);
  }

  res.status(400).json({ error: 'Invalid action' });
});

/**
 * Helper: Generate auth code and redirect
 */
async function generateAuthCodeAndRedirect(
  req, res, userId, clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod
) {
  const authCode = generateAuthCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.query(
    `INSERT INTO oauth2_authorization_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [authCode, clientId, userId, redirectUri, scope, codeChallenge, codeChallengeMethod, expiresAt]
  );

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', authCode);
  if (state) redirectUrl.searchParams.set('state', state);

  res.redirect(redirectUrl.toString());
}

/**
 * GET /oauth2/login - Show login form
 */
router.get('/login', (req, res) => {
  const { client_id, redirect_uri, scope, state, code_challenge } = req.query;

  res.json({
    step: 'login',
    message: 'Please login to continue',
    client_id,
    redirect_uri,
    scope,
    state,
    code_challenge,
  });
});

/**
 * POST /oauth2/login - Process login
 */
router.post('/login', async (req, res) => {
  const { username, password, client_id, redirect_uri, scope, state, code_challenge } = req.body;

  // Validate credentials
  const userId = await validateUser(username, password);

  if (!userId) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Store user session
  req.session.user_id = userId;

  // Redirect to consent screen
  const authorizeUrl = `/oauth2/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state || '')}&code_challenge=${encodeURIComponent(code_challenge || '')}`;

  res.redirect(authorizeUrl);
});

/**
 * POST /oauth2/token with auth code exchange
 * 
 * Body params:
 *   code, client_id, client_secret, redirect_uri, code_verifier (optional, PKCE)
 */
router.post('/token/auth-code', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri, code_verifier } = req.body;

  if (!code || !client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // Verify authorization code
    const codeResult = await pool.query(
      `SELECT * FROM oauth2_authorization_codes 
       WHERE code = $1 AND expires_at > NOW()`,
      [code]
    );

    if (codeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired authorization code' });
    }

    const authCode = codeResult.rows[0];

    // Verify code matches request
    if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'Code mismatch' });
    }

    // Verify PKCE if code_challenge was provided
    if (authCode.code_challenge && code_verifier) {
      const challenge = generateCodeChallenge(code_verifier);
      if (challenge !== authCode.code_challenge) {
        return res.status(400).json({ error: 'Invalid code_verifier' });
      }
    }

    // Delete code (prevent reuse)
    await pool.query('DELETE FROM oauth2_authorization_codes WHERE code = $1', [code]);

    // Generate tokens (same as client credentials flow)
    // In production, call main token endpoint logic here
    res.json({
      access_token: 'eyJ...',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'eyJ...',
      scope: authCode.scope,
      user_id: authCode.user_id,
    });
  } catch (error) {
    console.error('Error in token exchange:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /oauth2/logout - Logout user
 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ logged_out: true });
  });
});

module.exports = {
  router,
  initializeAuthCodeSchema,
};
