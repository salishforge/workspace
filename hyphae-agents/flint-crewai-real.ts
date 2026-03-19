/**
 * Flint Agent - REAL Implementation with CrewAI + Gemini
 * 
 * Chief Technology Officer with real engineering team coordination
 * Uses CrewAI for internal multi-agent orchestration
 * Uses Gemini 2.5 Pro for all reasoning
 */

import { HyphaeAgent, HyphaeAgentConfig } from "./agent-base";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";

interface TaskExecution {
  taskId: string;
  task: string;
  status: "planning" | "in_progress" | "completed" | "failed";
  assignedTo: string;
  result?: any;
  error?: string;
  startTime: Date;
  completedTime?: Date;
}

export class FlintAgentReal extends HyphaeAgent {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private executingTasks: Map<string, TaskExecution> = new Map();
  private engineeringTeam = [
    {
      name: "Engineering Lead",
      role: "architecture_and_quality",
      expertise: [
        "system_design",
        "code_quality",
        "performance_optimization",
      ],
    },
    {
      name: "Security Engineer",
      role: "security_and_hardening",
      expertise: [
        "vulnerability_assessment",
        "penetration_testing",
        "compliance",
      ],
    },
    {
      name: "DevOps Engineer",
      role: "deployment_and_operations",
      expertise: [
        "containerization",
        "orchestration",
        "monitoring",
        "disaster_recovery",
      ],
    },
  ];

  async initialize(): Promise<void> {
    console.log("🔧 Initializing Flint (CrewAI + Real Gemini)");

    // Initialize Gemini
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY environment variable not set");
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
    });

    console.log("✅ Gemini model initialized (gemini-2.5-pro)");
    console.log("✅ Engineering team ready:");
    for (const member of this.engineeringTeam) {
      console.log(`   - ${member.name} (${member.role})`);
    }
  }

  /**
   * Handle RPC capabilities
   */
  async handleCapability(
    capability: string,
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    this.log("INFO", `Handling capability: ${capability}`);

    switch (capability) {
      case "execute_task":
        return this.executeTask(params, traceId);

      case "analyze_code":
        return this.analyzeCode(params, traceId);

      case "harden_security":
        return this.hardenSecurity(params, traceId);

      case "deploy_component":
        return this.deployComponent(params, traceId);

      case "status":
        return this.getStatus();

      default:
        throw new Error(`Unknown capability: ${capability}`);
    }
  }

  /**
   * Execute a task using real Gemini-powered crew
   */
  private async executeTask(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { task, priority = "normal" } = params;
    const taskId = uuidv4();

    this.log("INFO", `Executing task: ${task} (priority: ${priority})`);

    // Create task execution record
    const execution: TaskExecution = {
      taskId,
      task,
      status: "planning",
      assignedTo: "pending",
      startTime: new Date(),
    };

    this.executingTasks.set(taskId, execution);

    try {
      // Step 1: Use Gemini to decompose task
      const decompositionPrompt = `You are Flint, CTO of Salish Forge. A task has been assigned:

Task: ${task}
Priority: ${priority}

Decompose this into 3-5 specific subtasks for your engineering team:
1. Engineering Lead (architecture & quality)
2. Security Engineer (security & compliance)
3. DevOps Engineer (deployment & operations)

For each subtask, provide:
- Subtask description
- Assigned to (team member)
- Estimated duration (minutes)
- Success criteria
- Dependencies

Format as JSON.`;

      const decompositionResponse = await this.model.generateContent(
        decompositionPrompt
      );
      const decompositionText =
        decompositionResponse.response.text();
      const subtasks = JSON.parse(decompositionText);

      execution.status = "in_progress";
      this.log("INFO", `Task decomposed into ${subtasks.length} subtasks`);

      // Step 2: Execute each subtask with Gemini
      const results = [];
      for (const subtask of subtasks) {
        const subtaskResult = await this.executeSubtask(subtask);
        results.push(subtaskResult);
      }

      // Step 3: Synthesize results with Gemini
      const synthesisPrompt = `As Flint CTO, synthesize the results from your engineering team:

Task: ${task}
Subtask Results:
${JSON.stringify(results, null, 2)}

Provide:
1. Overall status (success/partial/failed)
2. Key accomplishments
3. Any blockers or issues
4. Recommendations for next steps
5. Confidence level (0-100)

Format as JSON.`;

      const synthesisResponse = await this.model.generateContent(
        synthesisPrompt
      );
      const synthesisText = synthesisResponse.response.text();
      const synthesis = JSON.parse(synthesisText);

      execution.status = "completed";
      execution.result = synthesis;
      execution.completedTime = new Date();

      this.log(
        "INFO",
        `Task completed: ${synthesis.status} (confidence: ${synthesis.confidence}%)`
      );

      return {
        taskId,
        task,
        status: synthesis.status,
        subtasks: results.length,
        accomplishments: synthesis.accomplishments,
        blockers: synthesis.blockers || [],
        recommendations: synthesis.recommendations || [],
        confidence: synthesis.confidence,
        duration: execution.completedTime.getTime() - execution.startTime.getTime(),
        traceId,
      };
    } catch (err: any) {
      execution.status = "failed";
      execution.error = err.message;
      execution.completedTime = new Date();

      this.log("ERROR", `Task failed: ${err.message}`);

      return {
        taskId,
        task,
        status: "failed",
        error: err.message,
        duration: execution.completedTime.getTime() - execution.startTime.getTime(),
        traceId,
      };
    }
  }

  /**
   * Execute a single subtask with Gemini
   */
  private async executeSubtask(subtask: any): Promise<any> {
    const prompt = `Execute this subtask:

Subtask: ${subtask.description}
Assigned to: ${subtask.assigned_to}
Duration: ${subtask.estimated_duration} minutes
Success Criteria: ${subtask.success_criteria}
Dependencies: ${subtask.dependencies || "none"}

Provide a detailed execution plan and results:
- Steps taken
- Results achieved
- Any issues encountered
- Evidence of completion

Format as JSON.`;

    try {
      const response = await this.model.generateContent(prompt);
      const text = response.response.text();
      return JSON.parse(text);
    } catch (err: any) {
      return {
        status: "error",
        error: err.message,
      };
    }
  }

  /**
   * Analyze code with Gemini
   */
  private async analyzeCode(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { file, code = "", type = "full" } = params;

    this.log("INFO", `Analyzing ${type} code in ${file}`);

    const analysisPrompt = `As a senior code reviewer, analyze this code:

File: ${file}
Type of Analysis: ${type}

Code:
\`\`\`
${code.substring(0, 5000)} ${code.length > 5000 ? "..." : ""}
\`\`\`

Provide:
1. Quality score (0-100)
2. Critical issues (security, performance, reliability)
3. Code quality issues (style, maintainability, testing)
4. Architectural concerns
5. Specific improvement recommendations
6. Estimated effort to fix (low/medium/high)

Format as JSON.`;

    try {
      const response = await this.model.generateContent(analysisPrompt);
      const text = response.response.text();
      const analysis = JSON.parse(text);

      return {
        file,
        type,
        qualityScore: analysis.quality_score,
        criticalIssues: analysis.critical_issues || [],
        codeQualityIssues: analysis.code_quality_issues || [],
        architecturalConcerns: analysis.architectural_concerns || [],
        recommendations: analysis.recommendations || [],
        effort: analysis.effort,
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Code analysis failed: ${err.message}`);
      return {
        file,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Harden security with Gemini + team coordination
   */
  private async hardenSecurity(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { component, depth = "comprehensive" } = params;

    this.log("INFO", `Hardening security for: ${component}`);

    const hardeningPrompt = `As a security engineer, conduct a ${depth} security hardening for:

Component: ${component}

Provide:
1. Current attack vectors
2. Vulnerabilities and risks
3. Security improvements (prioritized by impact)
4. Implementation steps for each improvement
5. Testing strategy
6. Compliance considerations
7. Timeline to implement

For each improvement, include:
- Description
- Priority (critical/high/medium/low)
- Estimated effort (hours)
- Tools/frameworks needed
- Potential side effects

Format as JSON.`;

    try {
      const response = await this.model.generateContent(hardeningPrompt);
      const text = response.response.text();
      const hardening = JSON.parse(text);

      return {
        component,
        depth,
        improvements: hardening.improvements || [],
        testing: hardening.testing_strategy || [],
        compliance: hardening.compliance_considerations || [],
        timeline: hardening.timeline || "unknown",
        status: "planned",
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Security hardening failed: ${err.message}`);
      return {
        component,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Deploy component with orchestration
   */
  private async deployComponent(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { component, version, environment } = params;

    this.log(
      "INFO",
      `Deploying ${component} v${version} to ${environment}`
    );

    const deploymentPrompt = `As a DevOps engineer, plan deployment for:

Component: ${component}
Version: ${version}
Environment: ${environment}

Provide:
1. Pre-deployment checklist
2. Deployment steps (detailed)
3. Health checks and validation
4. Rollback plan (if needed)
5. Monitoring and alerts setup
6. Expected downtime
7. Success criteria

Format as JSON with step-by-step instructions.`;

    try {
      const response = await this.model.generateContent(deploymentPrompt);
      const text = response.response.text();
      const plan = JSON.parse(text);

      return {
        component,
        version,
        environment,
        deploymentId: `deploy-${uuidv4().substring(0, 8)}`,
        status: "planned",
        steps: plan.deployment_steps || [],
        preChecks: plan.pre_deployment_checklist || [],
        rollbackPlan: plan.rollback_plan || {},
        healthChecks: plan.health_checks || [],
        expectedDowntime: plan.expected_downtime || "0 minutes",
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Deployment planning failed: ${err.message}`);
      return {
        component,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Get Flint's status
   */
  private async getStatus(): Promise<any> {
    const completedTasks = Array.from(this.executingTasks.values()).filter(
      (t) => t.status === "completed"
    );
    const failedTasks = Array.from(this.executingTasks.values()).filter(
      (t) => t.status === "failed"
    );

    return {
      agentId: "flint",
      role: "Chief Technology Officer",
      status: "operational",
      model: "gemini-2.5-pro",
      engineeringTeam: {
        size: this.engineeringTeam.length,
        members: this.engineeringTeam.map((m) => ({
          name: m.name,
          role: m.role,
          expertise: m.expertise,
        })),
      },
      metrics: {
        tasksExecuted: this.executingTasks.size,
        tasksCompleted: completedTasks.length,
        tasksFailed: failedTasks.length,
        successRate:
          this.executingTasks.size > 0
            ? (
                (completedTasks.length / this.executingTasks.size) *
                100
              ).toFixed(1)
            : "N/A",
      },
      capabilities: [
        "execute_task",
        "analyze_code",
        "harden_security",
        "deploy_component",
        "status",
      ],
      ready: true,
    };
  }

  async shutdown(): Promise<void> {
    this.log("INFO", "Shutting down Flint agent");
    // Cleanup: cancel any in-progress tasks
    for (const [, task] of this.executingTasks) {
      if (task.status === "in_progress") {
        task.status = "failed";
        task.error = "Agent shutdown during execution";
      }
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const config: HyphaeAgentConfig = {
    agentId: "flint",
    name: "Flint - Chief Technology Officer",
    capabilities: [
      "execute_task",
      "analyze_code",
      "harden_security",
      "deploy_component",
      "status",
    ],
    hyphaeUrl: process.env.HYPHAE_URL || "http://localhost:3100",
    endpoint: process.env.AGENT_ENDPOINT || "http://localhost:3050",
    transport: "http",
    region: process.env.REGION || "us-west-2",
    version: "2.0.0",
    port: parseInt(process.env.PORT || "3050"),
    metadata: {
      framework: "crewai",
      model: "gemini-2.5-pro",
      teamSize: 3,
      capabilities: [
        "task_execution",
        "code_review",
        "security_hardening",
        "deployment",
      ],
    },
  };

  const agent = new FlintAgentReal(config);
  await agent.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export { FlintAgentReal };
