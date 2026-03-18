/**
 * OAuth2 Bearer Token Middleware — reusable for Express services
 *
 * Usage:
 *   import { createOAuth2Middleware } from './oauth2-middleware.js';
 *
 *   const oauth2Auth = createOAuth2Middleware({
 *     introspectUrl: 'http://localhost:3005/oauth2/introspect', // optional
 *     skipPaths: ['/health', '/healthz', '/metrics'],           // optional
 *   });
 *
 *   app.use(oauth2Auth);
 *
 * Environment (fallback if options not provided):
 *   OAUTH2_INTROSPECT_URL — default: http://localhost:3005/oauth2/introspect
 */

// Simple in-process token cache to avoid hammering the OAuth2 server
// Keys are access tokens, values are { active, client_id, scope, expires_at, cachedAt }
const TOKEN_CACHE = new Map();
const CACHE_TTL_MS = 30_000; // 30 seconds — short to respect token revocation

// Clean up expired cache entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of TOKEN_CACHE) {
    if (now - entry.cachedAt > CACHE_TTL_MS) TOKEN_CACHE.delete(token);
  }
}, 60_000).unref();

/**
 * Create OAuth2 authentication middleware.
 *
 * @param {object} [options]
 * @param {string} [options.introspectUrl] - OAuth2 introspect endpoint
 * @param {string[]} [options.skipPaths]   - Paths to skip auth (exact match)
 * @param {boolean} [options.required]     - Whether to reject unauthenticated (default: true)
 * @returns {import('express').RequestHandler}
 */
export function createOAuth2Middleware(options = {}) {
  const introspectUrl =
    options.introspectUrl ||
    process.env.OAUTH2_INTROSPECT_URL ||
    'http://localhost:3005/oauth2/introspect';

  const skipPaths = new Set(
    options.skipPaths || ['/health', '/healthz', '/metrics', '/api/spec.json']
  );

  const required = options.required !== false;

  return async function oauth2Auth(req, res, next) {
    // Skip auth for public paths
    if (skipPaths.has(req.path)) {
      return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (!required) return next();
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authorization: Bearer <token> header required',
      });
    }

    const token = authHeader.slice(7);

    // Check cache
    const cached = TOKEN_CACHE.get(token);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      if (!cached.active) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Token is expired or revoked',
        });
      }
      req.oauth2 = { client_id: cached.client_id, scope: cached.scope };
      return next();
    }

    // Introspect with OAuth2 server
    let data;
    try {
      const response = await fetch(introspectUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`Introspect HTTP ${response.status}`);
      }

      data = await response.json();
    } catch (err) {
      console.error('[oauth2-middleware] introspect failed:', err.message);
      if (!required) return next();
      return res.status(503).json({
        error: 'service_unavailable',
        error_description: 'OAuth2 server unavailable',
      });
    }

    // Cache the result
    TOKEN_CACHE.set(token, { ...data, cachedAt: Date.now() });

    if (!data.active) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token is expired or revoked',
      });
    }

    req.oauth2 = { client_id: data.client_id, scope: data.scope };
    return next();
  };
}

/**
 * OAuth2 client helper — manages token acquisition and refresh.
 *
 * Usage:
 *   const oauth2Client = new OAuth2Client({
 *     tokenUrl: 'http://localhost:3005/oauth2/token',
 *     clientId: 'dashboard',
 *     clientSecret: process.env.OAUTH2_CLIENT_SECRET,
 *   });
 *
 *   // On startup:
 *   await oauth2Client.init();
 *
 *   // In requests:
 *   const headers = await oauth2Client.getAuthHeaders();
 *   fetch(url, { headers });
 */
export class OAuth2Client {
  constructor(options) {
    this.tokenUrl = options.tokenUrl || process.env.OAUTH2_TOKEN_URL || 'http://localhost:3005/oauth2/token';
    this.clientId = options.clientId || process.env.OAUTH2_CLIENT_ID;
    this.clientSecret = options.clientSecret || process.env.OAUTH2_CLIENT_SECRET;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
    this._refreshing = null;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('OAuth2Client requires clientId and clientSecret');
    }
  }

  /** Acquire initial tokens. Call once on service startup. */
  async init() {
    console.log(`[oauth2-client:${this.clientId}] Acquiring initial token`);
    await this._acquireToken();
    console.log(`[oauth2-client:${this.clientId}] Token acquired, expires ${this.expiresAt.toISOString()}`);
  }

  /**
   * Returns Authorization header with a valid token.
   * Automatically refreshes if within 5 minutes of expiry.
   */
  async getAuthHeaders() {
    await this._ensureValid();
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async _ensureValid() {
    if (!this.accessToken || !this.expiresAt) {
      await this._acquireToken();
      return;
    }
    // Refresh if within 5 minutes of expiry
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() > this.expiresAt.getTime() - fiveMinutes) {
      if (this._refreshing) {
        await this._refreshing;
      } else {
        this._refreshing = this._refresh().finally(() => { this._refreshing = null; });
        await this._refreshing;
      }
    }
  }

  async _acquireToken() {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Token acquisition failed: HTTP ${response.status} — ${err}`);
    }

    const data = await response.json();
    this._storeTokens(data);
  }

  async _refresh() {
    if (!this.refreshToken) {
      return this._acquireToken();
    }

    console.log(`[oauth2-client:${this.clientId}] Refreshing token`);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    });

    try {
      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.warn(`[oauth2-client:${this.clientId}] Refresh failed, re-acquiring`);
        return this._acquireToken();
      }

      const data = await response.json();
      this._storeTokens(data);
      console.log(`[oauth2-client:${this.clientId}] Token refreshed, expires ${this.expiresAt.toISOString()}`);
    } catch (err) {
      console.error(`[oauth2-client:${this.clientId}] Refresh error:`, err.message);
      return this._acquireToken();
    }
  }

  _storeTokens(data) {
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    this.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  }
}
