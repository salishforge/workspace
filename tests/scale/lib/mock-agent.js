/**
 * Mock Agent — simulates a realistic AI agent workload against Salish Forge services
 *
 * Each agent lifecycle:
 *   1. Authenticate via OAuth2 client_credentials
 *   2. Register with Hyphae service registry
 *   3. Run workload loop: memory queries/writes, heartbeats, scope validation
 *   4. Refresh token before expiry
 *   5. Deregister from Hyphae on shutdown
 */

import { randomUUID } from 'crypto';

// Realistic memory content pool for queries/writes
const MEMORY_QUERIES = [
  'what tasks did I complete yesterday',
  'summarize recent user interactions',
  'retrieve last deployment configuration',
  'find relevant context for authentication flow',
  'what is the current project status',
  'locate performance optimization notes',
  'retrieve architecture decision history',
  'find recent error patterns in logs',
  'summarize team communication threads',
  'retrieve API integration guidelines',
  'what are the current security policies',
  'find database migration history',
  'retrieve code review feedback',
  'summarize recent feature requests',
  'find relevant documentation for OAuth2',
];

const MEMORY_EVENTS = [
  { type: 'task_completed', category: 'work',    importance: 0.7 },
  { type: 'error_observed', category: 'system',  importance: 0.9 },
  { type: 'user_message',   category: 'social',  importance: 0.5 },
  { type: 'decision_made',  category: 'work',    importance: 0.8 },
  { type: 'file_processed', category: 'work',    importance: 0.4 },
  { type: 'api_called',     category: 'system',  importance: 0.3 },
  { type: 'context_switch', category: 'work',    importance: 0.6 },
];

const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh when <60s remaining

// ─── MockAgent ───────────────────────────────────────────────────────────────

export class MockAgent {
  constructor(id, config) {
    this.id = id;
    this.agentId = `mock-agent-${id}-${randomUUID().slice(0, 8)}`;
    this.config = config;

    this.token = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.serviceId = null;

    this.metrics = config.metrics; // MetricsRegistry reference
    this.isRunning = false;
    this._workloadTimer = null;
    this._heartbeatTimer = null;
    this._consolidateTimer = null;

    // Per-agent stats (lightweight, aggregated into metrics registry)
    this.stats = {
      requests: 0,
      errors: 0,
      tokenRefreshes: 0,
      memoryWrites: 0,
      memoryQueries: 0,
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start() {
    this.isRunning = true;
    try {
      await this._authenticate();
      await this._registerService();
      this._startWorkloadLoop();
      this._startHeartbeatLoop();
      this._startConsolidationLoop();
    } catch (err) {
      this.isRunning = false;
      throw err;
    }
  }

  async stop() {
    this.isRunning = false;
    clearInterval(this._workloadTimer);
    clearInterval(this._heartbeatTimer);
    clearInterval(this._consolidateTimer);

    try {
      if (this.serviceId) await this._deregisterService();
    } catch (_) { /* best effort */ }
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  async _authenticate() {
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.oauth2Url}/oauth2/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'client_credentials',
            client_id:     this.config.clientId,
            client_secret: this.config.clientSecret,
            scope:         'memory:read memory:write hyphae:read hyphae:admin',
          }),
        }
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 120)}`);
      }

      const data = await resp.json();
      this.token = data.access_token;
      this.refreshToken = data.refresh_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

      const latency = Date.now() - start;
      this.metrics.latency.tokenGeneration.record(latency);
      this.metrics.throughput.total.inc();
      this.metrics.throughput.tokenGeneration.inc();
      this.stats.tokenRefreshes++;
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('token_generation', _errorType(err));
      throw err;
    }
  }

  async _refreshTokenIfNeeded() {
    if (Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) return;
    if (!this.refreshToken) {
      await this._authenticate();
      return;
    }

    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.oauth2Url}/oauth2/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: this.refreshToken,
            client_id:     this.config.clientId,
            client_secret: this.config.clientSecret,
          }),
        }
      );

      if (!resp.ok) {
        // Refresh token may be expired; fall back to full auth
        await this._authenticate();
        return;
      }

      const data = await resp.json();
      this.token = data.access_token;
      if (data.refresh_token) this.refreshToken = data.refresh_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

      const latency = Date.now() - start;
      this.metrics.latency.tokenRefresh.record(latency);
      this.metrics.throughput.total.inc();
      this.metrics.throughput.tokenGeneration.inc();
      this.stats.tokenRefreshes++;
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('token_refresh', _errorType(err));
      // Fall back to full authentication
      await this._authenticate();
    }
  }

  // ─── Service Registry ─────────────────────────────────────────────────────

  async _registerService() {
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.hyphaeUrl}/services`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            name:         this.agentId,
            description:  `Mock agent ${this.id} (scale test)`,
            capabilities: ['memory:read', 'memory:write', 'task:execute'],
            metadata: {
              agentType:   'mock',
              testRun:     true,
              createdAt:   new Date().toISOString(),
            },
          }),
        }
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 120)}`);
      }

      const data = await resp.json();
      this.serviceId = data.id ?? data.serviceId ?? this.agentId;

      const latency = Date.now() - start;
      this.metrics.latency.serviceRegistration.record(latency);
      this.metrics.throughput.total.inc();
      this.metrics.throughput.serviceOps.inc();
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('service_registration', _errorType(err));
      // Non-fatal: continue without service registration
    }
  }

  async _deregisterService() {
    if (!this.serviceId) return;
    const start = Date.now();
    this.metrics.errors.recordRequest();

    try {
      const resp = await this._fetch(
        `${this.config.hyphaeUrl}/services/${this.serviceId}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${this.token}` },
        }
      );

      if (resp.ok) {
        const latency = Date.now() - start;
        this.metrics.latency.serviceDeregistration.record(latency);
        this.metrics.throughput.total.inc();
        this.metrics.throughput.serviceOps.inc();
      }
    } catch (_) { /* best effort deregistration */ }
  }

  async _sendHeartbeat() {
    if (!this.serviceId) return;
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.hyphaeUrl}/services/${this.serviceId}/heartbeat`,
        {
          method: 'PUT',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          body: JSON.stringify({ status: 'healthy', load: Math.random() }),
        }
      );

      if (resp.ok) {
        const latency = Date.now() - start;
        this.metrics.latency.serviceHeartbeat.record(latency);
        this.metrics.throughput.total.inc();
        this.metrics.throughput.serviceOps.inc();
      } else {
        this.metrics.errors.recordError('heartbeat', `${resp.status}`);
      }
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('heartbeat', _errorType(err));
    }
  }

  async _discoverServices() {
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.hyphaeUrl}/services`,
        {
          headers: { 'Authorization': `Bearer ${this.token}` },
        }
      );

      if (resp.ok) {
        await resp.json(); // consume body
        const latency = Date.now() - start;
        this.metrics.latency.serviceDiscovery.record(latency);
        this.metrics.throughput.total.inc();
        this.metrics.throughput.serviceOps.inc();
      } else {
        this.metrics.errors.recordError('service_discovery', `${resp.status}`);
      }
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('service_discovery', _errorType(err));
    }
  }

  // ─── Memory Operations ────────────────────────────────────────────────────

  async _writeMemory() {
    const event = MEMORY_EVENTS[Math.floor(Math.random() * MEMORY_EVENTS.length)];
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.memforgeUrl}/memory/${this.agentId}/add`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            content: `[scale-test] Agent ${this.agentId} event: ${event.type} at ${new Date().toISOString()}`,
            metadata: {
              type:       event.type,
              category:   event.category,
              importance: event.importance,
              agentId:    this.agentId,
            },
          }),
        }
      );

      if (resp.ok) {
        const latency = Date.now() - start;
        this.metrics.latency.memoryWrite.record(latency);
        this.metrics.throughput.total.inc();
        this.metrics.throughput.memoryOps.inc();
        this.stats.memoryWrites++;
      } else {
        const body = await resp.text();
        this.metrics.errors.recordError('memory_write', `${resp.status}`);
      }
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('memory_write', _errorType(err));
    }
  }

  async _queryMemory() {
    const query = MEMORY_QUERIES[Math.floor(Math.random() * MEMORY_QUERIES.length)];
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const url = `${this.config.memforgeUrl}/memory/${this.agentId}/query?q=${encodeURIComponent(query)}&limit=10`;
      const resp = await this._fetch(url, {
        headers: { 'Authorization': `Bearer ${this.token}` },
      });

      if (resp.ok) {
        await resp.json(); // consume body
        const latency = Date.now() - start;
        this.metrics.latency.memoryQuery.record(latency);
        this.metrics.throughput.total.inc();
        this.metrics.throughput.memoryOps.inc();
        this.stats.memoryQueries++;
      } else {
        this.metrics.errors.recordError('memory_query', `${resp.status}`);
      }
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('memory_query', _errorType(err));
    }
  }

  async _validateScope() {
    if (!this.token) return;
    const start = Date.now();
    this.metrics.errors.recordRequest();
    this.stats.requests++;

    try {
      const resp = await this._fetch(
        `${this.config.oauth2Url}/oauth2/introspect`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          },
          body: new URLSearchParams({ token: this.token }),
        }
      );

      if (resp.ok) {
        const latency = Date.now() - start;
        this.metrics.latency.scopeValidation.record(latency);
        this.metrics.throughput.total.inc();
      } else {
        this.metrics.errors.recordError('scope_validation', `${resp.status}`);
      }
    } catch (err) {
      this.stats.errors++;
      this.metrics.errors.recordError('scope_validation', _errorType(err));
    }
  }

  // ─── Workload Loops ───────────────────────────────────────────────────────

  _startWorkloadLoop() {
    // Randomize initial jitter so agents don't all fire at once
    const jitter = Math.random() * this.config.workloadIntervalMs;
    setTimeout(() => {
      this._workloadTimer = setInterval(() => this._runWorkloadCycle(), this.config.workloadIntervalMs);
    }, jitter);
  }

  async _runWorkloadCycle() {
    if (!this.isRunning) return;

    try {
      await this._refreshTokenIfNeeded();

      // Weighted random operation selection
      const roll = Math.random();
      if      (roll < 0.40) await this._queryMemory();    // 40%
      else if (roll < 0.70) await this._writeMemory();    // 30%
      else if (roll < 0.80) await this._discoverServices(); // 10%
      else if (roll < 0.90) await this._validateScope();   // 10%
      // 10% idle — simulates think time
    } catch (_) { /* individual op failure is recorded in metrics */ }
  }

  _startHeartbeatLoop() {
    this._heartbeatTimer = setInterval(() => {
      if (this.isRunning) this._sendHeartbeat().catch(() => {});
    }, this.config.heartbeatIntervalMs ?? 15_000);
  }

  _startConsolidationLoop() {
    // Consolidation is a background/expensive operation; trigger occasionally
    const interval = this.config.consolidationIntervalMs ?? 120_000;
    this._consolidateTimer = setInterval(async () => {
      if (!this.isRunning || !this.token) return;
      const start = Date.now();
      this.metrics.errors.recordRequest();
      try {
        const resp = await this._fetch(
          `${this.config.memforgeUrl}/memory/${this.agentId}/consolidate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.token}` },
          }
        );
        if (resp.ok) {
          this.metrics.latency.memoryConsolidate.record(Date.now() - start);
          this.metrics.throughput.total.inc();
          this.metrics.throughput.memoryOps.inc();
        }
      } catch (_) {}
    }, interval + Math.random() * interval); // stagger consolidation triggers
  }

  // ─── HTTP helper ──────────────────────────────────────────────────────────

  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeoutMs ?? 10_000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error('Request timed out');
        e.type = 'timeout';
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function _errorType(err) {
  if (err.type === 'timeout') return 'timeout';
  if (err.code === 'ECONNREFUSED') return 'connection_refused';
  if (err.code === 'ECONNRESET') return 'connection_reset';
  if (err.code === 'ETIMEDOUT') return 'network_timeout';
  return 'error';
}
