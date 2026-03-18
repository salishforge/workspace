/**
 * Hyphae Service Registry — REST API
 * v1.1.0 — Salish Forge
 *
 * Endpoints:
 *   GET    /health              — public health check
 *   GET    /services            — list registered services  (scope: hyphae:read)
 *   GET    /services/:id        — get service by ID         (scope: hyphae:read)
 *   POST   /services            — register a service        (scope: hyphae:admin)
 *   DELETE /services/:id        — deregister a service      (scope: hyphae:admin)
 *   PUT    /services/:id/heartbeat — update heartbeat       (scope: hyphae:read)
 *
 * Environment:
 *   DATABASE_URL           — PostgreSQL connection string (required)
 *   PORT                   — HTTP port (default: 3006)
 *   OAUTH2_INTROSPECT_URL  — OAuth2 introspect endpoint (default: http://localhost:3005/oauth2/introspect)
 *   OAUTH2_REQUIRED        — Enforce auth (default: true; set false for dev)
 */

import express from 'express';
import pg from 'pg';
import { createOAuth2Middleware, createScopeMiddleware } from './oauth2-middleware.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3006', 10);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[hyphae] DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// ─── Auth ─────────────────────────────────────────────────────────────────────

const oauth2Auth = createOAuth2Middleware({
  skipPaths: ['/health', '/healthz'],
});

// Scope middleware bound with audit pool for DB logging
const readScope  = createScopeMiddleware('hyphae:read',  { auditPool: pool });
const adminScope = createScopeMiddleware('hyphae:admin', { auditPool: pool });

// Apply bearer auth to all protected routes
app.use(oauth2Auth);

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /health */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'hyphae', ts: new Date().toISOString() });
});

/**
 * GET /services
 * List all registered services (optionally filter by type or owner).
 * Requires scope: hyphae:read
 */
app.get('/services', readScope, async (req, res) => {
  const { type, owner } = req.query;

  let query = `
    SELECT s.id, s.type, s.endpoint, s.owner, s.registered_at, s.last_heartbeat,
           COALESCE(
             json_agg(c.capability_name) FILTER (WHERE c.capability_name IS NOT NULL),
             '[]'::json
           ) AS capabilities
    FROM hyphae_services s
    LEFT JOIN hyphae_capabilities c ON s.id = c.service_id
  `;
  const params = [];
  const conditions = [];

  if (type) {
    params.push(type);
    conditions.push(`s.type = $${params.length}`);
  }
  if (owner) {
    params.push(owner);
    conditions.push(`s.owner = $${params.length}`);
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' GROUP BY s.id ORDER BY s.registered_at DESC';

  try {
    const result = await pool.query(query, params);
    res.json({ services: result.rows });
  } catch (err) {
    console.error('[hyphae] DB error listing services:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * GET /services/:id
 * Get a single service by ID.
 * Requires scope: hyphae:read
 */
app.get('/services/:id', readScope, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT s.id, s.type, s.endpoint, s.owner, s.registered_at, s.last_heartbeat,
              COALESCE(
                json_agg(c.capability_name) FILTER (WHERE c.capability_name IS NOT NULL),
                '[]'::json
              ) AS capabilities
       FROM hyphae_services s
       LEFT JOIN hyphae_capabilities c ON s.id = c.service_id
       WHERE s.id = $1
       GROUP BY s.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'not_found', service_id: id });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[hyphae] DB error fetching service:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * POST /services
 * Register a new service or update an existing one.
 * Requires scope: hyphae:admin
 *
 * Body: { id, type, endpoint, owner, capabilities?: string[] }
 */
app.post('/services', adminScope, async (req, res) => {
  const { id, type, endpoint, owner, capabilities } = req.body;

  if (!id || !type || !endpoint || !owner) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'id, type, endpoint, and owner are required',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO hyphae_services (id, type, endpoint, owner, last_heartbeat)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         endpoint = EXCLUDED.endpoint,
         owner = EXCLUDED.owner,
         last_heartbeat = NOW()`,
      [id, type, endpoint, owner]
    );

    if (Array.isArray(capabilities) && capabilities.length > 0) {
      // Replace capabilities for this service
      await client.query('DELETE FROM hyphae_capabilities WHERE service_id = $1', [id]);
      for (const cap of capabilities) {
        if (typeof cap === 'string' && cap.trim()) {
          await client.query(
            'INSERT INTO hyphae_capabilities (service_id, capability_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, cap.trim()]
          );
        }
      }
    }

    await client.query('COMMIT');

    console.log(`[hyphae] service registered: ${id} by ${req.oauth2?.client_id}`);
    res.status(201).json({ registered: true, service_id: id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[hyphae] DB error registering service:', err.message);
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /services/:id
 * Deregister a service.
 * Requires scope: hyphae:admin
 */
app.delete('/services/:id', adminScope, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM hyphae_services WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', service_id: id });
    }

    console.log(`[hyphae] service deregistered: ${id} by ${req.oauth2?.client_id}`);
    res.json({ deleted: true, service_id: id });
  } catch (err) {
    console.error('[hyphae] DB error deregistering service:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * PUT /services/:id/heartbeat
 * Update last_heartbeat timestamp for a service.
 * Requires scope: hyphae:read
 */
app.put('/services/:id/heartbeat', readScope, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE hyphae_services SET last_heartbeat = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'not_found', service_id: id });
    }

    res.json({ updated: true, service_id: id, last_heartbeat: new Date().toISOString() });
  } catch (err) {
    console.error('[hyphae] DB error updating heartbeat:', err.message);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── 404 / error fallbacks ────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error('[hyphae] unhandled error:', err);
  res.status(500).json({ error: 'server_error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('[hyphae] PostgreSQL connected');
  } catch (err) {
    console.error('[hyphae] Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[hyphae] Service registry listening on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`[hyphae] ${signal} — shutting down`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start();
