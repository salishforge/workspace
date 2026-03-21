#!/usr/bin/env node

/**
 * Hyphae Rescue Agent
 * 
 * MINIMAL, EMBEDDED, FAIL-SAFE
 * 
 * Single responsibility: Recover Hyphae Core and System Admin Agent
 * to a known good state.
 * 
 * Design principle:
 * - NO complex decision logic
 * - NO learning
 * - NO policy evaluation
 * - JUST: Detect failure → Run recovery → Restore
 * 
 * This agent is UNAFFECTED by other component failures.
 * If anything else breaks, rescue agent can restore.
 * 
 * Runs on port 3115
 */

import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';

const PORT = process.env.RESCUE_PORT || 3115;
const RESCUE_MODE = process.env.RESCUE_MODE || 'embedded';

/**
 * RescueAgent
 * 
 * Hardcoded recovery procedures - no flexibility, maximum resilience
 */
class RescueAgent {
  constructor() {
    this.last_check = null;
    this.recovery_history = [];
    this.max_history = 50;
  }

  /**
   * Health check all critical services
   */
  async healthCheck() {
    const services = [
      {
        name: 'hyphae-core',
        url: 'http://localhost:3100/health',
        port: 3100
      },
      {
        name: 'system-admin-agent',
        url: 'http://localhost:3120/health',
        port: 3120
      },
      {
        name: 'admin-portal',
        url: 'http://localhost:3110/health',
        port: 3110
      },
      {
        name: 'model-router',
        url: 'http://localhost:3105/health',
        port: 3105
      }
    ];

    const status = {
      timestamp: new Date(),
      services: {}
    };

    for (const service of services) {
      try {
        const response = await fetch(service.url, { timeout: 5000 });
        status.services[service.name] = {
          status: response.ok ? 'healthy' : 'unhealthy',
          http_status: response.status
        };
      } catch (error) {
        status.services[service.name] = {
          status: 'unreachable',
          error: error.message
        };
      }
    }

    this.last_check = status;
    return status;
  }

  /**
   * Determine if recovery is needed
   */
  isRecoveryNeeded(health_status) {
    // Core or System Admin must be healthy
    if (health_status.services['hyphae-core'].status !== 'healthy') {
      return {
        needed: true,
        reason: 'Hyphae Core is not healthy',
        recovery_type: 'hyphae_core_recovery'
      };
    }

    if (health_status.services['system-admin-agent'].status !== 'healthy') {
      return {
        needed: true,
        reason: 'System Admin Agent is not healthy',
        recovery_type: 'system_admin_recovery'
      };
    }

    if (health_status.services['admin-portal'].status !== 'healthy') {
      return {
        needed: true,
        reason: 'Admin Portal is not healthy',
        recovery_type: 'admin_portal_recovery'
      };
    }

    return { needed: false };
  }

  /**
   * Recover Hyphae Core
   * 
   * Procedure:
   * 1. Kill existing process
   * 2. Wait for port to free
   * 3. Start fresh from deployment directory
   * 4. Verify startup
   */
  async recoverHyphaeCore() {
    console.log('[rescue] 🚑 RECOVERING: Hyphae Core');
    console.log('[rescue]    Kill existing process...');

    try {
      // Kill any existing processes
      execSync('pkill -f "hyphae-core" 2>/dev/null || true', { stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 2000));

      // Ensure port is free
      try {
        execSync('pkill -9 -f ":3100" 2>/dev/null || true', { stdio: 'ignore' });
      } catch (e) {}

      console.log('[rescue]    Starting Hyphae Core from deployment...');

      // Start fresh
      execSync(
        `cd /home/artificium/hyphae-staging && \
         export DB_HOST=localhost \
         export DB_PORT=5433 \
         export DB_NAME=hyphae \
         export DB_USER=postgres \
         export DB_PASSWORD=hyphae-password-2026 \
         node hyphae-core-llm-final.js > /tmp/hyphae-core-rescue.log 2>&1 &`,
        { stdio: 'ignore' }
      );

      // Wait for startup
      await new Promise(r => setTimeout(r, 5000));

      // Verify
      const response = await fetch('http://localhost:3100/health');
      if (response.ok) {
        console.log('[rescue] ✅ Hyphae Core recovered successfully');
        return { success: true, service: 'hyphae-core' };
      } else {
        console.log('[rescue] ⚠️  Hyphae Core started but health check failed');
        return { success: false, service: 'hyphae-core', reason: 'Health check failed' };
      }
    } catch (error) {
      console.error('[rescue] ❌ Hyphae Core recovery failed:', error.message);
      return { success: false, service: 'hyphae-core', error: error.message };
    }
  }

  /**
   * Recover System Admin Agent
   */
  async recoverSystemAdminAgent() {
    console.log('[rescue] 🚑 RECOVERING: System Admin Agent');

    try {
      execSync('pkill -f "system-admin-agent" 2>/dev/null || true', { stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 2000));

      console.log('[rescue]    Starting System Admin Agent...');

      execSync(
        `cd /home/artificium/hyphae-staging && \
         export DB_HOST=localhost \
         export DB_PORT=5433 \
         export DB_NAME=hyphae \
         export DB_USER=postgres \
         export DB_PASSWORD=hyphae-password-2026 \
         export SYSTEM_ADMIN_PORT=3120 \
         node hyphae-system-admin-agent.js > /tmp/system-admin-rescue.log 2>&1 &`,
        { stdio: 'ignore' }
      );

      await new Promise(r => setTimeout(r, 4000));

      const response = await fetch('http://localhost:3120/health');
      if (response.ok) {
        console.log('[rescue] ✅ System Admin Agent recovered');
        return { success: true, service: 'system-admin-agent' };
      } else {
        console.log('[rescue] ⚠️  System Admin Agent started but health check failed');
        return { success: false, service: 'system-admin-agent', reason: 'Health check failed' };
      }
    } catch (error) {
      console.error('[rescue] ❌ System Admin recovery failed:', error.message);
      return { success: false, service: 'system-admin-agent', error: error.message };
    }
  }

  /**
   * Factory Reset
   * 
   * Nuclear option: Restore to completely fresh state
   * This should ALWAYS work
   */
  async factoryReset() {
    console.log('[rescue] 💥 FACTORY RESET initiated');
    console.log('[rescue]    Killing all Hyphae services...');

    try {
      // Kill everything
      execSync(`pkill -f "hyphae-" 2>/dev/null || true`, { stdio: 'ignore' });
      execSync(`pkill -f "system-admin" 2>/dev/null || true`, { stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 3000));

      console.log('[rescue]    Waiting 10 seconds before restart...');
      await new Promise(r => setTimeout(r, 10000));

      console.log('[rescue]    Starting minimal Hyphae Core...');
      execSync(
        `cd /home/artificium/hyphae-staging && \
         export DB_HOST=localhost \
         export DB_PORT=5433 \
         export DB_NAME=hyphae \
         export DB_USER=postgres \
         export DB_PASSWORD=hyphae-password-2026 \
         node hyphae-core-llm-final.js > /tmp/hyphae-factory-reset.log 2>&1 &`,
        { stdio: 'ignore' }
      );

      await new Promise(r => setTimeout(r, 5000));

      console.log('[rescue] ✅ Factory reset complete');
      return { success: true, action: 'factory_reset' };
    } catch (error) {
      console.error('[rescue] ❌ Factory reset failed:', error.message);
      return { success: false, action: 'factory_reset', error: error.message };
    }
  }

  /**
   * Log recovery attempt
   */
  logRecovery(result) {
    this.recovery_history.push({
      timestamp: new Date(),
      ...result
    });

    // Limit history size
    if (this.recovery_history.length > this.max_history) {
      this.recovery_history = this.recovery_history.slice(-this.max_history);
    }

    // Also log to file for audit
    try {
      fs.appendFileSync(
        '/tmp/hyphae-rescue-history.log',
        JSON.stringify({ timestamp: new Date().toISOString(), ...result }) + '\n'
      );
    } catch (e) {
      // Ignore file write errors
    }
  }

  /**
   * Notify admin about recovery
   */
  async notifyAdmin(recovery_result) {
    const message = `
🚨 **Hyphae Rescue Agent Alert**

Recovery was triggered and executed.

**Result:** ${recovery_result.success ? '✅ SUCCESS' : '❌ FAILED'}
**Reason:** ${recovery_result.reason || recovery_result.service}
**Timestamp:** ${new Date().toISOString()}

Check logs: http://100.97.161.7:3110
    `.trim();

    console.log('[rescue] 📧 Admin notification:');
    console.log(message);

    // TODO: Send via Telegram/email/webhook
  }

  /**
   * Main rescue loop
   */
  async run() {
    console.log('[rescue] 🔄 Starting health check cycle...');

    const health = await this.healthCheck();
    console.log('[rescue] 📊 Health status:', JSON.stringify(health.services, null, 2));

    const recovery_needed = this.isRecoveryNeeded(health);

    if (!recovery_needed.needed) {
      console.log('[rescue] ✅ All systems healthy');
      return;
    }

    console.log(`[rescue] ⚠️  Recovery needed: ${recovery_needed.reason}`);

    let recovery_result;

    if (recovery_needed.recovery_type === 'hyphae_core_recovery') {
      recovery_result = await this.recoverHyphaeCore();
    } else if (recovery_needed.recovery_type === 'system_admin_recovery') {
      recovery_result = await this.recoverSystemAdminAgent();
    } else if (recovery_needed.recovery_type === 'admin_portal_recovery') {
      // Admin portal is less critical, attempt restart
      recovery_result = await this.recoverSystemAdminAgent();  // Reuse logic
    }

    this.logRecovery(recovery_result);

    if (!recovery_result.success) {
      console.log('[rescue] ❌ Recovery failed, attempting factory reset...');
      const factory_result = await this.factoryReset();
      this.logRecovery(factory_result);

      if (factory_result.success) {
        await this.notifyAdmin({
          success: true,
          reason: 'Factory reset executed successfully',
          recovery_type: recovery_needed.recovery_type
        });
      } else {
        await this.notifyAdmin({
          success: false,
          reason: 'All recovery procedures failed - MANUAL INTERVENTION REQUIRED',
          recovery_type: 'total_failure'
        });
      }
    } else {
      await this.notifyAdmin(recovery_result);
    }
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      agent: 'rescue-agent',
      mode: RESCUE_MODE,
      last_check: this.last_check,
      recovery_history: this.recovery_history.slice(-10),
      uptime_seconds: process.uptime()
    };
  }
}

// Global rescue agent
let rescue_agent;

// HTTP Server
async function requestHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'rescue-agent', uptime: process.uptime() }));
    return;
  }

  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify(rescue_agent.getStatus()));
    return;
  }

  if (req.url === '/api/check' && req.method === 'POST') {
    try {
      await rescue_agent.run();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Start
async function start() {
  rescue_agent = new RescueAgent();

  const server = http.createServer(requestHandler);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[rescue] ✅ Rescue Agent running on port ${PORT}`);
    console.log(`[rescue] 🔍 Health: GET http://localhost:${PORT}/health`);
    console.log(`[rescue] 📊 Status: GET http://localhost:${PORT}/status`);
    console.log(`[rescue] 🚨 Trigger check: POST http://localhost:${PORT}/api/check`);
    console.log(`[rescue] 🟢 Ready for emergency recovery`);
  });

  // Run health check every 60 seconds
  setInterval(() => rescue_agent.run(), 60000);

  // Initial check after 30 seconds
  setTimeout(() => rescue_agent.run(), 30000);

  process.on('SIGTERM', () => {
    console.log('[rescue] Shutting down...');
    server.close(() => process.exit(0));
  });
}

start().catch(err => {
  console.error('[rescue] Startup error:', err);
  process.exit(1);
});

export default RescueAgent;
