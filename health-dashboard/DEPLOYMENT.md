# Health Dashboard Deployment

## Quick Start

### 1. Copy Files to VPS

```bash
scp -r health-dashboard/ {VPS_USER}@{VPS_IP}:/home/{VPS_USER}/health-dashboard/
```

### 2. Install Dependencies

```bash
cd /home/{VPS_USER}/health-dashboard
npm install
npm run build
```

### 3. Environment Configuration

Create `.env` file:

```bash
cat > .env << 'EOF'
NATS_URL=nats://localhost:4222
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=tidepool
PG_USER=postgres
PG_PASSWORD=your_postgres_password
PORT=3000
EOF
```

### 4. Start Service

```bash
npm start
```

Or for systemd service:

```bash
# Create systemd service file
sudo cat > /etc/systemd/system/health-dashboard.service << 'EOF'
[Unit]
Description=Tidepool Health Dashboard
After=network.target

[Service]
Type=simple
User=tidepool
WorkingDirectory=/home/tidepool/health-dashboard
ExecStart=/usr/bin/node dist/health.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
EnvironmentFile=/home/tidepool/health-dashboard/.env

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable health-dashboard
sudo systemctl start health-dashboard
sudo systemctl status health-dashboard
```

## Testing

### 1. Health Check Endpoint

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "timestamp": "2026-03-17T21:45:00Z",
  "agents": [
    {
      "agentId": "tidepool-flint",
      "status": "healthy",
      "lastHeartbeat": "2026-03-17T21:44:58Z",
      "heartbeatAge_seconds": 2,
      "metrics": {
        "uptime_seconds": 86400,
        "memory_percent": 45.2,
        "messageLatency_ms": 234
      }
    }
  ],
  "summary": {
    "total": 1,
    "healthy": 1,
    "degraded": 0,
    "dead": 0
  }
}
```

### 2. Metrics Endpoint (Prometheus format)

```bash
curl http://localhost:3000/metrics
```

### 3. Liveness Probe

```bash
curl http://localhost:3000/healthz
```

## Architecture

The health dashboard:

1. **Connects to NATS** — Subscribes to `sf.agent.*.heartbeat` topics
2. **Connects to PostgreSQL** — Queries agent registry and audit logs
3. **Tracks agent status** — Based on heartbeat freshness (30s timeout)
4. **Calculates metrics** — Message latency from audit logs
5. **Exposes REST API** — GET /health for status, /metrics for Prometheus, /healthz for K8s probes

## Dependencies

- **Node.js** >= 18
- **NATS** running on localhost:4222 (or configured NATS_URL)
- **PostgreSQL** running on localhost:5432 (or configured PG_*)

## Logs

View service logs:

```bash
sudo journalctl -u health-dashboard -f
```

Or check application logs directly:

```bash
npm start 2>&1 | tee dashboard.log
```

## Health Check Status Codes

| Status | Meaning |
|--------|---------|
| **healthy** | Heartbeat within 15s, latency < 1s |
| **degraded** | Heartbeat within 30s, latency > 1s |
| **dead** | Heartbeat older than 30s |

## Troubleshooting

### "Cannot connect to NATS"
- Verify NATS_URL is correct
- Check NATS server is running: `nats-cli` or check logs

### "Cannot connect to PostgreSQL"
- Verify PG_* environment variables
- Check PostgreSQL is running: `psql -h localhost -U postgres -d tidepool`
- Verify agents table exists: `SELECT COUNT(*) FROM agents;`

### Endpoint returns 503
- Check database connectivity
- Check NATS connectivity
- Review logs: `journalctl -u health-dashboard -f`

## Integration with Monitoring

Use the `/metrics` endpoint with Prometheus:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'health-dashboard'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

Then query agent health:

```promql
agents_health{agent_id="tidepool-flint"} == 0  # healthy
agents_health{agent_id="tidepool-flint"} == 2  # dead
```
