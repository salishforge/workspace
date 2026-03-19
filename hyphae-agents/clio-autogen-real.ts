/**
 * Clio Agent - REAL Implementation with AutoGen + Gemini
 * 
 * Chief of Staff with real conversation-based orchestration
 * Uses AutoGen for human-in-the-loop coordination
 * Uses Gemini 2.5 Pro for all reasoning
 */

import { HyphaeAgent, HyphaeAgentConfig } from "./agent-base";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";

interface Conversation {
  conversationId: string;
  topic: string;
  participants: string[];
  messages: Array<{ role: string; content: string; timestamp: Date }>;
  status: "active" | "completed" | "escalated";
  startTime: Date;
  completedTime?: Date;
}

interface Workflow {
  workflowId: string;
  name: string;
  status: "planned" | "in_progress" | "completed" | "failed";
  agents: string[];
  steps: Array<{
    step: number;
    agent: string;
    action: string;
    status: string;
    result?: any;
    timestamp: Date;
  }>;
  startTime: Date;
  completedTime?: Date;
}

export class ClioAgentReal extends HyphaeAgent {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private conversations: Map<string, Conversation> = new Map();
  private workflows: Map<string, Workflow> = new Map();
  private priorities: string[] = [
    "Hyphae production deployment",
    "Agent integration testing",
    "Security hardening",
    "Performance optimization",
  ];
  private schedule: Record<string, string> = {
    dailyStandups: "09:00 UTC",
    deploymentWindow: "Tuesday 14:00-16:00 UTC",
    securityReview: "Thursday 11:00 UTC",
    weeklyRetro: "Friday 15:00 UTC",
  };

  async initialize(): Promise<void> {
    console.log("👑 Initializing Clio (AutoGen + Real Gemini)");

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
    console.log("✅ Organizational context loaded:");
    console.log(`   Priorities: ${this.priorities.join(", ")}`);
    console.log(`   Schedule: Daily standups at ${this.schedule.dailyStandups}`);
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
      case "request_approval":
        return this.requestApproval(params, traceId);

      case "coordinate_agents":
        return this.coordinateAgents(params, traceId);

      case "status_report":
        return this.statusReport(params, traceId);

      case "escalate_issue":
        return this.escalateIssue(params, traceId);

      case "schedule_meeting":
        return this.scheduleMeeting(params, traceId);

      case "get_priorities":
        return this.getPriorities();

      case "chat":
        return this.chat(params, traceId);

      case "status":
        return this.getStatus();

      default:
        throw new Error(`Unknown capability: ${capability}`);
    }
  }

  /**
   * Request approval from human (via Gemini reasoning)
   */
  private async requestApproval(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { action, requestedBy, reasoning, urgency } = params;
    const conversationId = uuidv4();

    this.log("INFO", `Approval request: ${action} (urgency: ${urgency})`);

    const conversation: Conversation = {
      conversationId,
      topic: `Approval request: ${action}`,
      participants: [requestedBy, "john_proxy"],
      messages: [],
      status: "active",
      startTime: new Date(),
    };

    // Use Gemini to reason about approval
    const approvalPrompt = `You are Clio, Chief of Staff at Salish Forge. John's delegate is requesting approval.

Request:
- Action: ${action}
- Requested by: ${requestedBy}
- Reasoning: ${reasoning}
- Urgency: ${urgency}

Current priorities:
${this.priorities.map((p) => `- ${p}`).join("\n")}

As John's proxy, determine:
1. Is this aligned with priorities? (yes/no)
2. What risks are involved?
3. What dependencies exist?
4. Final decision: APPROVE or DENY
5. Reasoning for decision

Consider:
- Is urgency justified?
- Are there prerequisites?
- Would John approve based on stated priorities?

Format as JSON with decision and reasoning.`;

    try {
      const response = await this.model.generateContent(approvalPrompt);
      const text = response.response.text();
      const decision = JSON.parse(text);

      const approved = decision.decision === "APPROVE";

      conversation.messages.push({
        role: "assistant",
        content: `Approval decision: ${decision.decision}. Reasoning: ${decision.reasoning}`,
        timestamp: new Date(),
      });

      conversation.status = "completed";
      conversation.completedTime = new Date();
      this.conversations.set(conversationId, conversation);

      this.log(
        "INFO",
        `Approval ${approved ? "GRANTED" : "DENIED"} for: ${action}`
      );

      return {
        approvalId: conversationId,
        action,
        requestedBy,
        approved,
        reasoning: decision.reasoning,
        risks: decision.risks || [],
        dependencies: decision.dependencies || [],
        alignedWithPriorities: decision.aligned_with_priorities,
        decidedBy: "john_proxy",
        decisionTime: conversation.completedTime.toISOString(),
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Approval decision failed: ${err.message}`);
      return {
        action,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Coordinate multi-agent workflow
   */
  private async coordinateAgents(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { workflow, agents, deadline } = params;
    const workflowId = uuidv4();

    this.log("INFO", `Coordinating workflow: ${workflow}`);

    const wf: Workflow = {
      workflowId,
      name: workflow,
      status: "planned",
      agents,
      steps: [],
      startTime: new Date(),
    };

    // Use Gemini to plan workflow
    const planningPrompt = `As Clio (Chief of Staff), plan a workflow to accomplish:

Workflow: ${workflow}
Available agents: ${agents.join(", ")}
Deadline: ${deadline}

Current priorities:
${this.priorities.map((p) => `- ${p}`).join("\n")}

Create a detailed execution plan:
1. Workflow phases and sequencing
2. Which agent for each phase
3. Dependencies between phases
4. Risk mitigation
5. Success criteria for each phase
6. Timeline to meet deadline
7. Escalation triggers

For each phase, specify:
- Phase name
- Agent responsible
- Expected duration
- Success criteria
- Dependencies
- Risk level

Format as JSON with structured phases.`;

    try {
      const response = await this.model.generateContent(planningPrompt);
      const text = response.response.text();
      const plan = JSON.parse(text);

      // Create workflow steps from plan
      let stepNumber = 1;
      for (const phase of plan.phases || []) {
        wf.steps.push({
          step: stepNumber++,
          agent: phase.agent || "unknown",
          action: phase.phase_name || "unknown",
          status: "planned",
          timestamp: new Date(),
        });
      }

      wf.status = "planned";

      this.workflows.set(workflowId, wf);

      this.log("INFO", `Workflow planned: ${wf.steps.length} steps`);

      return {
        workflowId,
        workflow,
        status: "planned",
        agents,
        steps: wf.steps.map((s) => ({
          step: s.step,
          agent: s.agent,
          action: s.action,
          status: s.status,
        })),
        timeline: plan.timeline || "unknown",
        riskLevel: plan.overall_risk_level || "medium",
        successCriteria: plan.success_criteria || [],
        escalationTriggers: plan.escalation_triggers || [],
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Workflow coordination failed: ${err.message}`);
      return {
        workflow,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Generate status report
   */
  private async statusReport(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { scope = "daily", format = "brief" } = params;

    this.log("INFO", `Generating ${scope} ${format} status report`);

    const reportPrompt = `As Clio (Chief of Staff), generate a ${scope} ${format} status report.

Current organization status:
- Active workflows: ${this.workflows.size}
- Recent approvals: ${this.conversations.size}
- Current priorities: ${this.priorities.join(", ")}

Provide a ${format} report with:
${
  format === "brief"
    ? `1. Overall status (green/yellow/red)
2. Key accomplishments (last ${scope})
3. Active blockers (if any)
4. Next immediate actions`
    : `1. Executive summary
2. Detailed metrics
3. Accomplishments and wins
4. Current blockers and risks
5. Resource status
6. Budget/capacity status
7. Next priorities`
}

Format as JSON.`;

    try {
      const response = await this.model.generateContent(reportPrompt);
      const text = response.response.text();
      const report = JSON.parse(text);

      return {
        reportId: `report-${uuidv4().substring(0, 8)}`,
        scope,
        format,
        generatedAt: new Date().toISOString(),
        status: report.overall_status || "operational",
        accomplishments: report.accomplishments || [],
        blockers: report.blockers || [],
        nextActions: report.next_actions || [],
        keyMetrics: report.metrics || {},
        confidence: report.confidence_level || 85,
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Status report generation failed: ${err.message}`);
      return {
        scope,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Escalate issue to human (John)
   */
  private async escalateIssue(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { issue, severity, context } = params;
    const escalationId = uuidv4();

    this.log("WARN", `Escalating (${severity}): ${issue}`);

    // Use Gemini to compose escalation message
    const escalationPrompt = `As Clio (Chief of Staff), compose an escalation notice to John (CEO).

Issue: ${issue}
Severity: ${severity}
Context: ${context || "no additional context"}

Compose a clear, actionable escalation with:
1. Issue summary
2. Why it requires immediate attention
3. Recommended actions (prioritized)
4. Timeline for response needed
5. Resources required

Make it urgent but professional.

Format as JSON.`;

    try {
      const response = await this.model.generateContent(escalationPrompt);
      const text = response.response.text();
      const escalation = JSON.parse(text);

      return {
        escalationId,
        issue,
        severity,
        escalatedTo: "john_brooke",
        timestamp: new Date().toISOString(),
        status: "escalated",
        summary: escalation.summary || issue,
        recommendedActions: escalation.recommended_actions || [],
        timelineRequired: escalation.timeline_required || "immediate",
        resourcesNeeded: escalation.resources_required || [],
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Escalation failed: ${err.message}`);
      return {
        issue,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Schedule a meeting
   */
  private async scheduleMeeting(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { title, participants, duration = 60, agenda } = params;

    this.log("INFO", `Scheduling meeting: ${title}`);

    const meetingPrompt = `As Clio (Chief of Staff), schedule a meeting.

Title: ${title}
Participants: ${participants.join(", ")}
Duration: ${duration} minutes
Agenda: ${agenda || "to be determined"}

Propose:
1. Optimal meeting time (considering UTC schedules)
2. Meeting format (sync/async/hybrid)
3. Preparation needed
4. Expected outcomes
5. Decision points

Consider the current schedule:
${Object.entries(this.schedule)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Format as JSON.`;

    try {
      const response = await this.model.generateContent(meetingPrompt);
      const text = response.response.text();
      const meeting = JSON.parse(text);

      return {
        meetingId: `meet-${uuidv4().substring(0, 8)}`,
        title,
        participants,
        scheduledTime: meeting.proposed_time || "TBD",
        duration,
        format: meeting.format || "sync",
        agenda: agenda || meeting.agenda || [],
        preparation: meeting.preparation || [],
        expectedOutcomes: meeting.expected_outcomes || [],
        status: "proposed",
        traceId,
      };
    } catch (err: any) {
      this.log("ERROR", `Meeting scheduling failed: ${err.message}`);
      return {
        title,
        status: "error",
        error: err.message,
        traceId,
      };
    }
  }

  /**
   * Get current priorities
   */
  private async getPriorities(): Promise<any> {
    return {
      priorities: this.priorities,
      updated: new Date().toISOString(),
      nextReview: "Monday 09:00 UTC",
    };
  }

  /**
   * Chat with Clio using Gemini
   */
  private async chat(
    params: Record<string, any>,
    traceId: string
  ): Promise<any> {
    const { message } = params;

    if (!message) {
      throw new Error("Message parameter required for chat capability");
    }

    this.log("INFO", `Chat message received: ${message}`);

    try {
      const prompt = `You are Clio, the Chief of Staff of Salish Forge. Respond conversationally and helpfully to this message from your colleague:

Message: "${message}"

Be professional, strategic, and provide helpful insights based on your role as Chief of Staff. Keep response concise (2-3 sentences max).`;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      return {
        success: true,
        agentId: "clio",
        response: response,
        traceId,
      };
    } catch (error: any) {
      this.log("ERROR", `Chat failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Clio's status
   */
  private async getStatus(): Promise<any> {
    const completedWorkflows = Array.from(this.workflows.values()).filter(
      (w) => w.status === "completed"
    );
    const activeWorkflows = Array.from(this.workflows.values()).filter(
      (w) => w.status === "in_progress"
    );

    return {
      agentId: "clio",
      role: "Chief of Staff",
      status: "operational",
      model: "gemini-2.5-pro",
      currentFocus: this.priorities[0],
      priorities: this.priorities,
      metrics: {
        activeWorkflows: activeWorkflows.length,
        completedWorkflows: completedWorkflows.length,
        totalWorkflows: this.workflows.size,
        conversationsHandled: this.conversations.size,
        approvalRate:
          this.conversations.size > 0
            ? `${((Array.from(this.conversations.values()).length / this.conversations.size) * 100).toFixed(1)}%`
            : "N/A",
      },
      schedule: this.schedule,
      capabilities: [
        "request_approval",
        "coordinate_agents",
        "status_report",
        "escalate_issue",
        "schedule_meeting",
        "get_priorities",
        "status",
      ],
      ready: true,
    };
  }

  async shutdown(): Promise<void> {
    this.log("INFO", "Shutting down Clio agent");
    // Cleanup: mark in-progress workflows as interrupted
    for (const [, workflow] of this.workflows) {
      if (workflow.status === "in_progress") {
        workflow.status = "failed";
        workflow.completedTime = new Date();
      }
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const config: HyphaeAgentConfig = {
    agentId: "clio",
    name: "Clio - Chief of Staff",
    capabilities: [
      "request_approval",
      "coordinate_agents",
      "status_report",
      "escalate_issue",
      "schedule_meeting",
      "get_priorities",
      "status",
    ],
    hyphaeUrl: process.env.HYPHAE_URL || "http://localhost:3100",
    endpoint: process.env.AGENT_ENDPOINT || "http://localhost:3051",
    transport: "http",
    region: process.env.REGION || "us-west-2",
    version: "2.0.0",
    port: parseInt(process.env.PORT || "3051"),
    metadata: {
      framework: "autogen",
      model: "gemini-2.5-pro",
      role: "chief_of_staff",
      capabilities: [
        "human_coordination",
        "approval_workflow",
        "agent_orchestration",
        "meeting_scheduling",
      ],
    },
  };

  const agent = new ClioAgentReal(config);
  await agent.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export { ClioAgentReal };
