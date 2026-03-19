# Health Dashboard

Real-time health monitoring for Tidepool agents.

## Overview

The Health Dashboard provides an Express.js REST API that monitors the status of Tidepool agents by:

1. Querying NATS for agent heartbeats
2. Querying PostgreSQL for message latency metrics
3. Determining agent health (healthy/degraded/dead)
4. Exposing health status via REST API and Prometheus metrics

## Quick Start

```bash
npm install
npm run build
npm start
```

Endpoint: `GET http://localhost:3000/health`

## API Endpoints

### GET /health

Returns agent health status and summary.

Response:
```json
{
  "timestamp": "2026-03-17T21:45:00Z",
  "agents": [...],
  "summary": {
    "total": 1,
    "healthy": 1,
    "degraded": 0,
    "dead": 0
  }
}
```

### GET /metrics

Prometheus-format metrics for monitoring.

### GET /healthz

Kubernetes liveness probe (simple alive/dead).

## Configuration

Set environment variables:

```
NATS_URL=nats://localhost:4222
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=tidepool
PG_USER=postgres
PG_PASSWORD=secret
PORT=3000
```

## Agent Health Status

| Status | Condition |
|--------|-----------|
| **healthy** | Heartbeat < 15s old, message latency < 1s |
| **degraded** | Heartbeat < 30s old, message latency > 1s |
| **dead** | Heartbeat > 30s old |

## Deployment

See `DEPLOYMENT.md` for detailed VPS deployment instructions.

## Architecture

```
GET /health
    ↓
Connect to NATS (if not connected)
    ↓
Query PostgreSQL agents table
    ↓
For each agent:
  - Check last_activity timestamp → heartbeat age
  - Query audit logs → message latency
  - Determine status (healthy/degraded/dead)
    ↓
Return JSON response + summary
```

## Integration

Use with monitoring systems:

- **Prometheus**: Scrape `/metrics` endpoint
- **Kubernetes**: Use `/healthz` as liveness probe
- **Custom**: Poll `/health` and parse JSON

## Development

```bash
# Watch mode
npm run dev

# Build TypeScript
npm run build

# Run built version
npm start
```

## License

MIT
