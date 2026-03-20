#!/usr/bin/env node

/**
 * Hyphae Model Router Service
 * 
 * Intelligent model routing, cost management, and API key lifecycle
 * March 20, 2026
 */

import crypto from 'crypto';
import pg from 'pg';
import fetch from 'node-fetch';
import http from 'http';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

// Configuration
const CONFIG = {
  db: {
    host: process.env.DB_HOST || '100.97.161.7',
    port: parseInt(process.env.DB_PORT || '5433'),
    database: process.env.DB_NAME || 'hyphae',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'hyphae-password-2026'
  },
  encryption: {
    algorithm: 'aes-256-gcm',
    key: process.env.ENCRYPTION_KEY || 'hyphae-encryption-key-2026-32-char-minimum-required'.slice(0, 32)
  },
  hyphae: {
    endpoint: 'http://localhost:3102/rpc',
    bearerToken: process.env.HYPHAE_TOKEN || 'hyphae-auth-token-2026'
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    flintBotToken: '8512187116:AAFPkeNNpGIAEiY117OQw7l75CHabUH3ZU8',
    clioBotToken: '8789255068:AAF92Z1thzb66VxMkH9l-03pMmaeGosnMqg',
    adminUserId: '8201776295'
  }
};

// Database pool
const db = new Pool(CONFIG.db);

// ─────────────────────────────────────────────────────────────
// Policy Configuration Management (File-Based)
// ─────────────────────────────────────────────────────────────

const POLICIES_CONFIG_PATH = process.env.POLICIES_CONFIG_PATH || './policies-config.json';

/**
 * Load policies from config file (dynamic - no restart required)
 */
function loadPoliciesFromFile() {
  try {
    if (!fs.existsSync(POLICIES_CONFIG_PATH)) {
      console.warn(`[policies] Config file not found at ${POLICIES_CONFIG_PATH}`);
      return getDefaultPolicies();
    }
    
    const content = fs.readFileSync(POLICIES_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    return config.policies || getDefaultPolicies();
  } catch (error) {
    console.error(`[policies] Error loading config:`, error.message);
    return getDefaultPolicies();
  }
}

/**
 * Save policies to config file
 */
function savePolicies(policiesObj, historyEntry) {
  try {
    const config = fs.existsSync(POLICIES_CONFIG_PATH) 
      ? JSON.parse(fs.readFileSync(POLICIES_CONFIG_PATH, 'utf-8'))
      : { policies: {}, defaults: {}, history: [] };
    
    config.policies = policiesObj;
    config.lastModified = new Date().toISOString();
    
    if (historyEntry) {
      config.history = config.history || [];
      config.history.push(historyEntry);
      // Keep last 100 entries
      if (config.history.length > 100) {
        config.history = config.history.slice(-100);
      }
    }
    
    fs.writeFileSync(POLICIES_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[policies] Updated config file at ${POLICIES_CONFIG_PATH}`);
    return true;
  } catch (error) {
    console.error(`[policies] Error saving config:`, error.message);
    return false;
  }
}

/**
 * Get policy change history
 */
function getPolicyHistory() {
  try {
    const config = fs.existsSync(POLICIES_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(POLICIES_CONFIG_PATH, 'utf-8'))
      : {};
    return config.history || [];
  } catch (error) {
    console.error(`[policies] Error reading history:`, error.message);
    return [];
  }
}

/**
 * Rollback to previous policy version
 */
function rollbackPolicy(agentId, steps = 1) {
  try {
    const history = getPolicyHistory();
    
    // Find policy updates for this agent (in reverse order)
    const agentUpdates = history
      .filter(entry => entry.agent_id === agentId && entry.action === 'policy_updated')
      .reverse(); // Most recent first
    
    if (agentUpdates.length === 0) {
      return { error: `No policy history found for ${agentId}` };
    }
    
    if (agentUpdates.length <= steps) {
      return { error: `Only ${agentUpdates.length} changes in history, cannot rollback ${steps}` };
    }
    
    // Get the policy state from steps changes ago
    const targetEntry = agentUpdates[steps];
    if (!targetEntry || !targetEntry.old_policy) {
      return { error: `Cannot find policy state to rollback to` };
    }
    
    const policies = loadPoliciesFromFile();
    const newPolicy = targetEntry.old_policy;
    const oldPolicy = policies[agentId];
    
    policies[agentId] = newPolicy;
    
    const rollbackEntry = {
      timestamp: new Date().toISOString(),
      action: 'policy_rollback',
      agent_id: agentId,
      old_policy: oldPolicy,
      new_policy: newPolicy,
      rollback_steps: steps,
      note: `Rolled back ${steps} change(s)`
    };
    
    savePolicies(policies, rollbackEntry);
    return {
      status: 'rolled_back',
      agent_id: agentId,
      policy: newPolicy,
      previous_policy: oldPolicy,
      steps: steps,
      reverted_to: targetEntry.timestamp
    };
  } catch (error) {
    console.error(`[policies] Error rolling back:`, error.message);
    return { error: error.message };
  }
}

/**
 * Get default policies
 */
function getDefaultPolicies() {
  return {
    'flint': {
      allowAnyModel: true,
      autoApproveUnder: 50.0,
      allowedModels: [],
      blockedModels: [],
      description: 'CTO - Full model access, high auto-approve threshold'
    },
    'clio': {
      allowAnyModel: false,
      allowedModels: [
        'claude-max-100',
        'gemini-api-pro',
        'claude-api-sonnet'
      ],
      blockedModels: [
        'claude-api-opus'
      ],
      autoApproveUnder: 20.0,
      description: 'Chief of Staff - Limited to strategic models'
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Encryption / Decryption
// ─────────────────────────────────────────────────────────────

function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    CONFIG.encryption.algorithm,
    Buffer.from(CONFIG.encryption.key, 'utf-8').slice(0, 32),
    iv
  );
  
  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

function decrypt(encryptedData, iv, authTag) {
  const decipher = crypto.createDecipheriv(
    CONFIG.encryption.algorithm,
    Buffer.from(CONFIG.encryption.key, 'utf-8').slice(0, 32),
    Buffer.from(iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  
  return decrypted;
}

// ─────────────────────────────────────────────────────────────
// API Key Management
// ─────────────────────────────────────────────────────────────

/**
 * Generate a new API key for an agent-service pair
 * Returns: {key_id, key_value, service_id}
 */
async function generateApiKey(agentId, serviceId, reason = null) {
  try {
    // Check if agent already has key for this service
    const existing = await db.query(
      `SELECT key_id, is_active FROM hyphae_model_api_keys 
       WHERE agent_id = $1 AND service_id = $2 AND is_active = true`,
      [agentId, serviceId]
    );
    
    if (existing.rows.length > 0) {
      return {
        error: 'Agent already has active key for this service',
        key_id: existing.rows[0].key_id
      };
    }
    
    // Generate new key
    const keyValue = crypto.randomBytes(32).toString('hex');
    const { encrypted, iv, authTag } = encrypt(keyValue);
    const keyId = crypto.randomUUID();
    
    // Insert key record (starts in 'pending' status)
    await db.query(
      `INSERT INTO hyphae_model_api_keys 
       (key_id, agent_id, service_id, key_value_encrypted, key_nonce, status, requested_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
      [keyId, agentId, serviceId, `${encrypted}|${iv}|${authTag}`, iv]
    );
    
    // Log to audit
    await logAudit('key_requested', agentId, serviceId, keyId, {
      reason
    });
    
    return {
      key_id: keyId,
      key_value: keyValue,
      status: 'pending',
      service_id: serviceId,
      agent_id: agentId
    };
  } catch (error) {
    console.error('Error generating API key:', error);
    throw error;
  }
}

/**
 * Retrieve encrypted API key for an approved agent
 */
async function getApiKey(agentId, serviceId) {
  try {
    const result = await db.query(
      `SELECT key_id, key_value_encrypted, key_nonce, status, is_active
       FROM hyphae_model_api_keys
       WHERE agent_id = $1 AND service_id = $2 AND is_active = true AND status = 'approved'`,
      [agentId, serviceId]
    );
    
    if (result.rows.length === 0) {
      return { error: 'No approved key found for this agent-service pair' };
    }
    
    const keyRecord = result.rows[0];
    const [encrypted, iv, authTag] = keyRecord.key_value_encrypted.split('|');
    const keyValue = decrypt(encrypted, iv, authTag);
    
    // Update last_use_at
    await db.query(
      `UPDATE hyphae_model_api_keys SET last_use_at = NOW(), total_requests = total_requests + 1
       WHERE key_id = $1`,
      [keyRecord.key_id]
    );
    
    return {
      key_id: keyRecord.key_id,
      key_value: keyValue,
      service_id: serviceId,
      agent_id: agentId
    };
  } catch (error) {
    console.error('Error retrieving API key:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Approval Workflow
// ─────────────────────────────────────────────────────────────

/**
 * Approve a pending API key request
 */
async function approveApiKey(keyId, approvedBy, reason = null) {
  try {
    // Update key status
    const result = await db.query(
      `UPDATE hyphae_model_api_keys
       SET status = 'approved', approved_by = $1, approved_at = NOW(), approval_reason = $2
       WHERE key_id = $3 AND status = 'pending'
       RETURNING agent_id, service_id`,
      [approvedBy, reason, keyId]
    );
    
    if (result.rows.length === 0) {
      return { error: 'Key not found or not in pending status' };
    }
    
    const { agent_id, service_id } = result.rows[0];
    
    // Log to audit
    await logAudit('key_approved', approvedBy, service_id, keyId, {
      agent_id,
      reason
    });
    
    // Send notification to agent
    await notifyAgent(agent_id, `✅ API key for service approved. Ready to use.`);
    
    return {
      key_id: keyId,
      status: 'approved',
      approved_by: approvedBy,
      approved_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error approving API key:', error);
    throw error;
  }
}

/**
 * Deny a pending API key request
 */
async function denyApiKey(keyId, deniedBy, reason = null) {
  try {
    const result = await db.query(
      `UPDATE hyphae_model_api_keys
       SET status = 'rejected', approved_by = $1, approval_reason = $2
       WHERE key_id = $3 AND status = 'pending'
       RETURNING agent_id, service_id`,
      [deniedBy, reason, keyId]
    );
    
    if (result.rows.length === 0) {
      return { error: 'Key not found or not in pending status' };
    }
    
    const { agent_id, service_id } = result.rows[0];
    
    await logAudit('key_denied', deniedBy, service_id, keyId, {
      agent_id,
      reason
    });
    
    await notifyAgent(agent_id, `❌ API key request denied. Reason: ${reason || 'Not specified'}`);
    
    return {
      key_id: keyId,
      status: 'rejected',
      denied_by: deniedBy,
      denial_reason: reason
    };
  } catch (error) {
    console.error('Error denying API key:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Limit Tracking
// ─────────────────────────────────────────────────────────────

/**
 * Get current limit status for an agent-service
 */
async function getLimitStatus(agentId, serviceId) {
  try {
    const result = await db.query(
      `SELECT 
        daily_limit_usd, monthly_limit_usd, hourly_limit_usd,
        current_daily_usage_usd, current_monthly_usage_usd, current_hourly_usage_usd,
        daily_reset_at, monthly_reset_at, hourly_reset_at,
        alert_threshold, hard_stop_threshold, is_blocked
       FROM hyphae_model_limits
       WHERE agent_id = $1 AND service_id = $2`,
      [agentId, serviceId]
    );
    
    if (result.rows.length === 0) {
      return {
        error: 'No limit record found',
        agent_id: agentId,
        service_id: serviceId
      };
    }
    
    const limit = result.rows[0];
    
    // Calculate percentages
    const dailyPct = limit.daily_limit_usd ? (limit.current_daily_usage_usd / limit.daily_limit_usd) : 0;
    const monthlyPct = limit.monthly_limit_usd ? (limit.current_monthly_usage_usd / limit.monthly_limit_usd) : 0;
    const hourlyPct = limit.hourly_limit_usd ? (limit.current_hourly_usage_usd / limit.hourly_limit_usd) : 0;
    
    const maxPct = Math.max(dailyPct, monthlyPct, hourlyPct);
    const status = limit.is_blocked ? 'blocked' : 
                   (maxPct >= limit.hard_stop_threshold ? 'hard_stop' :
                    maxPct >= limit.alert_threshold ? 'alert' : 'ok');
    
    return {
      agent_id: agentId,
      service_id: serviceId,
      daily_usage_pct: (dailyPct * 100).toFixed(1),
      monthly_usage_pct: (monthlyPct * 100).toFixed(1),
      hourly_usage_pct: (hourlyPct * 100).toFixed(1),
      max_usage_pct: (maxPct * 100).toFixed(1),
      status,
      is_blocked: limit.is_blocked,
      next_daily_reset: limit.daily_reset_at,
      next_monthly_reset: limit.monthly_reset_at
    };
  } catch (error) {
    console.error('Error getting limit status:', error);
    throw error;
  }
}

/**
 * Update limit usage and check thresholds
 */
async function updateLimitUsage(agentId, serviceId, costIncurred, tokens = 0) {
  try {
    // Get current limits
    const limitStatus = await getLimitStatus(agentId, serviceId);
    
    if (limitStatus.error) {
      return { error: limitStatus.error };
    }
    
    // Check hard stop before update
    if (limitStatus.status === 'hard_stop' || limitStatus.is_blocked) {
      return {
        error: 'Usage limit exceeded',
        blocked: true,
        status: limitStatus
      };
    }
    
    // Update usage
    await db.query(
      `UPDATE hyphae_model_limits
       SET 
         current_daily_usage_usd = current_daily_usage_usd + $1,
         current_monthly_usage_usd = current_monthly_usage_usd + $1,
         current_rolling_usage_tokens = current_rolling_usage_tokens + $2,
         updated_at = NOW()
       WHERE agent_id = $3 AND service_id = $4`,
      [costIncurred, tokens, agentId, serviceId]
    );
    
    // Check if we hit alert threshold
    const newStatus = await getLimitStatus(agentId, serviceId);
    if (newStatus.status === 'alert') {
      await notifyAdmin(
        `⚠️ ${agentId} approaching limit on ${serviceId}:\n` +
        `Usage: ${newStatus.max_usage_pct}%\n` +
        `Cost: $${costIncurred.toFixed(4)}`
      );
    } else if (newStatus.status === 'hard_stop') {
      // Block further usage
      await db.query(
        `UPDATE hyphae_model_limits
         SET is_blocked = true, blocked_reason = 'Hard limit exceeded', blocked_at = NOW()
         WHERE agent_id = $1 AND service_id = $2`,
        [agentId, serviceId]
      );
      
      await notifyAdmin(
        `🛑 ${agentId} HIT HARD LIMIT on ${serviceId}\n` +
        `Usage: ${newStatus.max_usage_pct}%\n` +
        `Cost: $${costIncurred.toFixed(4)}`
      );
    }
    
    return { success: true, status: newStatus };
  } catch (error) {
    console.error('Error updating limit usage:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Intelligent Router Algorithm
// ─────────────────────────────────────────────────────────────

/**
 * Classify a task based on type, complexity, urgency
 */
function classifyTask(taskType, complexity, isUrgent = false) {
  return {
    type: taskType || 'general',
    complexity: complexity || 'moderate',
    urgency: isUrgent ? 'high' : 'normal'
  };
}

/**
 * Score a service for the given task
 */
async function scoreService(service, agentId, taskClassification) {
  let score = 100;  // Base score
  
  // Get limit status
  const limitStatus = await getLimitStatus(agentId, service.service_id);
  if (limitStatus.error) {
    return { service, score: -999, reason: 'No limit configured' };
  }
  
  // Hard constraints
  if (limitStatus.status === 'hard_stop' || limitStatus.is_blocked) {
    return { service, score: -999, reason: 'Limit exceeded' };
  }
  
  // Penalty for approaching limits
  const usagePct = parseFloat(limitStatus.max_usage_pct) / 100;
  if (usagePct > 0.90) score -= 50;
  if (usagePct > 0.70) score -= 20;
  score += (1 - usagePct) * 10;
  
  // Cost optimization
  let costPerToken = 0.001;  // Default estimate
  if (service.service_name.includes('haiku')) costPerToken = 0.0000048;
  if (service.service_name.includes('flash')) costPerToken = 0.00000053;
  if (service.service_name.includes('sonnet')) costPerToken = 0.000018;
  if (service.service_name.includes('opus')) costPerToken = 0.00006;
  
  score += (1 / costPerToken) * 0.01;  // Cheaper = higher score
  
  // Task fit
  if (taskClassification.type === 'coding') {
    if (service.service_name.includes('max') || service.service_name.includes('opus')) score += 30;
    if (service.service_name.includes('flash')) score -= 15;
  }
  if (taskClassification.type === 'chat') {
    if (service.service_name.includes('flash')) score += 20;
    if (service.service_name.includes('max')) score += 5;
  }
  if (taskClassification.complexity === 'hard') {
    if (service.service_name.includes('opus') || service.service_name.includes('max')) score += 25;
    if (service.service_name.includes('flash')) score -= 20;
  }
  
  // Urgency
  if (taskClassification.urgency === 'high' && service.service_name.includes('max')) {
    score += 10;
  }
  
  return {
    service,
    score,
    reason: `Cost-optimized for ${taskClassification.type} (${taskClassification.complexity})`
  };
}

/**
 * Select optimal model based on task and current limits
 */
async function selectOptimalModel(agentId, taskType, complexity, isUrgent = false) {
  try {
    const classification = classifyTask(taskType, complexity, isUrgent);
    
    // Get all active services
    const servicesResult = await db.query(
      `SELECT service_id, service_name, service_type, provider, billing_model
       FROM hyphae_model_services
       WHERE is_active = true
       ORDER BY service_name`
    );
    
    const services = servicesResult.rows;
    
    // Score each service
    const scored = await Promise.all(
      services.map(service => scoreService(service, agentId, classification))
    );
    
    // Sort by score (highest first)
    const ranked = scored.sort((a, b) => b.score - a.score);
    
    // Return top option
    const selected = ranked[0];
    
    return {
      service_id: selected.service.service_id,
      service_name: selected.service.service_name,
      provider: selected.service.provider,
      score: selected.score,
      reason: selected.reason,
      ranking: ranked.map((r, i) => ({
        rank: i + 1,
        service: r.service.service_name,
        score: r.score
      }))
    };
  } catch (error) {
    console.error('Error selecting optimal model:', error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────

async function notifyAdmin(message) {
  try {
    const url = `https://api.telegram.org/bot${CONFIG.telegram.flintBotToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegram.adminUserId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    if (!response.ok) {
      console.error('Telegram notification failed:', await response.text());
    }
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
}

async function notifyAgent(agentId, message) {
  // For now, just log. In future: agent-specific channels
  console.log(`[AGENT NOTIFICATION] ${agentId}: ${message}`);
}

// ─────────────────────────────────────────────────────────────
// Override Policy Evaluation
// ─────────────────────────────────────────────────────────────

/**
 * Get policy for agent (loaded from file dynamically)
 * NO RESTART REQUIRED - reads from disk on each call
 */
function getOverridePolicy(agentId) {
  const policies = loadPoliciesFromFile();
  
  // Return agent policy or defaults
  if (policies[agentId]) {
    return policies[agentId];
  }
  
  // Default for new agents
  return {
    allowAnyModel: false,
    allowedModels: ['gemini-api-flash', 'gemini-api-pro'],
    autoApproveUnder: 5.0,
    blockedModels: ['claude-api-opus', 'claude-max-100'],
    description: 'New agent - Conservative defaults'
  };
}

function evaluateOverrideApproval(policy, serviceName, limitStatus) {
  // Handle error case
  if (limitStatus.error) {
    return {
      allowed: false,
      reason: limitStatus.error,
      autoApproved: false
    };
  }
  
  // Check if model is blocked
  if (policy.blockedModels && policy.blockedModels.includes(serviceName)) {
    return {
      allowed: false,
      reason: `${serviceName} is not allowed for this agent`,
      autoApproved: false,
      suggestedService: 'gemini-api-pro'
    };
  }
  
  // Check if model is allowed (if allowAnyModel is false)
  if (!policy.allowAnyModel && policy.allowedModels) {
    if (!policy.allowedModels.includes(serviceName)) {
      return {
        allowed: false,
        reason: `${serviceName} not in allowed models list`,
        autoApproved: false,
        suggestedService: policy.allowedModels[0]
      };
    }
  }
  
  // Check if over hard stop limit
  if (limitStatus.status === 'hard_stop' || limitStatus.is_blocked) {
    return {
      allowed: false,
      reason: 'Daily limit already exceeded for this service',
      autoApproved: false,
      suggestedService: 'gemini-api-flash'
    };
  }
  
  // Calculate remaining budget from percentage
  // limitStatus contains daily_usage_pct, which is the percentage used
  const usagePercent = parseFloat(limitStatus.daily_usage_pct) / 100;
  const autoApproveThreshold = policy.autoApproveUnder || 50.0;
  
  // If usage is low, approve automatically
  if (usagePercent < 0.5) {  // 50% of auto-approval threshold not reached
    return {
      allowed: true,
      reason: `Within auto-approval threshold (${limitStatus.daily_usage_pct}% used)`,
      autoApproved: true
    };
  }
  
  // If usage is moderate, approve but note it
  if (usagePercent < 0.9) {  // Less than 90% of threshold
    return {
      allowed: true,
      reason: `Approved but approaching limit (${limitStatus.daily_usage_pct}% used)`,
      autoApproved: false,
      requiresApproval: true
    };
  }
  
  return {
    allowed: false,
    reason: `Over limit (${limitStatus.daily_usage_pct}% used)`,
    autoApproved: false
  };
}

// ─────────────────────────────────────────────────────────────
// Audit Logging
// ─────────────────────────────────────────────────────────────

async function logAudit(actionType, actorId, serviceId, keyId = null, details = {}) {
  try {
    await db.query(
      `INSERT INTO hyphae_model_audit_log 
       (action_type, actor_id, target_agent_id, target_service_id, target_key_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actionType, actorId, actorId, serviceId, keyId, JSON.stringify(details)]
    );
  } catch (error) {
    console.error('Error logging audit:', error);
  }
}

// ─────────────────────────────────────────────────────────────
// RPC Method Handlers
// ─────────────────────────────────────────────────────────────

const rpcMethods = {
  // Service registry
  'model.getServices': async (params) => {
    const result = await db.query(
      `SELECT service_id, service_name, service_type, provider, billing_model, monthly_cost
       FROM hyphae_model_services
       WHERE is_active = true`
    );
    return { services: result.rows };
  },
  
  // Override request
  'model.requestOverride': async (params) => {
    const { agent_id, service_id, reason, duration } = params;
    
    if (!agent_id || !service_id) {
      return { error: 'Missing agent_id or service_id' };
    }
    
    try {
      // Validate service exists
      const serviceResult = await db.query(
        'SELECT service_name FROM hyphae_model_services WHERE service_id = $1',
        [service_id]
      );
      
      if (serviceResult.rows.length === 0) {
        return { error: 'Service not found' };
      }
      
      const serviceName = serviceResult.rows[0].service_name;
      
      // Check limit status
      const limitStatus = await getLimitStatus(agent_id, service_id);
      
      // Get override policy for agent
      const policy = getOverridePolicy(agent_id);
      
      // Evaluate if override should be approved
      const approval = evaluateOverrideApproval(policy, serviceName, limitStatus);
      
      if (!approval.allowed) {
        return {
          error: approval.reason,
          suggested_alternative: approval.suggestedService
        };
      }
      
      // Get API key
      const keyResult = await getApiKey(agent_id, service_id);
      if (keyResult.error) {
        return { error: 'No approved API key for this service' };
      }
      
      // Log override to audit
      await logAudit('override_approved', agent_id, service_id, null, {
        reason,
        duration,
        auto_approved: approval.autoApproved,
        limit_status: limitStatus.max_usage_pct
      });
      
      const expiresAt = new Date();
      if (duration === 'single-task') {
        expiresAt.setHours(expiresAt.getHours() + 1);
      } else if (duration === '24-hours') {
        expiresAt.setDate(expiresAt.getDate() + 1);
      }
      
      return {
        status: 'approved',
        service_id,
        service_name: serviceName,
        key_value: keyResult.key_value,
        endpoint: keyResult.service_endpoint,
        reason_for_approval: approval.reason,
        auto_approved: approval.autoApproved,
        expires_at: expiresAt.toISOString()
      };
    } catch (error) {
      console.error('Override request error:', error);
      return { error: error.message };
    }
  },
  
  // Check override policy
  'model.checkOverridePolicy': async (params) => {
    const { agent_id, service_id } = params;
    
    try {
      const limitStatus = await getLimitStatus(agent_id, service_id);
      const policy = getOverridePolicy(agent_id);
      
      const service = await db.query(
        'SELECT service_name FROM hyphae_model_services WHERE service_id = $1',
        [service_id]
      );
      
      if (service.rows.length === 0) {
        return { error: 'Service not found' };
      }
      
      const approval = evaluateOverrideApproval(policy, service.rows[0].service_name, limitStatus);
      
      return {
        allowed: approval.allowed,
        auto_approved: approval.autoApproved,
        reason: approval.reason,
        would_exceed_budget: limitStatus.status === 'hard_stop',
        current_daily_usage: limitStatus.current_daily_usage_usd,
        daily_limit: 50.0  // Default, can be made configurable
      };
    } catch (error) {
      console.error('Policy check error:', error);
      return { error: error.message };
    }
  },
  
  // API key management
  'model.requestAccess': async (params) => {
    const { agent_id, service_id, reason } = params;
    if (!agent_id || !service_id) {
      return { error: 'Missing agent_id or service_id' };
    }
    return await generateApiKey(agent_id, service_id, reason);
  },
  
  'model.approveKey': async (params) => {
    const { key_id, approved_by, reason } = params;
    if (!key_id || !approved_by) {
      return { error: 'Missing key_id or approved_by' };
    }
    return await approveApiKey(key_id, approved_by, reason);
  },
  
  'model.denyKey': async (params) => {
    const { key_id, denied_by, reason } = params;
    if (!key_id || !denied_by) {
      return { error: 'Missing key_id or denied_by' };
    }
    return await denyApiKey(key_id, denied_by, reason);
  },
  
  'model.getKey': async (params) => {
    const { agent_id, service_id } = params;
    if (!agent_id || !service_id) {
      return { error: 'Missing agent_id or service_id' };
    }
    return await getApiKey(agent_id, service_id);
  },
  
  // Limit management
  'model.getLimitStatus': async (params) => {
    const { agent_id, service_id } = params;
    if (!agent_id || !service_id) {
      return { error: 'Missing agent_id or service_id' };
    }
    return await getLimitStatus(agent_id, service_id);
  },
  
  'model.updateUsage': async (params) => {
    const { agent_id, service_id, cost, tokens } = params;
    if (!agent_id || !service_id || cost === undefined) {
      return { error: 'Missing required parameters' };
    }
    return await updateLimitUsage(agent_id, service_id, cost, tokens || 0);
  },
  
  // Router
  'model.selectOptimal': async (params) => {
    const { agent_id, task_type, complexity, is_urgent } = params;
    if (!agent_id || !task_type) {
      return { error: 'Missing agent_id or task_type' };
    }
    return await selectOptimalModel(agent_id, task_type, complexity, is_urgent);
  },
  
  // Policy management
  'model.getPolicy': async (params) => {
    const { agent_id } = params;
    
    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }
    
    const policy = getOverridePolicy(agent_id);
    return {
      agent_id,
      policy
    };
  },
  
  'model.listPolicies': async (params) => {
    const policies = {};
    const agentIds = ['flint', 'clio'];
    
    for (const agentId of agentIds) {
      policies[agentId] = getOverridePolicy(agentId);
    }
    
    return { policies };
  },
  
  'model.updatePolicy': async (params) => {
    const { agent_id, policy } = params;
    
    if (!agent_id || !policy) {
      return { error: 'Missing agent_id or policy' };
    }
    
    try {
      // Get current policies and old policy for history
      const policies = loadPoliciesFromFile();
      const oldPolicy = policies[agent_id] || null;
      
      // Update policy
      policies[agent_id] = policy;
      
      // Create history entry
      const historyEntry = {
        timestamp: new Date().toISOString(),
        action: 'policy_updated',
        agent_id: agent_id,
        old_policy: oldPolicy,
        new_policy: policy,
        changes: {
          allowAnyModel: oldPolicy?.allowAnyModel !== policy.allowAnyModel,
          autoApproveUnder: oldPolicy?.autoApproveUnder !== policy.autoApproveUnder,
          allowedModels: JSON.stringify(oldPolicy?.allowedModels) !== JSON.stringify(policy.allowedModels),
          blockedModels: JSON.stringify(oldPolicy?.blockedModels) !== JSON.stringify(policy.blockedModels)
        }
      };
      
      // Save to file
      const success = savePolicies(policies, historyEntry);
      
      if (!success) {
        return { error: 'Failed to persist policy change' };
      }
      
      // Log to audit trail
      await logAudit('policy_updated', 'admin', null, null, {
        agent_id,
        old_policy: oldPolicy,
        new_policy: policy,
        updated_at: new Date().toISOString()
      });
      
      console.log(`[model-router] Policy updated for ${agent_id} (persisted to file)`);
      
      return {
        status: 'updated',
        agent_id,
        policy,
        old_policy: oldPolicy,
        persisted: true,
        note: 'Policy updated and persisted to config file. Changes active immediately (no restart required).'
      };
    } catch (error) {
      console.error('Error updating policy:', error);
      return { error: error.message };
    }
  },
  
  'model.getPolicyHistory': async (params) => {
    const { agent_id } = params;
    const allHistory = getPolicyHistory();
    
    if (!agent_id) {
      return { history: allHistory };
    }
    
    const agentHistory = allHistory.filter(entry => entry.agent_id === agent_id);
    return { agent_id, history: agentHistory };
  },
  
  'model.rollbackPolicy': async (params) => {
    const { agent_id, steps } = params;
    
    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }
    
    return rollbackPolicy(agent_id, steps || 1);
  }
};

// ─────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'model-router' }));
    return;
  }
  
  if (req.url === '/rpc' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { method, params, id } = JSON.parse(body);
        
        if (!rpcMethods[method]) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Unknown method', id }));
          return;
        }
        
        const result = await rpcMethods[method](params || {});
        res.writeHead(200);
        res.end(JSON.stringify({ result, id }));
      } catch (error) {
        console.error('RPC error:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Startup
async function startup() {
  try {
    // Test database connection
    const result = await db.query('SELECT NOW()');
    console.log('✅ Database connected');
    
    // Schema already initialized separately via psql
    console.log('✅ Schema verified (pre-initialized)');
    
    // Start HTTP server
    const PORT = process.env.PORT || 3105;
    server.listen(PORT, () => {
      console.log(`✅ Model Router Service listening on port ${PORT}`);
      console.log(`   RPC: POST http://localhost:${PORT}/rpc`);
      console.log(`   Health: GET http://localhost:${PORT}/health`);
    });
    
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

startup();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await db.end();
  server.close();
});
