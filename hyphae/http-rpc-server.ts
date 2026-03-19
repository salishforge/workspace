/**
 * Hyphae HTTP RPC Server
 * 
 * Exposes service registry, discovery, and RPC coordination via HTTP.
 * Framework-agnostic coordination layer for multi-agent systems.
 * 
 * Endpoints:
 * - POST /api/services/register — Agent registration
 * - GET /api/services — Service discovery (query by capability/region)
 * - POST /api/rpc/call — Agent-to-agent RPC
 * - GET /api/services/{id} — Get service details
 * - GET /api/rpc/audit — Query RPC audit trail
 */

import express, { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import pg from "pg";

const { Pool } = pg;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "hyphae",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});

// Express app
const app = express();
app.use(express.json({ limit: "10mb" }));

// Types
interface ServiceRegistration {
  agentId: string;
  name: string;
  capabilities: string[];
  endpoint: string;
  transport: "http" | "nats" | "grpc";
  region: string;
  version: string;
  metadata?: Record<string, any>;
}

interface HyphaeRPCCall {
  sourceAgent: string;
  targetAgent: string;
  capability: string;
  params: Record<string, any>;
  timeout: number;
  traceId: string;
  deadline?: number;
}

interface HyphaeRPCResponse {
  success: boolean;
  result?: any;
  error?: string;
  traceId: string;
  duration: number;
  sourceAgent: string;
  targetAgent: string;
}

// Initialize database
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Service registry table
    await client.query(`
      CREATE TABLE IF NOT EXISTS hyphae_services (
        id UUID PRIMARY KEY,
        agent_id VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        capabilities TEXT[] NOT NULL,
        endpoint VARCHAR(1024) NOT NULL,
        transport VARCHAR(50) NOT NULL,
        region VARCHAR(100) NOT NULL,
        version VARCHAR(50) NOT NULL,
        metadata JSONB,
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        healthy BOOLEAN DEFAULT true
      );
    `);

    // RPC audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS hyphae_rpc_audit (
        id UUID PRIMARY KEY,
        trace_id VARCHAR(255) NOT NULL,
        source_agent VARCHAR(255) NOT NULL,
        target_agent VARCHAR(255) NOT NULL,
        capability VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        duration_ms INTEGER,
        error TEXT,
        params_hash VARCHAR(64),
        called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);

    // Service relationships (for semantic routing)
    await client.query(`
      CREATE TABLE IF NOT EXISTS hyphae_relationships (
        id UUID PRIMARY KEY,
        source_agent VARCHAR(255) NOT NULL,
        target_agent VARCHAR(255) NOT NULL,
        capability VARCHAR(255),
        call_count INTEGER DEFAULT 0,
        last_call TIMESTAMP,
        avg_duration_ms FLOAT DEFAULT 0
      );
    `);

    // Indexes
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_services_agent_id ON hyphae_services(agent_id);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_services_region ON hyphae_services(region);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_services_capabilities ON hyphae_services USING GIN(capabilities);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_audit_trace_id ON hyphae_rpc_audit(trace_id);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_audit_called_at ON hyphae_rpc_audit(called_at);"
    );

    console.log("✅ Database initialized");
  } finally {
    client.release();
  }
}

// Middleware: Request ID
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as any).traceId = req.headers["x-trace-id"] || uuidv4();
  res.setHeader("X-Trace-Id", (req as any).traceId);
  next();
});

// Middleware: Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({
    success: false,
    error: err.message,
    traceId: (req as any).traceId,
  });
});

// ============================================================================
// SERVICE REGISTRATION & DISCOVERY
// ============================================================================

/**
 * POST /api/services/register
 * 
 * Agent registers with Hyphae, provides capabilities and endpoint.
 * 
 * Body:
 * {
 *   agentId: "researcher",
 *   name: "Research Agent",
 *   capabilities: ["research", "analyze"],
 *   endpoint: "http://localhost:3006",
 *   transport: "http",
 *   region: "us-west-2",
 *   version: "1.0.0",
 *   metadata: { model: "gemini-2.5-pro" }
 * }
 */
app.post("/api/services/register", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;

  try {
    const {
      agentId,
      name,
      capabilities,
      endpoint,
      transport,
      region,
      version,
      metadata,
    } = req.body as ServiceRegistration;

    // Validate
    if (!agentId || !capabilities || !endpoint) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: agentId, capabilities, endpoint",
        traceId,
      });
    }

    const serviceId = uuidv4();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Check for existing registration
      const existing = await client.query(
        "SELECT id FROM hyphae_services WHERE agent_id = $1",
        [agentId]
      );

      if (existing.rows.length > 0) {
        // Update existing
        await client.query(
          `UPDATE hyphae_services 
           SET endpoint = $1, transport = $2, region = $3, version = $4, 
               metadata = $5, healthy = true, last_heartbeat = CURRENT_TIMESTAMP
           WHERE agent_id = $6`,
          [endpoint, transport, region, version, JSON.stringify(metadata), agentId]
        );
      } else {
        // Insert new
        await client.query(
          `INSERT INTO hyphae_services 
           (id, agent_id, name, capabilities, endpoint, transport, region, version, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            serviceId,
            agentId,
            name,
            capabilities,
            endpoint,
            transport,
            region,
            version,
            JSON.stringify(metadata),
          ]
        );
      }

      await client.query("COMMIT");

      res.status(200).json({
        success: true,
        serviceId,
        agentId,
        message: "Service registered successfully",
        traceId,
      });

      console.log(`✅ Agent registered: ${agentId} (${traceId})`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("❌ Registration failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      traceId,
    });
  }
});

/**
 * GET /api/services
 * 
 * Discover services by capability, region, or framework.
 * 
 * Query params:
 * - capability: Filter by capability (e.g., "research")
 * - region: Filter by region (e.g., "us-west-2")
 * - framework: Filter by framework (e.g., "crewai")
 * - healthy: true/false (default: true)
 */
app.get("/api/services", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;

  try {
    const { capability, region, framework, healthy = "true" } = req.query;

    let query = "SELECT * FROM hyphae_services WHERE healthy = $1";
    const params: any[] = [healthy === "true"];

    if (capability) {
      query += ` AND $${params.length + 1} = ANY(capabilities)`;
      params.push(capability);
    }

    if (region) {
      query += ` AND region = $${params.length + 1}`;
      params.push(region);
    }

    if (framework) {
      query += ` AND metadata->>'framework' = $${params.length + 1}`;
      params.push(framework);
    }

    query += " ORDER BY last_heartbeat DESC";

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      services: result.rows.map((row) => ({
        agentId: row.agent_id,
        name: row.name,
        capabilities: row.capabilities,
        endpoint: row.endpoint,
        transport: row.transport,
        region: row.region,
        version: row.version,
        metadata: row.metadata,
        registeredAt: row.registered_at,
        lastHeartbeat: row.last_heartbeat,
        healthy: row.healthy,
      })),
      count: result.rows.length,
      traceId,
    });

    console.log(
      `✅ Service discovery: ${result.rows.length} services found (${traceId})`
    );
  } catch (err: any) {
    console.error("❌ Discovery failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      traceId,
    });
  }
});

/**
 * GET /api/services/:agentId
 * 
 * Get details for a specific agent.
 */
app.get("/api/services/:agentId", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { agentId } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM hyphae_services WHERE agent_id = $1",
      [agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Agent not found: ${agentId}`,
        traceId,
      });
    }

    const row = result.rows[0];
    res.status(200).json({
      success: true,
      service: {
        agentId: row.agent_id,
        name: row.name,
        capabilities: row.capabilities,
        endpoint: row.endpoint,
        transport: row.transport,
        region: row.region,
        version: row.version,
        metadata: row.metadata,
        registeredAt: row.registered_at,
        lastHeartbeat: row.last_heartbeat,
        healthy: row.healthy,
      },
      traceId,
    });
  } catch (err: any) {
    console.error("❌ Service lookup failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      traceId,
    });
  }
});

// ============================================================================
// RPC COORDINATION
// ============================================================================

/**
 * POST /api/rpc/call
 * 
 * Agent A calls Agent B through Hyphae.
 * Hyphae routes the call, logs it, tracks relationships.
 * 
 * Body:
 * {
 *   sourceAgent: "researcher",
 *   targetAgent: "analyzer",
 *   capability: "analyze",
 *   params: { data: "..." },
 *   timeout: 30000,
 *   traceId: "..."
 * }
 */
app.post("/api/rpc/call", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const startTime = Date.now();

  try {
    const {
      sourceAgent,
      targetAgent,
      capability,
      params,
      timeout = 30000,
    }: HyphaeRPCCall = req.body;

    // Validate
    if (!sourceAgent || !targetAgent || !capability) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: sourceAgent, targetAgent, capability",
        traceId,
      });
    }

    // Find target service
    const serviceResult = await pool.query(
      "SELECT * FROM hyphae_services WHERE agent_id = $1 AND healthy = true",
      [targetAgent]
    );

    if (serviceResult.rows.length === 0) {
      const auditId = uuidv4();
      await pool.query(
        `INSERT INTO hyphae_rpc_audit (id, trace_id, source_agent, target_agent, capability, status, error, called_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [auditId, traceId, sourceAgent, targetAgent, capability, "SERVICE_NOT_FOUND", `Agent ${targetAgent} not registered or unhealthy`]
      );

      return res.status(404).json({
        success: false,
        error: `Target agent not found or unhealthy: ${targetAgent}`,
        traceId,
      });
    }

    const targetService = serviceResult.rows[0];

    // Make RPC call to target agent
    const rpcCallStart = Date.now();
    let callSuccess = false;
    let callResult: any = null;
    let callError: string | null = null;

    try {
      const response = await Promise.race([
        fetch(`${targetService.endpoint}/rpc`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": traceId,
            "X-Source-Agent": sourceAgent,
            "X-Deadline": String(Date.now() + timeout),
          },
          body: JSON.stringify({
            capability,
            params,
            traceId,
          }),
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("RPC_TIMEOUT")),
            timeout
          )
        ),
      ]) as Response;

      const responseData = await response.json() as any;
      callSuccess = responseData.success !== false;
      callResult = responseData;

      if (!callSuccess) {
        callError = responseData.error || "Unknown error";
      }
    } catch (err: any) {
      callSuccess = false;
      callError = err.message;
    }

    const rpcDuration = Date.now() - rpcCallStart;

    // Log to audit trail
    const auditId = uuidv4();
    await pool.query(
      `INSERT INTO hyphae_rpc_audit 
       (id, trace_id, source_agent, target_agent, capability, status, duration_ms, error, completed_at, called_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        auditId,
        traceId,
        sourceAgent,
        targetAgent,
        capability,
        callSuccess ? "SUCCESS" : "FAILED",
        rpcDuration,
        callError,
      ]
    );

    // Update relationship tracking
    const relResult = await pool.query(
      `SELECT id FROM hyphae_relationships 
       WHERE source_agent = $1 AND target_agent = $2 AND capability = $3`,
      [sourceAgent, targetAgent, capability]
    );

    if (relResult.rows.length === 0) {
      await pool.query(
        `INSERT INTO hyphae_relationships (id, source_agent, target_agent, capability, call_count, last_call, avg_duration_ms)
         VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, $5)`,
        [uuidv4(), sourceAgent, targetAgent, capability, rpcDuration]
      );
    } else {
      // Update call count and average duration
      await pool.query(
        `UPDATE hyphae_relationships 
         SET call_count = call_count + 1, 
             last_call = CURRENT_TIMESTAMP,
             avg_duration_ms = (avg_duration_ms * (call_count - 1) + $1) / call_count
         WHERE source_agent = $2 AND target_agent = $3 AND capability = $4`,
        [rpcDuration, sourceAgent, targetAgent, capability]
      );
    }

    const totalDuration = Date.now() - startTime;

    if (callSuccess) {
      res.status(200).json({
        success: true,
        result: callResult?.result,
        traceId,
        duration: totalDuration,
        sourceAgent,
        targetAgent,
      });

      console.log(
        `✅ RPC call: ${sourceAgent} → ${targetAgent}.${capability} (${totalDuration}ms, ${traceId})`
      );
    } else {
      res.status(500).json({
        success: false,
        error: callError,
        traceId,
        duration: totalDuration,
        sourceAgent,
        targetAgent,
      });

      console.log(
        `❌ RPC call failed: ${sourceAgent} → ${targetAgent}.${capability} (${callError}, ${traceId})`
      );
    }
  } catch (err: any) {
    console.error("❌ RPC call error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      traceId,
    });
  }
});

// ============================================================================
// AUDIT & MONITORING
// ============================================================================

/**
 * GET /api/rpc/audit
 * 
 * Query RPC audit trail.
 * 
 * Query params:
 * - traceId: Filter by trace ID
 * - sourceAgent: Filter by source agent
 * - targetAgent: Filter by target agent
 * - capability: Filter by capability
 * - status: Filter by status (SUCCESS, FAILED, SERVICE_NOT_FOUND, etc.)
 * - limit: Number of results (default: 100, max: 1000)
 * - offset: Pagination offset (default: 0)
 */
app.get("/api/rpc/audit", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;

  try {
    const {
      traceId: filterTraceId,
      sourceAgent,
      targetAgent,
      capability,
      status,
      limit = "100",
      offset = "0",
    } = req.query;

    const pageLimit = Math.min(parseInt(String(limit)), 1000);
    const pageOffset = parseInt(String(offset));

    let query = "SELECT * FROM hyphae_rpc_audit WHERE 1=1";
    const params: any[] = [];

    if (filterTraceId) {
      query += ` AND trace_id = $${params.length + 1}`;
      params.push(filterTraceId);
    }

    if (sourceAgent) {
      query += ` AND source_agent = $${params.length + 1}`;
      params.push(sourceAgent);
    }

    if (targetAgent) {
      query += ` AND target_agent = $${params.length + 1}`;
      params.push(targetAgent);
    }

    if (capability) {
      query += ` AND capability = $${params.length + 1}`;
      params.push(capability);
    }

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += " ORDER BY called_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2);
    params.push(pageLimit, pageOffset);

    const result = await pool.query(query, params);

    res.status(200).json({
      success: true,
      audit: result.rows.map((row) => ({
        id: row.id,
        traceId: row.trace_id,
        sourceAgent: row.source_agent,
        targetAgent: row.target_agent,
        capability: row.capability,
        status: row.status,
        durationMs: row.duration_ms,
        error: row.error,
        calledAt: row.called_at,
        completedAt: row.completed_at,
      })),
      count: result.rows.length,
      limit: pageLimit,
      offset: pageOffset,
      traceId,
    });
  } catch (err: any) {
    console.error("❌ Audit query failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      traceId,
    });
  }
});

/**
 * GET /api/health
 * 
 * Health check endpoint.
 */
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/stats
 * 
 * System statistics.
 */
app.get("/api/stats", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;

  try {
    const servicesCount = await pool.query("SELECT COUNT(*) FROM hyphae_services WHERE healthy = true");
    const rpcTotal = await pool.query("SELECT COUNT(*) FROM hyphae_rpc_audit");
    const rpcSuccess = await pool.query("SELECT COUNT(*) FROM hyphae_rpc_audit WHERE status = 'SUCCESS'");
    const avgDuration = await pool.query(
      "SELECT AVG(duration_ms) as avg FROM hyphae_rpc_audit WHERE duration_ms IS NOT NULL"
    );

    res.status(200).json({
      success: true,
      stats: {
        healthyServices: parseInt(servicesCount.rows[0].count),
        totalRpcCalls: parseInt(rpcTotal.rows[0].count),
        successfulCalls: parseInt(rpcSuccess.rows[0].count),
        avgDurationMs: parseFloat(avgDuration.rows[0].avg || "0").toFixed(2),
      },
      traceId,
    });
  } catch (err: any) {
    console.error("❌ Stats query failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      traceId,
    });
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = parseInt(process.env.PORT || "3100");

async function start() {
  try {
    // Initialize database
    await initializeDatabase();

    // Start server
    app.listen(PORT, () => {
      console.log(`✅ Hyphae HTTP RPC Server running on port ${PORT}`);
      console.log("   Service Registry: POST /api/services/register");
      console.log("   Service Discovery: GET /api/services");
      console.log("   RPC Calls: POST /api/rpc/call");
      console.log("   RPC Audit: GET /api/rpc/audit");
      console.log("   Health: GET /api/health");
      console.log("   Stats: GET /api/stats");
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();

export { app };
