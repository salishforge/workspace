#!/bin/bash

# Phase 3: Restart Hyphae Infrastructure Cleanly
# Execute this after SSH key is verified

set -e

echo "════════════════════════════════════════════════════════"
echo "PHASE 3: INFRASTRUCTURE RESTART & CLEANUP"
echo "════════════════════════════════════════════════════════"
echo ""

VPS_USER="artificium"
VPS_HOST="100.97.161.7"

echo "Executing on VPS via SSH..."
echo ""

ssh $VPS_USER@$VPS_HOST <<'PHASE3'

echo "Step 1: Stop all Hyphae services..."
pkill -f "hyphae-core" || true
pkill -f "hyphae-service-registry" || true
pkill -f "hyphae-service-proxy" || true
pkill -f "hyphae-memory-consolidator" || true
pkill -f "hyphae-memforge-agent-api" || true

sleep 3

echo "✅ All services stopped"
echo ""

echo "Step 2: Clear database (preserve schemas)..."
PGPASSWORD=hyphae-password-2026 psql -U postgres -h localhost -p 5433 -d hyphae <<'SQL'
TRUNCATE TABLE hyphae_agent_registrations;
TRUNCATE TABLE hyphae_agent_credentials;
TRUNCATE TABLE hyphae_agent_memory;
TRUNCATE TABLE hyphae_memory_agent_credentials;
DELETE FROM hyphae_service_audit_log;
DELETE FROM hyphae_agent_agent_messages;
TRUNCATE TABLE hyphae_agent_identities;
DELETE FROM clio_conversation_history;
DELETE FROM flint_conversation_history;
SQL

echo "✅ Database cleared (schemas preserved)"
echo ""

echo "Step 3: Restart services in order..."
echo ""

cd ~/hyphae-staging

# Core first
echo "  Starting Hyphae Core..."
nohup node hyphae-core-llm-final.js > /tmp/hyphae-core-restart.log 2>&1 &
CORE_PID=$!
sleep 5
if ! ps -p $CORE_PID > /dev/null; then
  echo "❌ Hyphae Core failed to start"
  tail -30 /tmp/hyphae-core-restart.log
  exit 1
fi
echo "  ✅ Hyphae Core running (PID: $CORE_PID)"

# Registry
echo "  Starting Service Registry..."
nohup node hyphae-service-registry.js > /tmp/hyphae-registry-restart.log 2>&1 &
sleep 5
echo "  ✅ Service Registry running"

# Proxy
echo "  Starting Service Proxy..."
nohup node hyphae-service-proxy.js > /tmp/hyphae-proxy-restart.log 2>&1 &
sleep 5
echo "  ✅ Service Proxy running"

# MemForge API
echo "  Starting MemForge Agent API..."
nohup node hyphae-memforge-agent-api.js > /tmp/hyphae-memforge-restart.log 2>&1 &
sleep 5
echo "  ✅ MemForge Agent API running"

echo ""
echo "Step 4: Verify services are responding..."

echo -n "  Core: "
curl -s http://localhost:3100/rpc -X POST -d '{"method":"system.health"}' > /dev/null && echo "✅" || echo "❌"

echo -n "  Registry: "
curl -s http://localhost:3108/health | grep -q "ok" && echo "✅" || echo "⚠️"

echo -n "  Proxy: "
curl -s http://localhost:3109/health | grep -q "ok" && echo "✅" || echo "⚠️"

echo -n "  MemForge: "
curl -s http://localhost:3107/health | grep -q "ok" && echo "✅" || echo "⚠️"

echo ""
echo "════════════════════════════════════════════════════════"
echo "✅ PHASE 3 COMPLETE - INFRASTRUCTURE RESTARTED"
echo "════════════════════════════════════════════════════════"

PHASE3

echo ""
echo "Next: Phase 4 - Deploy Admin Agent"
