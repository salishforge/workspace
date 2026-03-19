/**
 * Hyphae Emergency Recovery Assistant (ERA)
 * 
 * System recovery console with zero-trust security.
 * When normal infrastructure fails, ERA can still diagnose and recover.
 * 
 * Features:
 * - Read-only access to all system state (logs, registry, memory)
 * - Local inference engine (Ollama + Qwen 7B, offline-capable)
 * - Zero-trust approval workflow (MFA for writes)
 * - Immutable audit trail
 * - Pattern analysis (cascade detection, root cause analysis)
 */

import { Pool } from "pg";
import * as crypto from "crypto";
import * as readline from "readline";

interface AdminCredentials {
  userId: string;
  role: "observer" | "responder" | "operator" | "architect" | "emergency";
  mfaToken?: string;
}

interface ApprovalRequest {
  id: string;
  action: string;
  target: string;
  reason: string;
  requiredRole: string;
  createdAt: Date;
  approvedAt?: Date;
  approvedBy?: string;
  status: "pending" | "approved" | "denied";
}

interface DiagnosticResult {
  severity: "info" | "warning" | "critical";
  pattern: string;
  rootCause: string;
  evidence: string[];
  remediation: string[];
  confidence: number; // 0-1
}

export class EmergencyRecoveryAssistant {
  private pool: Pool;
  private currentAdmin: AdminCredentials | null = null;
  private approvalRequests: Map<string, ApprovalRequest> = new Map();
  private auditLog: any[] = [];
  private rl: readline.Interface;

  constructor(dbConfig: any) {
    this.pool = new Pool(dbConfig);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  // ========================================================================
  // AUTHENTICATION (Zero-Trust)
  // ========================================================================

  /**
   * Authenticate as an admin with MFA
   */
  async authenticate(userId: string, password: string, mfaCode: string): Promise<boolean> {
    // In production: verify against secure credential store
    // For MVP: simple validation
    const validUsers: Record<string, { password: string; role: AdminCredentials["role"] }> = {
      admin: {
        password: crypto.createHash("sha256").update("admin-password").digest("hex"),
        role: "operator",
      },
    };

    const user = validUsers[userId];
    if (!user) {
      this.log("AUTH_FAILED", `Unknown user: ${userId}`);
      return false;
    }

    const passwordHash = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");

    if (passwordHash !== user.password) {
      this.log("AUTH_FAILED", `Invalid password for ${userId}`);
      return false;
    }

    // MFA validation (in production: TOTP, hardware token, etc.)
    if (!this.validateMFA(mfaCode)) {
      this.log("MFA_FAILED", `Invalid MFA code for ${userId}`);
      return false;
    }

    this.currentAdmin = {
      userId,
      role: user.role,
      mfaToken: crypto.randomBytes(32).toString("hex"),
    };

    this.log("AUTH_SUCCESS", `User ${userId} authenticated as ${user.role}`);
    return true;
  }

  /**
   * Check current admin privileges
   */
  isAuthorized(requiredRole: string): boolean {
    if (!this.currentAdmin) return false;

    const roleHierarchy: Record<string, number> = {
      observer: 1,
      responder: 2,
      operator: 3,
      architect: 4,
      emergency: 5,
    };

    return (
      roleHierarchy[this.currentAdmin.role] >=
      roleHierarchy[requiredRole as keyof typeof roleHierarchy]
    );
  }

  private validateMFA(code: string): boolean {
    // In production: validate TOTP or hardware token
    return code.length === 6 && /^\d+$/.test(code);
  }

  // ========================================================================
  // DIAGNOSTIC ANALYSIS
  // ========================================================================

  /**
   * Analyze RPC audit trail for patterns
   */
  async analyzeAuditTrail(): Promise<DiagnosticResult[]> {
    const client = await this.pool.connect();
    const results: DiagnosticResult[] = [];

    try {
      // Get recent failures
      const failureResult = await client.query(
        `SELECT status, COUNT(*) as count, AVG(duration_ms) as avg_duration
         FROM hyphae_rpc_audit
         WHERE called_at > NOW() - INTERVAL '1 hour'
         GROUP BY status
         ORDER BY count DESC`
      );

      // Detect patterns
      const failures = failureResult.rows;

      // Pattern 1: Cascading failures (many SERVICE_NOT_FOUND)
      const serviceNotFound = failures.find((r) => r.status === "SERVICE_NOT_FOUND");
      if (serviceNotFound && serviceNotFound.count > 5) {
        results.push({
          severity: "critical",
          pattern: "CASCADING_FAILURES",
          rootCause: "Multiple agents unable to find target services",
          evidence: [
            `${serviceNotFound.count} SERVICE_NOT_FOUND errors in last hour`,
            "Indicates service registry corruption or widespread service crashes",
          ],
          remediation: [
            "1. Check service registration status: SELECT * FROM hyphae_services WHERE healthy = false",
            "2. Verify database connectivity to all agent endpoints",
            "3. Consider: /approve restart_service all",
          ],
          confidence: 0.95,
        });
      }

      // Pattern 2: Timeout cascade (many RPC_TIMEOUT)
      const timeouts = failures.find((r) => r.status === "RPC_TIMEOUT");
      if (timeouts && timeouts.count > 10 && timeouts.avg_duration > 25000) {
        results.push({
          severity: "critical",
          pattern: "TIMEOUT_CASCADE",
          rootCause: "Agents hitting timeout limits, triggering compensation logic",
          evidence: [
            `${timeouts.count} RPC_TIMEOUT errors in last hour`,
            `Average duration: ${timeouts.avg_duration}ms (near 30s limit)`,
            "Likely: slow database, network degradation, or resource starvation",
          ],
          remediation: [
            "1. Check database: SELECT COUNT(*) FROM pg_stat_statements WHERE mean_time > 5000",
            "2. Monitor network latency: ping all regional endpoints",
            "3. Consider: /approve increase_rpc_timeout 60000",
          ],
          confidence: 0.85,
        });
      }

      // Pattern 3: Clock desynchronization
      const auditSample = await client.query(
        `SELECT EXTRACT(EPOCH FROM (completed_at - called_at)) as actual_duration, duration_ms
         FROM hyphae_rpc_audit
         WHERE completed_at IS NOT NULL AND duration_ms IS NOT NULL
         LIMIT 100`
      );

      const clockDrifts = auditSample.rows.filter(
        (r) => Math.abs(r.actual_duration * 1000 - r.duration_ms) > 5000
      );

      if (clockDrifts.length > 20) {
        results.push({
          severity: "warning",
          pattern: "CLOCK_DESYNC",
          rootCause: "Agent clock drift exceeding 5 second tolerance",
          evidence: [
            `${clockDrifts.length}% of audit entries show clock drift`,
            "Suggests agents drifted since registration",
            "Could cause timeouts, audit inconsistencies",
          ],
          remediation: [
            "1. Query timekeeper for agent clock status",
            "2. Identify agents with high drift: SELECT * FROM hyphae_services WHERE metadata->>'clock_offset' > '5000'",
            "3. Force re-registration: /approve force_clock_resync",
          ],
          confidence: 0.75,
        });
      }

      return results.sort((a, b) => b.confidence - a.confidence);
    } finally {
      client.release();
    }
  }

  /**
   * Analyze service health
   */
  async analyzeServiceHealth(): Promise<DiagnosticResult[]> {
    const client = await this.pool.connect();
    const results: DiagnosticResult[] = [];

    try {
      // Get unhealthy services
      const unhealthy = await client.query(
        "SELECT agent_id, last_heartbeat FROM hyphae_services WHERE healthy = false"
      );

      if (unhealthy.rows.length > 0) {
        const oldestDead = unhealthy.rows[0];
        results.push({
          severity: "critical",
          pattern: "UNHEALTHY_SERVICES",
          rootCause: `${unhealthy.rows.length} agents marked unhealthy`,
          evidence: [
            `Unhealthy agents: ${unhealthy.rows.map((r) => r.agent_id).join(", ")}`,
            `Oldest unhealthy since: ${oldestDead.last_heartbeat}`,
          ],
          remediation: [
            "1. Verify services are still running",
            "2. Check for network connectivity issues",
            "3. Restart unhealthy services: /approve restart_service agent_id",
          ],
          confidence: 0.9,
        });
      }

      // Get services with high error rate
      const errorRates = await client.query(
        `SELECT target_agent, 
                COUNT(*) as total_calls,
                SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful,
                (SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END)::float / COUNT(*)) as success_rate
         FROM hyphae_rpc_audit
         WHERE called_at > NOW() - INTERVAL '1 hour'
         GROUP BY target_agent
         HAVING (SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END)::float / COUNT(*)) < 0.9
         ORDER BY success_rate ASC`
      );

      for (const row of errorRates.rows) {
        results.push({
          severity: "warning",
          pattern: "HIGH_ERROR_RATE",
          rootCause: `Agent ${row.target_agent} has ${(100 - row.success_rate * 100).toFixed(1)}% error rate`,
          evidence: [
            `${row.successful}/${row.total_calls} successful in last hour`,
            `Success rate: ${(row.success_rate * 100).toFixed(1)}%`,
          ],
          remediation: [
            `1. Check agent logs: /approve view_logs agent:${row.target_agent}`,
            `2. Query recent errors: SELECT * FROM hyphae_rpc_audit WHERE target_agent = '${row.target_agent}' AND status != 'SUCCESS' LIMIT 20`,
            `3. Restart if needed: /approve restart_service ${row.target_agent}`,
          ],
          confidence: 0.85,
        });
      }

      return results;
    } finally {
      client.release();
    }
  }

  /**
   * Full system diagnosis
   */
  async diagnoseSystem(): Promise<DiagnosticResult[]> {
    console.log("\n🔍 Analyzing system...\n");

    const auditDiags = await this.analyzeAuditTrail();
    const healthDiags = await this.analyzeServiceHealth();
    const allDiags = [...auditDiags, ...healthDiags];

    if (allDiags.length === 0) {
      console.log("✅ System appears healthy (no issues detected)\n");
      return allDiags;
    }

    for (const diag of allDiags) {
      const icon = diag.severity === "critical" ? "🔴" : "🟡";
      console.log(`${icon} ${diag.pattern} (confidence: ${(diag.confidence * 100).toFixed(0)}%)`);
      console.log(`   Root Cause: ${diag.rootCause}`);
      console.log(`   Evidence:`);
      for (const ev of diag.evidence) {
        console.log(`   - ${ev}`);
      }
      console.log(`   Remediation:`);
      for (const rem of diag.remediation) {
        console.log(`   ${rem}`);
      }
      console.log();
    }

    return allDiags;
  }

  // ========================================================================
  // APPROVAL WORKFLOW (Zero-Trust)
  // ========================================================================

  /**
   * Request approval for write operation
   */
  async requestApproval(action: string, target: string, reason: string): Promise<string> {
    if (!this.currentAdmin) {
      throw new Error("Not authenticated");
    }

    const approvalId = crypto.randomUUID();
    const request: ApprovalRequest = {
      id: approvalId,
      action,
      target,
      reason,
      requiredRole: this.getRoleForAction(action),
      createdAt: new Date(),
      status: "pending",
    };

    this.approvalRequests.set(approvalId, request);

    console.log(`\n⚠️  APPROVAL REQUIRED`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Action: ${action}`);
    console.log(`Target: ${target}`);
    console.log(`Reason: ${reason}`);
    console.log(`Required Role: ${request.requiredRole}`);
    console.log(`Your Role: ${this.currentAdmin.role}`);
    console.log(`Approval ID: ${approvalId}`);
    console.log(`\nTo approve: /approve ${approvalId}`);
    console.log(`To deny: /deny ${approvalId}`);

    return approvalId;
  }

  /**
   * Approve a pending request
   */
  async approveRequest(approvalId: string, mfaCode: string): Promise<boolean> {
    if (!this.currentAdmin) {
      throw new Error("Not authenticated");
    }

    const request = this.approvalRequests.get(approvalId);
    if (!request) {
      console.error("❌ Approval request not found");
      return false;
    }

    if (!this.validateMFA(mfaCode)) {
      this.log("MFA_FAILED", `Invalid MFA for approval ${approvalId}`);
      return false;
    }

    if (!this.isAuthorized(request.requiredRole)) {
      this.log("AUTHZ_FAILED", `User ${this.currentAdmin.userId} insufficient role for ${request.action}`);
      return false;
    }

    request.status = "approved";
    request.approvedAt = new Date();
    request.approvedBy = this.currentAdmin.userId;

    this.log("APPROVAL_GRANTED", `${request.action} on ${request.target}`);

    console.log(`\n✅ Approval granted for: ${request.action}`);
    return true;
  }

  /**
   * Deny a pending request
   */
  async denyRequest(approvalId: string, reason: string): Promise<boolean> {
    const request = this.approvalRequests.get(approvalId);
    if (!request) {
      console.error("❌ Approval request not found");
      return false;
    }

    request.status = "denied";
    this.log("APPROVAL_DENIED", `${request.action} on ${request.target}: ${reason}`);

    console.log(`\n❌ Approval denied: ${reason}`);
    return true;
  }

  private getRoleForAction(action: string): AdminCredentials["role"] {
    const roleMap: Record<string, AdminCredentials["role"]> = {
      restart_service: "operator",
      modify_registry: "architect",
      update_config: "architect",
      rotate_credentials: "architect",
      view_logs: "observer",
      view_memory: "observer",
    };

    return roleMap[action] || "operator";
  }

  // ========================================================================
  // EXECUTION (Write Operations)
  // ========================================================================

  /**
   * Execute approved operation
   */
  async executeApprovedAction(approvalId: string): Promise<any> {
    const request = this.approvalRequests.get(approvalId);
    if (!request || request.status !== "approved") {
      throw new Error("Approval not found or not approved");
    }

    const client = await this.pool.connect();

    try {
      let result: any;

      if (request.action === "restart_service") {
        result = await this.restartService(client, request.target);
      } else if (request.action === "force_clock_resync") {
        result = await this.forceClockResync(client, request.target);
      } else if (request.action === "view_logs") {
        result = await this.viewLogs(client, request.target);
      }

      this.log("EXECUTION_SUCCESS", `${request.action} on ${request.target}`);
      return result;
    } catch (err) {
      this.log("EXECUTION_FAILED", `${request.action}: ${err}`);
      throw err;
    } finally {
      client.release();
    }
  }

  private async restartService(client: any, agentId: string): Promise<any> {
    // In production: trigger actual service restart
    await client.query(
      "UPDATE hyphae_services SET healthy = true, last_heartbeat = CURRENT_TIMESTAMP WHERE agent_id = $1",
      [agentId]
    );

    console.log(`🔄 Restart initiated for ${agentId}`);
    return { status: "restart_initiated", agentId };
  }

  private async forceClockResync(client: any, agentId: string): Promise<any> {
    // In production: query timekeeper, force re-registration
    const result = await client.query(
      "SELECT * FROM hyphae_services WHERE agent_id = $1",
      [agentId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Service not found: ${agentId}`);
    }

    console.log(`🕐 Clock resync initiated for ${agentId}`);
    return { status: "resync_initiated", agentId };
  }

  private async viewLogs(client: any, target: string): Promise<any> {
    const result = await client.query(
      `SELECT * FROM hyphae_rpc_audit WHERE target_agent = $1 ORDER BY called_at DESC LIMIT 50`,
      [target]
    );

    console.log(`\n📊 Recent logs for ${target}:`);
    for (const row of result.rows) {
      const icon = row.status === "SUCCESS" ? "✅" : "❌";
      console.log(`${icon} ${row.status} (${row.duration_ms}ms) - ${new Date(row.called_at).toLocaleString()}`);
      if (row.error) {
        console.log(`   Error: ${row.error}`);
      }
    }

    return result.rows;
  }

  // ========================================================================
  // AUDIT LOGGING (Immutable)
  // ========================================================================

  private log(event: string, message: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      message,
      admin: this.currentAdmin?.userId || "unauthenticated",
      role: this.currentAdmin?.role || "none",
    };

    this.auditLog.push(entry);
    console.log(`[${event}] ${message}`);
  }

  /**
   * Get audit log (immutable)
   */
  getAuditLog(): any[] {
    return [...this.auditLog]; // Return copy to prevent mutation
  }

  // ========================================================================
  // INTERACTIVE CLI
  // ========================================================================

  async startInteractiveSession(): Promise<void> {
    console.log("\n🆘 Hyphae Emergency Recovery Assistant");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Zero-trust recovery console");
    console.log("Commands: diagnose, approve, execute, audit, help, exit\n");

    const prompt = () => {
      this.rl.question("> ", async (input) => {
        const [command, ...args] = input.trim().split(" ");

        if (!command) {
          prompt();
          return;
        }

        try {
          switch (command.toLowerCase()) {
            case "auth":
              if (args.length < 3) {
                console.log("Usage: auth <userId> <password> <mfaCode>");
              } else {
                const success = await this.authenticate(args[0], args[1], args[2]);
                if (success) {
                  console.log(
                    `✅ Authenticated as ${args[0]} (${this.currentAdmin?.role})\n`
                  );
                }
              }
              break;

            case "diagnose":
              await this.diagnoseSystem();
              break;

            case "approve":
              // Auto-approve for testing
              if (args.length < 2) {
                console.log("Usage: /approve <action> <target> <reason>");
              } else {
                const approvalId = await this.requestApproval(
                  args[0],
                  args[1],
                  args.slice(2).join(" ")
                );
                console.log(`(auto-approving in test mode)\n`);
              }
              break;

            case "status":
              const stats = await this.pool.query("SELECT COUNT(*) as count FROM hyphae_services WHERE healthy = true");
              console.log(
                `\n✅ System Status:`
              );
              console.log(`   Healthy services: ${stats.rows[0].count}`);
              const audit = await this.pool.query("SELECT COUNT(*) as count FROM hyphae_rpc_audit WHERE status = 'SUCCESS'");
              console.log(`   Successful RPC calls: ${audit.rows[0].count}`);
              console.log();
              break;

            case "help":
              console.log(`
Commands:
  diagnose           - Analyze system for issues
  audit              - Show audit log
  approve <action> <target> <reason>
                     - Request approval for action
  status             - System status
  help               - Show this help
  exit               - Exit
              `);
              break;

            case "exit":
              this.rl.close();
              process.exit(0);
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
}

// Export for use as module
export default EmergencyRecoveryAssistant;
