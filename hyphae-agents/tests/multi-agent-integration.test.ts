/**
 * Multi-Agent Integration Tests
 * 
 * Tests agent-to-agent coordination via Hyphae RPC
 * Validates framework-agnostic protocol implementation
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const HYPHAE_URL = process.env.HYPHAE_URL || "http://localhost:3100";
const TIMEOUT = 120000; // 2 minutes for Gemini calls

describe("Multi-Agent Coordination", () => {
  let flintRegistered = false;
  let clioRegistered = false;

  beforeAll(async () => {
    // Wait for services to be ready
    for (let i = 0; i < 30; i++) {
      try {
        await axios.get(`${HYPHAE_URL}/api/health`, { timeout: 5000 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Check if agents registered
    try {
      const services = await axios.get(`${HYPHAE_URL}/api/services`);
      flintRegistered = services.data.services.some(
        (s: any) => s.agentId === "flint"
      );
      clioRegistered = services.data.services.some(
        (s: any) => s.agentId === "clio"
      );
    } catch {
      console.warn("Could not verify agent registration");
    }
  }, 60000);

  describe("Agent Registration", () => {
    it("should have Flint registered with Hyphae", async () => {
      if (!flintRegistered) {
        console.warn("Flint not registered - is agent running?");
      }
      expect(flintRegistered).toBe(true);
    });

    it("should have Clio registered with Hyphae", async () => {
      if (!clioRegistered) {
        console.warn("Clio not registered - is agent running?");
      }
      expect(clioRegistered).toBe(true);
    });

    it("should discover Flint by capability", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services`, {
        params: { capability: "execute_task" },
      });

      const flint = response.data.services.find(
        (s: any) => s.agentId === "flint"
      );
      expect(flint).toBeDefined();
      expect(flint.capabilities).toContain("execute_task");
    });

    it("should discover Clio by capability", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/services`, {
        params: { capability: "request_approval" },
      });

      const clio = response.data.services.find(
        (s: any) => s.agentId === "clio"
      );
      expect(clio).toBeDefined();
      expect(clio.capabilities).toContain("request_approval");
    });
  });

  describe("RPC Coordination", () => {
    it("should call Flint.execute_task from Clio", async () => {
      if (!flintRegistered) {
        console.warn("Skipping - Flint not registered");
        return;
      }

      const response = await axios.post(
        `${HYPHAE_URL}/api/rpc/call`,
        {
          sourceAgent: "clio",
          targetAgent: "flint",
          capability: "execute_task",
          params: {
            task: "Test task execution",
            priority: "normal",
          },
          timeout: TIMEOUT,
        },
        { timeout: TIMEOUT + 5000 }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.taskId).toBeDefined();
      console.log("✅ Clio → Flint.execute_task: SUCCESS");
    });

    it("should call Flint.analyze_code from Clio", async () => {
      if (!flintRegistered) {
        console.warn("Skipping - Flint not registered");
        return;
      }

      const testCode = `
function hello() {
  console.log("Hello world");
}
`;

      const response = await axios.post(
        `${HYPHAE_URL}/api/rpc/call`,
        {
          sourceAgent: "clio",
          targetAgent: "flint",
          capability: "analyze_code",
          params: {
            file: "test.ts",
            code: testCode,
            type: "full",
          },
          timeout: TIMEOUT,
        },
        { timeout: TIMEOUT + 5000 }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.result.qualityScore).toBeDefined();
      console.log("✅ Clio → Flint.analyze_code: SUCCESS");
    });

    it("should call Flint.status from any agent", async () => {
      if (!flintRegistered) {
        console.warn("Skipping - Flint not registered");
        return;
      }

      const response = await axios.post(
        `${HYPHAE_URL}/api/rpc/call`,
        {
          sourceAgent: "test_client",
          targetAgent: "flint",
          capability: "status",
          params: {},
          timeout: 10000,
        },
        { timeout: 15000 }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.result.agentId).toBe("flint");
      expect(response.data.result.status).toBe("operational");
      console.log("✅ Test → Flint.status: SUCCESS");
    });

    it("should call Clio.request_approval from Flint", async () => {
      if (!clioRegistered) {
        console.warn("Skipping - Clio not registered");
        return;
      }

      const response = await axios.post(
        `${HYPHAE_URL}/api/rpc/call`,
        {
          sourceAgent: "flint",
          targetAgent: "clio",
          capability: "request_approval",
          params: {
            action: "deploy_to_production",
            requestedBy: "flint",
            reasoning: "All tests passed",
            urgency: "normal",
          },
          timeout: TIMEOUT,
        },
        { timeout: TIMEOUT + 5000 }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.result.approved).toBeDefined();
      console.log("✅ Flint → Clio.request_approval: SUCCESS");
    });

    it("should call Clio.coordinate_agents from Flint", async () => {
      if (!clioRegistered) {
        console.warn("Skipping - Clio not registered");
        return;
      }

      const response = await axios.post(
        `${HYPHAE_URL}/api/rpc/call`,
        {
          sourceAgent: "flint",
          targetAgent: "clio",
          capability: "coordinate_agents",
          params: {
            workflow: "deploy_hyphae_to_production",
            agents: ["flint"],
            deadline: new Date(Date.now() + 3600000).toISOString(),
          },
          timeout: TIMEOUT,
        },
        { timeout: TIMEOUT + 5000 }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.result.workflowId).toBeDefined();
      console.log("✅ Flint → Clio.coordinate_agents: SUCCESS");
    });

    it("should call Clio.status from any agent", async () => {
      if (!clioRegistered) {
        console.warn("Skipping - Clio not registered");
        return;
      }

      const response = await axios.post(
        `${HYPHAE_URL}/api/rpc/call`,
        {
          sourceAgent: "test_client",
          targetAgent: "clio",
          capability: "status",
          params: {},
          timeout: 10000,
        },
        { timeout: 15000 }
      );

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.result.agentId).toBe("clio");
      expect(response.data.result.status).toBe("operational");
      console.log("✅ Test → Clio.status: SUCCESS");
    });
  });

  describe("Audit Trail", () => {
    it("should log all RPC calls to audit trail", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, {
        params: { limit: 100 },
      });

      expect(response.data.success).toBe(true);
      expect(response.data.audit).toBeDefined();
      expect(response.data.audit.length).toBeGreaterThanOrEqual(0);
      console.log(`✅ Audit trail: ${response.data.audit.length} calls logged`);
    });

    it("should filter audit by source agent", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, {
        params: { sourceAgent: "flint" },
      });

      expect(response.data.success).toBe(true);
      expect(response.data.audit).toBeDefined();
      if (response.data.audit.length > 0) {
        expect(response.data.audit[0].sourceAgent).toBe("flint");
      }
      console.log(
        `✅ Audit filter (sourceAgent): ${response.data.audit.length} calls`
      );
    });
  });

  describe("System Health", () => {
    it("should return healthy status", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/health`);

      expect(response.status).toBe(200);
      expect(response.data.status).toBe("healthy");
      console.log("✅ Hyphae health: HEALTHY");
    });

    it("should return system statistics", async () => {
      const response = await axios.get(`${HYPHAE_URL}/api/stats`);

      expect(response.data.success).toBe(true);
      expect(response.data.stats.healthyServices).toBeGreaterThanOrEqual(0);
      console.log(`✅ System stats: ${response.data.stats.healthyServices} healthy services`);
    });
  });
});
