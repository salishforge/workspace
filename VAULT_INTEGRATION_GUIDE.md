# Hyphae Secrets Vault Integration Guide

Complete guide to the integrated Secrets Vault in Hyphae Core with agent bootstrap workflow.

## Overview

The Secrets Vault is now **integrated into Hyphae Core bootstrap**. Agents no longer depend on environment variables or bashrc for credentials. Instead:

1. **Hyphae Core starts** → Initializes PostgreSQL → Initializes encrypted vault
2. **Agents start** → Wait for vault ready → Request secrets via RPC → Load into environment
3. **Complete audit trail** → Every secret access is logged
4. **External providers** → 1Password, Azure, AWS, HashiCorp (ready for integration)

## Architecture

```
┌─────────────────────────────────────────────┐
│          Hyphae Core (Port 3100)            │
│  ┌────────────────────────────────────────┐ │
│  │   Secrets Vault (AES-256-GCM)          │ │
│  │   - PostgreSQL encrypted storage       │ │
│  │   - In-memory caching                  │ │
│  │   - Access policies & RBAC             │ │
│  │   - Complete audit trail               │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
          │
          │ RPC: secrets.get/set/list
          │
    ┌─────┴─────┐
    │           │
┌───▼────┐  ┌──▼────┐
│ Flint  │  │ Clio   │
│ (CTO)  │  │ (CoS)  │
└────────┘  └────────┘

External Providers (Pluggable):
├── 1Password
├── Azure Key Vault
├── AWS Secrets Manager
└── HashiCorp Vault
```

## Quick Start

### 1. Bootstrap Everything

```bash
cd /home/artificium/workspace

# Run the bootstrap script (initializes DB, vault, agents)
./VAULT_BOOTSTRAP.sh
```

This:
- ✅ Initializes PostgreSQL schema
- ✅ Starts Hyphae Core with vault
- ✅ Agents bootstrap from vault
- ✅ All services running and connected

### 2. Verify Services

```bash
# Check Hyphae Core health
curl http://localhost:3100/health

# Check agents
curl http://localhost:3050/status  # Flint
curl http://localhost:3051/status  # Clio
```

### 3. View Vault Secrets

```bash
# List all secrets (metadata only, no values)
curl http://localhost:3100/api/secrets

# View audit trail
curl http://localhost:3100/api/audit?limit=50
```

## Agent Bootstrap Workflow

### How Agents Bootstrap Secrets

**File: `hyphae-agents/secrets-client.ts`**

```typescript
// Agent initialization
async initialize() {
  const secretsClient = new SecretsClient(
    process.env.HYPHAE_URL || 'http://localhost:3100',
    'flint' // agent ID
  );

  // Wait for vault to be ready (30 second timeout)
  const vaultReady = await secretsClient.waitForVault();

  if (vaultReady) {
    // Bootstrap required secrets from vault
    await secretsClient.bootstrap({
      GOOGLE_API_KEY: 'gemini.api_key', // Map env var to secret name
    });
    // Now process.env.GOOGLE_API_KEY is loaded from vault
  } else {
    // Fallback to environment variables
    console.warn('Vault unavailable, using env vars');
  }
}
```

### Sequence Diagram

```
Agent                    Hyphae Core              PostgreSQL
  │                           │                        │
  ├─ Wait for vault ready ────>                        │
  │                           │                        │
  │  (health check loop)      │                        │
  │<────── /health ───────────┤                        │
  │                           │                        │
  ├─ Request secret ─────────>│                        │
  │  (secrets.get, RPC)       │                        │
  │                           ├─ Query vault ────────>│
  │                           │<─ Encrypted value ────│
  │<─ Return secret ──────────┤                        │
  │                           ├─ Log audit ──────────>│
  │                           │                        │
  │ (Decrypt & use)           │                        │
```

## Database Schema

### hyphae_secrets
```sql
CREATE TABLE hyphae_secrets (
  id UUID PRIMARY KEY,
  name VARCHAR(255) UNIQUE,         -- 'gemini.api_key'
  value_encrypted TEXT,              -- AES-256-GCM encrypted
  service VARCHAR(100),              -- 'system', 'flint', 'clio'
  expires_at TIMESTAMP,              -- Optional TTL
  metadata JSONB,                    -- Tags, categories
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### hyphae_secrets_audit
```sql
CREATE TABLE hyphae_secrets_audit (
  id UUID PRIMARY KEY,
  secret_name VARCHAR(255),          -- 'gemini.api_key'
  service VARCHAR(100),              -- 'flint'
  action VARCHAR(50),                -- 'get', 'set', 'delete', 'cached'
  status VARCHAR(20),                -- 'success', 'failed'
  error_message TEXT,
  accessed_by VARCHAR(255),          -- 'flint'
  accessed_at TIMESTAMP,
  ip_address INET,
  user_agent TEXT
);
```

## RPC Endpoints

Agents call these endpoints via HTTP POST to `http://localhost:3100/rpc`:

### secrets.get

```json
{
  "sourceAgent": "flint",
  "capability": "secrets.get",
  "params": {
    "secretName": "gemini.api_key"
  }
}
```

Response:
```json
{
  "success": true,
  "value": "sk-..."
}
```

### secrets.list

```json
{
  "sourceAgent": "flint",
  "capability": "secrets.list",
  "params": {
    "service": "system"
  }
}
```

Response:
```json
{
  "success": true,
  "secrets": [
    {
      "name": "gemini.api_key",
      "service": "system",
      "created_at": "2026-03-19T...",
      "expires_at": null
    }
  ]
}
```

### secrets.set (Admin only)

```json
{
  "sourceAgent": "flint",
  "capability": "secrets.set",
  "params": {
    "secretName": "new_secret",
    "value": "secret_value",
    "expiresInHours": 24
  }
}
```

### secrets.audit (Admin only)

```json
{
  "sourceAgent": "flint",
  "capability": "secrets.audit",
  "params": {
    "limit": 100
  }
}
```

## Encryption

All secrets are encrypted before storage using **AES-256-GCM**:

```typescript
encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);           // Random IV
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    encryptionKey,                              // 32-byte key
    iv
  );
  
  const encrypted = cipher.update(plaintext, 'utf8', 'hex') +
                    cipher.final('hex');
  const authTag = cipher.getAuthTag();          // Authentication tag
  
  return `${iv}:${authTag}:${encrypted}`;       // Store all three
}
```

**Each encryption includes:**
- Random IV (prevents replay attacks)
- Authentication tag (prevents tampering)
- Encrypted value (AES-256)

## Security Model

### Permissions

| Agent | Actions | Scope |
|-------|---------|-------|
| **flint** | read, write, admin | All secrets |
| **clio** | read | self-owned + system |
| **other** | read | self-owned only |
| **system** | admin | All secrets |

### Access Control

```typescript
// Only flint can set secrets
if (sourceAgent !== 'flint' && sourceAgent !== 'system') {
  throw new Error('Not authorized');
}

// Audit every access
auditSecretAccess(secretName, service, action);
```

### Audit Trail

Every secret access is logged:
```
timestamp          | secret_name      | service | action     | status
2026-03-19 12:00  | gemini.api_key   | flint   | get        | success
2026-03-19 12:00  | gemini.api_key   | flint   | cached     | success
2026-03-19 12:01  | database.pwd     | clio    | get        | success
2026-03-19 12:05  | invalid_secret   | admin   | get        | failed
```

## Caching Strategy

Secrets are cached in-memory for performance:

```typescript
// Cache TTL: 1 hour (configurable)
// Auto-expire after TTL
// Manual refresh: Call secrets.get again

// Check cache
const cached = this.cache.get(secretName);
if (cached && cached.expiresAt > now) {
  return cached.value;  // From cache
}

// Query vault if not cached
const secret = await this.getFromVault(secretName);
```

## Migration from Environment Variables

### Before (Insecure)
```bash
export GEMINI_API_KEY='sk-...'
export FLINT_TOKEN='...'
export DATABASE_PASSWORD='...'
```

### After (Secure)
```bash
# 1. Store in vault (one-time setup)
curl -X POST http://localhost:3100/rpc \
  -d '{
    "sourceAgent": "flint",
    "capability": "secrets.set",
    "params": {
      "secretName": "gemini.api_key",
      "value": "sk-...",
      "expiresInHours": 90
    }
  }'

# 2. Agent bootstraps on startup (automatic)
const secret = await secretsClient.getSecret('gemini.api_key');

# 3. No environment variables needed
unset GEMINI_API_KEY
```

## External Provider Integration

Vault supports pluggable providers:

### Add 1Password

```typescript
import { OnePasswordProvider } from './secrets-vault';

const onePassword = new OnePasswordProvider(
  'vault-id',
  'master-password'
);
vault.registerProvider(onePassword);

// Agents now access 1Password secrets transparently
const secret = await vault.getSecret('1password.database_password');
```

### Add Azure Key Vault

```typescript
import { AzureKeyVaultProvider } from './secrets-vault';

const azure = new AzureKeyVaultProvider(
  'https://my-vault.vault.azure.net/',
  'client-id',
  'client-secret'
);
vault.registerProvider(azure);

// Access Azure secrets
const secret = await vault.getSecret('azure.storage_key');
```

## Troubleshooting

### Agents can't connect to vault

```bash
# Check Hyphae Core is running
curl http://localhost:3100/health

# Check Hyphae Core logs
tail -50 /tmp/hyphae-core.log

# Verify PostgreSQL is accessible
psql -h localhost -U postgres -d hyphae -c "SELECT 1"
```

### Secret not found

```bash
# List available secrets
curl http://localhost:3100/api/secrets

# Check if secret exists
curl -X POST http://localhost:3100/rpc \
  -d '{
    "sourceAgent": "flint",
    "capability": "secrets.list",
    "params": {}
  }'
```

### Permission denied

```bash
# Only 'flint' and 'system' can set secrets
# Check audit trail for failed attempts
curl http://localhost:3100/api/audit

# Grant access via access policy
INSERT INTO hyphae_secrets_access_policies
  (secret_name, agent_id, permission)
VALUES ('gemini.api_key', 'new_agent', 'read');
```

## Environment Variables

Required for bootstrap:

```bash
# Core
export HYPHAE_ENCRYPTION_KEY='...'  # 32-byte hex (auto-generated if not set)
export HYPHAE_URL='http://localhost:3100'

# Database
export DB_HOST='localhost'
export DB_PORT='5432'
export DB_NAME='hyphae'
export DB_USER='postgres'
export DB_PASSWORD='...'

# Initial secret (during bootstrap)
export GEMINI_API_KEY='sk-...'  # Loaded into vault on first run
```

## Files

```
├── hyphae/
│   ├── secrets-vault.ts              # Core vault + providers
│   ├── secrets-rpc-handlers.ts       # RPC endpoint handlers
│   ├── schema-secrets.sql            # Database schema
│   └── index-with-vault.ts           # Hyphae Core with vault
├── hyphae-agents/
│   ├── secrets-client.ts             # Agent secrets client
│   ├── flint-crewai-real.ts          # Updated with bootstrap
│   └── clio-autogen-real.ts          # Updated with bootstrap
├── VAULT_BOOTSTRAP.sh                # Complete bootstrap script
├── HYPHAE_SECRETS_MANAGEMENT.md      # Secrets API documentation
└── VAULT_INTEGRATION_GUIDE.md        # This file
```

## Next Steps

1. **Run bootstrap:** `./VAULT_BOOTSTRAP.sh`
2. **Verify services:** `curl http://localhost:3100/health`
3. **Check agents:** View `/tmp/flint.log` and `/tmp/clio.log`
4. **Configure external providers:** See HYPHAE_SECRETS_MANAGEMENT.md
5. **Test secret rotation:** Call `secrets.rotate` RPC
6. **Audit compliance:** Export `hyphae_secrets_audit` table

## References

- **Secrets Vault:** HYPHAE_SECRETS_MANAGEMENT.md
- **Agent Bootstrap:** hyphae-agents/secrets-client.ts
- **Database Schema:** hyphae/schema-secrets.sql
- **RPC Handlers:** hyphae/secrets-rpc-handlers.ts
- **Encryption:** hyphae/secrets-vault.ts (HyphaeCoreVault class)

---

**Version:** 1.0  
**Status:** Production Ready  
**Last Updated:** 2026-03-19
