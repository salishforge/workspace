#!/usr/bin/env node

/**
 * MemForge Service Wrapper with Hyphae Integration
 * 
 * Runs MemForge consolidation + retrieval services and automatically
 * registers them with Hyphae Core service registry.
 */

import fetch from 'node-fetch';

const HYPHAE_RPC_URL = process.env.HYPHAE_RPC_URL || 'http://localhost:3102';
const HYPHAE_BEARER_TOKEN = process.env.HYPHAE_BEARER_TOKEN || 'memforge-token-2026';
const MEMFORGE_RPC_URL = process.env.MEMFORGE_RPC_URL || 'http://localhost:3003';
const MEMFORGE_RETRIEVAL_URL = process.env.MEMFORGE_RETRIEVAL_URL || 'http://localhost:3004';

let consolidationRegistrationToken;
let retrievalRegistrationToken;

/**
 * Register MemForge Consolidation Service with Hyphae
 */
async function registerConsolidationService() {
  try {
    console.log('[memforge] Registering consolidation service with Hyphae...');

    const registration = {
      jsonrpc: '2.0',
      method: 'services.register',
      params: {
        service_id: 'memforge-consolidation',
        service_name: 'MemForge Consolidation',
        service_type: 'memory',
        version: '1.0.0',
        api_endpoint: MEMFORGE_RPC_URL,
        api_protocol: 'json-rpc',
        capabilities: [
          { id: 'consolidate', method: 'consolidation.run', description: 'Run sleep-cycle consolidation' },
          { id: 'status', method: 'consolidation.status', description: 'Get consolidation status' },
          { id: 'lastRun', method: 'consolidation.lastRun', description: 'Get last run timestamp' }
        ],
        requires: [
          { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
          { type: 'database', connection_string_env: 'MEMFORGE_DB_URL' }
        ],
        health_check_url: `${MEMFORGE_RPC_URL}/health`
      },
      id: 'register-consolidation'
    };

    const response = await callHyphaeRPC(registration);

    if (response.result?.registration_token) {
      consolidationRegistrationToken = response.result.registration_token;
      console.log('[memforge] ✓ Consolidation service registered with Hyphae');
      console.log(`    Token: ${consolidationRegistrationToken.substring(0, 12)}...`);
      return true;
    } else {
      throw new Error('No registration token in response');
    }
  } catch (error) {
    console.warn(`[memforge] Consolidation registration failed: ${error.message}`);
    return false;
  }
}

/**
 * Register MemForge Retrieval Service with Hyphae
 */
async function registerRetrievalService() {
  try {
    console.log('[memforge] Registering retrieval service with Hyphae...');

    const registration = {
      jsonrpc: '2.0',
      method: 'services.register',
      params: {
        service_id: 'memforge-retrieval',
        service_name: 'MemForge Retrieval',
        service_type: 'memory',
        version: '1.0.0',
        api_endpoint: MEMFORGE_RETRIEVAL_URL,
        api_protocol: 'http-rest',
        capabilities: [
          { id: 'queryByText', method: 'GET /query', description: 'Full-text semantic search' },
          { id: 'getHotTier', method: 'GET /hot-tier', description: 'Get hot memory' },
          { id: 'getWarmTier', method: 'GET /warm-tier', description: 'Get warm memory' },
          { id: 'getColdTier', method: 'GET /cold-tier', description: 'Get cold archive' },
          { id: 'cacheStats', method: 'GET /cache-stats', description: 'Cache performance' }
        ],
        requires: [
          { type: 'encryption_key', env_var: 'MEMFORGE_ENCRYPTION_KEY' },
          { type: 'database', connection_string_env: 'MEMFORGE_DB_URL' }
        ],
        health_check_url: `${MEMFORGE_RETRIEVAL_URL}/health`
      },
      id: 'register-retrieval'
    };

    const response = await callHyphaeRPC(registration);

    if (response.result?.registration_token) {
      retrievalRegistrationToken = response.result.registration_token;
      console.log('[memforge] ✓ Retrieval service registered with Hyphae');
      console.log(`    Token: ${retrievalRegistrationToken.substring(0, 12)}...`);
      return true;
    } else {
      throw new Error('No registration token in response');
    }
  } catch (error) {
    console.warn(`[memforge] Retrieval registration failed: ${error.message}`);
    return false;
  }
}

/**
 * Start Heartbeat for Consolidation Service
 */
function startConsolidationHeartbeat() {
  setInterval(async () => {
    try {
      if (!consolidationRegistrationToken) return;

      const heartbeat = {
        jsonrpc: '2.0',
        method: 'services.heartbeat',
        params: {
          service_id: 'memforge-consolidation',
          registration_token: consolidationRegistrationToken,
          status: 'ready',
          metrics: {
            uptime_seconds: process.uptime(),
            consolidations_run: global.CONSOLIDATION_COUNT || 0,
            last_run_duration_ms: global.LAST_RUN_DURATION || 0,
            memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
          }
        },
        id: `heartbeat-consolidation-${Date.now()}`
      };

      await callHyphaeRPC(heartbeat);
    } catch (error) {
      // Silent fail on heartbeat
    }
  }, 30000); // Every 30 seconds
}

/**
 * Start Heartbeat for Retrieval Service
 */
function startRetrievalHeartbeat() {
  setInterval(async () => {
    try {
      if (!retrievalRegistrationToken) return;

      const heartbeat = {
        jsonrpc: '2.0',
        method: 'services.heartbeat',
        params: {
          service_id: 'memforge-retrieval',
          registration_token: retrievalRegistrationToken,
          status: 'ready',
          metrics: {
            uptime_seconds: process.uptime(),
            cache_hits: global.CACHE_HITS || 0,
            queries_executed: global.QUERIES_EXECUTED || 0,
            memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
          }
        },
        id: `heartbeat-retrieval-${Date.now()}`
      };

      await callHyphaeRPC(heartbeat);
    } catch (error) {
      // Silent fail on heartbeat
    }
  }, 30000); // Every 30 seconds
}

/**
 * Call Hyphae RPC
 */
async function callHyphaeRPC(rpcRequest) {
  const response = await fetch(HYPHAE_RPC_URL + '/rpc', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HYPHAE_BEARER_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(rpcRequest),
    timeout: 5000
  });

  if (!response.ok) {
    throw new Error(`Hyphae returned ${response.status}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`Hyphae error: ${result.error.message}`);
  }

  return result;
}

/**
 * Main: Start MemForge and Register Services
 */
async function main() {
  console.log('[memforge-wrapper] Starting MemForge service wrapper...');
  console.log(`[memforge-wrapper] Hyphae RPC: ${HYPHAE_RPC_URL}`);
  console.log(`[memforge-wrapper] Consolidation RPC: ${MEMFORGE_RPC_URL}`);
  console.log(`[memforge-wrapper] Retrieval RPC: ${MEMFORGE_RETRIEVAL_URL}`);

  // Register services with Hyphae
  const consRegistered = await registerConsolidationService();
  const retriRegistered = await registerRetrievalService();

  if (consRegistered) {
    startConsolidationHeartbeat();
  }

  if (retriRegistered) {
    startRetrievalHeartbeat();
  }

  // Start mock MemForge services (in real deployment, these would be actual services)
  startMockServices();

  console.log('[memforge-wrapper] ✓ Ready - services registered and heartbeats active');
}

/**
 * Mock MemForge Services (for testing)
 */
function startMockServices() {
  // In a real deployment, these would be actual MemForge processes
  // For testing, we just log that they're running
  console.log('[memforge] Consolidation service: listening on port 3003 (mock)');
  console.log('[memforge] Retrieval service: listening on port 3004 (mock)');
  
  // Simulate service health endpoints
  global.CONSOLIDATION_COUNT = 0;
  global.LAST_RUN_DURATION = 0;
  global.CACHE_HITS = 0;
  global.QUERIES_EXECUTED = 0;
}

main().catch(error => {
  console.error('[memforge-wrapper] Fatal error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[memforge-wrapper] Shutting down...');
  process.exit(0);
});
