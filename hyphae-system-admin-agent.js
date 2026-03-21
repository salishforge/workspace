#!/usr/bin/env node

/**
 * Hyphae System Administrator Agent
 * 
 * Hybrid Human-AI infrastructure management
 * 
 * Responsibilities:
 * - Observe all system events
 * - Detect anomalies
 * - Make decisions within policy
 * - Escalate when needed
 * - Learn from outcomes
 * 
 * Runs on port 3120
 */

import http from 'http';
import pg from 'pg';
import fetch from 'node-fetch';
import { PolicyEngine } from './hyphae-admin-policy-engine.js';

const { Pool } = pg;

const PORT = process.env.SYSTEM_ADMIN_PORT || 3120;
const AGENT_ID = 'system-admin';

const db = new Pool({
  host: process.env.DB_HOST || '100.97.161.7',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026'
});

/**
 * System Admin Agent
 * 
 * Core intelligence for infrastructure management
 */
export class SystemAdminAgent {
  constructor() {
    this.policy = null;
    this.events = [];
    this.patterns = new Map();
  }

  /**
   * Initialize the agent
   */
  async initialize() {
    console.log('[system-admin] Initializing...');
    
    this.policy = await PolicyEngine.getPolicy(AGENT_ID);
    if (!this.policy) {
      throw new Error(`No policy found for ${AGENT_ID}`);
    }

    console.log(`[system-admin] ✅ Loaded policy (mode: ${this.policy.mode})`);
  }

  /**
   * Observe a system event
   * 
   * Example events:
   * - service.health.check (service status)
   * - service.error (service failed)
   * - agent.request (agent making a request)
   * - performance.metric (performance data)
   * - security.event (security alert)
   */
  async observeEvent(event) {
    console.log(`[system-admin] 📊 Event: ${event.event_type}`);

    // Store event
    this.events.push({
      ...event,
      timestamp: new Date(),
      observed_at: new Date()
    });

    // Detect anomalies
    const anomaly = await this.detectAnomaly(event);
    if (anomaly) {
      console.log(`[system-admin] ⚠️  Anomaly detected: ${anomaly.description}`);
      await this.handleAnomaly(anomaly);
    }

    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }

  /**
   * Detect if an event indicates an anomaly
   */
  async detectAnomaly(event) {
    const { event_type, service_id, data } = event;

    // Service health anomalies
    if (event_type === 'service.health.check') {
      if (data.status === 'unhealthy') {
        return {
          type: 'service_unhealthy',
          description: `Service ${service_id} is unhealthy`,
          severity: 'medium',
          service_id,
          incident_data: data
        };
      }
    }

    // Service errors
    if (event_type === 'service.error') {
      // Count errors in last 5 minutes
      const recent_errors = this.events.filter(e =>
        e.event_type === 'service.error' &&
        e.service_id === service_id &&
        new Date() - e.timestamp < 5 * 60 * 1000
      ).length;

      if (recent_errors > 10) {
        return {
          type: 'service_error_spike',
          description: `${service_id} has had ${recent_errors} errors in the last 5 minutes`,
          severity: 'high',
          service_id,
          error_count: recent_errors
        };
      }
    }

    // Cost anomalies
    if (event_type === 'cost.spike') {
      if (data.hourly_rate > (data.expected_rate * 1.5)) {
        return {
          type: 'cost_spike',
          description: `Hourly cost spike: $${data.hourly_rate} (expected ~$${data.expected_rate})`,
          severity: 'high',
          cost_data: data
        };
      }
    }

    // Performance anomalies
    if (event_type === 'performance.metric') {
      if (data.latency_ms > 5000) {
        return {
          type: 'high_latency',
          description: `High latency detected: ${data.latency_ms}ms (threshold: 5000ms)`,
          severity: 'medium',
          performance_data: data
        };
      }
    }

    return null;
  }

  /**
   * Handle an anomaly
   */
  async handleAnomaly(anomaly) {
    const { type, description, severity, service_id } = anomaly;

    // Determine decision category
    let decision_category;
    switch (type) {
      case 'service_unhealthy':
      case 'service_error_spike':
        decision_category = 'service_recovery';
        break;
      case 'cost_spike':
        decision_category = 'cost_management';
        break;
      case 'high_latency':
        decision_category = 'performance_optimization';
        break;
      default:
        decision_category = 'anomaly_response';
    }

    // Determine decision action
    let decision_action;
    const reasoning = {};

    if (type === 'service_unhealthy') {
      decision_action = `Restart service: ${service_id}`;
      reasoning.action = 'service_restart';
      reasoning.target = service_id;
    } else if (type === 'service_error_spike') {
      decision_action = `Investigate error spike in ${service_id} and apply mitigation`;
      reasoning.action = 'investigate_and_mitigate';
      reasoning.error_count = anomaly.error_count;
    } else if (type === 'cost_spike') {
      decision_action = `Alert admin about cost spike; consider throttling or upgrade`;
      reasoning.action = 'cost_alert';
      reasoning.current_rate = anomaly.cost_data.hourly_rate;
    } else {
      decision_action = `Investigate and respond to: ${description}`;
    }

    // Evaluate against policy
    const evaluation = await PolicyEngine.evaluateDecision({
      agent_id: AGENT_ID,
      decision_category,
      decision_action,
      input_data: {
        anomaly,
        recent_events: this.events.slice(-10)
      },
      cost_estimate_usd: type === 'cost_spike' ? anomaly.cost_data.hourly_rate : 0
    });

    console.log(`[system-admin] 📋 Policy evaluation: ${evaluation.allowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
    console.log(`[system-admin]    Requires approval: ${evaluation.requires_approval}`);
    console.log(`[system-admin]    Boundary: ${evaluation.policy_boundary}`);

    // Log the decision
    const decision_log = await PolicyEngine.logDecision({
      agent_id: AGENT_ID,
      decision_category,
      policy_evaluation: evaluation,
      input_data: { anomaly },
      decision_reasoning: reasoning,
      decision_action,
      outcome_status: evaluation.requires_approval ? 'escalated' : 'pending',
      cost_impact_usd: type === 'cost_spike' ? anomaly.cost_data.hourly_rate : 0
    });

    // Execute if allowed and doesn't require approval
    if (evaluation.allowed && !evaluation.requires_approval) {
      console.log(`[system-admin] ✅ Executing autonomous action...`);
      
      try {
        const result = await this.executeAction({
          type,
          action: decision_action,
          service_id,
          reasoning
        });

        // Update decision log
        await db.query(
          `UPDATE hyphae_admin_decision_log 
           SET outcome_status = 'executed', outcome_result = $1 
           WHERE id = $2`,
          [JSON.stringify(result), decision_log.id]
        );

        console.log(`[system-admin] ✅ Action executed successfully`);
      } catch (error) {
        console.error(`[system-admin] ❌ Action failed:`, error.message);
        
        await db.query(
          `UPDATE hyphae_admin_decision_log 
           SET outcome_status = 'failed', outcome_result = $1 
           WHERE id = $2`,
          [JSON.stringify({ error: error.message }), decision_log.id]
        );
      }
    } else if (evaluation.requires_approval) {
      console.log(`[system-admin] 🔔 Escalating to human admin...`);
      
      // Send notification to admin
      await this.notifyAdmin({
        decision_id: decision_log.id,
        category: decision_category,
        description,
        recommendation: evaluation.recommended_action
      });
    }
  }

  /**
   * Execute an autonomous action
   */
  async executeAction(params) {
    const { type, action, service_id, reasoning } = params;

    console.log(`[system-admin]    Executing: ${action}`);

    // Example implementations
    if (type === 'service_unhealthy') {
      // Restart service via Hyphae
      const response = await fetch('http://localhost:3100/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'hyphae.executeServiceAction',
          params: {
            service_id,
            action: 'restart'
          },
          id: 1
        })
      });

      return await response.json();
    }

    // Add more action types as needed
    return { status: 'executed', action_type: type };
  }

  /**
   * Notify admin
   */
  async notifyAdmin(params) {
    const { decision_id, category, description, recommendation } = params;

    const message = `
🔔 **System Admin Agent Alert**

**Decision ID:** ${decision_id}
**Category:** ${category}
**Description:** ${description}

${recommendation ? `**Recommendation:** ${recommendation}` : ''}

Review in admin portal: http://100.97.161.7:3110
    `.trim();

    console.log(`[system-admin] 📧 Notification: ${message}`);

    // TODO: Send to admin via Telegram/email/webhook
  }

  /**
   * Main event loop
   */
  async run() {
    console.log(`[system-admin] 🚀 Starting event loop...`);

    // Simulate some events for testing
    const test_events = [
      {
        event_type: 'service.health.check',
        service_id: 'hyphae-core',
        data: { status: 'healthy' }
      },
      {
        event_type: 'performance.metric',
        service_id: 'model-router',
        data: { latency_ms: 125, requests_per_sec: 10 }
      },
      {
        event_type: 'cost.spike',
        data: { hourly_rate: 25, expected_rate: 10 }
      }
    ];

    for (const event of test_events) {
      await this.observeEvent(event);
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[system-admin] ✅ Event loop cycle complete`);
  }
}

// HTTP Server
async function requestHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'system-admin-agent' }));
    return;
  }

  if (req.url === '/api/event' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const event = JSON.parse(body);
        await agent.observeEvent(event);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Agent instance
let agent;

async function start() {
  agent = new SystemAdminAgent();
  await agent.initialize();

  const server = http.createServer(requestHandler);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[system-admin] ✅ System Admin Agent running on port ${PORT}`);
    console.log(`[system-admin] 📍 Event endpoint: POST http://localhost:${PORT}/api/event`);
    console.log(`[system-admin] ❤️  Health check: GET http://localhost:${PORT}/health`);
    console.log(`[system-admin] 🟢 Ready to observe and manage infrastructure`);
  });

  // Run main loop every 30 seconds
  setInterval(() => agent.run(), 30000);

  process.on('SIGTERM', () => {
    server.close(() => {
      db.end();
      process.exit(0);
    });
  });
}

start().catch(err => {
  console.error('[system-admin] Startup error:', err);
  process.exit(1);
});

export default SystemAdminAgent;
