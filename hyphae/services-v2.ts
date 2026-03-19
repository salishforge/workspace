/**
 * Hyphae Service Registry & Agent-to-Agent RPC
 * 
 * Core platform for multi-framework agent coordination.
 * 
 * Features:
 * - Service registration (agents declare capabilities)
 * - Service discovery (find agents by capability)
 * - Agent-to-agent RPC (framework-agnostic calling)
 * - Clock synchronization (REQUIRED at registration)
 * - Audit logging (every call recorded)
 * - Multi-region federation (agents can be in different regions)
 */

import Database from 'better-sqlite3';
import axios from 'axios';
import crypto from 'crypto';
import { HyphaeTimekeeper, ClockSyncResponse } from './timekeeper';

interface Capability {
  name: string;
  description: string;
  params: string[];
  returns: string;
}

interface ServiceRegistration {
  agentId: string;
  name: string;
  framework: string;
  version: string;
  capabilities: Capability[];
  endpoint: string;
  healthCheckPath: string;
  region: string;
  oauthClientId: string;
  authRequired: boolean;
  registeredAt: number;
  lastHeartbeat: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  capacity: number; // 0-1, how utilized
  localTime?: number; // Agent's Date.now() at registration (for clock sync)
  clockOffset?: number; // Hyphae time - agent time in milliseconds
  lastClockSync?: number; // When was clock last synchronized?
}

interface RPCRequest {
  traceId: string;
  sourceAgent: string;
  targetAgent: string;
  capability: string;
  params: Record<string, any>;
  timeout: number;
  timestamp: number;
}

interface RPCResponse {
  traceId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  timestamp: number;
}

class HyphaeServiceRegistry {
  private db: Database.Database;
  private timekeeper: HyphaeTimekeeper;

  constructor(dbPath: string, timekeeper: HyphaeTimekeeper) {
    this.db = new Database(dbPath);
    this.timekeeper = timekeeper;
    this.initSchema();
  }

  private initSchema() {
    // Services table (with clock synchronization)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hyphae_services (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        framework TEXT NOT NULL,
        version TEXT NOT NULL,
        capabilities JSON NOT NULL,
        endpoint TEXT NOT NULL,
        health_check_path TEXT NOT NULL,
        region TEXT NOT NULL,
        oauth_client_id TEXT NOT NULL,
        auth_required BOOLEAN NOT NULL,
        registered_at INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'healthy',
        capacity REAL NOT NULL DEFAULT 0.5,
        clock_offset INTEGER DEFAULT 0,
        last_clock_sync INTEGER,
        clock_status TEXT DEFAULT 'unknown'
      );
      
      CREATE INDEX IF NOT EXISTS idx_hyphae_region ON hyphae_services(region);
      CREATE INDEX IF NOT EXISTS idx_hyphae_status ON hyphae_services(status);
      CREATE INDEX IF NOT EXISTS idx_hyphae_framework ON hyphae_services(framework);
      CREATE INDEX IF NOT EXISTS idx_hyphae_clock_status ON hyphae_services(clock_status);
    `);

    // RPC audit trail table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hyphae_rpc_audit (
        trace_id TEXT PRIMARY KEY,
        source_agent TEXT NOT NULL,
        target_agent TEXT NOT NULL,
        capability TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        error TEXT,
        duration INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        caller_scope TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_rpc_source ON hyphae_rpc_audit(source_agent);
      CREATE INDEX IF NOT EXISTS idx_rpc_target ON hyphae_rpc_audit(target_agent);
      CREATE INDEX IF NOT EXISTS idx_rpc_timestamp ON hyphae_rpc_audit(timestamp);
    `);

    // Service relationships (for semantic routing)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hyphae_relationships (
        source_agent TEXT NOT NULL,
        target_agent TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        strength REAL NOT NULL,
        last_interaction INTEGER NOT NULL,
        PRIMARY KEY (source_agent, target_agent, relationship_type)
      );
    `);
  }

  /**
   * Register a new service (agent calling /services/register)
   * REQUIRES clock synchronization as first step
   */
  registerService(service: ServiceRegistration): { success: boolean; clockSync?: ClockSyncResponse; error?: string } {
    try {
      // STEP 1: Clock synchronization (REQUIRED)
      if (!service.localTime) {
        return {
          success: false,
          error: `REGISTRATION_FAILED: Missing required 'localTime' field.

Registration requires clock synchronization for security and audit trail accuracy.

Details:
  - Field missing: localTime (your current Date.now())
  
REMEDIATION:
  1. Include 'localTime: Date.now()' in registration request
  2. Send POST to /services/register with:
     {
       agentId: "...",
       name: "...",
       localTime: Date.now(),  // <- REQUIRED
       ...
     }
  3. Use returned 'offset' in all subsequent RPC calls
  
Example:
  const response = await fetch('/services/register', {
    method: 'POST',
    body: JSON.stringify({
      agentId: 'my-agent',
      localTime: Date.now(),
      ...
    })
  });
  const offset = response.clockOffset;`,
        };
      }

      // Synchronize clocks
      const clockSyncResult = this.timekeeper.syncAgentClock({
        agentId: service.agentId,
        localTime: service.localTime,
      });

      if (clockSyncResult.status === 'error') {
        return {
          success: false,
          clockSync: clockSyncResult,
          error: clockSyncResult.message,
        };
      }

      // STEP 2: Registration (now that clocks are synced)
      const timePoint = this.timekeeper.now();

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO hyphae_services (
          agent_id, name, framework, version, capabilities,
          endpoint, health_check_path, region, oauth_client_id,
          auth_required, registered_at, last_heartbeat, status, capacity,
          clock_offset, last_clock_sync, clock_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        service.agentId,
        service.name,
        service.framework,
        service.version,
        JSON.stringify(service.capabilities),
        service.endpoint,
        service.healthCheckPath,
        service.region,
        service.oauthClientId,
        service.authRequired ? 1 : 0,
        timePoint.unix,
        timePoint.unix,
        service.status,
        service.capacity,
        clockSyncResult.offset,
        timePoint.unix,
        'healthy'
      );

      return {
        success: true,
        clockSync: clockSyncResult,
      };
    } catch (error) {
      return {
        success: false,
        error: `REGISTRATION_FAILED: Internal error during registration.

Error: ${String(error)}

This may indicate:
  - Database connection issue
  - Invalid service data format
  - Server-side problem

ACTION:
  1. Verify all required fields are present and valid
  2. Retry registration after a few seconds
  3. If persistent, contact Hyphae administrator`,
      };
    }
  }

  /**
   * Deregister a service
   */
  deregisterService(agentId: string): { success: boolean } {
    try {
      this.db.prepare('DELETE FROM hyphae_services WHERE agent_id = ?').run(agentId);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Heartbeat from agent (keeps it alive)
   */
  heartbeat(agentId: string, capacity: number): { success: boolean } {
    try {
      const stmt = this.db.prepare(
        'UPDATE hyphae_services SET last_heartbeat = ?, capacity = ?, status = ? WHERE agent_id = ?'
      );
      stmt.run(Date.now(), capacity, 'healthy', agentId);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Discover services by capability
   * GET /services?capability=researcher&region=us-west
   */
  discoverServices(query: {
    capability?: string;
    region?: string;
    framework?: string;
  }): ServiceRegistration[] {
    let sql = 'SELECT * FROM hyphae_services WHERE status = "healthy"';
    const params: any[] = [];

    if (query.capability) {
      sql += ' AND capabilities LIKE ?';
      params.push(`%"name":"${query.capability}"%`);
    }

    if (query.region) {
      sql += ' AND region = ?';
      params.push(query.region);
    }

    if (query.framework) {
      sql += ' AND framework = ?';
      params.push(query.framework);
    }

    sql += ' ORDER BY capacity ASC'; // Prefer less-utilized agents

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      agentId: row.agent_id,
      name: row.name,
      framework: row.framework,
      version: row.version,
      capabilities: JSON.parse(row.capabilities),
      endpoint: row.endpoint,
      healthCheckPath: row.health_check_path,
      region: row.region,
      oauthClientId: row.oauth_client_id,
      authRequired: Boolean(row.auth_required),
      registeredAt: row.registered_at,
      lastHeartbeat: row.last_heartbeat,
      status: row.status,
      capacity: row.capacity,
    }));
  }

  /**
   * Get details for specific service (includes clock info)
   */
  getService(agentId: string): ServiceRegistration | null {
    const stmt = this.db.prepare('SELECT * FROM hyphae_services WHERE agent_id = ?');
    const row = stmt.get(agentId) as any;

    if (!row) return null;

    return {
      agentId: row.agent_id,
      name: row.name,
      framework: row.framework,
      version: row.version,
      capabilities: JSON.parse(row.capabilities),
      endpoint: row.endpoint,
      healthCheckPath: row.health_check_path,
      region: row.region,
      oauthClientId: row.oauth_client_id,
      authRequired: Boolean(row.auth_required),
      registeredAt: row.registered_at,
      lastHeartbeat: row.last_heartbeat,
      status: row.status,
      capacity: row.capacity,
      clockOffset: row.clock_offset,
      lastClockSync: row.last_clock_sync,
    };
  }

  /**
   * Validate and update clock for a service during heartbeat
   */
  async validateAndUpdateServiceClock(agentId: string): Promise<{ updated: boolean; error?: string }> {
    const service = this.getService(agentId);

    if (!service) {
      return { updated: false, error: `Service ${agentId} not found` };
    }

    try {
      const metrics = await this.timekeeper.validateAgentClockSync(agentId, service.endpoint);

      // Update service with latest clock metrics
      const stmt = this.db.prepare(
        `UPDATE hyphae_services 
         SET clock_offset = ?, last_clock_sync = ?, clock_status = ? 
         WHERE agent_id = ?`
      );

      stmt.run(metrics.averageOffset, metrics.lastValidation, metrics.status, agentId);

      return { updated: true };
    } catch (error) {
      return {
        updated: false,
        error: `Clock validation failed for ${agentId}: ${String(error)}`,
      };
    }
  }

  /**
   * Agent-to-agent RPC call
   * Agent A calls: hyphae.call(targetAgent, capability, params)
   * All RPC timestamps MUST come from timekeeper for accuracy
   */
  async call(
    sourceAgent: string,
    targetAgentId: string,
    capability: string,
    params: Record<string, any>,
    options: { timeout?: number; region?: string; scope?: string; timestamp?: number } = {}
  ): Promise<RPCResponse> {
    const traceId = crypto.randomUUID();
    
    // Use provided timestamp or get from timekeeper
    // In production, timestamp should come from agent's corrected clock
    const timePoint = this.timekeeper.now();
    const timestamp = options.timestamp || timePoint.unix;
    const timeout = options.timeout || 30000;

    try {
      // VALIDATION: Check source agent's clock hasn't drifted
      const sourceService = this.getService(sourceAgent);
      if (sourceService) {
        const timestampValidation = this.timekeeper.validateTimestamp(timestamp, {
          agentId: sourceAgent,
          rpcId: traceId,
        });

        if (!timestampValidation.valid) {
          const error = timestampValidation.error || 'Invalid timestamp';
          console.error(`RPC REJECTED: ${error}`);
          this.logAudit(
            traceId,
            sourceAgent,
            targetAgentId,
            capability,
            false,
            error,
            0,
            options.scope
          );
          return {
            traceId,
            success: false,
            error: `TIMESTAMP_VALIDATION_FAILED: ${error}`,
            duration: 0,
            timestamp,
          };
        }
      }

      // Discover target agent
      const targetService = this.getService(targetAgentId);
      if (!targetService) {
        const error = `SERVICE_NOT_FOUND: Agent '${targetAgentId}' not registered with Hyphae.

Details:
  - Requested agent:  ${targetAgentId}
  - Time:             ${new Date(timestamp).toISOString()}
  - Requester:        ${sourceAgent}
  - Capability:       ${capability}

POSSIBLE CAUSES:
  1. Agent has not registered (startup delay?)
  2. Agent name is incorrect
  3. Agent deregistered or crashed
  4. Agent is in a different region

REMEDIATION:
  1. Verify agent name matches exactly (case-sensitive)
  2. Confirm agent is running and healthy
  3. Check if agent is in expected region
  4. Wait a few seconds (new agents have startup delay)
  5. Retry discovery to get current service list`;

        this.logAudit(traceId, sourceAgent, targetAgentId, capability, false, error, 0, options.scope);
        return { traceId, success: false, error, duration: 0, timestamp };
      }

      // Check region if specified
      if (options.region && targetService.region !== options.region) {
        const error = `Service not available in region: ${options.region}`;
        this.logAudit(traceId, sourceAgent, targetAgentId, capability, false, error, 0, options.scope);
        return { traceId, success: false, error, duration: 0, timestamp };
      }

      // Make HTTP call to target agent
      const startTime = Date.now();
      const response = await axios.post(
        `${targetService.endpoint}/rpc`,
        {
          traceId,
          sourceAgent,
          targetAgent: targetAgentId,
          capability,
          params,
          timestamp,
        },
        {
          timeout,
          headers: {
            'X-Trace-Id': traceId,
            'X-Source-Agent': sourceAgent,
            ...(options.scope && { 'X-Agent-Scope': options.scope }),
          },
        }
      );

      const duration = Date.now() - startTime;

      // Log successful call
      this.logAudit(traceId, sourceAgent, targetAgentId, capability, true, undefined, duration, options.scope);

      // Update relationship (for semantic routing later)
      this.recordRelationship(sourceAgent, targetAgentId, 'calls', 1.0);

      return {
        traceId,
        success: true,
        result: response.data,
        duration,
        timestamp,
      };
    } catch (error) {
      const duration = Date.now() - timestamp;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.logAudit(traceId, sourceAgent, targetAgentId, capability, false, errorMsg, duration, options.scope);

      return {
        traceId,
        success: false,
        error: errorMsg,
        duration,
        timestamp,
      };
    }
  }

  /**
   * Log RPC audit trail
   */
  private logAudit(
    traceId: string,
    sourceAgent: string,
    targetAgent: string,
    capability: string,
    success: boolean,
    error: string | undefined,
    duration: number,
    scope?: string
  ) {
    const stmt = this.db.prepare(`
      INSERT INTO hyphae_rpc_audit (
        trace_id, source_agent, target_agent, capability,
        success, error, duration, timestamp, caller_scope
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      traceId,
      sourceAgent,
      targetAgent,
      capability,
      success ? 1 : 0,
      error || null,
      duration,
      Date.now(),
      scope || null
    );
  }

  /**
   * Record relationship between agents (for semantic routing)
   */
  private recordRelationship(sourceAgent: string, targetAgent: string, type: string, strength: number) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO hyphae_relationships (
          source_agent, target_agent, relationship_type, strength, last_interaction
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_agent, target_agent, relationship_type)
        DO UPDATE SET strength = strength + ?, last_interaction = ?
      `);

      stmt.run(sourceAgent, targetAgent, type, strength, Date.now(), strength, Date.now());
    } catch (error) {
      // Ignore errors in relationship tracking
    }
  }

  /**
   * Get audit trail for debugging/compliance
   */
  getAuditTrail(filters: {
    sourceAgent?: string;
    targetAgent?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): any[] {
    let sql = 'SELECT * FROM hyphae_rpc_audit WHERE 1=1';
    const params: any[] = [];

    if (filters.sourceAgent) {
      sql += ' AND source_agent = ?';
      params.push(filters.sourceAgent);
    }

    if (filters.targetAgent) {
      sql += ' AND target_agent = ?';
      params.push(filters.targetAgent);
    }

    if (filters.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(filters.startTime);
    }

    if (filters.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(filters.endTime);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(filters.limit || 100);

    return this.db.prepare(sql).all(...params) as any[];
  }

  /**
   * Get service mesh topology (for Dashboard)
   */
  getMeshTopology(): {
    services: ServiceRegistration[];
    relationships: any[];
    metrics: { totalServices: number; healthyServices: number; averageCapacity: number };
  } {
    const stmt = this.db.prepare('SELECT * FROM hyphae_services');
    const services = stmt.all() as any[];

    const relationships = this.db
      .prepare('SELECT * FROM hyphae_relationships ORDER BY strength DESC LIMIT 100')
      .all();

    const healthyServices = services.filter((s) => s.status === 'healthy').length;
    const averageCapacity =
      services.length > 0 ? services.reduce((sum: number, s: any) => sum + s.capacity, 0) / services.length : 0;

    return {
      services: services.map((row) => ({
        agentId: row.agent_id,
        name: row.name,
        framework: row.framework,
        version: row.version,
        capabilities: JSON.parse(row.capabilities),
        endpoint: row.endpoint,
        region: row.region,
        status: row.status,
        capacity: row.capacity,
      })),
      relationships,
      metrics: {
        totalServices: services.length,
        healthyServices,
        averageCapacity,
      },
    };
  }
}

export { HyphaeServiceRegistry, ServiceRegistration, Capability, RPCRequest, RPCResponse };
export { HyphaeTimekeeper } from './timekeeper';
