/**
 * Agent Registration Client
 * Handles zero-trust key exchange with Hyphae Core
 */

import crypto from 'crypto';
import axios from 'axios';

export interface RegistrationConfig {
  agentId: string;
  name: string;
  role: string;
  hyphaeUrl: string;
  type: 'primary' | 'sub-agent';
  parentAgentId?: string; // For sub-agents
  privateKeyPath?: string; // Path to agent's Ed25519 private key
}

export interface KeyExchangeResult {
  success: boolean;
  status: string; // 'active', 'pending_approval', 'error'
  encryptionKey?: string;
  grantId?: string;
  requiresApproval?: boolean;
  message?: string;
}

export class RegistrationClient {
  private config: RegistrationConfig;
  private privateKey: crypto.KeyObject;
  private publicKey: string; // Hex-encoded

  constructor(config: RegistrationConfig) {
    this.config = config;
    this.initializeKeys();
  }

  /**
   * Initialize or load agent cryptographic identity
   */
  private initializeKeys(): void {
    try {
      // Try to load existing keys
      const fs = require('fs');
      const path = require('path');

      const keyDir = path.join(process.env.HOME || '/tmp', '.hyphae-keys');
      const privateKeyPath = path.join(keyDir, `${this.config.agentId}.key`);
      const publicKeyPath = path.join(keyDir, `${this.config.agentId}.pub`);

      if (fs.existsSync(privateKeyPath)) {
        // Load existing keys
        const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
        this.privateKey = crypto.createPrivateKey(privateKeyPem);

        const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8');
        const publicKeyObj = crypto.createPublicKey(publicKeyPem);
        this.publicKey = publicKeyObj.export({ format: 'pem' }).toString('hex');

        console.log(`🔑 Loaded existing keys for ${this.config.agentId}`);
        return;
      }

      // Generate new key pair
      console.log(`🔐 Generating new Ed25519 key pair for ${this.config.agentId}`);

      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
        privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        publicKeyEncoding: { format: 'pem', type: 'spki' },
      });

      this.privateKey = privateKey;
      this.publicKey = publicKey.toString('hex');

      // Store keys
      if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
      }

      fs.writeFileSync(privateKeyPath, privateKey.toString('pem'), {
        mode: 0o600,
      });
      fs.writeFileSync(publicKeyPath, publicKey.toString('pem'), {
        mode: 0o600,
      });

      console.log(`✅ Generated and stored keys for ${this.config.agentId}`);
    } catch (error) {
      throw new Error(`Failed to initialize keys: ${error}`);
    }
  }

  /**
   * Register with Hyphae Core
   * Returns encryption key or waits for human approval
   */
  async register(): Promise<KeyExchangeResult> {
    console.log(`📋 Starting registration for ${this.config.agentId}`);

    try {
      // Step 1: Initiate registration (get challenge nonce)
      console.log(`   → Initiating challenge...`);
      const nonceResponse = await axios.post(
        `${this.config.hyphaeUrl}/rpc`,
        {
          capability: 'registration.initiate',
          params: { agentId: this.config.agentId },
        }
      );

      if (!nonceResponse.data.success) {
        return {
          success: false,
          status: 'error',
          message: nonceResponse.data.error,
        };
      }

      const nonce = nonceResponse.data.nonce;
      console.log(`   ✅ Challenge received`);

      // Step 2: Sign challenge with private key
      console.log(`   → Signing challenge...`);
      const signature = this.signNonce(nonce);
      console.log(`   ✅ Challenge signed`);

      // Step 3: Submit registration with signature
      console.log(`   → Submitting registration...`);
      const registrationResponse = await axios.post(
        `${this.config.hyphaeUrl}/rpc`,
        {
          capability: 'registration.submit',
          params: {
            agentId: this.config.agentId,
            name: this.config.name,
            role: this.config.role,
            type: this.config.type,
            vouchedBy: this.config.parentAgentId,
            publicKey: this.publicKey,
            nonce,
            signature,
          },
        }
      );

      if (!registrationResponse.data.success) {
        return {
          success: false,
          status: 'error',
          message: registrationResponse.data.error,
        };
      }

      const status = registrationResponse.data.status;

      // Step 4a: Approval required (primary agents)
      if (status === 'pending_approval') {
        console.log(`\n👤 PRIMARY AGENT REGISTRATION PENDING APPROVAL\n`);
        console.log(
          `   Agent ID: ${this.config.agentId}`
        );
        console.log(
          `   Role: ${this.config.role}`
        );
        console.log(
          `\n   ⏳ Waiting for human approval...`
        );
        console.log(
          `   Dashboard: ${this.config.hyphaeUrl}/dashboard/pending-approvals`
        );

        return {
          success: true,
          status: 'pending_approval',
          requiresApproval: true,
          message: 'Awaiting human approval',
        };
      }

      // Step 4b: Auto-approved (sub-agents via parent vouching)
      if (status === 'approved') {
        const encryptionKey = registrationResponse.data.encryptionKey;
        const grantId = registrationResponse.data.grantId;

        console.log(`\n🤖 SUB-AGENT REGISTERED SUCCESSFULLY\n`);
        console.log(`   Agent ID: ${this.config.agentId}`);
        console.log(`   Parent: ${this.config.parentAgentId}`);
        console.log(`   Grant ID: ${grantId}`);

        return {
          success: true,
          status: 'active',
          encryptionKey,
          grantId,
          message: 'Registration approved',
        };
      }

      return {
        success: false,
        status: 'unknown',
        message: `Unknown registration status: ${status}`,
      };
    } catch (error: any) {
      console.error(`❌ Registration failed: ${error.message}`);
      return {
        success: false,
        status: 'error',
        message: error.message,
      };
    }
  }

  /**
   * Wait for approval (for primary agents)
   * Polls until approved or timeout
   */
  async waitForApproval(
    timeoutSeconds: number = 300
  ): Promise<KeyExchangeResult> {
    console.log(
      `⏳ Waiting for approval (timeout: ${timeoutSeconds}s)...`
    );

    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      try {
        const response = await axios.post(
          `${this.config.hyphaeUrl}/rpc`,
          {
            capability: 'registration.checkStatus',
            params: { agentId: this.config.agentId },
          }
        );

        if (response.data.status === 'active') {
          const encryptionKey = response.data.encryptionKey;

          console.log(`\n✅ REGISTRATION APPROVED!\n`);
          console.log(`   Agent ID: ${this.config.agentId}`);
          console.log(`   Grant ID: ${response.data.grantId}`);

          return {
            success: true,
            status: 'active',
            encryptionKey,
            grantId: response.data.grantId,
            message: 'Registration approved by administrator',
          };
        }

        if (response.data.status === 'rejected') {
          console.log(`\n❌ REGISTRATION REJECTED\n`);
          return {
            success: false,
            status: 'rejected',
            message: 'Registration rejected by administrator',
          };
        }
      } catch (e) {
        // Status check failed, try again
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      status: 'timeout',
      message: `Approval not received within ${timeoutSeconds} seconds`,
    };
  }

  /**
   * Sign a challenge nonce with private key
   */
  private signNonce(nonce: string): string {
    const signer = crypto.createSign('SHA256');
    signer.update(nonce);
    const signature = signer.sign(this.privateKey);

    return signature.toString('hex');
  }

  /**
   * Get public key (for debugging)
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.config.agentId;
  }
}

export default RegistrationClient;
