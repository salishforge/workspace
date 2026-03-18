# OAuth2 Authorization Code Flow — Developer Guide

**Spec:** RFC 6749 §4.1
**Version:** v1.1.0
**Server port:** 3005 (default)

---

## Flow Diagram

```
Client App                    OAuth2 Server                    User Browser
    │                               │                               │
    │  Redirect user to /authorize  │                               │
    │──────────────────────────────►│                               │
    │                               │  Show login form (HTML)       │
    │                               │──────────────────────────────►│
    │                               │                               │
    │                               │  POST /oauth2/login           │
    │                               │◄──────────────────────────────│
    │                               │  (username, password)         │
    │                               │                               │
    │                               │  Session cookie set           │
    │                               │  Show consent screen          │
    │                               │──────────────────────────────►│
    │                               │                               │
    │                               │  POST /oauth2/authorize       │
    │                               │◄──────────────────────────────│
    │                               │  (action=approve)             │
    │                               │                               │
    │                               │  Redirect to redirect_uri     │
    │                               │  with ?code=AUTH_CODE         │
    │                               │──────────────────────────────►│
    │                               │                               │
    │  Browser follows redirect     │                               │
    │◄──────────────────────────────│                               │
    │  GET /callback?code=AUTH_CODE │                               │
    │                               │                               │
    │  POST /oauth2/token           │                               │
    │  (code + client_secret)       │                               │
    │──────────────────────────────►│                               │
    │                               │                               │
    │  { access_token, user_id }    │                               │
    │◄──────────────────────────────│                               │
    │                               │                               │
    │  API call with Bearer token   │                               │
    │──────────────────────────────►│                               │
```

---

## Endpoints

### `GET /oauth2/authorize`

Starts the authorization flow. Validates parameters, redirects to login if
the user has no session, shows consent screen if this is the first grant.

**Query parameters:**

| Parameter              | Required | Description |
|------------------------|----------|-------------|
| `client_id`            | ✅       | Registered client ID |
| `redirect_uri`         | ✅       | Must match registered URI exactly |
| `scope`                | ✅       | Space-separated list of requested scopes |
| `response_type`        | ✅       | Must be `code` |
| `state`                | Rec.     | Opaque value; echoed back on redirect (CSRF protection) |
| `code_challenge`       | Optional | PKCE challenge (base64url SHA-256 of verifier) |
| `code_challenge_method`| Optional | Must be `S256` when provided |

**Responses:**
- Redirects to `/oauth2/login` if not authenticated
- Renders consent screen HTML if authenticated and no prior consent
- Redirects to `redirect_uri?code=AUTH_CODE[&state=STATE]` if consented

---

### `POST /oauth2/authorize`

Processes the consent form submission. Saves consent (30-day TTL) and issues
an authorization code.

**Form body:**

| Field                  | Description |
|------------------------|-------------|
| `client_id`            | Same as in GET |
| `redirect_uri`         | Same as in GET |
| `scope`                | Same as in GET |
| `state`                | Same as in GET |
| `code_challenge`       | Same as in GET |
| `code_challenge_method`| Same as in GET |
| `action`               | `approve` or `deny` |

**On `approve`:** Redirects to `redirect_uri?code=AUTH_CODE[&state=STATE]`
**On `deny`:** Redirects to `redirect_uri?error=access_denied`

---

### `POST /oauth2/token` — Authorization Code Exchange

Exchange an authorization code for tokens.

**Form body (application/x-www-form-urlencoded):**

| Field           | Required | Description |
|-----------------|----------|-------------|
| `grant_type`    | ✅       | `authorization_code` |
| `code`          | ✅       | The auth code from the redirect |
| `client_id`     | ✅       | Client ID |
| `client_secret` | Rec.     | Client secret (required unless PKCE-only public client) |
| `redirect_uri`  | ✅       | Must exactly match what was used in /authorize |
| `code_verifier` | PKCE     | Required if `code_challenge` was provided |

**Success response:**

```json
{
  "access_token": "a4b2c1...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "d5e6f7...",
  "scope": "memforge:read hyphae:read",
  "user_id": "user-abc123"
}
```

**Error responses follow RFC 6749:**
- `invalid_grant` — code invalid, expired, or redirect_uri mismatch
- `invalid_client` — unknown or inactive client
- `invalid_request` — missing required parameters

---

### `GET /oauth2/login`

Renders the HTML login form. Preserves all OAuth2 params as hidden fields.

### `POST /oauth2/login`

Processes credentials. On success: sets session cookie, redirects to `/oauth2/authorize`.
On failure: re-renders login form with error message.

### `GET /oauth2/error`

Renders a user-friendly error page.

Query params: `error`, `error_description`

### `POST /oauth2/logout`

Destroys the current login session. Returns `{ "logged_out": true }`.

---

## PKCE (Proof Key for Code Exchange)

PKCE prevents authorization code interception attacks. Recommended for all
clients; required for public clients (mobile apps, SPAs) that cannot safely
store a client secret.

### Client-side setup (JavaScript)

```javascript
// 1. Generate code_verifier (43–128 URL-safe chars)
const verifier = crypto.randomBytes(32).toString('base64url');

// 2. Derive code_challenge
const challenge = crypto.createHash('sha256')
  .update(verifier)
  .digest('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');

// 3. Include in authorization URL
const authUrl = new URL('http://localhost:3005/oauth2/authorize');
authUrl.searchParams.set('client_id',             'my-app');
authUrl.searchParams.set('redirect_uri',          'http://localhost:8080/callback');
authUrl.searchParams.set('scope',                 'memforge:read');
authUrl.searchParams.set('response_type',         'code');
authUrl.searchParams.set('state',                 crypto.randomBytes(8).toString('hex'));
authUrl.searchParams.set('code_challenge',        challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

// 4. Exchange code using verifier (not challenge)
const tokenRes = await fetch('http://localhost:3005/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type:    'authorization_code',
    code:          authCode,       // from redirect query param
    client_id:     'my-app',
    redirect_uri:  'http://localhost:8080/callback',
    code_verifier: verifier,       // the original random value
  }),
});

const { access_token, refresh_token, user_id } = await tokenRes.json();
```

---

## Example: Minimal Node.js Client

```javascript
/**
 * Minimal OAuth2 Authorization Code client — Salish Forge
 *
 * Run with: node example-client.js
 * Then open: http://localhost:8080/login
 */

import http from 'http';
import crypto from 'crypto';
import { URL, URLSearchParams } from 'url';

const OAUTH2_SERVER = 'http://localhost:3005';
const CLIENT_ID     = 'example-app';
const CLIENT_SECRET = 'change-me';
const REDIRECT_URI  = 'http://localhost:8080/callback';
const SCOPE         = 'memforge:read';
const PORT          = 8080;

// In-memory state store (use Redis in production)
const pendingStates = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Step 1: Initiate login
  if (url.pathname === '/login') {
    const state    = crypto.randomBytes(8).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256')
      .update(verifier).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    pendingStates.set(state, { verifier });

    const authUrl = new URL(`${OAUTH2_SERVER}/oauth2/authorize`);
    authUrl.searchParams.set('client_id',             CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',          REDIRECT_URI);
    authUrl.searchParams.set('scope',                 SCOPE);
    authUrl.searchParams.set('response_type',         'code');
    authUrl.searchParams.set('state',                 state);
    authUrl.searchParams.set('code_challenge',        challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // Step 2: Handle callback
  if (url.pathname === '/callback') {
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Authorization denied: ${error}`);
      return;
    }

    const pending = pendingStates.get(state);
    if (!pending) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Unknown state — possible CSRF');
      return;
    }
    pendingStates.delete(state);

    // Exchange code for tokens
    const tokenRes = await fetch(`${OAUTH2_SERVER}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        code_verifier: pending.verifier,
      }),
    });

    const tokens = await tokenRes.json();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Logged in!', tokens }, null, 2));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<a href="/login">Login with Salish Forge</a>');
});

server.listen(PORT, () => {
  console.log(`Example client running at http://localhost:${PORT}`);
  console.log(`OAuth2 server at ${OAUTH2_SERVER}`);
});
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `oauth2_users` | User accounts (scrypt password hashes) |
| `oauth2_sessions` | Active login sessions (cookie-backed, 1hr TTL) |
| `oauth2_authorization_codes` | Temporary single-use codes (10min TTL) |
| `oauth2_user_consents` | Remembered consent per user+client (30day TTL) |

Schema: `schema/oauth2-auth-code-schema.sql`

---

## Seeding Users

Use `createUser()` from `oauth2/auth-code-flow.js` or add to `scripts/oauth2-seed.js`:

```javascript
import { createUser, initializeAuthCodeSchema } from './oauth2/auth-code-flow.js';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await initializeAuthCodeSchema(pool);
await createUser(pool, {
  username: 'admin',
  password: 'change-me-in-production',
  scopes: 'memforge:read memforge:write',
});
await pool.end();
```

---

## Security Notes

| Concern | Mitigation |
|---------|-----------|
| Auth code interception | PKCE S256 prevents value even if code is leaked |
| Code reuse | Code deleted from DB on first exchange |
| Code expiration | 10-minute hard TTL enforced in DB query |
| Redirect URI | Validated exactly against registered value (no prefix match) |
| Password storage | scrypt with random salt (same algorithm as client secrets) |
| Session fixation | New session ID generated on each login |
| XSS in HTML pages | All user-supplied values HTML-escaped before rendering |
| CSRF on consent | `state` parameter ties consent to original request |

---

## Running Tests

```bash
# Unit tests only (no server required)
node tests/auth-code-flow-tests.js

# Full integration tests (requires live server + DB)
DATABASE_URL=postgres://oauth2_user:oauth2_salish_2026@localhost:5432/oauth2 \
node oauth2-server.js &

OAUTH2_TEST_URL=http://127.0.0.1:3005 \
node tests/auth-code-flow-tests.js
```
