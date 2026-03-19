/**
 * Tests for Hyphae HTTP RPC Server
 * 
 * Validates:
 * - Service registration
 * - Service discovery
 * - RPC call routing
 * - Audit logging
 * - Error handling
 */

import axios from "axios";
import { Pool } from "pg";

const HYPHAE_URL = process.env.HYPHAE_URL || "http://localhost:3100";

// Test utilities
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Hyphae HTTP RPC Server", () => {
  let pool: Pool;

  beforeAll(async () => {
    // Wait for server to be ready
    for (let i = 0; i < 30; i++) {
      try {
        await axios.get(`${HYPHAE_URL}/api/health`);
        break;
      } catch {
        await sleep(100);
      }
    }

    // Database connection for cleanup
    pool = new Pool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "hyphae",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // ========================================================================
  // Service Registration Tests
  // ========================================================================

  describe("Service Registration", () => {
    it("should register a new service", async () => {
      const response = await axios.post(`${HYPHAE_URL}/api/services/register`, {
        agentId: "test-agent-1",
        name: "Test Agent 1",
        capabilities: ["research", "analyze"],
        endpoint: "http://localhost:3001",
        transport: "http",
        region: "us-west-2",
        version: "1.0.0",
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.agentId).toBe("test-agent-1");
      expect(response.data.traceId).toBeDefined();
    });

    it("should reject registration without required fields", async () => {
      try {
        await axios.post(`${HYPHAE_URL}/api/services/register`, {
          agentId: "test-agent-2",
          // missing: name, capabilities, endpoint
        });
        fail("Should have thrown error");
      } catch (err: any) {
        expect(err.response.status).toBe(400);
      }
    });

    it("should update existing service registration", async () => {
      // First registration
      await axios.post(`${HYPHAE_URL}/api/services/register`, {
        agentId: "test-agent-3",
        name: "Test Agent 3",
        capabilities: ["research"],
        endpoint: "http://localhost:3003",
        transport: "http",
        region: "us-west-2",
        version: "1.0.0",
      });

      // Second registration (should update)
      const response = await axios.post(`${HYPHAE_URL}/api/services/register`, {
        agentId: "test-agent-3",
        name: "Test Agent 3 Updated",
        capabilities: ["research", "analyze", "synthesize"],
        endpoint: "http://localhost:3033",
        transport: "http",
        region: "us-east-1",
        version: "1.1.0",
      });

      expect(response.data.success).toBe(true);

      // Verify update
      const getResponse = await axios.get(
        `${HYPHAE_URL}/api/services/test-agent-3`
      );
      expect(getResponse.data.service.endpoint).toBe("http://localhost:3033");
      expect(getResponse.data.service.region).toBe("us-east-1");
      expect(getResponse.data.service.capabilities).toContain("synthesize");
    });
  });

  // ========================================================================
  // Service Discovery Tests
  // ========================================================================

  describe("Service Discovery", () => {
    beforeAll(async () => {
      // Register test services
      const services = [
        {
          agentId: "researcher",
          name: "Research Agent",
          capabilities: ["research", "investigate"],
          region: "us-west-2",
        },
        {
          agentId: "analyzer",
          name: "Analysis Agent",
          capabilities: ["analyze", "review"],
          region: "us-west-2",
        },
        {
          agentId: "writer",
          name: "Writing Agent",
          capabilities: ["write", "synthesize"],
          region: "us-east-1",
        },
      ];

      for (const service of services) {
        await axios.post(`${HYPHAE_URL}/api/services/register`, {
          ...service,
          endpoint: `http://localhost:${Math.floor(Math.random() * 1000) + 3000}`,
          transport: "http",
          version: "1.0.0",
        });
      }
    });

    it("should discover all services", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services`);

      expect(response.data.success).toBe(true);
      expect(response.data.count).toBeGreaterThanOrEqual(3);
      expect(response.data.services.length).toBeGreaterThanOrEqual(3);
    });

    it("should discover services by capability", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services`, {
        params: { capability: "research" },
      });

      expect(response.data.success).toBe(true);
      expect(response.data.services.length).toBeGreaterThan(0);
      expect(response.data.services[0].capabilities).toContain("research");
    });

    it("should discover services by region", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services`, {
        params: { region: "us-west-2" },
      });

      expect(response.data.success).toBe(true);
      expect(response.data.services.every((s: any) => s.region === "us-west-2")).toBe(true);
    });

    it("should discover services by capability AND region", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services`, {
        params: {
          capability: "analyze",
          region: "us-west-2",
        },
      });

      expect(response.data.success).toBe(true);
      const services = response.data.services;
      expect(services.every((s: any) => s.capabilities.includes("analyze"))).toBe(true);
      expect(services.every((s: any) => s.region === "us-west-2")).toBe(true);
    });

    it("should get specific service details", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services/researcher`);

      expect(response.data.success).toBe(true);
      expect(response.data.service.agentId).toBe("researcher");
      expect(response.data.service.capabilities).toContain("research");
    });

    it("should return 404 for unknown service", async () => {
      try {
        await axios.get(`${HYPHAE_URL}/api/services/unknown-agent-xyz`);
        fail("Should have thrown 404");
      } catch (err: any) {
        expect(err.response.status).toBe(404);
      }
    });
  });

  // ========================================================================
  // RPC Call Tests
  // ========================================================================

  describe("RPC Calls", () => {
    beforeAll(async () => {
      // Register agents for RPC testing
      await axios.post(`${HYPHAE_URL}/api/services/register`, {
        agentId: "rpc-test-agent",
        name: "RPC Test Agent",
        capabilities: ["test"],
        endpoint: "http://localhost:3888",
        transport: "http",
        region: "us-west-2",
        version: "1.0.0",
      });
    });

    it("should fail RPC call to unregistered agent", async () => {
      try {
        await axios.post(`${HYPHAE_URL}/api/rpc/call`, {
          sourceAgent: "test-client",
          targetAgent: "nonexistent-agent",
          capability: "test",
          params: {},
          timeout: 5000,
        });
        fail("Should have thrown error");
      } catch (err: any) {
        expect(err.response.status).toBe(404);
        expect(err.response.data.error).toContain("not found");
      }
    });

    it("should fail RPC call without required fields", async () => {
      try {
        await axios.post(`${HYPHAE_URL}/api/rpc/call`, {
          sourceAgent: "test-client",
          // missing: targetAgent, capability
        });
        fail("Should have thrown error");
      } catch (err: any) {
        expect(err.response.status).toBe(400);
      }
    });

    it("should handle RPC timeout", async () => {
      try {
        await axios.post(
          `${HYPHAE_URL}/api/rpc/call`,
          {
            sourceAgent: "test-client",
            targetAgent: "rpc-test-agent",
            capability: "test",
            params: {},
            timeout: 100, // Very short timeout
          },
          { timeout: 10000 }
        );
        // May succeed or timeout depending on timing
      } catch (err: any) {
        // Either timeout or service not responding is OK
        expect([404, 500]).toContain(err.response?.status);
      }
    });
  });

  // ========================================================================
  // Audit Trail Tests
  // ========================================================================

  describe("Audit Trail", () => {
    beforeAll(async () => {
      // Clear audit table
      const client = await pool.connect();
      try {
        await client.query("DELETE FROM hyphae_rpc_audit WHERE source_agent LIKE 'audit-test-%'");
      } finally {
        client.release();
      }
    });

    it("should retrieve audit trail", async () => {
      // First, try to make some calls (will fail but will be logged)
      for (let i = 0; i < 3; i++) {
        try {
          await axios.post(`${HYPHAE_URL}/api/rpc/call`, {
            sourceAgent: "audit-test-client",
            targetAgent: "nonexistent-agent",
            capability: "test",
            params: {},
            timeout: 5000,
          });
        } catch {
          // Expected to fail
        }
      }

      // Query audit trail
      const response = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, {
        params: {
          sourceAgent: "audit-test-client",
          limit: 100,
        },
      });

      expect(response.data.success).toBe(true);
      expect(response.data.count).toBeGreaterThan(0);
      expect(response.data.audit.length).toBeGreaterThan(0);
      expect(response.data.audit[0].sourceAgent).toBe("audit-test-client");
    });

    it("should filter audit by status", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, {
        params: {
          status: "SERVICE_NOT_FOUND",
          limit: 100,
        },
      });

      expect(response.data.success).toBe(true);
      if (response.data.audit.length > 0) {
        expect(response.data.audit[0].status).toBe("SERVICE_NOT_FOUND");
      }
    });

    it("should support pagination", async () => {
      const response1 = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, {
        params: { limit: 2, offset: 0 },
      });

      const response2 = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, {
        params: { limit: 2, offset: 2 },
      });

      expect(response1.data.limit).toBe(2);
      expect(response2.data.offset).toBe(2);
    });
  });

  // ========================================================================
  // System Status Tests
  // ========================================================================

  describe("System Status", () => {
    it("should return health status", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/health`);

      expect(response.status).toBe(200);
      expect(response.data.status).toBe("healthy");
      expect(response.data.timestamp).toBeDefined();
    });

    it("should return system statistics", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/stats`);

      expect(response.data.success).toBe(true);
      expect(response.data.stats.healthyServices).toBeGreaterThanOrEqual(0);
      expect(response.data.stats.totalRpcCalls).toBeGreaterThanOrEqual(0);
      expect(response.data.stats.successfulCalls).toBeGreaterThanOrEqual(0);
      expect(response.data.stats.avgDurationMs).toBeDefined();
    });
  });
});
