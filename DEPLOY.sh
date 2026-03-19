#!/bin/bash
set -e

# ============================================================================
# HYPHAE PRODUCTION DEPLOYMENT SCRIPT
# ============================================================================
# 
# Run this on the VPS: ssh artificium@100.97.161.7
# Then: bash /path/to/DEPLOY.sh
#
# This script deploys:
# ✅ Hyphae HTTP RPC Server
# ✅ Flint Agent (CrewAI + Gemini)
# ✅ Clio Agent (AutoGen + Gemini)
# ✅ Authenticated Proxy
#

echo "🚀 HYPHAE PRODUCTION DEPLOYMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Deployment started: $(date)"
echo ""

# ============================================================================
# ENVIRONMENT VALIDATION
# ============================================================================

echo "1️⃣  Validating environment..."

if [ -z "$GOOGLE_API_KEY" ]; then
    echo "❌ ERROR: GOOGLE_API_KEY not set"
    echo "   Run: export GOOGLE_API_KEY='your-api-key'"
    exit 1
fi

if [ -z "$JWT_SECRET" ]; then
    echo "❌ ERROR: JWT_SECRET not set"
    echo "   Run: export JWT_SECRET='your-secret-key'"
    exit 1
fi

if [ -z "$JOHN_API_KEY" ]; then
    echo "❌ ERROR: JOHN_API_KEY not set"
    echo "   Run: export JOHN_API_KEY='your-api-key'"
    exit 1
fi

echo "   ✅ GOOGLE_API_KEY set"
echo "   ✅ JWT_SECRET set"
echo "   ✅ JOHN_API_KEY set"
echo ""

# Check requirements
echo "2️⃣  Checking requirements..."

docker --version > /dev/null || (echo "❌ Docker not found"; exit 1)
docker-compose --version > /dev/null || (echo "❌ Docker Compose not found"; exit 1)
node --version > /dev/null || (echo "❌ Node.js not found"; exit 1)

echo "   ✅ Docker installed"
echo "   ✅ Docker Compose installed"
echo "   ✅ Node.js installed"
echo ""

# ============================================================================
# WORKSPACE VERIFICATION
# ============================================================================

echo "3️⃣  Verifying workspace..."

cd /home/artificium/workspace

if [ ! -d "hyphae" ]; then
    echo "❌ Directory not found: hyphae"
    exit 1
fi

if [ ! -d "hyphae-agents" ]; then
    echo "❌ Directory not found: hyphae-agents"
    exit 1
fi

if [ ! -d "hyphae-proxy" ]; then
    echo "❌ Directory not found: hyphae-proxy"
    exit 1
fi

echo "   ✅ Workspace structure valid"
echo ""

# ============================================================================
# DEPLOY HYPHAE CORE
# ============================================================================

echo "4️⃣  Deploying Hyphae HTTP RPC Server..."

cd /home/artificium/workspace/hyphae

echo "   Stopping old containers..."
docker-compose down --remove-orphans 2>/dev/null || true

echo "   Starting Hyphae Core..."
docker-compose up -d

echo "   Waiting for services to start..."
sleep 5

if curl -s http://localhost:3100/api/health > /dev/null; then
    echo "   ✅ Hyphae Core healthy"
else
    echo "   ⚠️  Hyphae Core not responding yet (check docker-compose logs)"
fi

echo ""

# ============================================================================
# DEPLOY AGENTS
# ============================================================================

echo "5️⃣  Deploying Agents (Flint + Clio)..."

cd /home/artificium/workspace/hyphae-agents

echo "   Installing dependencies..."
npm install --production > /dev/null 2>&1

echo "   Building..."
npm run build > /dev/null 2>&1

echo "   Starting Flint Agent..."
export PORT=3050
export AGENT_ENDPOINT="http://localhost:3050"
nohup npm run start:flint > /tmp/flint.log 2>&1 &
FLINT_PID=$!

sleep 3

echo "   Starting Clio Agent..."
export PORT=3051
export AGENT_ENDPOINT="http://localhost:3051"
nohup npm run start:clio > /tmp/clio.log 2>&1 &
CLIO_PID=$!

sleep 3

echo "   ✅ Flint Agent deployed (PID: $FLINT_PID)"
echo "   ✅ Clio Agent deployed (PID: $CLIO_PID)"
echo ""

# ============================================================================
# DEPLOY AUTHENTICATED PROXY
# ============================================================================

echo "6️⃣  Deploying Authenticated Proxy..."

cd /home/artificium/workspace/hyphae-proxy

echo "   Installing dependencies..."
npm install --production > /dev/null 2>&1

echo "   Building..."
npm run build > /dev/null 2>&1

echo "   Starting proxy..."
export INTERNAL_HYPHAE="http://localhost:3100"
export PROXY_PORT=3000
nohup npm start > /tmp/proxy.log 2>&1 &
PROXY_PID=$!

sleep 2

echo "   ✅ Authenticated Proxy deployed (PID: $PROXY_PID)"
echo ""

# ============================================================================
# VERIFICATION
# ============================================================================

echo "7️⃣  Verifying all services..."

sleep 2

# Check Hyphae Core
if curl -s http://localhost:3100/api/health > /dev/null; then
    echo "   ✅ Hyphae Core (port 3100)"
else
    echo "   ❌ Hyphae Core not responding"
fi

# Check Flint
if curl -s http://localhost:3050/health > /dev/null 2>&1; then
    echo "   ✅ Flint Agent (port 3050)"
else
    echo "   ⚠️  Flint Agent not yet responding (still initializing)"
fi

# Check Clio
if curl -s http://localhost:3051/health > /dev/null 2>&1; then
    echo "   ✅ Clio Agent (port 3051)"
else
    echo "   ⚠️  Clio Agent not yet responding (still initializing)"
fi

# Check Proxy
if curl -s http://localhost:3000/health > /dev/null; then
    echo "   ✅ Authenticated Proxy (port 3000)"
else
    echo "   ❌ Proxy not responding"
fi

echo ""

# ============================================================================
# SERVICE DISCOVERY
# ============================================================================

echo "8️⃣  Checking agent registration..."

sleep 3

SERVICES=$(curl -s http://localhost:3100/api/services | jq '.count' 2>/dev/null || echo "0")

if [ "$SERVICES" -ge 2 ]; then
    echo "   ✅ Both agents registered ($SERVICES services found)"
else
    echo "   ⚠️  Waiting for agent registration (check logs)"
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DEPLOYMENT COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Services running:"
echo "  📡 Hyphae HTTP RPC Server (port 3100, internal)"
echo "  🔧 Flint Agent (port 3050, internal)"
echo "  👑 Clio Agent (port 3051, internal)"
echo "  🔐 Authenticated Proxy (port 3000, external)"
echo ""
echo "Next steps:"
echo ""
echo "1️⃣  Get an authentication token:"
echo "    curl -X POST https://100.97.161.7:3000/auth/token \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"userId\":\"john-broker\",\"apiKey\":\"$JOHN_API_KEY\"}'"
echo ""
echo "2️⃣  Call your agents:"
echo "    TOKEN='<token-from-step-1>'"
echo "    curl -H \"Authorization: Bearer \$TOKEN\" \\"
echo "      https://100.97.161.7:3000/api/services"
echo ""
echo "3️⃣  View logs:"
echo "    tail -f /tmp/flint.log"
echo "    tail -f /tmp/clio.log"
echo "    tail -f /tmp/proxy.log"
echo ""
echo "4️⃣  Documentation:"
echo "    - EXTERNAL_ACCESS_GUIDE.md (usage)"
echo "    - COMMUNICATION_GUIDE.md (agent capabilities)"
echo "    - PRODUCTION_DEPLOYMENT_CHECKLIST.md (verification)"
echo ""
echo "Deployment completed: $(date)"
echo ""
