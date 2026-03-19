/**
 * Hyphae Secrets RPC Handlers
 * Agent-accessible RPC endpoints for secrets management
 */

import { HyphaeCoreVault } from './secrets-vault';

export class SecretsRPCHandlers {
  constructor(private vault: HyphaeCoreVault) {}

  /**
   * RPC: secrets.get
   * Agents call this to retrieve a secret
   */
  async handleGetSecret(request: {
    sourceAgent: string;
    secretName: string;
    ttl?: number; // Seconds to cache
  }): Promise<{
    success: boolean;
    value?: string;
    error?: string;
  }> {
    try {
      const secret = await this.vault.getSecret(
        request.secretName,
        request.sourceAgent
      );

      return {
        success: true,
        value: secret,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * RPC: secrets.set
   * Agents call this to store a secret (requires admin capability)
   */
  async handleSetSecret(request: {
    sourceAgent: string;
    secretName: string;
    value: string;
    expiresInHours?: number;
  }): Promise<{
    success: boolean;
    error?: string;
  }> {
    // Verify agent has admin capability
    if (!this.canAdministerSecrets(request.sourceAgent)) {
      return {
        success: false,
        error: 'Agent does not have permission to administer secrets',
      };
    }

    try {
      const expiresAt = request.expiresInHours
        ? new Date(Date.now() + request.expiresInHours * 3600000)
        : undefined;

      await this.vault.setSecret(
        request.secretName,
        request.value,
        request.sourceAgent,
        expiresAt
      );

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * RPC: secrets.list
   * List all secrets accessible to the requesting agent
   */
  async handleListSecrets(request: {
    sourceAgent: string;
    service?: string;
  }): Promise<{
    success: boolean;
    secrets?: any[];
    error?: string;
  }> {
    try {
      const secrets = await this.vault.listSecrets(request.service);

      // Filter based on agent permissions
      const accessible = secrets.filter(
        (s) =>
          this.canAccessSecret(request.sourceAgent, s.name) ||
          s.service === request.sourceAgent
      );

      return {
        success: true,
        secrets: accessible.map((s) => ({
          name: s.name,
          service: s.service,
          expires_at: s.expires_at,
          created_at: s.created_at,
          // Do NOT return the value
        })),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * RPC: secrets.audit
   * View audit trail (admin only)
   */
  async handleAuditTrail(request: {
    sourceAgent: string;
    limit?: number;
  }): Promise<{
    success: boolean;
    audit?: any[];
    error?: string;
  }> {
    if (!this.canAdministerSecrets(request.sourceAgent)) {
      return {
        success: false,
        error: 'Only administrators can view audit trail',
      };
    }

    try {
      const audit = await this.vault.getAuditTrail(request.limit || 100);
      return {
        success: true,
        audit,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * RPC: secrets.rotate
   * Rotate a secret (admin only)
   */
  async handleRotateSecret(request: {
    sourceAgent: string;
    secretName: string;
    newValue: string;
  }): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.canAdministerSecrets(request.sourceAgent)) {
      return {
        success: false,
        error: 'Only administrators can rotate secrets',
      };
    }

    try {
      // Store new value
      await this.vault.setSecret(
        request.secretName,
        request.newValue,
        request.sourceAgent
      );

      // Log rotation in audit trail
      console.log(
        `🔄 Secret rotated: ${request.secretName} (by ${request.sourceAgent})`
      );

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Permission check: Can agent access this secret?
   */
  private canAccessSecret(agentId: string, secretName: string): boolean {
    // Check access policies from database
    // For now, default to: agent can access its own secrets + system secrets
    return agentId === 'system' || secretName.startsWith(`${agentId}.`);
  }

  /**
   * Permission check: Can agent administer secrets?
   */
  private canAdministerSecrets(agentId: string): boolean {
    // Only system and Flint (CTO) can administer
    return agentId === 'system' || agentId === 'flint';
  }
}

/**
 * RPC Handler Registry
 */
export function registerSecretsHandlers(
  vault: HyphaeCoreVault,
  rpcServer: any
) {
  const handlers = new SecretsRPCHandlers(vault);

  rpcServer.registerHandler('secrets.get', (req: any) =>
    handlers.handleGetSecret(req)
  );

  rpcServer.registerHandler('secrets.set', (req: any) =>
    handlers.handleSetSecret(req)
  );

  rpcServer.registerHandler('secrets.list', (req: any) =>
    handlers.handleListSecrets(req)
  );

  rpcServer.registerHandler('secrets.audit', (req: any) =>
    handlers.handleAuditTrail(req)
  );

  rpcServer.registerHandler('secrets.rotate', (req: any) =>
    handlers.handleRotateSecret(req)
  );

  console.log('✅ Secrets RPC handlers registered');
}
