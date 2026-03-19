# Hyphae Authenticated Proxy

**Secure external access to Hyphae agents**

---

## What It Does

- ✅ Sits in front of Hyphae (port 3100, internal)
- ✅ Provides external access on port 3000
- ✅ Requires JWT authentication for all requests
- ✅ Rate limits (100 req/min per user)
- ✅ Logs all requests with trace IDs
- ✅ TLS-ready for HTTPS

---

## Quick Start

```bash
# Install
npm install --production

# Build
npm run build

# Start
export INTERNAL_HYPHAE='http://localhost:3100'
export JWT_SECRET='your-secret-key'
export PROXY_PORT=3000
npm start
```

---

## Authentication

### Get Token
```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "john-broker",
    "apiKey": "your-api-key"
  }'
```

### Use Token
```bash
TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/services
```

---

## Endpoints

All require `Authorization: Bearer <token>`

- `GET /api/services` — List agents
- `GET /api/services/:agentId` — Agent details
- `POST /api/rpc/call` — Call an agent
- `GET /api/rpc/audit` — View call history
- `GET /api/health` — Health check
- `GET /api/stats` — System stats

---

## Environment Variables

- `INTERNAL_HYPHAE` — Internal Hyphae URL (default: http://localhost:3100)
- `JWT_SECRET` — Secret for signing tokens (required, change in production)
- `PROXY_PORT` — Port to listen on (default: 3000)

---

## See Also

- `EXTERNAL_ACCESS_GUIDE.md` — Complete usage guide
- `COMMUNICATION_GUIDE.md` — Agent communication
- `hyphae/` — Hyphae HTTP RPC server

---

