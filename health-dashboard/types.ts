/**
 * Health Dashboard Type Definitions
 */

export interface AgentHeartbeat {
  agentId: string;
  timestamp: string;
  uptime_seconds?: number;
  memory_percent?: number;
  metadata?: Record<string, any>;
}

export interface AgentMetrics {
  uptime_seconds: number;
  memory_percent: number;
  messageLatency_ms: number;
}

export type AgentHealthStatus = 'healthy' | 'degraded' | 'dead';

export interface AgentStatus {
  agentId: string;
  status: AgentHealthStatus;
  lastHeartbeat: string; // ISO8601
  heartbeatAge_seconds: number;
  metrics: AgentMetrics;
}

export interface HealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  dead: number;
}

export interface HealthResponse {
  timestamp: string; // ISO8601
  agents: AgentStatus[];
  summary: HealthSummary;
}

export interface HealthCheckError extends HealthResponse {
  error: string;
}

export interface LivenessResponse {
  status: 'alive' | 'dead';
  error?: string;
}

export interface DashboardConfig {
  natsUrl: string;
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  port?: number;
  heartbeatTimeoutSeconds?: number;
  degradedThresholdMs?: number;
}
