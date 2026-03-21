/**
 * Hyphae Agent Autonomy Framework
 * 
 * Enables autonomous decision-making and inter-agent coordination:
 * 1. Monitor system state
 * 2. Detect trigger conditions
 * 3. Decide: handle alone, coordinate, or escalate
 * 4. Compose and send messages
 * 5. Process responses
 */

export class AgentAutonomy {
  constructor(agentId, agentRole) {
    this.agentId = agentId;
    this.agentRole = agentRole;
    this.hyphaeCoreUrl = 'http://localhost:3100';
    this.lastTriggers = new Map(); // Track already-triggered conditions to avoid spam
    this.triggerCooldown = 60000; // 60s cooldown between same trigger
  }

  /**
   * Decision Framework
   * Determines action based on incident type and agent role
   */
  decideAction(trigger, context) {
    const decisionMap = {
      // Flint's decisions
      flint: {
        cost_spike: {
          autonomous: false,
          escalateTo: 'clio',
          priority: 'urgent',
          reason: 'Budget decisions require operational coordination'
        },
        security_incident: {
          autonomous: false,
          escalateTo: 'john',
          priority: 'urgent',
          reason: 'Security incidents require human escalation'
        },
        architecture_decision: {
          autonomous: true,
          escalateTo: 'clio',
          priority: 'normal',
          reason: 'Technical decisions autonomous, operational alignment needed'
        },
        resource_constraint: {
          autonomous: false,
          escalateTo: 'clio',
          priority: 'high',
          reason: 'Resource conflicts require priority alignment'
        },
        performance_degradation: {
          autonomous: true,
          escalateTo: 'clio',
          priority: 'high',
          reason: 'Can diagnose, but operational impact needs coordination'
        }
      },

      // Clio's decisions
      clio: {
        cost_spike_response: {
          autonomous: true,
          escalateTo: 'flint',
          priority: 'urgent',
          reason: 'Request Flint analysis, then coordinate response'
        },
        technical_assessment_needed: {
          autonomous: false,
          escalateTo: 'flint',
          priority: 'normal',
          reason: 'Get technical input before operational decision'
        },
        priority_conflict: {
          autonomous: false,
          escalateTo: 'flint',
          priority: 'high',
          reason: 'Need Flint input on technical feasibility'
        },
        team_alignment_issue: {
          autonomous: true,
          escalateTo: null,
          priority: 'normal',
          reason: 'Can handle organizationally'
        },
        memory_consolidation: {
          autonomous: true,
          escalateTo: 'flint',
          priority: 'normal',
          reason: 'Request Flint learnings for consolidation'
        }
      }
    };

    return decisionMap[this.agentId]?.[trigger] || {
      autonomous: false,
      escalateTo: 'john',
      priority: 'normal',
      reason: 'Unknown trigger - escalate to human'
    };
  }

  /**
   * Check if condition should trigger based on cooldown
   */
  shouldTrigger(triggerType) {
    const lastTriggerTime = this.lastTriggers.get(triggerType);
    const now = Date.now();

    if (!lastTriggerTime || (now - lastTriggerTime) > this.triggerCooldown) {
      this.lastTriggers.set(triggerType, now);
      return true;
    }

    console.log(`[autonomy] ${this.agentId}: ${triggerType} in cooldown (${((this.triggerCooldown - (now - lastTriggerTime)) / 1000).toFixed(1)}s remaining)`);
    return false;
  }

  /**
   * Compose message to peer agent
   */
  composeMessage(trigger, context, decision) {
    const messages = {
      flint: {
        cost_spike: {
          template: 'Cost spike detected. Monthly spend exceeds budget threshold. Need operational guidance on budget reallocation.',
          details: (ctx) => `Amount: $${ctx.amount}, Threshold: $${ctx.threshold}, Overage: $${ctx.amount - ctx.threshold}`
        },
        security_incident: {
          template: 'Security incident detected. Severity: {{severity}}. Escalating to human admin.',
          details: (ctx) => `Vulnerability: ${ctx.vulnerability}, Impact: ${ctx.impact}`
        },
        resource_constraint: {
          template: 'Resource constraint detected. Infrastructure at {{metric}}% capacity. Need priority realignment.',
          details: (ctx) => `Metric: ${ctx.metric}, Current: ${ctx.current}%, Threshold: ${ctx.threshold}%`
        }
      },

      clio: {
        cost_spike_response: {
          template: 'Flint reported cost spike. Analyzing budget options and team impact. Ready to coordinate response.',
          details: (ctx) => `Cost: $${ctx.amount}, Departments affected: ${ctx.departments?.join(', ') || 'all'}`
        },
        technical_assessment_needed: {
          template: 'Need technical assessment on proposed {{decision_type}}. Please review and advise on feasibility.',
          details: (ctx) => `Decision: ${ctx.decision_type}, Scope: ${ctx.scope}`
        },
        priority_conflict: {
          template: 'Team priority conflict detected. Seeking technical input on feasibility constraints.',
          details: (ctx) => `Conflict: ${ctx.conflicting_priorities?.join(' vs. ') || 'Unknown'}`
        }
      }
    };

    const agentMessages = messages[this.agentId] || {};
    const triggerMsg = agentMessages[trigger];

    if (!triggerMsg) {
      return {
        message: `Trigger detected: ${trigger}. Requesting coordination.`,
        context: context
      };
    }

    let message = triggerMsg.template;
    for (const [key, value] of Object.entries(context || {})) {
      message = message.replace(`{{${key}}}`, value);
    }

    return {
      message: message,
      context: {
        trigger: trigger,
        ...context,
        details: triggerMsg.details(context || {})
      }
    };
  }

  /**
   * Process incoming message from peer and respond autonomously
   */
  async composeResponse(fromAgent, incomingMessage, context) {
    // Flint responding to Clio
    if (this.agentId === 'flint' && fromAgent === 'clio') {
      if (incomingMessage.includes('technical assessment')) {
        return {
          message: 'Technical assessment complete. Recommendation: [analysis]. Ready to implement pending approval.',
          context: { assessment: 'complete', recommendation: 'optimize' }
        };
      }
      if (incomingMessage.includes('priority conflict')) {
        return {
          message: 'Reviewed feasibility. Technical constraints: [details]. Recommend prioritizing [option].',
          context: { constraint: 'identified', recommendation: 'documented' }
        };
      }
    }

    // Clio responding to Flint
    if (this.agentId === 'clio' && fromAgent === 'flint') {
      if (incomingMessage.includes('cost spike')) {
        return {
          message: 'Cost analysis underway. Recommending [action] with team impact [assessment]. Escalating to admin if needed.',
          context: { analysis: 'complete', action: 'recommended' }
        };
      }
      if (incomingMessage.includes('resource constraint')) {
        return {
          message: 'Priority realignment in progress. Reallocating resources to [department]. Will coordinate team messaging.',
          context: { reallocation: 'planned', coordination: 'ready' }
        };
      }
    }

    // Default response
    return {
      message: `Acknowledged. Processing ${fromAgent} request.`,
      context: { acknowledged: true }
    };
  }

  /**
   * Send message to peer agent
   */
  async sendMessage(toAgentId, message, context, priority = 'normal') {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.sendMessage',
          params: {
            from_agent_id: this.agentId,
            to_agent_id: toAgentId,
            message: message,
            context: context,
            priority: priority
          },
          id: Date.now()
        })
      });

      const data = await response.json();

      if (data.result?.success) {
        console.log(`[autonomy] ${this.agentId} → ${toAgentId}: "${message.substring(0, 50)}..." (${priority})`);
        return { success: true, messageId: data.result.message_id };
      } else {
        console.error(`[autonomy] Send failed: ${data.result?.error}`);
        return { success: false, error: data.result?.error };
      }
    } catch (error) {
      console.error(`[autonomy] Send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Poll for messages and respond autonomously
   */
  async pollAndRespond() {
    try {
      const response = await fetch(`${this.hyphaeCoreUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent.getMessages',
          params: { agent_id: this.agentId, limit: 10 },
          id: Date.now()
        })
      });

      const data = await response.json();
      const messages = data.result?.messages || [];

      for (const msg of messages) {
        console.log(`[autonomy] ${this.agentId} received from ${msg.from}: "${msg.message.substring(0, 50)}..."`);

        // Compose response
        const response = await this.composeResponse(msg.from, msg.message, msg.context);

        // Send response
        await this.sendMessage(msg.from, response.message, response.context, 'normal');

        // Acknowledge
        await fetch(`${this.hyphaeCoreUrl}/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'agent.ackMessage',
            params: { message_id: msg.id, processed_by: this.agentId },
            id: Date.now()
          })
        });
      }
    } catch (error) {
      console.error(`[autonomy] Poll error: ${error.message}`);
    }
  }

  /**
   * Trigger-based coordination (called by agent when condition detected)
   */
  async coordinateIfNeeded(trigger, context) {
    // Check cooldown
    if (!this.shouldTrigger(trigger)) {
      return null;
    }

    // Get decision
    const decision = this.decideAction(trigger, context);

    console.log(`[autonomy] ${this.agentId} detected ${trigger}`);
    console.log(`[autonomy]   Decision: ${decision.autonomous ? 'handle autonomously' : `escalate to ${decision.escalateTo}`}`);
    console.log(`[autonomy]   Reason: ${decision.reason}`);

    // If autonomous, handle locally and return
    if (decision.autonomous && !decision.escalateTo) {
      console.log(`[autonomy] ${this.agentId} handling ${trigger} autonomously`);
      return { action: 'autonomous', trigger: trigger, context: context };
    }

    // If needs escalation, send message
    if (decision.escalateTo) {
      const msgComposed = this.composeMessage(trigger, context, decision);
      const result = await this.sendMessage(
        decision.escalateTo,
        msgComposed.message,
        msgComposed.context,
        decision.priority
      );

      if (result.success) {
        return { action: 'escalated', to: decision.escalateTo, messageId: result.messageId };
      } else {
        console.error(`[autonomy] Failed to escalate: ${result.error}`);
        return { action: 'failed', error: result.error };
      }
    }

    return null;
  }
}

export default AgentAutonomy;
