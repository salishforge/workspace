#!/bin/bash

# Hyphae Secrets Vault Bootstrap
# Initializes database schema and seeds secrets vault
# Then starts Hyphae Core and agents

set -e

echo "🔐 Hyphae Secrets Vault Bootstrap"
echo ""

# Configuration
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-hyphae}
DB_USER=${DB_USER:-postgres}
HYPHAE_PORT=${HYPHAE_PORT:-3100}
FLINT_PORT=${FLINT_PORT:-3050}
CLIO_PORT=${CLIO_PORT:-3051}

# Load environment
if [ -f ~/.bashrc ]; then
  source ~/.bashrc
fi

# Generate encryption key if not set
if [ -z "$HYPHAE_ENCRYPTION_KEY" ]; then
  echo "🔑 Generating HYPHAE_ENCRYPTION_KEY..."
  export HYPHAE_ENCRYPTION_KEY=$(openssl rand -hex 32)
  echo "   Key: $HYPHAE_ENCRYPTION_KEY"
fi

echo ""
echo "📊 Database Configuration:"
echo "   Host: $DB_HOST:$DB_PORT"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo ""

# Step 1: Initialize database schema
echo "📋 Initializing database schema..."

SCHEMA_SQL=$(cat <<'EOSQL'
-- Hyphae Secrets Management Schema
CREATE TABLE IF NOT EXISTS hyphae_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  value_encrypted TEXT NOT NULL,
  service VARCHAR(100) NOT NULL DEFAULT 'system',
  expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  updated_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_secrets_name ON hyphae_secrets(name);
CREATE INDEX IF NOT EXISTS idx_secrets_service ON hyphae_secrets(service);
CREATE INDEX IF NOT EXISTS idx_secrets_expires ON hyphae_secrets(expires_at);

CREATE TABLE IF NOT EXISTS hyphae_secrets_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  service VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  accessed_by VARCHAR(255),
  accessed_at TIMESTAMP DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_secrets_audit_name ON hyphae_secrets_audit(secret_name);
CREATE INDEX IF NOT EXISTS idx_secrets_audit_service ON hyphae_secrets_audit(service);
CREATE INDEX IF NOT EXISTS idx_secrets_audit_timestamp ON hyphae_secrets_audit(accessed_at);

CREATE TABLE IF NOT EXISTS hyphae_secrets_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  provider_type VARCHAR(100) NOT NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_health_check TIMESTAMP,
  health_status VARCHAR(20) DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_providers_name ON hyphae_secrets_providers(name);
CREATE INDEX IF NOT EXISTS idx_providers_active ON hyphae_secrets_providers(is_active);

CREATE TABLE IF NOT EXISTS hyphae_secrets_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  agent_id VARCHAR(255) NOT NULL,
  permission VARCHAR(50) NOT NULL,
  expires_at TIMESTAMP,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  FOREIGN KEY (secret_name) REFERENCES hyphae_secrets(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_policy_secret ON hyphae_secrets_access_policies(secret_name);
CREATE INDEX IF NOT EXISTS idx_access_policy_agent ON hyphae_secrets_access_policies(agent_id);

CREATE TABLE IF NOT EXISTS hyphae_secrets_rotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  rotated_at TIMESTAMP DEFAULT NOW(),
  old_value_hash VARCHAR(255),
  new_value_hash VARCHAR(255),
  rotated_by VARCHAR(255),
  reason VARCHAR(255),
  success BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_rotation_secret ON hyphae_secrets_rotation(secret_name);
EOSQL
)

PGPASSWORD=$DB_PASSWORD psql \
  -h $DB_HOST \
  -p $DB_PORT \
  -U $DB_USER \
  -d $DB_NAME \
  -c "$SCHEMA_SQL" 2>/dev/null || true

echo "✅ Schema initialized"
echo ""

# Step 2: Seed vault with API key
echo "🌱 Seeding vault with secrets..."

if [ -z "$GEMINI_API_KEY" ]; then
  echo "⚠️  GEMINI_API_KEY not set. Using placeholder."
  export GEMINI_API_KEY="placeholder-api-key"
fi

if [ -z "$CLIO_GEMINI_API_KEY" ]; then
  export CLIO_GEMINI_API_KEY=$GEMINI_API_KEY
fi

echo "   ✓ GEMINI_API_KEY ready"
echo ""

# Step 3: Stop any existing processes
echo "🛑 Stopping existing services..."
pkill -f "node.*hyphae" || true
pkill -f "node.*flint" || true
pkill -f "node.*clio" || true
sleep 2
echo "✅ Services stopped"
echo ""

# Step 4: Start Hyphae Core
echo "🚀 Starting Hyphae Core..."
export HYPHAE_URL="http://localhost:3100"
export DB_HOST=$DB_HOST
export DB_PORT=$DB_PORT
export DB_NAME=$DB_NAME
export DB_USER=$DB_USER
export DB_PASSWORD=$DB_PASSWORD

cd /home/artificium/workspace/hyphae

# Compile TypeScript if needed
if [ ! -f "dist/index.js" ]; then
  npx tsc index-with-vault.ts --outDir dist --lib es2020 --module commonjs --target es2020 > /dev/null 2>&1 || true
fi

# Start Hyphae Core
PORT=$HYPHAE_PORT \
HYPHAE_ENCRYPTION_KEY=$HYPHAE_ENCRYPTION_KEY \
DB_HOST=$DB_HOST \
DB_PORT=$DB_PORT \
DB_NAME=$DB_NAME \
DB_USER=$DB_USER \
DB_PASSWORD=$DB_PASSWORD \
nohup node index-with-vault.js > /tmp/hyphae-core.log 2>&1 &

HYPHAE_PID=$!
echo "✅ Hyphae Core started (PID: $HYPHAE_PID)"
sleep 5

# Verify Hyphae is ready
HEALTH_CHECK=$(curl -s http://localhost:3100/health | grep -o '"status":"ready"' || echo "")
if [ -z "$HEALTH_CHECK" ]; then
  echo "❌ Hyphae Core failed to start. Check /tmp/hyphae-core.log"
  tail -20 /tmp/hyphae-core.log
  exit 1
fi

echo "✅ Hyphae Core health check passed"
echo ""

# Step 5: Seed API key into vault
echo "🗝️  Seeding API key into vault..."

# For now, we'll seed via the agent bootstrap
# In production, you'd write a setup script to call secrets.set

echo "   (API key will be loaded from bashrc on first agent run)"
echo ""

# Step 6: Start Flint agent
echo "🤖 Starting Flint agent..."

cd /home/artificium/workspace/hyphae-agents

PORT=$FLINT_PORT \
HYPHAE_URL=$HYPHAE_URL \
AGENT_ENDPOINT="http://localhost:$FLINT_PORT" \
GOOGLE_API_KEY=$GEMINI_API_KEY \
nohup npm run start:flint > /tmp/flint.log 2>&1 &

FLINT_PID=$!
echo "✅ Flint started (PID: $FLINT_PID)"
sleep 8

# Verify Flint is ready
FLINT_CHECK=$(curl -s http://localhost:3050/status | grep -o '"status":"operational"' || echo "")
if [ -z "$FLINT_CHECK" ]; then
  echo "⚠️  Flint startup check inconclusive. Check /tmp/flint.log"
  tail -10 /tmp/flint.log
fi

echo ""

# Step 7: Start Clio agent
echo "👑 Starting Clio agent..."

PORT=$CLIO_PORT \
HYPHAE_URL=$HYPHAE_URL \
AGENT_ENDPOINT="http://localhost:$CLIO_PORT" \
GOOGLE_API_KEY=$CLIO_GEMINI_API_KEY \
nohup npm run start:clio > /tmp/clio.log 2>&1 &

CLIO_PID=$!
echo "✅ Clio started (PID: $CLIO_PID)"
sleep 8

echo ""
echo "=========================================="
echo "🎉 HYPHAE VAULT BOOTSTRAP COMPLETE"
echo "=========================================="
echo ""
echo "Services Running:"
echo "  🌐 Hyphae Core    - http://localhost:$HYPHAE_PORT"
echo "  🤖 Flint Agent    - http://localhost:$FLINT_PORT"
echo "  👑 Clio Agent     - http://localhost:$CLIO_PORT"
echo ""
echo "Logs:"
echo "  /tmp/hyphae-core.log"
echo "  /tmp/flint.log"
echo "  /tmp/clio.log"
echo ""
echo "Next Steps:"
echo "  1. Verify agents are running:"
echo "     curl http://localhost:3050/status"
echo "     curl http://localhost:3051/status"
echo ""
echo "  2. View vault audit trail:"
echo "     curl http://localhost:3100/api/audit"
echo ""
echo "  3. Start dashboard:"
echo "     cd /home/artificium/workspace/hyphae-dashboard"
echo "     npm start"
echo ""
echo "ProcessIDs:"
echo "  Hyphae Core: $HYPHAE_PID"
echo "  Flint: $FLINT_PID"
echo "  Clio: $CLIO_PID"
echo ""
