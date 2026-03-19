/**
 * Hyphae Zero-Trust Agent Registration Protocol
 * 
 * Tiered registration with key exchange:
 * - Primary agents: Require human authorization
 * - Sub-agents: Autonomous registration via parent vouching
 */

import crypto from 'crypto';
import { Database } from 'pg';

export interface AgentIdentity {
  agentId: string;
  publicKey: string; // Ed25519 public key (hex)
  name: string;
  role: string;
  type: 'primary' | 'sub-agent';
}

export interface RegistrationChallenge {
  challengeId: string;
  agentId: string;
  nonce: string;
  expiresAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  approvedAt?: Date;
}

export interface RegistrationRequest {
  agentId: string;
  publicKey: string;
  name: string;
  role: string;
  type: 'primary' | 'sub-agent';
  vouchedBy?: string; // For sub-agents: parent agent ID
  signature: string; // Signed nonce with agent's private key
  nonce: string; // Challenge nonce
}

export interface EncryptionKeyGrant {
  grantId: string;
  agentId: string;
  encryptionKey: string; // Returned to agent
  issuedAt: Date;
  expiresAt: Date;
}

export class RegistrationProtocol {
  private db: Database;
  private challenges: Map<string, RegistrationChallenge> = new Map();

  constructor(db: Database) {
    this.db = db;
    this.initializeSchema();
  }

  /**
   * Initialize registration tables
   */
  private async initializeSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS hyphae_agent_identities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id VARCHAR(255) NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        name VARCHAR(255),
        role VARCHAR(255),
        type VARCHAR(50) NOT NULL, -- 'primary', 'sub-agent'
        parent_agent_id VARCHAR(255), -- For sub-agents
        status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'active', 'revoked'
        created_at TIMESTAMP DEFAULT NOW(),
        approved_at TIMESTAMP,
        approved_by VARCHAR(255),
        revoked_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS hyphae_registration_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_id VARCHAR(255) NOT NULL UNIQUE,
        agent_id VARCHAR(255) NOT NULL,
        nonce TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        approved_by VARCHAR(255),
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hyphae_key_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        grant_id VARCHAR(255) NOT NULL UNIQUE,
        agent_id VARCHAR(255) NOT NULL,
        encryption_key TEXT NOT NULL,
        issued_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        issued_by VARCHAR(255)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_identities_agent_id 
        ON hyphae_agent_identities(agent_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_agent_id 
        ON hyphae_registration_challenges(agent_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_status 
        ON hyphae_registration_challenges(status);
      CREATE INDEX IF NOT EXISTS idx_key_grants_agent_id 
        ON hyphae_key_grants(agent_id);
    `);
  }

  /**
   * Step 1: Agent initiates registration
   * Hyphae Core issues challenge (nonce)
   */
  async initiateRegistration(agentId: string): Promise<string> {
    console.log(`📋 Registration initiated for ${agentId}`);

    const challengeId = crypto.randomUUID();
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const challenge: RegistrationChallenge = {
      challengeId,
      agentId,
      nonce,
      expiresAt,
      status: 'pending',
    };

    this.challenges.set(challengeId, challenge);

    // Store in database
    await this.db.query(
      `INSERT INTO hyphae_registration_challenges 
       (challenge_id, agent_id, nonce, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [challengeId, agentId, nonce, expiresAt]
    );

    return nonce; // Return to agent
  }

  /**
   * Step 2: Agent signs challenge with private key
   * Agent sends: registration request with signature
   */
  async submitRegistration(request: RegistrationRequest): Promise<{
    success: boolean;
    status: string;
    requiresApproval?: boolean;
    grantId?: string;
    encryptionKey?: string;
    error?: string;
  }> {
    console.log(`📝 Registration request from ${request.agentId}`);

    // Verify challenge is valid
    const challenge = await this.db.query(
      `SELECT * FROM hyphae_registration_challenges 
       WHERE nonce = $1 AND status = 'pending'`,
      [request.nonce]
    );

    if (challenge.rows.length === 0) {
      return {
        success: false,
        status: 'invalid_challenge',
        error: 'Challenge not found or expired',
      };
    }

    const chal = challenge.rows[0];

    // Verify signature (agent signed the nonce with their private key)
    if (!this.verifySignature(request.nonce, request.signature, request.publicKey)) {
      return {
        success: false,
        status: 'invalid_signature',
        error: 'Signature verification failed',
      };
    }

    console.log(`✅ Signature verified for ${request.agentId}`);

    // Store agent identity
    const identityResult = await this.db.query(
      `INSERT INTO hyphae_agent_identities 
       (agent_id, public_key, name, role, type, parent_agent_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (agent_id) DO UPDATE SET status = $7
       RETURNING *`,
      [
        request.agentId,
        request.publicKey,
        request.name,
        request.role,
        request.type,
        request.vouchedBy || null,
        'pending',
      ]
    );

    // Determine approval path
    if (request.type === 'primary') {
      // Primary agents require human approval
      console.log(`👤 Primary agent ${request.agentId} pending human approval`);
      return {
        success: true,
        status: 'pending_approval',
        requiresApproval: true,
      };
    } else if (request.type === 'sub-agent' && request.vouchedBy) {
      // Sub-agents: verify parent agent is active
      const parentAgent = await this.db.query(
        `SELECT * FROM hyphae_agent_identities 
         WHERE agent_id = $1 AND status = 'active'`,
        [request.vouchedBy]
      );

      if (parentAgent.rows.length === 0) {
        return {
          success: false,
          status: 'parent_not_active',
          error: `Parent agent ${request.vouchedBy} is not active`,
        };
      }

      // Auto-approve sub-agent
      console.log(
        `🤖 Sub-agent ${request.agentId} auto-approved by parent ${request.vouchedBy}`
      );

      return await this.approveRegistration(request.agentId, request.vouchedBy);
    } else {
      return {
        success: false,
        status: 'invalid_request',
        error: 'Sub-agents must specify vouchedBy parent agent',
      };
    }
  }

  /**
   * Step 3a: Human approves primary agent registration
   */
  async approveRegistration(agentId: string, approvedBy: string): Promise<{
    success: boolean;
    status: string;
    grantId?: string;
    encryptionKey?: string;
    error?: string;
  }> {
    console.log(`✅ Approving registration for ${agentId} (by ${approvedBy})`);

    // Verify agent exists and is pending
    const agent = await this.db.query(
      `SELECT * FROM hyphae_agent_identities 
       WHERE agent_id = $1 AND status = 'pending'`,
      [agentId]
    );

    if (agent.rows.length === 0) {
      return {
        success: false,
        status: 'agent_not_pending',
        error: `Agent ${agentId} not found or already approved`,
      };
    }

    // Generate encryption key for this agent
    const encryptionKey = crypto.randomBytes(32).toString('hex');
    const grantId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

    // Store key grant
    await this.db.query(
      `INSERT INTO hyphae_key_grants 
       (grant_id, agent_id, encryption_key, expires_at, issued_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [grantId, agentId, encryptionKey, expiresAt, approvedBy]
    );

    // Update agent status to active
    await this.db.query(
      `UPDATE hyphae_agent_identities 
       SET status = 'active', approved_at = NOW(), approved_by = $1
       WHERE agent_id = $2`,
      [approvedBy, agentId]
    );

    // Update challenge status
    await this.db.query(
      `UPDATE hyphae_registration_challenges 
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE agent_id = $2`,
      [approvedBy, agentId]
    );

    console.log(`🔑 Encryption key granted to ${agentId}`);

    return {
      success: true,
      status: 'approved',
      grantId,
      encryptionKey, // Return to agent
    };
  }

  /**
   * Step 3b: Human rejects primary agent registration
   */
  async rejectRegistration(agentId: string, rejectedBy: string): Promise<boolean> {
    console.log(`❌ Rejecting registration for ${agentId}`);

    await this.db.query(
      `UPDATE hyphae_agent_identities 
       SET status = 'revoked'
       WHERE agent_id = $1`,
      [agentId]
    );

    await this.db.query(
      `UPDATE hyphae_registration_challenges 
       SET status = 'rejected', approved_by = $1, approved_at = NOW()
       WHERE agent_id = $2`,
      [rejectedBy, agentId]
    );

    return true;
  }

  /**
   * Verify agent signature (agent signed with private key)
   */
  private verifySignature(
    nonce: string,
    signature: string,
    publicKey: string
  ): boolean {
    try {
      // Create verifier with agent's public key
      const verifier = crypto.createVerify('SHA256');
      verifier.update(nonce);

      // Verify signature
      return verifier.verify(
        {
          key: Buffer.from(publicKey, 'hex').toString('base64'),
          format: 'pem',
          type: 'pkcs8',
        },
        Buffer.from(signature, 'hex')
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * Agent retrieves its encryption key
   */
  async getEncryptionKey(agentId: string): Promise<string | null> {
    const result = await this.db.query(
      `SELECT encryption_key FROM hyphae_key_grants 
       WHERE agent_id = $1 AND expires_at > NOW() AND revoked_at IS NULL
       LIMIT 1`,
      [agentId]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0].encryption_key;
  }

  /**
   * Verify agent is active
   */
  async isAgentActive(agentId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT status FROM hyphae_agent_identities WHERE agent_id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) return false;
    return result.rows[0].status === 'active';
  }

  /**
   * List pending approvals (for admin dashboard)
   */
  async listPendingApprovals(): Promise<any[]> {
    const result = await this.db.query(
      `SELECT agent_id, name, role, type, created_at 
       FROM hyphae_agent_identities 
       WHERE status = 'pending'
       ORDER BY created_at DESC`
    );

    return result.rows;
  }

  /**
   * Get agent identity
   */
  async getAgentIdentity(agentId: string): Promise<AgentIdentity | null> {
    const result = await this.db.query(
      `SELECT agent_id, public_key, name, role, type 
       FROM hyphae_agent_identities 
       WHERE agent_id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      agentId: row.agent_id,
      publicKey: row.public_key,
      name: row.name,
      role: row.role,
      type: row.type,
    };
  }

  /**
   * Revoke agent registration
   */
  async revokeAgent(agentId: string, revokedBy: string): Promise<boolean> {
    await this.db.query(
      `UPDATE hyphae_agent_identities 
       SET status = 'revoked'
       WHERE agent_id = $1`,
      [agentId]
    );

    await this.db.query(
      `UPDATE hyphae_key_grants 
       SET revoked_at = NOW()
       WHERE agent_id = $1`,
      [agentId]
    );

    console.log(`🚫 Agent ${agentId} revoked by ${revokedBy}`);
    return true;
  }
}
