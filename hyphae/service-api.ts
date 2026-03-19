/**
 * Hyphae Universal Service API
 * Agents make standardized calls to Hyphae; Hyphae proxies to appropriate backend
 */

import { Database } from 'pg';

/**
 * Standard Hyphae Service Request
 * This is the ONLY interface agents need to know
 */
export interface ServiceRequest {
  sourceAgent: string; // Agent making the request
  service: string; // Service name (e.g., 'secrets', 'database', 'storage')
  operation: string; // Operation (e.g., 'get', 'set', 'query')
  params: Record<string, any>; // Operation-specific parameters
  context?: {
    traceId?: string;
    timeout?: number;
    retryPolicy?: 'none' | 'exponential' | 'linear';
  };
}

/**
 * Standard Hyphae Service Response
 * All backends normalize to this format
 */
export interface ServiceResponse {
  success: boolean;
  result?: any; // Operation result
  error?: string; // Error message if failed
  status?: string; // Service-specific status
  metadata?: {
    sourceBackend: string; // Which backend handled this (core, 1password, azure, etc.)
    latency: number; // Milliseconds
    backendStatus: string; // Backend-specific status
  };
  traceId?: string;
}

/**
 * Service Connector Interface
 * All external service adapters implement this
 */
export interface IServiceConnector {
  name: string; // 'core-vault', '1password', 'azure-keyvault', 'aws-secrets', etc.
  type: string; // 'secrets', 'database', 'storage', 'messaging', etc.
  isAvailable(): Promise<boolean>;
  execute(operation: string, params: Record<string, any>): Promise<any>;
  supportsOperation(operation: string): boolean;
}

/**
 * Service Configuration
 * How services are registered and routed
 */
export interface ServiceConfig {
  serviceName: string; // 'secrets'
  operation: string; // 'get'
  primaryConnector: string; // 'core-vault'
  fallbackConnectors?: string[]; // ['1password', 'azure-keyvault']
  routingRules?: {
    // Route based on request parameters
    condition: (params: Record<string, any>) => boolean;
    connector: string;
  }[];
  caching?: {
    enabled: boolean;
    ttl: number; // Seconds
  };
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

/**
 * Hyphae Service API Gateway
 */
export class HyphaeServiceAPI {
  private db: Database;
  private connectors: Map<string, IServiceConnector> = new Map();
  private serviceRegistry: Map<string, ServiceConfig> = new Map();
  private requestCache: Map<string, { result: any; expiresAt: Date }> = new Map();
  private auditLog: any;

  constructor(db: Database) {
    this.db = db;
    this.initializeSchema();
  }

  /**
   * Initialize service API tables
   */
  private async initializeSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS hyphae_services (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        service_name VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(100),
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hyphae_service_connectors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        connector_name VARCHAR(255) NOT NULL UNIQUE,
        service_type VARCHAR(100) NOT NULL,
        connector_class VARCHAR(255),
        config JSONB,
        status VARCHAR(50) DEFAULT 'inactive',
        priority INTEGER DEFAULT 100,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hyphae_service_routes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        service_name VARCHAR(255) NOT NULL,
        operation VARCHAR(255) NOT NULL,
        primary_connector VARCHAR(255),
        fallback_connectors TEXT[],
        routing_rules JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hyphae_service_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_agent VARCHAR(255),
        service_name VARCHAR(255),
        operation VARCHAR(255),
        connector_used VARCHAR(255),
        status VARCHAR(50),
        latency_ms INTEGER,
        requested_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_services_name ON hyphae_services(service_name);
      CREATE INDEX IF NOT EXISTS idx_connectors_service ON hyphae_service_connectors(service_type);
      CREATE INDEX IF NOT EXISTS idx_routes_service ON hyphae_service_routes(service_name);
      CREATE INDEX IF NOT EXISTS idx_requests_agent ON hyphae_service_requests(source_agent);
      CREATE INDEX IF NOT EXISTS idx_requests_service ON hyphae_service_requests(service_name);
    `);
  }

  /**
   * Register a service connector
   */
  registerConnector(connector: IServiceConnector): void {
    this.connectors.set(connector.name, connector);
    console.log(`✅ Registered connector: ${connector.name} (${connector.type})`);
  }

  /**
   * Register service routing rules
   */
  registerService(config: ServiceConfig): void {
    this.serviceRegistry.set(
      `${config.serviceName}:${config.operation}`,
      config
    );
    console.log(
      `✅ Registered service: ${config.serviceName}.${config.operation} → ${config.primaryConnector}`
    );
  }

  /**
   * Main API entry point: Execute a service request
   * Agents call this for ALL external service access
   */
  async execute(request: ServiceRequest): Promise<ServiceResponse> {
    const startTime = Date.now();
    const traceId = request.context?.traceId || this.generateTraceId();

    console.log(
      `📡 [${traceId}] ${request.sourceAgent}.${request.service}.${request.operation}`
    );

    try {
      // Verify agent is registered and active
      const agentActive = await this.isAgentActive(request.sourceAgent);
      if (!agentActive) {
        return {
          success: false,
          error: `Agent ${request.sourceAgent} is not registered or active`,
          traceId,
          metadata: { sourceBackend: 'gateway', latency: Date.now() - startTime },
        };
      }

      // Check permissions
      const hasPermission = await this.canAgentAccessService(
        request.sourceAgent,
        request.service
      );
      if (!hasPermission) {
        return {
          success: false,
          error: `Agent ${request.sourceAgent} does not have permission to access ${request.service}`,
          traceId,
          metadata: { sourceBackend: 'gateway', latency: Date.now() - startTime },
        };
      }

      // Check cache
      const cacheKey = this.generateCacheKey(request);
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiresAt > new Date()) {
        console.log(`   💾 Cache hit`);
        return {
          success: true,
          result: cached.result,
          metadata: {
            sourceBackend: 'cache',
            latency: Date.now() - startTime,
          },
          traceId,
        };
      }

      // Get routing config
      const routeKey = `${request.service}:${request.operation}`;
      const route = this.serviceRegistry.get(routeKey);

      if (!route) {
        return {
          success: false,
          error: `Service ${request.service}.${request.operation} not found`,
          traceId,
          metadata: { sourceBackend: 'gateway', latency: Date.now() - startTime },
        };
      }

      // Determine which connector to use
      const connectorName = this.selectConnector(
        route,
        request.params
      );

      if (!connectorName) {
        return {
          success: false,
          error: 'No available connectors for this service',
          traceId,
          metadata: { sourceBackend: 'gateway', latency: Date.now() - startTime },
        };
      }

      // Execute with retry logic
      let lastError: any;
      const maxAttempts = route.retryPolicy?.maxAttempts || 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await this.executeWithConnector(
            connectorName,
            request.operation,
            request.params,
            request.context?.timeout || 30000
          );

          // Cache result if configured
          if (route.caching?.enabled) {
            this.cacheResult(
              cacheKey,
              result,
              route.caching.ttl || 3600
            );
          }

          // Audit log
          await this.auditServiceRequest(
            request.sourceAgent,
            request.service,
            request.operation,
            connectorName,
            'success',
            Date.now() - startTime
          );

          console.log(
            `   ✅ Success via ${connectorName} (${Date.now() - startTime}ms)`
          );

          return {
            success: true,
            result,
            metadata: {
              sourceBackend: connectorName,
              latency: Date.now() - startTime,
              backendStatus: 'success',
            },
            traceId,
          };
        } catch (error: any) {
          lastError = error;
          console.warn(
            `   ⚠️  Attempt ${attempt}/${maxAttempts} failed: ${error.message}`
          );

          // Try fallback connectors
          if (attempt === 1 && route.fallbackConnectors && route.fallbackConnectors.length > 0) {
            for (const fallbackName of route.fallbackConnectors) {
              try {
                console.log(`   → Trying fallback: ${fallbackName}`);
                const result = await this.executeWithConnector(
                  fallbackName,
                  request.operation,
                  request.params,
                  request.context?.timeout || 30000
                );

                // Cache and audit
                if (route.caching?.enabled) {
                  this.cacheResult(cacheKey, result, route.caching.ttl || 3600);
                }

                await this.auditServiceRequest(
                  request.sourceAgent,
                  request.service,
                  request.operation,
                  fallbackName,
                  'success',
                  Date.now() - startTime
                );

                console.log(
                  `   ✅ Success via fallback ${fallbackName} (${Date.now() - startTime}ms)`
                );

                return {
                  success: true,
                  result,
                  metadata: {
                    sourceBackend: fallbackName,
                    latency: Date.now() - startTime,
                    backendStatus: 'fallback',
                  },
                  traceId,
                };
              } catch (fallbackError: any) {
                console.warn(`   ✗ Fallback ${fallbackName} failed: ${fallbackError.message}`);
              }
            }
          }

          // Wait before retry
          if (attempt < maxAttempts) {
            const backoffMs = route.retryPolicy?.backoffMs || 1000;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        }
      }

      // All attempts failed
      await this.auditServiceRequest(
        request.sourceAgent,
        request.service,
        request.operation,
        connectorName,
        'failure',
        Date.now() - startTime
      );

      return {
        success: false,
        error: `All connectors failed: ${lastError?.message}`,
        traceId,
        metadata: {
          sourceBackend: connectorName,
          latency: Date.now() - startTime,
          backendStatus: 'failed',
        },
      };
    } catch (error: any) {
      console.error(`[${traceId}] Gateway error: ${error.message}`);
      return {
        success: false,
        error: `Gateway error: ${error.message}`,
        traceId,
        metadata: {
          sourceBackend: 'gateway',
          latency: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute request with specific connector
   */
  private async executeWithConnector(
    connectorName: string,
    operation: string,
    params: Record<string, any>,
    timeout: number
  ): Promise<any> {
    const connector = this.connectors.get(connectorName);

    if (!connector) {
      throw new Error(`Connector ${connectorName} not found`);
    }

    if (!connector.supportsOperation(operation)) {
      throw new Error(
        `Connector ${connectorName} does not support operation ${operation}`
      );
    }

    const isAvailable = await connector.isAvailable();
    if (!isAvailable) {
      throw new Error(`Connector ${connectorName} is not available`);
    }

    // Execute with timeout
    return Promise.race([
      connector.execute(operation, params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      ),
    ]);
  }

  /**
   * Select which connector to use for this request
   */
  private selectConnector(
    route: ServiceConfig,
    params: Record<string, any>
  ): string | null {
    // Check routing rules first
    if (route.routingRules && route.routingRules.length > 0) {
      for (const rule of route.routingRules) {
        if (rule.condition(params)) {
          return rule.connector;
        }
      }
    }

    // Use primary connector
    return route.primaryConnector;
  }

  /**
   * Check if agent is active
   */
  private async isAgentActive(agentId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT status FROM hyphae_agent_identities WHERE agent_id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) return false;
    return result.rows[0].status === 'active';
  }

  /**
   * Check if agent has permission to access service
   */
  private async canAgentAccessService(
    agentId: string,
    service: string
  ): Promise<boolean> {
    // Check service access policies
    const result = await this.db.query(
      `SELECT permission FROM hyphae_service_access_policies 
       WHERE agent_id = $1 AND service_name = $2 
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [agentId, service]
    );

    // For now, allow all active agents to access all services
    // In production, enforce explicit permissions
    return true;
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(request: ServiceRequest): string {
    return `${request.sourceAgent}:${request.service}:${request.operation}:${JSON.stringify(
      request.params
    )}`;
  }

  /**
   * Cache a result
   */
  private cacheResult(key: string, result: any, ttlSeconds: number): void {
    this.requestCache.set(key, {
      result,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });

    // Auto-expire
    setTimeout(() => this.requestCache.delete(key), ttlSeconds * 1000);
  }

  /**
   * Audit service request
   */
  private async auditServiceRequest(
    sourceAgent: string,
    service: string,
    operation: string,
    connector: string,
    status: string,
    latency: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO hyphae_service_requests 
       (source_agent, service_name, operation, connector_used, status, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sourceAgent, service, operation, connector, status, latency]
    ).catch(() => {
      // Audit failure doesn't block request
    });
  }

  /**
   * Generate trace ID
   */
  private generateTraceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get service status
   */
  async getServiceStatus(): Promise<any> {
    const connectorStatus: Record<string, any> = {};

    for (const [name, connector] of this.connectors) {
      connectorStatus[name] = {
        available: await connector.isAvailable(),
        type: connector.type,
      };
    }

    return {
      connectors: connectorStatus,
      registeredServices: Array.from(this.serviceRegistry.keys()),
    };
  }

  /**
   * List available services and operations
   */
  async getAvailableServices(): Promise<any[]> {
    return Array.from(this.serviceRegistry.entries()).map(([key, config]) => ({
      service: config.serviceName,
      operation: config.operation,
      primaryConnector: config.primaryConnector,
      fallbackConnectors: config.fallbackConnectors || [],
    }));
  }
}
