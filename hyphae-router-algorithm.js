/**
 * Hyphae Intelligent Router Algorithm
 * 
 * Selects optimal model based on:
 * - Task type (coding, chat, reasoning, etc.)
 * - Task complexity (simple, moderate, hard)
 * - Current budget status
 * - Limit reset timing
 * - Admin policies
 * - Cost per output
 * 
 * March 20, 2026
 */

/**
 * Task Classification Engine
 */
class TaskClassifier {
  static classify(taskDescription, explicitType = null) {
    const desc = (taskDescription || '').toLowerCase();
    
    // Explicit type takes precedence
    if (explicitType) {
      return {
        type: explicitType,
        complexity: this.estimateComplexity(desc),
        urgency: this.estimateUrgency(desc)
      };
    }
    
    // Infer type from description
    let type = 'general';
    if (desc.includes('code') || desc.includes('implement') || desc.includes('script')) {
      type = 'coding';
    } else if (desc.includes('write') || desc.includes('generate') || desc.includes('answer')) {
      type = 'chat';
    } else if (desc.includes('think') || desc.includes('reason') || desc.includes('analyze')) {
      type = 'reasoning';
    } else if (desc.includes('summarize') || desc.includes('extract') || desc.includes('parse')) {
      type = 'summarization';
    }
    
    return {
      type,
      complexity: this.estimateComplexity(desc),
      urgency: this.estimateUrgency(desc)
    };
  }
  
  static estimateComplexity(description) {
    const desc = (description || '').toLowerCase();
    const keywords = {
      hard: ['complex', 'difficult', 'intricate', 'architecture', 'design', 'debug', 'refactor'],
      moderate: ['implement', 'develop', 'update', 'modify', 'enhance'],
      simple: ['explain', 'summarize', 'answer', 'translate', 'format']
    };
    
    for (const [level, kws] of Object.entries(keywords)) {
      if (kws.some(kw => desc.includes(kw))) {
        return level;
      }
    }
    
    return 'moderate';
  }
  
  static estimateUrgency(description) {
    const desc = (description || '').toLowerCase();
    const urgentKeywords = ['urgent', 'asap', 'immediate', 'critical', 'emergency', 'blocking'];
    return urgentKeywords.some(kw => desc.includes(kw)) ? 'high' : 'normal';
  }
}

/**
 * Model Selection Scoring Engine
 */
class RouterScorer {
  constructor(limitStatuses, adminPolicies = {}) {
    this.limitStatuses = limitStatuses;
    this.policies = adminPolicies;
  }
  
  /**
   * Calculate score for a specific service
   */
  score(service, taskClassification) {
    let score = 100;
    let penalties = [];
    let bonuses = [];
    
    // Phase 1: Policy compliance (hard constraints)
    const policyResult = this.checkPolicy(service, taskClassification);
    if (policyResult.blocked) {
      return {
        service,
        score: -999,
        reason: `Policy blocked: ${policyResult.reason}`,
        penalties,
        bonuses
      };
    }
    
    // Phase 2: Check availability
    const limitStatus = this.limitStatuses[service.service_id];
    if (!limitStatus) {
      return {
        service,
        score: -999,
        reason: 'No limit data available',
        penalties,
        bonuses
      };
    }
    
    // Phase 3: Budget/limit penalties
    const usagePct = parseFloat(limitStatus.max_usage_pct) / 100;
    if (usagePct > 0.95) {
      penalties.push({ name: 'critical_limit', penalty: 100 });
      score -= 100;
    } else if (usagePct > 0.85) {
      penalties.push({ name: 'high_limit', penalty: 50 });
      score -= 50;
    } else if (usagePct > 0.70) {
      penalties.push({ name: 'approaching_limit', penalty: 20 });
      score -= 20;
    }
    
    // Bonus for low utilization
    if (usagePct < 0.30) {
      bonuses.push({ name: 'low_utilization', bonus: 15 });
      score += 15;
    }
    
    // Phase 4: Cost optimization
    const costPerToken = this.estimateCostPerToken(service.service_name);
    const costScore = Math.max(0, 50 - (costPerToken * 1000000));  // Cheaper = higher score
    bonuses.push({ name: 'cost_efficient', bonus: costScore });
    score += costScore;
    
    // Phase 5: Task fit
    const taskFitScore = this.calculateTaskFit(service, taskClassification);
    if (taskFitScore > 0) {
      bonuses.push({ name: 'task_fit', bonus: taskFitScore });
      score += taskFitScore;
    }
    
    // Phase 6: Reset timing (prefer services with longer reset cycles)
    if (limitStatus.next_reset && limitStatus.status !== 'ok') {
      const resetHours = this.calculateHoursUntilReset(limitStatus.next_reset);
      if (resetHours > 20) {
        bonuses.push({ name: 'long_reset_window', bonus: 10 });
        score += 10;
      } else if (resetHours < 1) {
        penalties.push({ name: 'imminent_reset', penalty: 5 });
        score -= 5;
      }
    }
    
    // Phase 7: Urgency handling
    if (taskClassification.urgency === 'high') {
      // Prefer Claude Max for urgent tasks (has priority queue)
      if (service.service_name.includes('max')) {
        bonuses.push({ name: 'priority_queue', bonus: 25 });
        score += 25;
      }
    }
    
    const finalScore = Math.max(-999, score);  // Floor at -999
    
    return {
      service,
      score: finalScore,
      reason: this.generateReason(service, taskClassification, penalties, bonuses),
      penalties,
      bonuses,
      usagePct: (usagePct * 100).toFixed(1)
    };
  }
  
  /**
   * Check if service is allowed by admin policy
   */
  checkPolicy(service, task) {
    const policies = this.policies.routing_policies || {};
    const taskPolicies = policies[task.type] || {};
    
    // Check if service is blocked for this task type
    if (taskPolicies.block && taskPolicies.block.includes(service.service_id)) {
      return {
        blocked: true,
        reason: `${service.service_name} blocked for ${task.type} tasks`
      };
    }
    
    // Check complexity-based blocking
    if (task.complexity === 'simple' && policies.block_expensive_for_simple) {
      if (service.service_name.includes('opus')) {
        return {
          blocked: true,
          reason: 'Opus not allowed for simple tasks (policy)'
        };
      }
    }
    
    return { blocked: false };
  }
  
  /**
   * Calculate how well a service fits the task
   */
  calculateTaskFit(service, task) {
    let score = 0;
    const name = service.service_name.toLowerCase();
    
    // Coding tasks
    if (task.type === 'coding') {
      if (name.includes('max') || name.includes('opus')) score += 30;
      if (name.includes('sonnet')) score += 20;
      if (name.includes('haiku')) score -= 10;
      if (name.includes('flash')) score -= 25;
    }
    
    // Chat tasks (interactive, low latency)
    if (task.type === 'chat') {
      if (name.includes('flash')) score += 25;
      if (name.includes('haiku')) score += 15;
      if (name.includes('sonnet')) score += 5;
      if (name.includes('max')) score += 3;  // Overkill for simple chat
    }
    
    // Reasoning tasks
    if (task.type === 'reasoning') {
      if (name.includes('opus')) score += 35;
      if (name.includes('max')) score += 30;
      if (name.includes('3-1-pro')) score += 25;
      if (name.includes('pro')) score += 15;
      if (name.includes('flash')) score -= 20;
    }
    
    // Complexity-based
    if (task.complexity === 'hard') {
      if (name.includes('opus')) score += 20;
      if (name.includes('max')) score += 15;
      if (name.includes('flash')) score -= 15;
    }
    
    if (task.complexity === 'simple') {
      if (name.includes('flash') || name.includes('haiku')) score += 15;
      if (name.includes('opus')) score -= 10;
    }
    
    return score;
  }
  
  /**
   * Estimate cost per token for a service
   */
  estimateCostPerToken(serviceName) {
    const name = serviceName.toLowerCase();
    
    // Pay-per-token services (per million tokens)
    if (name.includes('haiku')) return 0.0048;
    if (name.includes('flash')) return 0.15;
    if (name.includes('pro') && name.includes('3-1')) return 0.30;
    if (name.includes('pro')) return 0.30;
    if (name.includes('sonnet')) return 18;
    if (name.includes('opus')) return 60;
    
    // Subscription services (amortized across usage)
    if (name.includes('max')) return 0.00111;  // $100/month amortized
    if (name.includes('cloud')) return 0.00222;  // $20/month amortized
    
    return 1;  // Default
  }
  
  /**
   * Calculate hours until service limit resets
   */
  calculateHoursUntilReset(resetTimestamp) {
    if (!resetTimestamp) return 24;  // Default to 24h
    
    const resetTime = new Date(resetTimestamp).getTime();
    const nowTime = Date.now();
    const diffMs = resetTime - nowTime;
    
    return Math.max(0, diffMs / (1000 * 60 * 60));  // Convert to hours
  }
  
  /**
   * Generate human-readable reason for selection
   */
  generateReason(service, task, penalties, bonuses) {
    const reasons = [];
    
    if (bonuses.length > 0) {
      const topBonus = bonuses.reduce((a, b) => a.bonus > b.bonus ? a : b);
      reasons.push(topBonus.name.replace(/_/g, ' '));
    }
    
    if (penalties.length === 0) {
      reasons.push(`optimal for ${task.type}`);
    }
    
    return reasons.join(', ') || 'selected';
  }
}

/**
 * Main Router Class
 */
class IntelligentRouter {
  constructor(limitStatuses, adminPolicies = {}) {
    this.limitStatuses = limitStatuses;
    this.policies = adminPolicies;
    this.scorer = new RouterScorer(limitStatuses, adminPolicies);
  }
  
  /**
   * Select optimal model
   * 
   * Returns:
   * {
   *   service_id: 'claude-max-100',
   *   service_name: 'Claude Max 5×',
   *   score: 145,
   *   reason: 'cost efficient, task fit',
   *   ranking: [
   *     { rank: 1, service_id, score },
   *     ...
   *   ]
   * }
   */
  selectOptimal(services, taskDescription, explicitTaskType = null) {
    // Classify task
    const classification = TaskClassifier.classify(taskDescription, explicitTaskType);
    
    // Score all services
    const scored = services.map(service => 
      this.scorer.score(service, classification)
    );
    
    // Sort by score (highest first)
    const ranked = scored
      .filter(s => s.score > -999)  // Filter out hard-blocked services
      .sort((a, b) => b.score - a.score);
    
    if (ranked.length === 0) {
      return {
        error: 'No available services for task',
        task: classification
      };
    }
    
    const selected = ranked[0];
    
    return {
      service_id: selected.service.service_id,
      service_name: selected.service.service_name,
      provider: selected.service.provider,
      score: selected.score,
      reason: selected.reason,
      usage_pct: selected.usagePct,
      ranking: ranked.slice(0, 5).map((s, i) => ({
        rank: i + 1,
        service_id: s.service.service_id,
        service_name: s.service.service_name,
        score: s.score,
        reason: s.reason
      }))
    };
  }
}

export {
  TaskClassifier,
  RouterScorer,
  IntelligentRouter
};
