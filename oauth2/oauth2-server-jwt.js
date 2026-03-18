/**
 * OAuth2 Authorization Server (RFC 6749) with JWT Support
 * v1.1.0 Feature: JWT tokens instead of introspection calls
 * 
 * Features:
 * - Client credentials + refresh token flows
 * - JWT access tokens (RS256, stateless validation)
 * - Opaque refresh tokens (DB-backed)
 * - Token introspection (RFC 7662) - for legacy/fallback
 * - Token revocation (RFC 7009)
 * - Scope-based authorization
 * - /oauth2/.well-known/jwks.json endpoint
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10kb' }));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/oauth2',
  max: 10,
});

// Configuration
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || fs.readFileSync(path.join(__dirname, 'keys/jwt-private.pem'), 'utf8');
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || fs.readFileSync(path.join(__dirname, 'keys/jwt-public.pem'), 'utf8');
const AUTH_TOKEN = process.env.HYPHAE_AUTH_TOKEN || 'test-auth-token';
const JWT_ALGORITHM = 'RS256';
const ACCESS_TOKEN_EXPIRY = 3600; // 1 hour
const REFRESH_TOKEN_EXPIRY = 604800; // 7 days

// Extract key ID from public key
const KEY_ID = crypto
  .createHash('sha256')
  .update(JWT_PUBLIC_KEY)
  .digest('hex')
  .substring(0, 8);

console.log(`ℹ️  OAuth2 Server with JWT Support`);
console.log(`   Key ID: ${KEY_ID}`);
console.log(`   Algorithm: ${JWT_ALGORITHM}`);
console.log(`   Access Token TTL: ${ACCESS_TOKEN_EXPIRY}s`);

// ============= Database Schema =============

pool.query(`
  CREATE TABLE IF NOT EXISTS oauth2_clients (
    client_id VARCHAR(255) PRIMARY KEY,
    client_secret_hash VARCHAR(255) NOT NULL,
    scopes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS oauth2_tokens (
    id SERIAL PRIMARY KEY,
    access_token VARCHAR(2048),
    refresh_token VARCHAR(255) UNIQUE,
    client_id VARCHAR(255) NOT NULL REFERENCES oauth2_clients(client_id),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS oauth2_client_scopes (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL REFERENCES oauth2_clients(client_id),
    scope VARCHAR(255) NOT NULL,
    UNIQUE(client_id, scope)
  );
`)
.catch(err => console.error('Schema creation error:', err));

// ============= Utilities =============

function generateRandomToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function generateJWT(clientId, scopes) {
  const payload = {
    client_id: clientId,
    sub: clientId, // subject
    scope: scopes.join(' '),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY,
  };

  return jwt.sign(payload, JWT_PRIVATE_KEY, {
    algorithm: JWT_ALGORITHM,
    keyid: KEY_ID,
  });
}

// ============= Routes =============

// GET /oauth2/health
app.get('/oauth2/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'oauth2-server',
    features: ['jwt', 'introspection', 'refresh-tokens', 'scopes'],
    key_id: KEY_ID,
    ts: new Date().toISOString(),
  });
});

// GET /oauth2/.well-known/jwks.json (public key endpoint)
app.get('/oauth2/.well-known/jwks.json', (req, res) => {
  const { createPublicKey } = require('crypto');
  const publicKey = createPublicKey({ key: JWT_PUBLIC_KEY });
  const jwk = publicKey.export({ format: 'jwk' });

  res.json({
    keys: [
      {
        ...jwk,
        kid: KEY_ID,
        use: 'sig',
        alg: JWT_ALGORITHM,
      },
    ],
  });
});

// POST /oauth2/token - Issue tokens (RFC 6749)
app.post('/oauth2/token', async (req, res) => {
  const { client_id, client_secret, grant_type, refresh_token } = req.body;

  // Validate input
  if (!client_id || !client_secret || !grant_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Only support client_credentials and refresh_token grants for now
  if (!['client_credentials', 'refresh_token'].includes(grant_type)) {
    return res.status(400).json({ error: 'Unsupported grant_type' });
  }

  try {
    if (grant_type === 'client_credentials') {
      // Standard OAuth2 client credentials flow
      const result = await pool.query(
        'SELECT * FROM oauth2_clients WHERE client_id = $1',
        [client_id]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid client' });
      }

      const client = result.rows[0];

      // Verify secret (simplified - in production use bcrypt)
      if (client.client_secret_hash !== client_secret) {
        return res.status(401).json({ error: 'Invalid secret' });
      }

      // Get client scopes
      const scopeResult = await pool.query(
        'SELECT scope FROM oauth2_client_scopes WHERE client_id = $1 ORDER BY scope',
        [client_id]
      );

      const scopes = scopeResult.rows.map(r => r.scope);

      // Generate JWT access token
      const accessToken = generateJWT(client_id, scopes);
      const refreshToken = generateRandomToken(32);

      // Store refresh token
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);
      await pool.query(
        'INSERT INTO oauth2_tokens (access_token, refresh_token, client_id, expires_at) VALUES ($1, $2, $3, $4)',
        [accessToken, refreshToken, client_id, expiresAt]
      );

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY,
        refresh_token: refreshToken,
        scope: scopes.join(' '),
      });
    } else if (grant_type === 'refresh_token') {
      // Refresh token flow
      if (!refresh_token) {
        return res.status(400).json({ error: 'Missing refresh_token' });
      }

      const result = await pool.query(
        'SELECT * FROM oauth2_tokens WHERE refresh_token = $1 AND expires_at > NOW()',
        [refresh_token]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }

      const token = result.rows[0];

      // Get client info
      const clientResult = await pool.query(
        'SELECT * FROM oauth2_clients WHERE client_id = $1',
        [token.client_id]
      );

      if (clientResult.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid client' });
      }

      // Get scopes
      const scopeResult = await pool.query(
        'SELECT scope FROM oauth2_client_scopes WHERE client_id = $1 ORDER BY scope',
        [token.client_id]
      );

      const scopes = scopeResult.rows.map(r => r.scope);

      // Generate new JWT
      const newAccessToken = generateJWT(token.client_id, scopes);
      const newRefreshToken = generateRandomToken(32);

      // Update refresh token
      await pool.query(
        'UPDATE oauth2_tokens SET refresh_token = $1, expires_at = NOW() + INTERVAL \'7 days\' WHERE id = $2',
        [newRefreshToken, token.id]
      );

      res.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_EXPIRY,
        refresh_token: newRefreshToken,
        scope: scopes.join(' '),
      });
    }
  } catch (error) {
    console.error('Error in /oauth2/token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /oauth2/introspect (RFC 7662) - For backward compatibility
app.post('/oauth2/introspect', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // Try to verify as JWT first
    const decoded = jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: [JWT_ALGORITHM] });

    res.json({
      active: true,
      client_id: decoded.client_id,
      scope: decoded.scope,
      iat: decoded.iat,
      exp: decoded.exp,
    });
  } catch (jwtError) {
    // If not JWT, check refresh tokens
    const result = await pool.query(
      'SELECT * FROM oauth2_tokens WHERE refresh_token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length > 0) {
      res.json({
        active: true,
        client_id: result.rows[0].client_id,
        token_type: 'refresh',
        exp: Math.floor(new Date(result.rows[0].expires_at).getTime() / 1000),
      });
    } else {
      res.json({ active: false });
    }
  }
});

// POST /oauth2/revoke (RFC 7009)
app.post('/oauth2/revoke', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM oauth2_tokens WHERE refresh_token = $1 RETURNING id',
      [token]
    );

    res.json({ revoked: result.rowCount > 0 });
  } catch (error) {
    console.error('Error in /oauth2/revoke:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3005;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ OAuth2 server listening on http://127.0.0.1:${PORT}`);
  console.log(`   JWT Support: ENABLED (RS256, stateless validation)`);
  console.log(`   Public Key: /oauth2/.well-known/jwks.json`);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await pool.end();
  process.exit(0);
});

module.exports = app;
