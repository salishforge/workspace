// Health Dashboard — Prometheus metrics registry
//
// Exposes:
//   http_requests_total           counter   (method, route, status_code)
//   http_request_duration_seconds histogram (method, route, status_code)
//   process_memory_bytes          gauge     (via collectDefaultMetrics)
//   process_uptime_seconds        gauge     (via collectDefaultMetrics)
//   agents_health                 gauge     (agent_id, status)
//   agent_heartbeat_age_seconds   gauge     (agent_id)
//   agent_message_latency_ms      gauge     (agent_id)

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'dashboard_' });

// ── HTTP metrics ──────────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ── Agent health metrics ──────────────────────────────────────────────────────

export const agentsHealth = new Gauge({
  name: 'agents_health',
  help: 'Agent health status: 0=healthy, 1=degraded, 2=dead',
  labelNames: ['agent_id', 'status'] as const,
  registers: [registry],
});

export const agentHeartbeatAge = new Gauge({
  name: 'agent_heartbeat_age_seconds',
  help: 'Seconds since last heartbeat for each agent',
  labelNames: ['agent_id'] as const,
  registers: [registry],
});

export const agentMessageLatency = new Gauge({
  name: 'agent_message_latency_ms',
  help: 'Average message processing latency in milliseconds',
  labelNames: ['agent_id'] as const,
  registers: [registry],
});
