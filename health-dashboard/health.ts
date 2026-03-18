import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import {
  registry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  agentsHealth,
  agentHeartbeatAge,
  agentMessageLatency,
} from './metrics.js';

// ── OAuth2 scope enforcement ───────────────────────────────────────────────────

const INTROSPECT_URL =
  process.env['OAUTH2_INTROSPECT_URL'] ?? 'http://localhost:3005/oauth2/introspect';

interface TokenInfo {
  active: boolean;
  client_id: string;
  scope: string;
  cachedAt: number;
}
const TOKEN_CACHE = new Map<string, TokenInfo>();
const CACHE_TTL_MS = 30_000;

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of TOKEN_CACHE) {
    if (now - entry.cachedAt > CACHE_TTL_MS) TOKEN_CACHE.delete(token);
  }
}, 60_000).unref();

async function getTokenInfo(token: string): Promise<TokenInfo | null> {
  const cached = TOKEN_CACHE.get(token);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;
  try {
    const resp = await fetch(INTROSPECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await resp.json()) as TokenInfo;
    TOKEN_CACHE.set(token, { ...data, cachedAt: Date.now() });
    return data;
  } catch {
    return null;
  }
}

async function requireScopeHandler(
  requiredScope: string,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'] as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
    return;
  }
  const token = authHeader.slice(7);
  const info = await getTokenInfo(token);
  if (!info?.active) {
    res.status(401).json({ error: 'invalid_token', error_description: 'Token expired or revoked' });
    return;
  }
  const scopes = info.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (!scopes.includes(requiredScope)) {
    console.warn(
      `[dashboard:scope] DENIED client=${info.client_id} required=${requiredScope} granted=${info.scope} ${req.method} ${req.path}`,
    );
    res.status(403).json({ error: 'insufficient_scope', required_scope: requiredScope });
    return;
  }
  next();
}

interface AgentStatus {
  agentId: string;
  status: 'healthy' | 'degraded' | 'dead';
  lastHeartbeat: string;
  heartbeatAge_seconds: number;
  metrics: {
    uptime_seconds: number;
    memory_percent: number;
    messageLatency_ms: number;
  };
}

interface HealthResponse {
  timestamp: string;
  agents: AgentStatus[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    dead: number;
  };
}

const HEARTBEAT_TIMEOUT_SECONDS = 30;

// ── OpenAPI spec ──────────────────────────────────────────────────────────────

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Health Dashboard API',
    version: '0.1.0',
    description: 'Real-time agent health monitoring and Prometheus metrics export.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  tags: [
    { name: 'Health', description: 'Agent health status' },
    { name: 'System', description: 'Observability endpoints' },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Agent health status',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'Health summary for all agents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'string', format: 'date-time' },
                    agents: {
                      type: 'array',
                      items: { '$ref': '#/components/schemas/AgentStatus' },
                    },
                    summary: { '$ref': '#/components/schemas/HealthSummary' },
                  },
                },
              },
            },
          },
          '503': {
            description: 'Health check failed (database unreachable)',
            content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Prometheus metrics',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Prometheus text format metrics',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/healthz': {
      get: {
        summary: 'Kubernetes liveness probe',
        tags: ['System'],
        responses: {
          '200': { description: 'Service is alive' },
          '503': { description: 'Service is dead (database unreachable)' },
        },
      },
    },
    '/api/spec.json': {
      get: {
        summary: 'OpenAPI 3.0 specification',
        tags: ['System'],
        responses: {
          '200': { description: 'OpenAPI spec JSON' },
        },
      },
    },
    '/api/docs': {
      get: {
        summary: 'Interactive Swagger UI',
        tags: ['System'],
        responses: {
          '200': { description: 'HTML page' },
        },
      },
    },
  },
  components: {
    schemas: {
      AgentStatus: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          status: { type: 'string', enum: ['healthy', 'degraded', 'dead'] },
          lastHeartbeat: { type: 'string', format: 'date-time' },
          heartbeatAge_seconds: { type: 'number' },
          metrics: {
            type: 'object',
            properties: {
              uptime_seconds: { type: 'number' },
              memory_percent: { type: 'number' },
              messageLatency_ms: { type: 'number' },
            },
          },
        },
      },
      HealthSummary: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          healthy: { type: 'integer' },
          degraded: { type: 'integer' },
          dead: { type: 'integer' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

// ── Swagger UI HTML ───────────────────────────────────────────────────────────

function swaggerUiHtml(specUrl: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    });
  </script>
</body>
</html>`;
}

export class HealthDashboard {
  private pg: Pool;
  private app: express.Application;

  constructor(pgConfig: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  }) {
    this.pg = new Pool(pgConfig);
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      res.on('finish', () => {
        const route = (req.route?.path as string | undefined) ?? req.path;
        const labels = {
          method: req.method,
          route,
          status_code: String(res.statusCode),
        };
        httpRequestsTotal.inc(labels);
        httpRequestDurationSeconds.observe(labels, (Date.now() - start) / 1000);
      });
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/health', this.handleHealthCheck.bind(this));
    this.app.get(
      '/metrics',
      (req, res, next) => requireScopeHandler('system:admin', req, res, next),
      this.handleMetrics.bind(this),
    );
    this.app.get('/healthz', this.handleLiveness.bind(this));
    this.app.get('/api/spec.json', (_req, res) => res.json(openApiSpec));
    this.app.get('/api/docs', (_req, res) =>
      res.type('html').send(swaggerUiHtml('/api/spec.json', 'Health Dashboard API Docs')),
    );
    // Display granted scopes for the calling client (requires valid token)
    this.app.get('/api/scopes', this.handleScopesCheck.bind(this));
  }

  private async handleHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const agents = await this.getAgentHeartbeats();
      const response = this.buildHealthResponse(agents);
      res.json(response);
    } catch (error) {
      console.error('Error in health check:', error);
      res.status(503).json({
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        agents: [],
        summary: { total: 0, healthy: 0, degraded: 0, dead: 0 },
      });
    }
  }

  private async getAgentHeartbeats(): Promise<AgentStatus[]> {
    const agents: AgentStatus[] = [];
    const now = new Date();

    try {
      const result = await this.pg.query(
        `SELECT id as agent_id, last_activity FROM agents ORDER BY id`
      );

      for (const row of result.rows) {
        const agentId = row.agent_id;
        const lastActivity = new Date(row.last_activity);
        const ageSeconds = (now.getTime() - lastActivity.getTime()) / 1000;

        let status: 'healthy' | 'degraded' | 'dead';
        if (ageSeconds > HEARTBEAT_TIMEOUT_SECONDS) {
          status = 'dead';
        } else if (ageSeconds > HEARTBEAT_TIMEOUT_SECONDS / 2) {
          status = 'degraded';
        } else {
          status = 'healthy';
        }

        const latency = await this.getMessageLatency(agentId);

        agents.push({
          agentId,
          status,
          lastHeartbeat: lastActivity.toISOString(),
          heartbeatAge_seconds: Math.round(ageSeconds),
          metrics: {
            uptime_seconds: Math.round(ageSeconds),
            memory_percent: 0,
            messageLatency_ms: Math.round(latency),
          },
        });
      }
    } catch (error) {
      console.error('Error querying agents:', error);
    }

    return agents;
  }

  private async getMessageLatency(agentId: string): Promise<number> {
    try {
      const result = await this.pg.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (created_at - timestamp))) * 1000 as avg_latency_ms
         FROM audit_log
         WHERE actor = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
        [agentId]
      );

      return result.rows[0]?.avg_latency_ms || 0;
    } catch (error) {
      console.error(`Error querying latency for ${agentId}:`, error);
      return 0;
    }
  }

  private buildHealthResponse(agents: AgentStatus[]): HealthResponse {
    const summary = {
      total: agents.length,
      healthy: agents.filter((a) => a.status === 'healthy').length,
      degraded: agents.filter((a) => a.status === 'degraded').length,
      dead: agents.filter((a) => a.status === 'dead').length,
    };

    return {
      timestamp: new Date().toISOString(),
      agents,
      summary,
    };
  }

  private async handleMetrics(req: Request, res: Response): Promise<void> {
    // Refresh agent gauge metrics from current state
    try {
      const agents = await this.getAgentHeartbeats();
      agentsHealth.reset();
      agentHeartbeatAge.reset();
      agentMessageLatency.reset();

      for (const agent of agents) {
        const statusValue = { healthy: 0, degraded: 1, dead: 2 }[agent.status];
        agentsHealth.set({ agent_id: agent.agentId, status: agent.status }, statusValue);
        agentHeartbeatAge.set({ agent_id: agent.agentId }, agent.heartbeatAge_seconds);
        agentMessageLatency.set(
          { agent_id: agent.agentId },
          agent.metrics.messageLatency_ms
        );
      }
    } catch {
      // non-fatal — return whatever metrics we have
    }

    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }

  private async handleScopesCheck(req: Request, res: Response): Promise<void> {
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
      return;
    }
    const token = authHeader.slice(7);
    const info = await getTokenInfo(token);
    if (!info?.active) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    res.json({
      client_id: info.client_id,
      granted_scopes: info.scope?.split(/\s+/).filter(Boolean) ?? [],
    });
  }

  private async handleLiveness(req: Request, res: Response): Promise<void> {
    try {
      await this.pg.query('SELECT 1');
      res.json({ status: 'alive' });
    } catch (error) {
      res.status(503).json({ status: 'dead', error: String(error) });
    }
  }

  async start(port: number = 3000): Promise<void> {
    this.app.listen(port, () => {
      console.log(`Health dashboard listening on port ${port}`);
    });
  }

  async stop(): Promise<void> {
    await this.pg.end();
  }
}

// CLI entry point
const dashboard = new HealthDashboard({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'tidepool',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
});

dashboard.start(parseInt(process.env.PORT || '3000'));

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  dashboard.stop().then(() => process.exit(0));
});
