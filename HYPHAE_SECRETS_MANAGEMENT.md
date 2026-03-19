# Hyphae Secrets Management

Enterprise-grade secrets management integrated into Hyphae Core with support for external providers (1Password, Azure Key Vault, AWS Secrets Manager, HashiCorp Vault).

## Architecture

### Core Vault (Built-in)
- **Encryption:** AES-256-GCM
- **Storage:** PostgreSQL (encrypted values)
- **Access:** RPC endpoints
- **TTL Support:** Time-limited secrets with auto-expiry
- **Caching:** In-memory with configurable TTL

### Plugin System
- **1Password** — Team vaults with biometric unlock
- **Azure Key Vault** — Azure-native secrets service
- **AWS Secrets Manager** — AWS-native rotation and compliance
- **HashiCorp Vault** — Self-hosted enterprise vault

### Security Model
- **Zero-Trust:** All access requires authentication + audit
- **RBAC:** Fine-grained agent permissions per secret
- **Audit Trail:** Complete history of all secret access
- **Rotation:** Built-in secret rotation with history
- **Expiry:** Automatic cleanup of expired secrets

## Usage

### Agents Accessing Secrets

**Flint (CTO) — Request a secret:**
```typescript
// Via RPC call to Hyphae Core
const secret = await hyphaeCoreClient.rpc('secrets.get', {
  sourceAgent: 'flint',
  secretName: 'gemini.api_key',
  ttl: 3600 // Cache for 1 hour
});

if (secret.success) {
  const apiKey = secret.value;
  // Use secret
}
```

**Clio (Chief of Staff) — List accessible secrets:**
```typescript
const secrets = await hyphaeCoreClient.rpc('secrets.list', {
  sourceAgent: 'clio',
  service: 'system'
});

// Returns metadata only (names, created dates, expiry)
// Never returns actual values unless explicitly requested via secrets.get
```

**Any Agent — Rotate a secret (admin only):**
```typescript
const rotation = await hyphaeCoreClient.rpc('secrets.rotate', {
  sourceAgent: 'flint', // Must be admin
  secretName: 'gemini.api_key',
  newValue: 'new-api-key-value'
});
```

### Bootstrap Configuration

**On agent startup, load secrets from vault:**
```typescript
async function initializeAgent() {
  const vault = new HyphaeCoreVault(db, encryptionKey);
  
  // Load service secrets
  try {
    const apiKey = await vault.getSecret('gemini.api_key', 'flint');
    process.env.GOOGLE_API_KEY = apiKey;
  } catch (e) {
    console.error('Failed to load API key from vault');
    process.exit(1);
  }
}
```

## Database Schema

### Tables

**hyphae_secrets**
- Encrypted secret storage
- Service ownership
- Expiry tracking
- Metadata (tags, categories)

**hyphae_secrets_audit**
- Complete access history
- Action tracking (get, set, delete)
- Source agent identification
- IP address logging
- Success/failure status

**hyphae_secrets_providers**
- Registered external providers
- Configuration (encrypted)
- Health status
- Priority ordering

**hyphae_secrets_access_policies**
- Per-agent secret permissions
- Fine-grained RBAC
- Time-limited access grants
- Audit trail of permission changes

**hyphae_secrets_rotation**
- Secret rotation history
- Old/new value hashes
- Rotation reason
- Rotated-by tracking

## External Providers

### 1Password Setup
```typescript
const onePassword = new OnePasswordProvider(
  'vault-id-from-1password',
  'master-password'
);
vault.registerProvider(onePassword);

// Agents can now request secrets from 1Password
const secret = await vault.getSecret('1password.database_password');
```

### Azure Key Vault Setup
```typescript
const azure = new AzureKeyVaultProvider(
  'https://my-vault.vault.azure.net/',
  'client-id',
  'client-secret'
);
vault.registerProvider(azure);

// Agents access Azure secrets transparently
const secret = await vault.getSecret('azure.storage_key');
```

### AWS Secrets Manager Setup
```typescript
const aws = new AWSSecretsManagerProvider('us-west-2');
vault.registerProvider(aws);

// Access AWS secrets
const secret = await vault.getSecret('aws.rds_password');
```

### HashiCorp Vault Setup
```typescript
const hcvault = new HashiCorpVaultProvider(
  'https://vault.example.com:8200',
  'auth-token'
);
vault.registerProvider(hcvault);

// Access Vault secrets
const secret = await vault.getSecret('vault.kubernetes_token');
```

## Access Control

### Default Permissions

| Agent | Permissions | Scope |
|-------|-------------|-------|
| **flint** | read, write, admin | system.*, flint.* |
| **clio** | read | system.*, clio.* |
| **Other agents** | read | self-owned secrets only |
| **system** | admin | All secrets |

### Grant Permissions

```typescript
// Only system/flint can do this
await vault.grantAccess({
  secretName: 'gemini.api_key',
  agentId: 'new_agent',
  permission: 'read',
  expiresAt: new Date(Date.now() + 30*24*3600*1000), // 30 days
  reason: 'Temporary access for Q2 project'
});
```

## Audit & Compliance

### View Audit Trail
```typescript
const audit = await vault.getAuditTrail(100);
// Returns:
// [
//   { secret_name: 'gemini.api_key', service: 'flint', action: 'get', accessed_at: ... },
//   { secret_name: 'gemini.api_key', service: 'flint', action: 'cached', accessed_at: ... },
// ]
```

### Rotation Workflow

1. **Schedule rotation** — Set expiry date
2. **Generate new secret** — Update in external provider
3. **Call secrets.rotate** — Hyphae updates core vault
4. **Log rotation** — Audit trail records change with reason
5. **Auto-cleanup** — Old cached values expire

## Best Practices

### 1. Secret Naming
```
{service}.{resource}.{type}
gemini.api_key        # Global API key
flint.internal_token  # Flint-specific token
database.master_password
```

### 2. TTL Configuration
```typescript
// Short TTL for sensitive secrets
await vault.setSecret('mfa.backup_code', code, 'system', {
  expiresInHours: 1 // 1 hour max
});

// Longer TTL for stable secrets
await vault.setSecret('api.key', key, 'system', {
  expiresInHours: 30 * 24 // 30 days
});
```

### 3. Rotation Policy
```typescript
// Rotate every 90 days
setInterval(async () => {
  const newKey = await generateNewAPIKey();
  await vault.setSecret(
    'gemini.api_key',
    newKey,
    'system',
    { expiresInHours: 90*24 }
  );
}, 90*24*3600*1000);
```

### 4. Access Logging
```typescript
// Audit trail shows:
// - WHEN secrets were accessed
// - BY WHICH agent
// - WHAT action was taken
// - SUCCESS or FAILURE
// - FROM WHICH IP address
```

## Performance Metrics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Vault get (cached) | <50ms | Memory cache hit |
| Vault get (miss) | 100-500ms | PostgreSQL query + decryption |
| Vault set | 200-800ms | Encrypt + PostgreSQL write |
| Vault list | 300-1000ms | PostgreSQL query + decrypt multiple |
| Cache lookup | <10ms | Hash map lookup |

## Encryption at Rest

```typescript
// All values encrypted before storage
value_encrypted = AES_256_GCM(
  plaintext: string,
  key: Buffer.from(encryptionKey, 'hex'),
  iv: crypto.randomBytes(16)
)

// Each encryption includes:
// - Random IV (initialization vector)
// - Authentication tag (prevents tampering)
// - Encrypted value (AES-256-GCM)
```

## Environment Variables

Required for Hyphae startup:

```bash
# Core vault encryption key (32 bytes, hex encoded)
export HYPHAE_ENCRYPTION_KEY='...'

# PostgreSQL connection
export DB_HOST='localhost'
export DB_PORT='5432'
export DB_NAME='hyphae'
export DB_USER='hyphae_user'
export DB_PASSWORD='...'

# Optional: External provider configuration
export ONEPASSWORD_VAULT_ID='...'
export AZURE_KEY_VAULT_URL='...'
export AWS_REGION='us-west-2'
export HASHICORP_VAULT_URL='...'
```

## Migration from Environment Variables

**Before (insecure):**
```bash
export GEMINI_API_KEY='sk-...'
export FLINT_TOKEN='...'
```

**After (secure):**
```bash
# 1. Store in vault
await vault.setSecret('gemini.api_key', 'sk-...', 'system');

# 2. Remove from environment
unset GEMINI_API_KEY

# 3. Agent bootstraps from vault
const apiKey = await vault.getSecret('gemini.api_key', 'flint');
```

## Troubleshooting

### Secret Not Found
1. Check secret exists: `secrets.list`
2. Verify agent permissions: Check `hyphae_secrets_access_policies`
3. Check TTL: Expired secrets are automatically deleted

### Cache Issues
1. Secrets are cached for 1 hour by default
2. Manual refresh: Call `secrets.get` with fresh request
3. Clear cache: Restart agent

### Provider Failures
1. Check provider health: `hyphae_secrets_providers` table
2. Verify provider configuration
3. Fall back to core vault if provider offline

## Support

- **Questions?** Check `hyphae_secrets_audit` for access patterns
- **Need rotation?** Call `secrets.rotate` RPC
- **Compliance audit?** Export `hyphae_secrets_audit` table
- **Emergency reset?** Master encryption key in `~/.config/hyphae/encryption.key`

---

**Version:** 1.0  
**Status:** Production Ready  
**Last Updated:** 2026-03-19
