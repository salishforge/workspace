/**
 * Hyphae Admin Policy Enforcement Engine
 * 
 * Evaluates decisions against policy configuration
 * Returns: approved, requires_approval, escalate
 */

import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

const db = new Pool({
  host: process.env.DB_HOST || '100.97.161.7',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026'
});

/**
 * PolicyEngine
 * 
 * Core decision-making logic for System Admin Agent
 */
export class PolicyEngine {
  /**
   * Evaluate a decision against policy
   * 
   * Returns: {
   *   allowed: boolean,
   *   requires_approval: boolean,
   *   policy_boundary: string,
   *   reasoning: string,
   *   recommended_action: string | null
   * }
   */
  static async evaluateDecision(params) {
    const {
      agent_id = 'system-admin',
      decision_category,  // service_recovery, policy_adaptation, credential_rotation, etc.
      decision_action,    // What does the agent want to do?
      input_data,         // Context (what did agent observe?)
      cost_estimate_usd = 0
    } = params;

    // Load the agent's policy
    const policy = await this.getPolicy(agent_id);
    if (!policy) {
      throw new Error(`No policy found for agent ${agent_id}`);
    }

    // Evaluate based on mode
    if (policy.mode === 'basic') {
      return this.evaluateBasicMode(policy, {
        decision_category,
        decision_action,
        input_data,
        cost_estimate_usd
      });
    } else if (policy.mode === 'advanced') {
      return this.evaluateAdvancedMode(policy, {
        decision_category,
        decision_action,
        input_data,
        cost_estimate_usd
      });
    } else {
      throw new Error(`Unknown policy mode: ${policy.mode}`);
    }
  }

  /**
   * BASIC MODE: T-shirt sizing
   * 
   * Three options:
   * 1. Human approves all changes
   * 2. Agent autonomy except financial and security decisions
   * 3. Full autonomy within defined budget constraints
   */
  static evaluateBasicMode(policy, decision) {
    const {
      decision_category,
      decision_action,
      cost_estimate_usd
    } = decision;

    const setting = policy.basic_mode_setting;

    // Option 1: Human approves all
    if (setting === 'human_approves_all') {
      return {
        allowed: true,
        requires_approval: true,
        policy_boundary: 'BASIC_MODE:HUMAN_APPROVES_ALL',
        reasoning: 'Policy requires human approval for all changes',
        recommended_action: null
      };
    }

    // Option 2: Agent autonomy except financial and security
    if (setting === 'agent_autonomy_except_financial_security') {
      const is_financial = decision_category === 'budget_reallocation' || cost_estimate_usd > 0;
      const is_security = decision_category === 'credential_rotation' || decision_category === 'access_policy';

      if (is_financial || is_security) {
        return {
          allowed: true,
          requires_approval: true,
          policy_boundary: 'BASIC_MODE:EXCEPT_FINANCIAL_SECURITY',
          reasoning: is_financial 
            ? `Financial decision: $${cost_estimate_usd} requires approval`
            : 'Security decision requires approval',
          recommended_action: null
        };
      }

      // Non-financial, non-security decisions are autonomous
      return {
        allowed: true,
        requires_approval: false,
        policy_boundary: 'BASIC_MODE:AUTONOMOUS',
        reasoning: 'Decision falls within autonomous scope (not financial or security)',
        recommended_action: decision_action
      };
    }

    // Option 3: Full autonomy within budget
    if (setting === 'full_autonomy_within_budget') {
      const daily_budget = policy.basic_daily_budget_usd || 0;
      const escalation_threshold = policy.basic_escalation_threshold_usd || daily_budget * 0.7;

      // Check today's spending
      const today_spending = this.getDailySpending(policy.agent_id);  // TODO: implement
      const total_if_approved = today_spending + cost_estimate_usd;

      if (total_if_approved > daily_budget) {
        return {
          allowed: false,
          requires_approval: true,
          policy_boundary: 'BASIC_MODE:BUDGET_EXCEEDED',
          reasoning: `Daily budget of $${daily_budget} would be exceeded. Current: $${today_spending}, Request: $${cost_estimate_usd}`,
          recommended_action: null
        };
      }

      if (total_if_approved > escalation_threshold) {
        return {
          allowed: true,
          requires_approval: true,
          policy_boundary: 'BASIC_MODE:ESCALATION_THRESHOLD',
          reasoning: `Escalation threshold of $${escalation_threshold} reached. Current: $${today_spending}, Request: $${cost_estimate_usd}`,
          recommended_action: decision_action
        };
      }

      // Under escalation threshold, autonomous
      return {
        allowed: true,
        requires_approval: false,
        policy_boundary: 'BASIC_MODE:WITHIN_BUDGET',
        reasoning: `Within daily budget. Total spend: $${total_if_approved}/$${daily_budget}`,
        recommended_action: decision_action
      };
    }

    throw new Error(`Unknown basic mode setting: ${setting}`);
  }

  /**
   * ADVANCED MODE: Granular per-decision-category policy
   */
  static evaluateAdvancedMode(policy, decision) {
    const {
      decision_category,
      decision_action,
      cost_estimate_usd
    } = decision;

    const advanced = policy.advanced_policy || {};
    const category_policy = advanced[decision_category] || {};

    // Policy can be: 'allow', 'require_approval', 'escalate', 'deny'
    const policy_action = category_policy.policy || 'escalate';

    if (policy_action === 'allow') {
      return {
        allowed: true,
        requires_approval: false,
        policy_boundary: `ADVANCED_MODE:${decision_category.toUpperCase()}:ALLOW`,
        reasoning: `Policy allows autonomous action for ${decision_category}`,
        recommended_action: decision_action
      };
    }

    if (policy_action === 'require_approval') {
      return {
        allowed: true,
        requires_approval: true,
        policy_boundary: `ADVANCED_MODE:${decision_category.toUpperCase()}:REQUIRE_APPROVAL`,
        reasoning: `Policy requires approval for ${decision_category}`,
        recommended_action: decision_action
      };
    }

    if (policy_action === 'escalate') {
      return {
        allowed: true,
        requires_approval: true,
        policy_boundary: `ADVANCED_MODE:${decision_category.toUpperCase()}:ESCALATE`,
        reasoning: `Policy escalates ${decision_category} to human`,
        recommended_action: null
      };
    }

    if (policy_action === 'deny') {
      return {
        allowed: false,
        requires_approval: false,
        policy_boundary: `ADVANCED_MODE:${decision_category.toUpperCase()}:DENY`,
        reasoning: `Policy denies ${decision_category}`,
        recommended_action: null
      };
    }

    throw new Error(`Unknown policy action: ${policy_action}`);
  }

  /**
   * Log a decision
   */
  static async logDecision(params) {
    const {
      agent_id,
      decision_category,
      policy_evaluation,
      input_data,
      decision_reasoning,
      decision_action,
      outcome_status = 'pending',
      cost_impact_usd = 0
    } = params;

    const result = await db.query(
      `INSERT INTO hyphae_admin_decision_log (
        agent_id, decision_category, decision_required, policy_boundary,
        input_data, decision_reasoning, decision_action,
        outcome_status, cost_impact_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, created_at`,
      [
        agent_id,
        decision_category,
        policy_evaluation.requires_approval,
        policy_evaluation.policy_boundary,
        JSON.stringify(input_data),
        JSON.stringify(decision_reasoning),
        decision_action,
        outcome_status,
        cost_impact_usd
      ]
    );

    return result.rows[0];
  }

  /**
   * Get pending approvals (for admin dashboard)
   */
  static async getPendingApprovals(agent_id = null) {
    let query = `
      SELECT id, agent_id, decision_category, input_data, decision_reasoning,
             decision_action, cost_impact_usd, created_at
      FROM hyphae_admin_decision_log
      WHERE outcome_status IN ('pending', 'escalated')
      AND human_approval_required = true
    `;

    const params = [];
    if (agent_id) {
      query += ' AND agent_id = $1';
      params.push(agent_id);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Approve a decision
   */
  static async approveDecision(decision_id, approved_by, reasoning = null) {
    const result = await db.query(
      `UPDATE hyphae_admin_decision_log
       SET outcome_status = 'approved',
           human_approved_by = $1,
           human_approval_reasoning = $2,
           human_approved_at = NOW()
       WHERE id = $3
       RETURNING id`,
      [approved_by, reasoning, decision_id]
    );

    return result.rows[0];
  }

  /**
   * Reject a decision
   */
  static async rejectDecision(decision_id, rejected_by, reasoning = null) {
    const result = await db.query(
      `UPDATE hyphae_admin_decision_log
       SET outcome_status = 'rejected',
           human_rejected_by = $1,
           human_rejection_reasoning = $2,
           human_rejected_at = NOW()
       WHERE id = $3
       RETURNING id`,
      [rejected_by, reasoning, decision_id]
    );

    return result.rows[0];
  }

  /**
   * Get policy for agent
   */
  static async getPolicy(agent_id) {
    const result = await db.query(
      'SELECT * FROM hyphae_admin_policies WHERE agent_id = $1',
      [agent_id]
    );

    return result.rows[0] || null;
  }

  /**
   * Update policy
   */
  static async updatePolicy(agent_id, new_policy, updated_by, reason = null) {
    const old_policy = await this.getPolicy(agent_id);

    // Update the policy
    await db.query(
      `UPDATE hyphae_admin_policies 
       SET mode = $1, basic_mode_setting = $2, basic_daily_budget_usd = $3,
           advanced_policy = $4, updated_by = $5, updated_at = NOW()
       WHERE agent_id = $6`,
      [
        new_policy.mode,
        new_policy.basic_mode_setting,
        new_policy.basic_daily_budget_usd,
        JSON.stringify(new_policy.advanced_policy),
        updated_by,
        agent_id
      ]
    );

    // Log in history
    await db.query(
      `INSERT INTO hyphae_admin_policy_history 
       (agent_id, policy_version_id, previous_policy, new_policy, change_reason, changed_by)
       VALUES ($1, (SELECT id FROM hyphae_admin_policies WHERE agent_id = $2), $3, $4, $5, $6)`,
      [
        agent_id,
        agent_id,
        JSON.stringify(old_policy),
        JSON.stringify(new_policy),
        reason,
        updated_by
      ]
    );

    // Audit log
    await this.auditLog({
      action_type: 'policy_change',
      actor_id: updated_by,
      actor_type: 'human_admin',
      resource_type: 'policy',
      resource_id: agent_id,
      action_details: {
        old_policy,
        new_policy,
        reason
      }
    });
  }

  /**
   * Audit logging
   */
  static async auditLog(params) {
    const {
      action_type,
      actor_id,
      actor_type,
      resource_type,
      resource_id,
      action_details
    } = params;

    await db.query(
      `INSERT INTO hyphae_admin_audit_log 
       (action_type, actor_id, actor_type, resource_type, resource_id, action_details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        action_type,
        actor_id,
        actor_type,
        resource_type,
        resource_id,
        JSON.stringify(action_details)
      ]
    );
  }

  /**
   * Get daily spending (TODO: integrate with actual usage tracking)
   */
  static getDailySpending(agent_id) {
    // TODO: Query actual spending from model router usage log
    return 0;
  }
}

export default PolicyEngine;
