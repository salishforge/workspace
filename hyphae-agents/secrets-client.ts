/**
 * Secrets Client for Agents
 * Allows agents to request secrets from Hyphae Core Vault
 */

import axios from 'axios';

export interface SecretResponse {
  success: boolean;
  value?: string;
  error?: string;
}

export interface SecretListResponse {
  success: boolean;
  secrets?: Array<{
    name: string;
    service: string;
    expires_at?: string;
    created_at: string;
  }>;
  error?: string;
}

export class SecretsClient {
  private hyphaeUrl: string;
  private agentId: string;

  constructor(
    hyphaeUrl: string = 'http://localhost:3100',
    agentId: string = 'system'
  ) {
    this.hyphaeUrl = hyphaeUrl;
    this.agentId = agentId;
  }

  /**
   * Request a secret from the vault
   */
  async getSecret(secretName: string): Promise<string> {
    try {
      const response = await axios.post<SecretResponse>(
        `${this.hyphaeUrl}/rpc`,
        {
          sourceAgent: this.agentId,
          capability: 'secrets.get',
          params: { secretName },
          timeout: 5000,
        }
      );

      if (response.data.success && response.data.value) {
        return response.data.value;
      } else {
        throw new Error(response.data.error || 'Unknown error');
      }
    } catch (error: any) {
      throw new Error(
        `Failed to get secret '${secretName}': ${error.message}`
      );
    }
  }

  /**
   * List secrets accessible to this agent
   */
  async listSecrets(service?: string): Promise<any[]> {
    try {
      const response = await axios.post<SecretListResponse>(
        `${this.hyphaeUrl}/rpc`,
        {
          sourceAgent: this.agentId,
          capability: 'secrets.list',
          params: { service },
          timeout: 5000,
        }
      );

      if (response.data.success && response.data.secrets) {
        return response.data.secrets;
      } else {
        throw new Error(response.data.error || 'Unknown error');
      }
    } catch (error: any) {
      throw new Error(
        `Failed to list secrets: ${error.message}`
      );
    }
  }

  /**
   * Bootstrap agent: Load all required secrets into environment
   */
  async bootstrap(requiredSecrets: Record<string, string>): Promise<boolean> {
    console.log(`🔐 Bootstrapping ${this.agentId} secrets from vault...`);

    const failures: string[] = [];

    for (const [envVar, secretName] of Object.entries(requiredSecrets)) {
      try {
        const value = await this.getSecret(secretName);
        process.env[envVar] = value;
        console.log(`  ✅ Loaded ${secretName} → ${envVar}`);
      } catch (error: any) {
        console.error(`  ❌ Failed to load ${secretName}:`, error.message);
        failures.push(secretName);
      }
    }

    if (failures.length > 0) {
      console.error(`\n⚠️  Failed to load ${failures.length} secrets:`);
      failures.forEach((s) => console.error(`   - ${s}`));
      return false;
    }

    console.log(`✅ All ${Object.keys(requiredSecrets).length} secrets loaded`);
    return true;
  }

  /**
   * Wait for vault to be ready
   */
  async waitForVault(maxAttempts: number = 30): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await axios.get(`${this.hyphaeUrl}/health`, {
          timeout: 2000,
        });

        if (response.data.status === 'ready') {
          console.log(`✅ Vault ready (attempt ${attempt})`);
          return true;
        }
      } catch (e) {
        // Not ready yet
      }

      if (attempt < maxAttempts) {
        console.log(`⏳ Waiting for vault... (${attempt}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return false;
  }
}

export default SecretsClient;
