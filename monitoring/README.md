# Salish Forge — Platform Observability

Prometheus metrics, OpenAPI documentation, Grafana dashboards, and alert rules for the Tidepool / MemForge / Health Dashboard platform.

---

## Metrics Endpoints

| Service | Port | Metrics URL |
|---------|------|-------------|
| Tidepool (mgmt) | 3004 | `GET /metrics` |
| MemForge | 3333 | `GET /metrics` |
| Health Dashboard | 3000 | `GET /metrics` |

### Exposed Metrics

#### All Services
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency (buckets: 5ms–5s) |
| `<prefix>_process_resident_memory_bytes` | Gauge | — | Process RSS memory |
| `<prefix>_process_uptime_seconds` | Gauge | — | Process uptime |
| `<prefix>_nodejs_*` | Various | — | Node.js runtime metrics (GC, event loop, heap) |

Prefixes: `tidepool_`, `memforge_`, `dashboard_`

#### MemForge-specific
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `database_pool_connections` | Gauge | `state` (total\|idle\|waiting) | PostgreSQL pool state |

#### Tidepool-specific
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `service_registry_size` | Gauge | — | Number of registered groups |

#### Health Dashboard-specific
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `agents_health` | Gauge | `agent_id`, `status` | Agent health (0=healthy, 1=degraded, 2=dead) |
| `agent_heartbeat_age_seconds` | Gauge | `agent_id` | Seconds since last heartbeat |
| `agent_message_latency_ms` | Gauge | `agent_id` | Avg message latency (ms) |

---

## OpenAPI / Swagger

| Service | Spec | Swagger UI |
|---------|------|------------|
| Tidepool | `GET :3004/api/spec.json` | `GET :3004/api/docs` |
| MemForge | `GET :3333/api/spec.json` | `GET :3333/api/docs` |
| Health Dashboard | `GET :3000/api/spec.json` | `GET :3000/api/docs` |

Swagger UI loads from CDN (`unpkg.com/swagger-ui-dist@5`) — requires internet access.

---

## Grafana Dashboard

File: `monitoring/grafana-dashboard.json`

### Import
1. Open Grafana → Dashboards → Import
2. Upload `grafana-dashboard.json`
3. Select your Prometheus data source when prompted

### Panels
- Request rate (per service, per route)
- p50 / p95 / p99 latency
- Error rate (5xx) and client error rate (4xx)
- Process memory RSS and uptime
- MemForge DB pool connections
- Tidepool service registry size
- Agent health gauges

---

## Prometheus Scrape Config

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: tidepool
    static_configs:
      - targets: ['localhost:3004']
    metrics_path: /metrics

  - job_name: memforge
    static_configs:
      - targets: ['localhost:3333']
    metrics_path: /metrics

  - job_name: dashboard
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics

rule_files:
  - /path/to/monitoring/alert-rules.yml
```

---

## Alert Rules

File: `monitoring/alert-rules.yml`

| Alert | Threshold | Severity | Description |
|-------|-----------|----------|-------------|
| `HighLatency` | p95 > 200ms for 2m | warning | Request latency too high |
| `HighErrorRate` | 5xx > 1% for 1m | critical | Error rate exceeding SLO |
| `HighClientErrorRate` | 4xx > 5% for 5m | warning | Unusual client error rate |
| `ServiceDown` | `up == 0` for 1m | critical | Target unreachable > 60s |
| `HighMemoryUsage` | RSS > 512MB for 5m | warning | Process memory bloat |
| `DBPoolExhausted` | waiting > 0 for 2m | warning | PostgreSQL pool pressure |
| `AgentDead` | health == 2 for 2m | warning | Agent heartbeat timeout |

---

## Local Testing

```bash
# Verify metrics endpoint
curl http://localhost:3333/metrics | head -30

# Check Prometheus format
curl -s http://localhost:3333/metrics | grep '^http_requests_total'

# View Swagger UI (open in browser)
open http://localhost:3333/api/docs
open http://localhost:3000/api/docs
open http://localhost:3004/api/docs
```
