# External Access Guide: Secure Proxy for Hyphae Agents

**Status:** Production-Ready  
**Purpose:** Access Hyphae agents from outside the VPS with authentication

---

## Architecture

```
Your Computer (External)
    ↓ HTTPS + JWT Token
Authenticated Proxy (Port 3000)
    ↓ HTTP (Internal)
Hyphae Services (Port 3100, internal only)
    ↓
Flint & Clio Agents
```

**Security:**
- ✅ Internal services NOT exposed directly
- ✅ All external requests require JWT token
- ✅ Rate limiting (100 requests/min per user)
- ✅ All requests logged with trace IDs
- ✅ TLS-ready for HTTPS

---

## Deployment (Corrected)

### Step 1: SSH to VPS (Correct User)
```bash
ssh artificium@100.97.161.7
```

### Step 2: Set Environment Variables
```bash
# Gemini API key (for agents)
export GOOGLE_API_KEY='your-gemini-api-key'

# Proxy authentication
export JWT_SECRET='your-jwt-secret-change-this'
export JOHN_API_KEY='your-api-key'
```

### Step 3: Deploy Hyphae Core
```bash
cd /home/artificium/workspace/hyphae
docker-compose up -d

# Wait for startup
sleep 5

# Verify
curl http://localhost:3100/api/health
```

### Step 4: Deploy Agents
```bash
cd /home/artificium/workspace/hyphae-agents
npm install --production
npm run build

# Start Flint
export PORT=3050
export AGENT_ENDPOINT="http://localhost:3050"
nohup npm run start:flint > /tmp/flint.log 2>&1 &

# Start Clio
export PORT=3051
export AGENT_ENDPOINT="http://localhost:3051"
nohup npm run start:clio > /tmp/clio.log 2>&1 &

sleep 3
echo "✅ Agents deployed"
```

### Step 5: Deploy Authenticated Proxy
```bash
cd /home/artificium/workspace/hyphae-proxy
npm install --production
npm run build

# Start proxy
export INTERNAL_HYPHAE='http://localhost:3100'
export JWT_SECRET='your-jwt-secret'
export PROXY_PORT=3000
nohup npm start > /tmp/proxy.log 2>&1 &

sleep 2
echo "✅ Proxy deployed (port 3000)"

# Verify
curl http://localhost:3000/health
```

### Step 6: Verify All Services
```bash
# Check all running
curl http://localhost:3100/api/health          # Hyphae core
curl http://localhost:3050/health              # Flint
curl http://localhost:3051/health              # Clio
curl http://localhost:3000/health              # Proxy
```

---

## Using the Proxy (From Your Computer)

### Step 1: Get Authentication Token

**Request:**
```bash
curl -X POST https://100.97.161.7:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "john-broker",
    "apiKey": "your-api-key",
    "role": "admin"
  }'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "type": "Bearer"
}
```

**Save the token:**
```bash
export HYPHAE_TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### Step 2: Call Agents Through Proxy

**Check what agents are available:**
```bash
curl -H "Authorization: Bearer $HYPHAE_TOKEN" \
  https://100.97.161.7:3000/api/services
```

**Call Flint to execute task:**
```bash
curl -X POST https://100.97.161.7:3000/api/rpc/call \
  -H "Authorization: Bearer $HYPHAE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "john-broker",
    "targetAgent": "flint",
    "capability": "execute_task",
    "params": {
      "task": "Deploy Hyphae to production",
      "priority": "critical"
    },
    "timeout": 60000
  }'
```

**Ask Clio for approval:**
```bash
curl -X POST https://100.97.161.7:3000/api/rpc/call \
  -H "Authorization: Bearer $HYPHAE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "john-broker",
    "targetAgent": "clio",
    "capability": "request_approval",
    "params": {
      "action": "deploy_to_production",
      "requestedBy": "john-broker",
      "reasoning": "All tests pass, code reviewed",
      "urgency": "high"
    },
    "timeout": 60000
  }'
```

**Check audit trail:**
```bash
curl -H "Authorization: Bearer $HYPHAE_TOKEN" \
  'https://100.97.161.7:3000/api/rpc/audit?limit=50'
```

---

## CLI Integration

### Option A: Use Proxy-Aware CLI

```bash
# Get token
TOKEN=$(curl -s -X POST https://100.97.161.7:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"john-broker","apiKey":"your-key"}' | jq -r .token)

# Use with CLI
export HYPHAE_URL='https://100.97.161.7:3000'
export HYPHAE_TOKEN="$TOKEN"

hyphae-cli discover
hyphae-cli call john-broker flint execute_task --params '{"task":"Deploy"}'
```

### Option B: Bash Helper

```bash
#!/bin/bash
# save as: hyphae-proxy-call.sh

PROXY_URL="https://100.97.161.7:3000"
USER_ID="${1:-john-broker}"
TARGET="${2:-flint}"
CAPABILITY="${3:-status}"
PARAMS="${4:-{}}"

# Get token
TOKEN=$(curl -s -X POST $PROXY_URL/auth/token \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\",\"apiKey\":\"$HYPHAE_API_KEY\"}" | jq -r .token)

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Failed to get token"
  exit 1
fi

# Make RPC call
curl -X POST $PROXY_URL/api/rpc/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"sourceAgent\": \"$USER_ID\",
    \"targetAgent\": \"$TARGET\",
    \"capability\": \"$CAPABILITY\",
    \"params\": $PARAMS,
    \"timeout\": 60000
  }"
```

**Usage:**
```bash
./hyphae-proxy-call.sh john-broker flint execute_task '{"task":"Deploy"}'
```

---

## Security Configuration

### Set Strong Secrets

**On VPS:**
```bash
# Generate strong JWT secret
openssl rand -base64 32

# Generate strong API key
openssl rand -hex 32

# Set in environment
export JWT_SECRET='long-random-string'
export JOHN_API_KEY='another-random-string'
```

### Enable HTTPS/TLS (Production)

**Install Nginx reverse proxy with SSL:**
```bash
sudo apt-get install nginx certbot python3-certbot-nginx

sudo certbot certonly --standalone -d 100.97.161.7
# (Or use your domain instead of IP)

# Configure Nginx to proxy to internal port 3000
# See: NGINX_HTTPS_CONFIG.md
```

### Rate Limiting

- **Default:** 100 requests per minute per user
- **Configurable:** Set `RATE_LIMIT_REQUESTS` in proxy code
- **Per user:** Each authenticated user has independent limit

---

## Monitoring

### View Proxy Logs
```bash
tail -f /tmp/proxy.log
```

### Check Proxy Status
```bash
curl https://100.97.161.7:3000/health
```

### View Request Metrics
```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://100.97.161.7:3000/api/stats
```

---

## Troubleshooting

### "Invalid token"
```bash
# Token expired? Get a new one
TOKEN=$(curl -s -X POST https://100.97.161.7:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId":"john-broker","apiKey":"your-key"}' | jq -r .token)
```

### "Rate limit exceeded"
- You've made >100 requests in the last minute
- Check response header: `Retry-After: 45` (retry in 45 seconds)
- Reduce request frequency or contact admin to increase limit

### "Proxy not responding"
```bash
# Check if proxy is running
ps aux | grep "auth-proxy"

# Restart if needed
cd /home/artificium/workspace/hyphae-proxy
npm start
```

### "Internal Hyphae unavailable"
```bash
# Check if Hyphae core is healthy
curl http://localhost:3100/api/health

# Check agents
curl http://localhost:3050/health
curl http://localhost:3051/health

# Check docker
docker-compose ps
```

---

## API Reference

All endpoints require: `Authorization: Bearer <jwt-token>`

### Service Discovery
```
GET /api/services
GET /api/services/:agentId
GET /api/services?capability=execute_task&region=us-west-2
```

### RPC Calls
```
POST /api/rpc/call
{
  "sourceAgent": "john-broker",
  "targetAgent": "flint",
  "capability": "execute_task",
  "params": {...},
  "timeout": 60000
}
```

### Audit Trail
```
GET /api/rpc/audit
GET /api/rpc/audit?sourceAgent=john-broker&limit=50
GET /api/rpc/audit?status=FAILED
```

### System Status
```
GET /api/health
GET /api/stats
```

### Authentication
```
POST /auth/token
{
  "userId": "john-broker",
  "apiKey": "your-api-key",
  "role": "admin"
}
```

---

## Summary

**You now have:**
- ✅ Hyphae agents on VPS (internal, not exposed)
- ✅ Authenticated proxy for external access
- ✅ JWT token-based authentication
- ✅ Rate limiting and logging
- ✅ Full RPC coordination through proxy

**External access:**
```bash
# Get token once
TOKEN=$(curl -X POST https://100.97.161.7:3000/auth/token ...)

# Use for all requests
curl -H "Authorization: Bearer $TOKEN" https://100.97.161.7:3000/api/...
```

**Next: Configure HTTPS/TLS for production security.**

---

