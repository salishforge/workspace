/**
 * Service Registry Methods (Phase 1-2)
 * 
 * Implements:
 * - services.register
 * - services.heartbeat
 * - services.deregister
 * - services.discover
 * - services.integrate
 * - services.listIntegrations
 */

// ── Service Registration RPC (Phase 1) ──
export async function handleServiceRegister(pool, params) {
  try {
    const {
      service_id,
      service_name,
      service_type,
      version,
      api_endpoint,
      api_protocol,
      capabilities,
      requires,
      health_check_url
    } = params;

    // Validate required fields
    if (!service_id || !service_name || !service_type || !version || !api_endpoint) {
      throw new Error('Missing required fields: service_id, service_name, service_type, version, api_endpoint');
    }

    // Register service
    await pool.query(
      `INSERT INTO hyphae_service_registry 
       (service_id, service_name, service_type, version, status, api_endpoint, api_protocol, capabilities, requires, health_check_url)
       VALUES ($1, $2, $3, $4, 'registering', $5, $6, $7, $8, $9)
       ON CONFLICT (service_id) DO UPDATE SET status = 'registering', registered_at = now()`,
      [service_id, service_name, service_type, version, api_endpoint, api_protocol || 'json-rpc',
       JSON.stringify(capabilities || []), JSON.stringify(requires || []), health_check_url]
    );

    const registrationToken = generateUuid();
    await auditLog(pool, 'service_register', 'system', service_name, 'success', { service_id });

    console.log(`[hyphae] Service registered: ${service_name} (${service_id})`);

    return {
      service_id,
      registered: true,
      registration_token: registrationToken,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      heartbeat_interval: 30,
      next_heartbeat_by: new Date(Date.now() + 30000).toISOString()
    };
  } catch (error) {
    await auditLog(pool, 'service_register', 'system', 'unknown', 'failure', { error: error.message });
    throw error;
  }
}

// ── Service Heartbeat RPC (Phase 1) ──
export async function handleServiceHeartbeat(pool, params) {
  try {
    const { service_id, status, metrics } = params;

    if (!service_id) {
      throw new Error('Missing service_id');
    }

    // Update service status
    await pool.query(
      `UPDATE hyphae_service_registry 
       SET status = $1, last_health_check = now(), consecutive_failures = 0, healthy = true
       WHERE service_id = $2`,
      [status || 'ready', service_id]
    );

    await auditLog(pool, 'service_heartbeat', 'system', service_id, 'success', { metrics });

    return {
      acknowledged: true,
      next_heartbeat_by: new Date(Date.now() + 30000).toISOString()
    };
  } catch (error) {
    await auditLog(pool, 'service_heartbeat', 'system', params.service_id || 'unknown', 'failure', { error: error.message });
    throw error;
  }
}

// ── Service Deregister RPC (Phase 1) ──
export async function handleServiceDeregister(pool, params) {
  try {
    const { service_id, reason } = params;

    if (!service_id) {
      throw new Error('Missing service_id');
    }

    const result = await pool.query(
      `UPDATE hyphae_service_registry 
       SET status = 'offline', healthy = false
       WHERE service_id = $1
       RETURNING service_name`,
      [service_id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Service ${service_id} not found`);
    }

    await auditLog(pool, 'service_deregister', 'system', result.rows[0].service_name, 'success', { reason });
    console.log(`[hyphae] Service deregistered: ${service_id}`);

    // Delete integrations (cascade)
    await pool.query(`DELETE FROM hyphae_service_integrations WHERE service_id = $1`, [service_id]);

    return {
      deregistered: true,
      service_id
    };
  } catch (error) {
    await auditLog(pool, 'service_deregister', 'system', params.service_id || 'unknown', 'failure', { error: error.message });
    throw error;
  }
}

// ── Service Discovery RPC (Phase 2) ──
export async function handleServiceDiscover(pool, params) {
  try {
    const { agent_id, filters = {} } = params;
    const { service_type, healthy, required_capabilities } = filters;

    let query = `
      SELECT service_id, service_name, service_type, version, api_endpoint, api_protocol, 
             capabilities, health_check_url, healthy, last_health_check
      FROM hyphae_service_registry
      WHERE status != 'offline'
    `;
    const queryParams = [];

    // Apply filters
    if (service_type) {
      query += ` AND service_type = $${queryParams.length + 1}`;
      queryParams.push(service_type);
    }

    if (healthy === true) {
      query += ` AND healthy = true`;
    }

    query += ` ORDER BY registered_at DESC`;

    const result = await pool.query(query, queryParams);

    // Filter by required capabilities (post-query, since it's a JSONB array)
    let services = result.rows;
    if (required_capabilities && required_capabilities.length > 0) {
      services = services.filter(service => {
        const caps = service.capabilities || [];
        return required_capabilities.every(req => caps.some(c => c.id === req));
      });
    }

    await auditLog(pool, 'service_discover', agent_id, 'query', 'success', { filter: filters, result_count: services.length });

    return {
      services: services.map(s => ({
        service_id: s.service_id,
        service_name: s.service_name,
        service_type: s.service_type,
        api_endpoint: s.api_endpoint,
        api_protocol: s.api_protocol,
        capabilities: s.capabilities,
        health_status: s.healthy ? 'healthy' : 'unhealthy',
        latency_ms: 45 // Placeholder
      }))
    };
  } catch (error) {
    await auditLog(pool, 'service_discover', params.agent_id || 'unknown', 'query', 'failure', { error: error.message });
    throw error;
  }
}

// ── Service Integration RPC (Phase 2) ──
export async function handleServiceIntegrate(pool, params) {
  try {
    const { agent_id, service_id, integration_type, capabilities_needed } = params;

    if (!agent_id || !service_id || !integration_type) {
      throw new Error('Missing required fields: agent_id, service_id, integration_type');
    }

    // Verify service exists and is healthy
    const serviceResult = await pool.query(
      `SELECT service_name FROM hyphae_service_registry WHERE service_id = $1 AND healthy = true`,
      [service_id]
    );

    if (serviceResult.rows.length === 0) {
      throw new Error(`Service ${service_id} not found or not healthy`);
    }

    const serviceName = serviceResult.rows[0].service_name;

    // Create integration
    const integrationToken = generateUuid();
    await pool.query(
      `INSERT INTO hyphae_service_integrations 
       (agent_id, service_id, integration_type, capabilities_granted, integration_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, service_id) DO UPDATE SET integration_token = $5`,
      [agent_id, service_id, integration_type, JSON.stringify(capabilities_needed || []), integrationToken]
    );

    await auditLog(pool, 'service_integrate', agent_id, service_id, 'success', { integration_type });
    console.log(`[hyphae] Agent ${agent_id} integrated with ${serviceName}`);

    return {
      integrated: true,
      integration_config: {
        service_endpoint: 'http://localhost:3102', // Hyphae itself
        agent_authorization: `Bearer ${integrationToken}`,
        routing_via_hyphae: integration_type === 'routed',
        caching_enabled: true,
        retry_policy: 'exponential_backoff'
      }
    };
  } catch (error) {
    await auditLog(pool, 'service_integrate', params.agent_id || 'unknown', params.service_id || 'unknown', 'failure', { error: error.message });
    throw error;
  }
}

// ── List Integrations RPC (Phase 2) ──
export async function handleListIntegrations(pool, params) {
  try {
    const { service_id } = params;

    if (!service_id) {
      throw new Error('Missing service_id');
    }

    const result = await pool.query(
      `SELECT agent_id, integration_type, capabilities_granted FROM hyphae_service_integrations 
       WHERE service_id = $1`,
      [service_id]
    );

    return {
      service_id,
      integrations: result.rows
    };
  } catch (error) {
    await auditLog(pool, 'service_listIntegrations', 'system', params.service_id || 'unknown', 'failure', { error: error.message });
    throw error;
  }
}

// ── Health Check Polling (Phase 1) ──
export function startServiceHealthChecking(pool) {
  setInterval(async () => {
    try {
      const services = await pool.query(
        `SELECT service_id, service_name, health_check_url FROM hyphae_service_registry 
         WHERE status != 'offline' AND health_check_url IS NOT NULL`
      );

      for (const service of services.rows) {
        try {
          const response = await fetch(service.health_check_url, { timeout: 5000 });

          if (response.ok) {
            await pool.query(
              `UPDATE hyphae_service_registry 
               SET healthy = true, consecutive_failures = 0, last_health_check = now()
               WHERE service_id = $1`,
              [service.service_id]
            );
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
        } catch (error) {
          // Service is unhealthy
          await pool.query(
            `UPDATE hyphae_service_registry 
             SET consecutive_failures = consecutive_failures + 1, last_health_check = now()
             WHERE service_id = $1`,
            [service.service_id]
          );

          const result = await pool.query(
            `SELECT consecutive_failures FROM hyphae_service_registry WHERE service_id = $1`,
            [service.service_id]
          );

          if (result.rows[0].consecutive_failures >= 3) {
            await pool.query(
              `UPDATE hyphae_service_registry 
               SET healthy = false, status = 'degraded'
               WHERE service_id = $1`,
              [service.service_id]
            );
            console.warn(`[hyphae] Service marked unhealthy: ${service.service_name}`);
          }
        }
      }
    } catch (error) {
      console.error(`[hyphae] Health check error: ${error.message}`);
    }
  }, 30000);
}

// ── Utility ──
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
