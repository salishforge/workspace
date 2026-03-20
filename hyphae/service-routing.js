/**
 * Service Routing Layer — Phase 3 & 4
 * 
 * Transparent routing of service requests through Hyphae Core
 * - Request interception and authorization
 * - Service gateway with circuit breaker
 * - Request metadata (tracing, auth)
 * - Priority interrupt system
 */

import { EventEmitter } from 'events';

// ── Circuit Breaker per Service ──
class ServiceCircuitBreaker extends EventEmitter {
  constructor(serviceName, errorThreshold = 5, windowMs = 60000) {
    super();
    this.serviceName = serviceName;
    this.state = 'CLOSED';
    this.failures = [];
    this.successes = [];
    this.errorThreshold = errorThreshold;
    this.windowMs = windowMs;
    this.openedAt = null;
    this.minCallThreshold = 10; // Don't open on first failure
  }

  recordSuccess() {
    this.successes.push(Date.now());
    const cutoff = Date.now() - this.windowMs;
    this.successes = this.successes.filter(t => t > cutoff);
    this.failures = this.failures.filter(t => t > cutoff);

    if (this.state === 'HALF_OPEN' && this.successes.length >= 4) {
      this.setState('CLOSED');
    }
  }

  recordFailure() {
    this.failures.push(Date.now());
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter(t => t > cutoff);
    this.successes = this.successes.filter(t => t > cutoff);

    const total = this.failures.length + this.successes.length;
    const errorRate = total > 0 ? this.failures.length / total : 0;

    if (errorRate > (this.errorThreshold / 100) && this.failures.length > 0 && total >= this.minCallThreshold) {
      if (this.state === 'CLOSED') {
        this.setState('OPEN');
        this.openedAt = Date.now();
        return true; // Signal to send interrupt
      }
    }

    return false;
  }

  setState(newState) {
    if (this.state !== newState) {
      console.log(`[hyphae] Service circuit ${this.serviceName}: ${this.state} → ${newState}`);
      this.state = newState;
      this.emit('stateChange', { service: this.serviceName, state: newState });
    }
  }

  getState() {
    if (this.state === 'OPEN' && (Date.now() - this.openedAt) > 30000) {
      this.setState('HALF_OPEN');
    }
    return this.state;
  }

  isOpen() {
    return this.getState() === 'OPEN';
  }

  metrics() {
    return {
      service: this.serviceName,
      state: this.getState(),
      failures: this.failures.length,
      successes: this.successes.length,
      errorRate: this.successes.length + this.failures.length > 0
        ? (this.failures.length / (this.failures.length + this.successes.length)).toFixed(2)
        : 0
    };
  }
}

const serviceCircuitBreakers = new Map();

function getServiceCircuitBreaker(serviceName) {
  if (!serviceCircuitBreakers.has(serviceName)) {
    serviceCircuitBreakers.set(serviceName, new ServiceCircuitBreaker(serviceName));
  }
  return serviceCircuitBreakers.get(serviceName);
}

// ── Service Gateway ──
export async function routeServiceRequest(pool, agentId, serviceName, method, params, options = {}) {
  try {
    // 1. Verify agent exists and is active
    const agentResult = await pool.query(
      `SELECT is_active FROM hyphae_agent_identities WHERE agent_id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0 || !agentResult.rows[0].is_active) {
      await auditLog(pool, 'service_routing', agentId, serviceName, 'denied', { reason: 'agent_revoked' });
      throw new Error('Agent not found or revoked');
    }

    // 2. Get service from registry
    const serviceResult = await pool.query(
      `SELECT * FROM hyphae_service_registry WHERE service_name = $1 AND status != 'offline'`,
      [serviceName]
    );

    if (serviceResult.rows.length === 0) {
      await auditLog(pool, 'service_routing', agentId, serviceName, 'denied', { reason: 'service_not_found' });
      throw new Error(`Service ${serviceName} not available`);
    }

    const service = serviceResult.rows[0];

    // 3. Verify service is healthy
    if (!service.healthy) {
      await auditLog(pool, 'service_routing', agentId, serviceName, 'denied', { reason: 'service_unhealthy' });
      throw new Error(`Service ${serviceName} is unhealthy`);
    }

    // 4. Check agent integration and capabilities
    const integrationResult = await pool.query(
      `SELECT capabilities_granted FROM hyphae_service_integrations 
       WHERE agent_id = $1 AND service_id = $2`,
      [agentId, service.service_id]
    );

    if (integrationResult.rows.length === 0) {
      await auditLog(pool, 'service_routing', agentId, serviceName, 'denied', { reason: 'not_integrated' });
      throw new Error(`Agent not integrated with ${serviceName}`);
    }

    const integration = integrationResult.rows[0];
    const hasCapability = integration.capabilities_granted.includes(method);

    if (!hasCapability) {
      await auditLog(pool, 'service_routing', agentId, serviceName, 'denied', { reason: 'no_capability', method });
      throw new Error(`Agent not authorized for ${serviceName}.${method}`);
    }

    // 5. Check circuit breaker
    const circuit = getServiceCircuitBreaker(serviceName);
    if (circuit.isOpen()) {
      await auditLog(pool, 'service_routing', agentId, serviceName, 'fallback');
      
      // Send priority interrupt
      await sendPriorityInterrupt(pool, agentId, serviceName);
      
      throw new Error(`Service ${serviceName} temporarily unavailable (circuit open)`);
    }

    // 6. Build request with metadata
    const requestId = generateUuid();
    const request = {
      jsonrpc: '2.0',
      method,
      params: {
        ...params,
        _meta: {
          agent_id: agentId,
          request_id: requestId,
          timestamp: new Date().toISOString(),
          routed_via_hyphae: true
        }
      },
      id: requestId
    };

    // 7. Forward to service
    console.log(`[hyphae] Routing ${agentId} → ${serviceName}.${method}`);
    const response = await callService(service.api_endpoint, request, options.timeout || 5000);

    // 8. Record success
    circuit.recordSuccess();
    await auditLog(pool, 'service_routing', agentId, serviceName, 'success', { method, request_id: requestId });

    return response;

  } catch (error) {
    // Record failure and check if circuit should open
    const circuit = getServiceCircuitBreaker(serviceName);
    const shouldInterrupt = circuit.recordFailure();

    await auditLog(pool, 'service_routing', agentId, serviceName, 'failure', {
      error: error.message,
      method
    });

    if (shouldInterrupt) {
      await sendPriorityInterrupt(pool, agentId, serviceName);
    }

    throw error;
  }
}

// ── Service Invocation ──
async function callService(endpoint, request, timeoutMs) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      timeout: timeoutMs
    });

    if (!response.ok) {
      throw new Error(`Service returned ${response.status}: ${response.statusText}`);
    }

    return await response.json();

  } catch (error) {
    throw new Error(`Service call failed: ${error.message}`);
  }
}

// ── Priority Interrupt System ──
async function sendPriorityInterrupt(pool, agentId, serviceName) {
  const interrupt = {
    type: 'CAPABILITY_UNAVAILABLE',
    capability: serviceName,
    timestamp: new Date().toISOString(),
    description: `Service ${serviceName} is unavailable. Will retry automatically.`,
    retry_at: new Date(Date.now() + 30000).toISOString()
  };

  // Log the interrupt
  await auditLog(pool, 'priority_interrupt', agentId, serviceName, 'sent', interrupt);

  // In production: Send to agent via message queue or webhook
  // For now: Log it (actual delivery depends on agent communication channel)
  console.log(`[hyphae] Priority interrupt: ${agentId} notified of ${serviceName} unavailability`);
}

// ── Audit Logging ──
async function auditLog(pool, action, agentId, resource, status, details = {}) {
  try {
    await pool.query(
      `INSERT INTO hyphae_audit_log (agent_id, action, resource, status, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [agentId || 'system', action, resource, status, JSON.stringify(details)]
    );
  } catch (error) {
    console.error(`[hyphae] Audit log failed: ${error.message}`);
  }
}

// ── Utilities ──
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Exports ──
export {
  ServiceCircuitBreaker,
  getServiceCircuitBreaker,
  serviceCircuitBreakers
};
