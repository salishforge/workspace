#!/usr/bin/env node

/**
 * Hyphae CLI
 * 
 * Command-line interface for interacting with Hyphae service registry and RPC.
 * 
 * Usage:
 *   hyphae-cli register <agentId> <name> <capabilities...>
 *   hyphae-cli discover [--capability <cap>] [--region <reg>]
 *   hyphae-cli call <sourceAgent> <targetAgent> <capability> [--params <json>]
 *   hyphae-cli audit [--traceId <id>] [--limit 100]
 *   hyphae-cli status
 */

import axios, { AxiosError } from "axios";
import * as readline from "readline";

const HYPHAE_URL = process.env.HYPHAE_URL || "http://localhost:3100";

interface CLIOptions {
  capability?: string;
  region?: string;
  framework?: string;
  params?: string;
  traceId?: string;
  sourceAgent?: string;
  targetAgent?: string;
  limit?: number;
  offset?: number;
  timeout?: number;
}

// Parse command-line arguments
function parseArgs(args: string[]): { command: string; args: string[]; options: CLIOptions } {
  const command = args[0];
  const restArgs: string[] = [];
  const options: CLIOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.substring(2);
      const value = args[i + 1];

      if (value && !value.startsWith("--")) {
        (options as Record<string, any>)[key] = value;
        i++;
      }
    } else {
      restArgs.push(arg);
    }
  }

  return { command, args: restArgs, options };
}

// Register an agent
async function register(agentId: string, name: string, capabilities: string[], options: CLIOptions) {
  try {
    const endpoint = options.params || `http://localhost:${3000 + Math.floor(Math.random() * 100)}`;
    const transport = "http";
    const region = options.region || "us-west-2";
    const version = "1.0.0";

    const response = await axios.post(`${HYPHAE_URL}/api/services/register`, {
      agentId,
      name,
      capabilities,
      endpoint,
      transport,
      region,
      version,
      metadata: {
        cliRegistration: true,
        registeredAt: new Date().toISOString(),
      },
    });

    console.log("✅ Agent registered:");
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Name: ${name}`);
    console.log(`   Capabilities: ${capabilities.join(", ")}`);
    console.log(`   Endpoint: ${endpoint}`);
    console.log(`   Region: ${region}`);
    console.log(`   Trace ID: ${response.data.traceId}`);
  } catch (err) {
    const error = err as AxiosError;
    console.error("❌ Registration failed:", error.response?.data || error.message);
  }
}

// Discover services
async function discover(options: CLIOptions) {
  try {
    const params: any = {};

    if (options.capability) params.capability = options.capability;
    if (options.region) params.region = options.region;
    if (options.framework) params.framework = options.framework;

    const response = await axios.get(`${HYPHAE_URL}/api/services`, { params });

    console.log(`\n📋 Services Found: ${response.data.count}`);
    console.log("─".repeat(80));

    if (response.data.services.length === 0) {
      console.log("(no services registered)");
      return;
    }

    for (const service of response.data.services) {
      console.log(`\n🤖 ${service.agentId}`);
      console.log(`   Name: ${service.name}`);
      console.log(`   Capabilities: ${service.capabilities.join(", ")}`);
      console.log(`   Endpoint: ${service.endpoint}`);
      console.log(`   Transport: ${service.transport}`);
      console.log(`   Region: ${service.region}`);
      console.log(`   Healthy: ${service.healthy ? "✅" : "❌"}`);
      console.log(`   Last Heartbeat: ${new Date(service.lastHeartbeat).toLocaleString()}`);
    }

    console.log(`\nTrace ID: ${response.data.traceId}`);
  } catch (err) {
    const error = err as AxiosError;
    console.error("❌ Discovery failed:", error.response?.data || error.message);
  }
}

// Make RPC call
async function call(
  sourceAgent: string,
  targetAgent: string,
  capability: string,
  options: CLIOptions
) {
  try {
    let params: any = {};

    if (options.params) {
      try {
        params = JSON.parse(options.params);
      } catch {
        console.error("❌ Invalid JSON in --params");
        return;
      }
    }

    console.log(`\n📡 Making RPC call...`);
    console.log(`   From: ${sourceAgent}`);
    console.log(`   To: ${targetAgent}`);
    console.log(`   Capability: ${capability}`);
    console.log(`   Timeout: ${options.timeout || 30000}ms`);

    const response = await axios.post(
      `${HYPHAE_URL}/api/rpc/call`,
      {
        sourceAgent,
        targetAgent,
        capability,
        params,
        timeout: options.timeout || 30000,
      },
      { timeout: (options.timeout || 30000) + 5000 }
    );

    if (response.data.success) {
      console.log("\n✅ RPC call succeeded");
      console.log(`   Duration: ${response.data.duration}ms`);
      console.log(`   Result:`);
      console.log(JSON.stringify(response.data.result, null, 2));
    } else {
      console.log("\n❌ RPC call failed");
      console.log(`   Error: ${response.data.error}`);
    }

    console.log(`\nTrace ID: ${response.data.traceId}`);
  } catch (err) {
    const error = err as AxiosError;
    console.error("❌ RPC call failed:", error.response?.data || error.message);
  }
}

// Query audit trail
async function audit(options: CLIOptions) {
  try {
    const params: any = {
      limit: options.limit || 50,
      offset: options.offset || 0,
    };

    if (options.traceId) params.traceId = options.traceId;
    if (options.sourceAgent) params.sourceAgent = options.sourceAgent;
    if (options.targetAgent) params.targetAgent = options.targetAgent;

    const response = await axios.get(`${HYPHAE_URL}/api/rpc/audit`, { params });

    console.log(`\n📊 RPC Audit Trail: ${response.data.count} records`);
    console.log("─".repeat(120));

    if (response.data.audit.length === 0) {
      console.log("(no audit records)");
      return;
    }

    for (const record of response.data.audit) {
      const statusEmoji = record.status === "SUCCESS" ? "✅" : "❌";
      console.log(
        `\n${statusEmoji} ${record.traceId.substring(0, 8)}... [${record.status}] ${record.durationMs}ms`
      );
      console.log(`   ${record.sourceAgent} → ${record.targetAgent}.${record.capability}`);
      if (record.error) {
        console.log(`   Error: ${record.error}`);
      }
      console.log(`   Called: ${new Date(record.calledAt).toLocaleString()}`);
    }

    console.log(`\nShowing ${response.data.limit} of ${response.data.count} total records`);
    console.log(`Trace ID: ${response.data.traceId}`);
  } catch (err) {
    const error = err as AxiosError;
    console.error("❌ Audit query failed:", error.response?.data || error.message);
  }
}

// Show system status
async function status() {
  try {
    const healthResponse = await axios.get(`${HYPHAE_URL}/api/health`);
    const statsResponse = await axios.get(`${HYPHAE_URL}/api/stats`);

    console.log("\n📈 Hyphae System Status");
    console.log("─".repeat(50));
    console.log(`Health: ${healthResponse.data.status === "healthy" ? "✅ Healthy" : "❌ Unhealthy"}`);
    console.log(
      `Healthy Services: ${statsResponse.data.stats.healthyServices}`
    );
    console.log(
      `Total RPC Calls: ${statsResponse.data.stats.totalRpcCalls}`
    );
    console.log(
      `Successful Calls: ${statsResponse.data.stats.successfulCalls} (${(
        (statsResponse.data.stats.successfulCalls / Math.max(statsResponse.data.stats.totalRpcCalls, 1)) *
        100
      ).toFixed(1)
      }%)`
    );
    console.log(
      `Avg Duration: ${statsResponse.data.stats.avgDurationMs}ms`
    );
    console.log(`Timestamp: ${new Date(healthResponse.data.timestamp).toLocaleString()}`);
  } catch (err) {
    const error = err as AxiosError;
    console.error("❌ Status check failed:", error.response?.data || error.message);
  }
}

// Interactive mode
async function interactive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n🚀 Hyphae CLI (interactive mode)");
  console.log("Commands: register, discover, call, audit, status, help, exit");
  console.log();

  const prompt = () => {
    rl.question("> ", async (input) => {
      const [command, ...args] = input.trim().split(" ");

      if (!command) {
        prompt();
        return;
      }

      const { args: cmdArgs, options } = parseArgs([command, ...args]);

      try {
        switch (command.toLowerCase()) {
          case "register":
            if (cmdArgs.length < 3) {
              console.log(
                "Usage: register <agentId> <name> <capability1> [capability2] ..."
              );
            } else {
              await register(cmdArgs[0], cmdArgs[1], cmdArgs.slice(2), options);
            }
            break;

          case "discover":
            await discover(options);
            break;

          case "call":
            if (cmdArgs.length < 3) {
              console.log(
                "Usage: call <sourceAgent> <targetAgent> <capability> [--params <json>] [--timeout <ms>]"
              );
            } else {
              await call(cmdArgs[0], cmdArgs[1], cmdArgs[2], options);
            }
            break;

          case "audit":
            await audit(options);
            break;

          case "status":
            await status();
            break;

          case "help":
            console.log(`
CLI Commands:
  register <agentId> <name> <cap1> [cap2...]
    Register an agent with Hyphae

  discover [--capability <cap>] [--region <reg>] [--framework <fw>]
    Discover available services

  call <sourceAgent> <targetAgent> <capability> [--params <json>] [--timeout <ms>]
    Make an RPC call from one agent to another

  audit [--traceId <id>] [--sourceAgent <agent>] [--targetAgent <agent>] [--limit 50]
    Query RPC audit trail

  status
    Show system status

  help
    Show this help message

  exit
    Exit CLI
            `);
            break;

          case "exit":
          case "quit":
            rl.close();
            return;

          default:
            console.log(`Unknown command: ${command}`);
        }
      } catch (err) {
        console.error("Error:", err);
      }

      prompt();
    });
  };

  prompt();
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await interactive();
    return;
  }

  const { command, args: cmdArgs, options } = parseArgs(args);

  switch (command?.toLowerCase()) {
    case "register":
      if (cmdArgs.length < 3) {
        console.error("Usage: hyphae-cli register <agentId> <name> <capability1> [capability2] ...");
        process.exit(1);
      }
      await register(cmdArgs[0], cmdArgs[1], cmdArgs.slice(2), options);
      break;

    case "discover":
      await discover(options);
      break;

    case "call":
      if (cmdArgs.length < 3) {
        console.error("Usage: hyphae-cli call <sourceAgent> <targetAgent> <capability> [--params <json>]");
        process.exit(1);
      }
      await call(cmdArgs[0], cmdArgs[1], cmdArgs[2], options);
      break;

    case "audit":
      await audit(options);
      break;

    case "status":
      await status();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Use 'hyphae-cli help' for usage");
      process.exit(1);
  }
}

main().catch(console.error);
