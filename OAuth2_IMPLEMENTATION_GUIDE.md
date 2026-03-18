# OAuth2 Implementation Guide

**Status:** Design phase (ready to implement)  
**Version:** 1.0  
**Timeline:** Phase to production over 2 sprints

---

## Overview

Replace bearer tokens with minimal OAuth2 implementation to meet production standards.

**Current:** Bearer tokens (simple but non-standard)  
**Target:** OAuth2 (RFC 6749, industry standard, with token expiration & refresh)

---

## Minimal OAuth2 Design

### What We Need (MVP)

**OAuth2 Server (embedded in infrastructure)**
- Client credentials stored in PostgreSQL
- Access token generation (1 hour expiration)
- Refresh token generation (7 days expiration)
- Token validation endpoint (for other services)
- Token revocation endpoint

**OAuth2 Client Flow**
1. Client requests token: `POST /oauth2/token` with credentials
2. Server validates, issues access_token + refresh_token
3. Client uses access_token in requests: `Authorization: Bearer <token>`
4. When expired, client uses refresh_token to get new access_token
5. Services validate tokens via `/oauth2/introspect`

---

## Implementation Plan

### Phase 1 (This Sprint): Minimal OAuth2 Server

**Scope:**
- OAuth2 token endpoint (RFC 6749 Client Credentials flow)
- PostgreSQL oauth2_clients table (client_id, secret, scopes)
- PostgreSQL oauth2_tokens table (access_token, refresh_token, expires_at)
- Token validation endpoint

**Code Location:** `/home/artificium/oauth2-server.js` (standalone service or embedded)

**Endpoints:**
```
POST /oauth2/token
  Body: { client_id, client_secret, grant_type }
  Response: { access_token, refresh_token, expires_in }

POST /oauth2/introspect
  Body: { token }
  Response: { active, client_id, scope, expires_at }

POST /oauth2/revoke
  Body: { token }
  Response: { revoked: true }
```

**Example:**
```bash
# Get token
curl -X POST http://localhost:3005/oauth2/token \
  -d "client_id=dashboard&client_secret=secret&grant_type=client_credentials"

# Response
{
  "access_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "eyJhbGc..."
}

# Use token
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:3333/health

# Validate token
curl -X POST http://localhost:3005/oauth2/introspect \
  -d "token=eyJhbGc..."
```

---

### Phase 2 (Next Sprint): Service Integration

**Dashboard:**
- On startup: Get OAuth2 token from server
- Store token + refresh_token
- Use access_token in all requests to MemForge
- Refresh token before expiration

**MemForge:**
- Accept OAuth2 tokens (via Authorization: Bearer header)
- Validate tokens with OAuth2 server
- Replace current no-auth with OAuth2 middleware

**Hyphae:**
- Accept OAuth2 tokens instead of current bearer tokens
- Validate tokens with OAuth2 server

---

## Quick OAuth2 Reference

### Components

1. **Authorization Server** (what we build)
   - Issues tokens
   - Validates tokens
   - Manages client credentials

2. **Resource Server** (Dashboard, MemForge, Hyphae)
   - Accepts tokens
   - Validates with Authorization Server
   - Protects resources

3. **Client** (our services)
   - Gets tokens
   - Uses tokens in requests
   - Refreshes when expired

### Token Lifecycle

```
1. Client requests token
   → POST /oauth2/token (client_id, client_secret)
   
2. Server generates tokens
   → access_token (expires in 1 hour)
   → refresh_token (expires in 7 days)

3. Client uses access_token
   → Authorization: Bearer <access_token>
   → Valid for 1 hour

4. Token expires
   → Client uses refresh_token
   → POST /oauth2/token (refresh_token)
   → Gets new access_token

5. Refresh token expires
   → Client must get new token from authorization server
```

---

## Implementation Checklist

- [ ] Create OAuth2 server (postgres + express)
- [ ] Create oauth2_clients table
- [ ] Create oauth2_tokens table
- [ ] Implement /oauth2/token endpoint
- [ ] Implement /oauth2/introspect endpoint
- [ ] Implement /oauth2/revoke endpoint
- [ ] Create initial clients in database (dashboard, memforge, hyphae)
- [ ] Update Dashboard to use OAuth2
- [ ] Update MemForge to validate OAuth2 tokens
- [ ] Update Hyphae to validate OAuth2 tokens
- [ ] Test end-to-end flow
- [ ] Deploy to VPS
- [ ] Document for ops team

---

## Security Considerations

1. **Client Secret:** Stored hashed in database (bcrypt)
2. **Token Storage:** In database with expiration
3. **HTTPS:** Enforce in production (TLS for /oauth2 endpoints)
4. **Refresh Token Rotation:** Issue new refresh_token on each use
5. **Rate Limiting:** Limit token endpoint to prevent brute force
6. **Scope-Based Access:** Optional in v1.0 (add in v1.1)

---

## Timeline

**MVP OAuth2 (1-2 hours):**
- Basic token server working
- Services can validate tokens
- Manual testing successful

**Production OAuth2 (2-3 hours):**
- Full integration with all services
- Automated tests passing
- Deployment documentation
- Ops runbook for token rotation

---

## For Later (v1.1+)

- [ ] Scope-based access control
- [ ] JWT tokens (faster validation, no introspection call)
- [ ] Authorization Code flow (for web UIs)
- [ ] Multi-tenant token isolation
- [ ] Token revocation lists
- [ ] Audit logging for all token operations

---

**Owner:** Engineering  
**Priority:** High (required for production)  
**Effort:** 3-4 hours (MVP + integration)

