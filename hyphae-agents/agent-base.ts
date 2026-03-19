/**
 * Hyphae Agent Base Class
 * 
 * Template for any agent framework to integrate with Hyphae.
 * Handles: registration, service discovery, RPC calls, error handling
 * 
 * Frameworks should:
 * 1. Extend HyphaeAgent
 * 2. Implement abstract methods (initialize, handleCapability, shutdown)
 * 3. Express server automatically exposes /rpc endpoint
 */

import express, { Express, Request, Response } from "express";
import axios, { AxiosError } from "axios";
import { v4 as uuidv4 } from "uuid";

export interface HyphaeAgentConfig {
  agentId: string;
  name: string;
  capabilities: string[];
  hyphaeUrl: string;
  endpoint: string;
  transport: "http" | "nats" | "grpc";
  region: string;
  version: string;
  metadata?: Record<string, any>;
  port: number;
}

export interface HyphaeRPCCall {
  capability: string;
  params: Record<string, any>;
  traceId: string;
  deadline?: number;
}

export interface HyphaeRPCResponse {
  success: boolean;
  result?: any;
  error?: string;
  traceId: string;
  duration: number;
}

export abstract class HyphaeAgent {
  protected config: HyphaeAgentConfig;
  protected app: Express;
  protected registered = false;

  constructor(config: HyphaeAgentConfig) {
    this.config = config;
    this.app = express();
    this.setupExpress();
  }

  // ========================================================================
  // LIFECYCLE
  // ========================================================================

  /**
   * Initialize the agent (implement in subclass)
   */
  abstract initialize(): Promise<void>;

  /**
   * Handle RPC call for a capability (implement in subclass)
   */
  abstract handleCapability(
    capability: string,
    params: Record<string, any>,
    traceId: string
  ): Promise<any>;

  /**
   * Shutdown the agent gracefully (implement in subclass)
   */
  abstract shutdown(): Promise<void>;

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    console.log(`🤖 Starting agent: ${this.config.agentId}`);

    try {
      // Initialize agent-specific logic
      await this.initialize();

      // Register with Hyphae
      await this.register();

      // Start HTTP server
      this.app.listen(this.config.port, () => {
        console.log(
          `✅ Agent ${this.config.agentId} listening on port ${this.config.port}`
        );
        console.log(`   Hyphae endpoint: POST ${this.config.endpoint}/rpc`);
        console.log(`   Capabilities: ${this.config.capabilities.join(", ")}`);
      });

      // Graceful shutdown
      process.on("SIGTERM", () => this.stop());
      process.on("SIGINT", () => this.stop());
    } catch (err) {
      console.error("❌ Failed to start agent:", err);
      process.exit(1);
    }
  }

  /**
   * Stop the agent gracefully
   */
  async stop(): Promise<void> {
    console.log(`\n⏹️  Stopping agent: ${this.config.agentId}`);

    try {
      await this.shutdown();
      console.log("✅ Agent stopped");
      process.exit(0);
    } catch (err) {
      console.error("❌ Error during shutdown:", err);
      process.exit(1);
    }
  }

  // ========================================================================
  // HYPHAE INTEGRATION
  // ========================================================================

  /**
   * Register with Hyphae
   */
  private async register(): Promise<void> {
    try {
      const response = await axios.post(
        `${this.config.hyphaeUrl}/api/services/register`,
        {
          agentId: this.config.agentId,
          name: this.config.name,
          capabilities: this.config.capabilities,
          endpoint: this.config.endpoint,
          transport: this.config.transport,
          region: this.config.region,
          version: this.config.version,
          metadata: {
            ...this.config.metadata,
            registeredAt: new Date().toISOString(),
          },
        }
      );

      this.registered = true;
      console.log(`✅ Registered with Hyphae (${response.data.traceId})`);
    } catch (err) {
      console.error("❌ Registration failed:", err);
      throw err;
    }
  }

  /**
   * Discover services by capability
   */
  async discoverServicesByCapability(capability: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.config.hyphaeUrl}/api/services`,
        {
          params: {
            capability,
            region: this.config.region,
          },
        }
      );

      return response.data.services || [];
    } catch (err) {
      console.error(`❌ Discovery failed for capability ${capability}:`, err);
      return [];
    }
  }

  /**
   * Call another agent through Hyphae
   */
  async callAgent(
    targetAgent: string,
    capability: string,
    params: Record<string, any>,
    timeout = 30000
  ): Promise<any> {
    const traceId = uuidv4();
    const startTime = Date.now();

    try {
      console.log(
        `📡 Calling ${targetAgent}.${capability} (trace: ${traceId.substring(0, 8)}...)`
      );

      const response = await axios.post(
        `${this.config.hyphaeUrl}/api/rpc/call`,
        {
          sourceAgent: this.config.agentId,
          targetAgent,
          capability,
          params,
          timeout,
        },
        {
          timeout: timeout + 5000, // Add buffer
          headers: {
            "X-Trace-Id": traceId,
          },
        }
      );

      const duration = Date.now() - startTime;

      if (response.data.success) {
        console.log(
          `✅ Call succeeded (${duration}ms): ${targetAgent}.${capability}`
        );
        return response.data.result;
      } else {
        console.error(
          `❌ Call failed: ${targetAgent}.${capability} - ${response.data.error}`
        );
        throw new Error(response.data.error);
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      const error = err as AxiosError;

      console.error(`❌ RPC call error (${duration}ms):`, error.message);

      if (error.response?.status === 404) {
        throw new Error(`Target agent not found or unhealthy: ${targetAgent}`);
      } else if (error.code === "ECONNABORTED") {
        throw new Error(`RPC call timeout (>${timeout}ms)`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Discover all available capabilities
   */
  async discoverAllCapabilities(): Promise<Map<string, string[]>> {
    try {
      const response = await axios.get(
        `${this.config.hyphaeUrl}/api/services`,
        {
          params: { region: this.config.region },
        }
      );

      const capabilities = new Map<string, string[]>();
      for (const service of response.data.services) {
        capabilities.set(service.agentId, service.capabilities);
      }

      console.log(`✅ Discovered ${capabilities.size} agents in region`);
      return capabilities;
    } catch (err) {
      console.error("❌ Failed to discover services:", err);
      return new Map();
    }
  }

  // ========================================================================
  // EXPRESS SERVER SETUP
  // ========================================================================

  private setupExpress(): void {
    this.app.use(express.json({ limit: "10mb" }));

    // Health check
    this.app.get("/health", (req: Request, res: Response) => {
      res.status(200).json({
        status: "healthy",
        agentId: this.config.agentId,
        timestamp: new Date().toISOString(),
      });
    });

    // RPC endpoint
    this.app.post("/rpc", async (req: Request, res: Response) => {
      const traceId =
        (req.headers["x-trace-id"] as string) || uuidv4();
      const startTime = Date.now();

      try {
        const { capability, params }: HyphaeRPCCall = req.body;

        if (!capability) {
          return res.status(400).json({
            success: false,
            error: "Missing capability",
            traceId,
          });
        }

        // Check deadline
        const deadline = req.headers["x-deadline"];
        if (deadline && Date.now() > parseInt(deadline as string)) {
          return res.status(504).json({
            success: false,
            error: "Request deadline exceeded",
            traceId,
            duration: Date.now() - startTime,
          });
        }

        console.log(
          `📥 RPC received: ${capability} (trace: ${traceId.substring(0, 8)}...)`
        );

        // Handle capability
        const result = await this.handleCapability(
          capability,
          params || {},
          traceId
        );

        const duration = Date.now() - startTime;

        console.log(
          `✅ RPC handled: ${capability} (${duration}ms)`
        );

        res.status(200).json({
          success: true,
          result,
          traceId,
          duration,
        });
      } catch (err: any) {
        const duration = Date.now() - startTime;

        console.error(`❌ RPC error (${duration}ms):`, err.message);

        res.status(500).json({
          success: false,
          error: err.message,
          traceId,
          duration,
        });
      }
    });

    // Status endpoint
    this.app.get("/status", (req: Request, res: Response) => {
      res.status(200).json({
        agentId: this.config.agentId,
        name: this.config.name,
        capabilities: this.config.capabilities,
        registered: this.registered,
        region: this.config.region,
        version: this.config.version,
        uptime: process.uptime(),
      });
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: "Not found",
        path: req.path,
      });
    });

    // Error handler
    this.app.use(
      (
        err: any,
        req: Request,
        res: Response,
        next: any
      ) => {
        console.error("Express error:", err);
        res.status(500).json({
          error: "Internal server error",
          message: err.message,
        });
      }
    );
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  /**
   * Log an event (can be overridden for custom logging)
   */
  protected log(level: string, message: string): void {
    console.log(`[${level}] ${this.config.agentId}: ${message}`);
  }

  /**
   * Generate trace ID for request correlation
   */
  protected generateTraceId(): string {
    return uuidv4();
  }
}

export default HyphaeAgent;
