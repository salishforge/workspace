/**
 * Hyphae Secrets Vault
 * Core encrypted secrets management with plugin support for external services
 */

import crypto from 'crypto';
import { Database } from 'pg';

interface Secret {
  id: string;
  name: string;
  value: string;
  service: string; // Which service owns this secret (hyphae, flint, clio, etc.)
  expiresAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

interface SecretProvider {
  name: string;
  getSecret(name: string): Promise<string>;
  setSecret(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
}

export class HyphaeCoreVault {
  private db: Database;
  private encryptionKey: string;
  private providers: Map<string, SecretProvider> = new Map();
  private cache: Map<string, { value: string; expiresAt: Date }> = new Map();
  private auditLog: any;

  constructor(db: Database, encryptionKey?: string) {
    this.db = db;
    this.encryptionKey =
      encryptionKey ||
      process.env.HYPHAE_ENCRYPTION_KEY ||
      crypto.randomBytes(32).toString('hex');

    this.initializeAuditLogging();
  }

  /**
   * Initialize audit logging
   */
  private initializeAuditLogging() {
    console.log('🔐 Secrets Vault initialized');
    console.log(
      '   Encryption: AES-256-GCM'
    );
  }

  /**
   * Register an external secrets provider (1Password, Azure, etc.)
   */
  registerProvider(provider: SecretProvider) {
    this.providers.set(provider.name, provider);
    console.log(`✅ Registered secrets provider: ${provider.name}`);
  }

  /**
   * Get a secret by name
   * 1. Check cache
   * 2. Check core vault (encrypted)
   * 3. Check registered providers
   */
  async getSecret(name: string, service: string = 'system'): Promise<string> {
    // Check cache
    const cached = this.cache.get(name);
    if (cached && cached.expiresAt > new Date()) {
      this.auditSecretAccess(name, service, 'cached');
      return cached.value;
    }

    // Check core vault
    const vaultSecret = await this.getFromVault(name);
    if (vaultSecret) {
      this.auditSecretAccess(name, service, 'vault');
      this.cacheSecret(name, vaultSecret.value, vaultSecret.expiresAt);
      return vaultSecret.value;
    }

    // Check external providers
    for (const [providerName, provider] of this.providers) {
      try {
        const value = await provider.getSecret(name);
        if (value) {
          this.auditSecretAccess(name, service, `provider:${providerName}`);
          this.cacheSecret(name, value);
          return value;
        }
      } catch (e) {
        console.warn(
          `⚠️  Provider ${providerName} failed for secret ${name}: ${e}`
        );
      }
    }

    throw new Error(`Secret not found: ${name}`);
  }

  /**
   * Set a secret in core vault
   */
  async setSecret(
    name: string,
    value: string,
    service: string = 'system',
    expiresAt?: Date
  ): Promise<void> {
    const encrypted = this.encrypt(value);

    await this.db.query(
      `INSERT INTO hyphae_secrets (name, value_encrypted, service, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET
         value_encrypted = $2,
         updated_at = NOW()`,
      [name, encrypted, service, expiresAt]
    );

    this.cacheSecret(name, value, expiresAt);
    this.auditSecretAccess(name, service, 'set');
  }

  /**
   * Delete a secret
   */
  async deleteSecret(name: string, service: string = 'system'): Promise<void> {
    await this.db.query('DELETE FROM hyphae_secrets WHERE name = $1', [name]);
    this.cache.delete(name);
    this.auditSecretAccess(name, service, 'deleted');
  }

  /**
   * Get secret from vault (encrypted)
   */
  private async getFromVault(
    name: string
  ): Promise<Secret | null> {
    const result = await this.db.query(
      `SELECT id, name, value_encrypted, service, expires_at, metadata, created_at, updated_at
       FROM hyphae_secrets
       WHERE name = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [name]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      value: this.decrypt(row.value_encrypted),
      service: row.service,
      expiresAt: row.expires_at,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Encrypt a value
   */
  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt a value
   */
  private decrypt(ciphertext: string): string {
    const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Cache a secret
   */
  private cacheSecret(
    name: string,
    value: string,
    expiresAt?: Date
  ): void {
    const ttl = expiresAt
      ? expiresAt.getTime() - Date.now()
      : 3600000; // 1 hour default

    this.cache.set(name, {
      value,
      expiresAt: new Date(Date.now() + ttl),
    });

    // Auto-expire from cache
    setTimeout(() => this.cache.delete(name), ttl);
  }

  /**
   * Audit secret access
   */
  private auditSecretAccess(
    secretName: string,
    service: string,
    action: string
  ): void {
    this.db.query(
      `INSERT INTO hyphae_secrets_audit (secret_name, service, action)
       VALUES ($1, $2, $3)`,
      [secretName, service, action]
    ).catch(e => console.error('Audit logging failed:', e));
  }

  /**
   * Get audit trail
   */
  async getAuditTrail(limit: number = 100): Promise<any[]> {
    const result = await this.db.query(
      `SELECT secret_name, service, action, accessed_at
       FROM hyphae_secrets_audit
       ORDER BY accessed_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  /**
   * List all secrets (metadata only, no values)
   */
  async listSecrets(service?: string): Promise<any[]> {
    let query = `SELECT name, service, expires_at, created_at, updated_at
                FROM hyphae_secrets`;
    const params: any[] = [];

    if (service) {
      query += ` WHERE service = $1`;
      params.push(service);
    }

    const result = await this.db.query(query, params);
    return result.rows;
  }
}

/**
 * 1Password Provider
 */
export class OnePasswordProvider implements SecretProvider {
  name = '1password';
  private client: any;

  constructor(vaultId: string, masterPassword: string) {
    // Initialize 1Password CLI or API client
    // This is a placeholder - actual implementation would use op CLI or API
    console.log(`📦 1Password provider initialized (vault: ${vaultId})`);
  }

  async getSecret(name: string): Promise<string> {
    // op item get "name" --format json | jq .fields[0].value
    throw new Error('1Password provider not yet implemented');
  }

  async setSecret(name: string, value: string): Promise<void> {
    throw new Error('1Password provider not yet implemented');
  }

  async deleteSecret(name: string): Promise<void> {
    throw new Error('1Password provider not yet implemented');
  }
}

/**
 * Azure Key Vault Provider
 */
export class AzureKeyVaultProvider implements SecretProvider {
  name = 'azure-keyvault';
  private client: any;

  constructor(vaultUrl: string, clientId: string, clientSecret: string) {
    // Initialize Azure SDK
    console.log(`☁️  Azure Key Vault provider initialized (${vaultUrl})`);
  }

  async getSecret(name: string): Promise<string> {
    throw new Error('Azure Key Vault provider not yet implemented');
  }

  async setSecret(name: string, value: string): Promise<void> {
    throw new Error('Azure Key Vault provider not yet implemented');
  }

  async deleteSecret(name: string): Promise<void> {
    throw new Error('Azure Key Vault provider not yet implemented');
  }
}

/**
 * AWS Secrets Manager Provider
 */
export class AWSSecretsManagerProvider implements SecretProvider {
  name = 'aws-secretsmanager';
  private client: any;

  constructor(region: string) {
    // Initialize AWS SDK
    console.log(`🔑 AWS Secrets Manager provider initialized (${region})`);
  }

  async getSecret(name: string): Promise<string> {
    throw new Error('AWS Secrets Manager provider not yet implemented');
  }

  async setSecret(name: string, value: string): Promise<void> {
    throw new Error('AWS Secrets Manager provider not yet implemented');
  }

  async deleteSecret(name: string): Promise<void> {
    throw new Error('AWS Secrets Manager provider not yet implemented');
  }
}

/**
 * HashiCorp Vault Provider
 */
export class HashiCorpVaultProvider implements SecretProvider {
  name = 'hashicorp-vault';
  private client: any;

  constructor(vaultUrl: string, authToken: string) {
    // Initialize Vault SDK
    console.log(`🔓 HashiCorp Vault provider initialized (${vaultUrl})`);
  }

  async getSecret(name: string): Promise<string> {
    throw new Error('HashiCorp Vault provider not yet implemented');
  }

  async setSecret(name: string, value: string): Promise<void> {
    throw new Error('HashiCorp Vault provider not yet implemented');
  }

  async deleteSecret(name: string): Promise<void> {
    throw new Error('HashiCorp Vault provider not yet implemented');
  }
}
