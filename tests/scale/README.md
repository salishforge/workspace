# Scale Testing — Salish Forge v1.2.0

Validates that the platform handles 100+ concurrent agents with realistic workloads.

## Quick Start

```bash
# Start services
docker-compose up -d

# Set credentials
export CLIENT_ID=sf-test-client
export CLIENT_SECRET=your-secret

# Run baseline (10 agents, 10 minutes)
cd tests/scale
node runner.js --scenario baseline

# Generate report
node lib/reporter.js --latest
```

## Scenarios

| Scenario | Agents | Duration | Purpose |
|----------|--------|----------|---------|
| `baseline` | 10 | 10 min | Reference metrics at minimal load |
| `linear-scale` | 25→50→100→150 | 40 min | Latency/error scaling analysis |
| `peak-burst` | 100→150→100 | 30 min | Spike handling validation |
| `sustained` | 100 | 1 hour | Memory leak + degradation detection |
| `all` | sequential | ~1h 40m | Full suite |

## Each Mock Agent Simulates

- **OAuth2 auth** — token acquisition via client_credentials
- **Service registration** — registers with Hyphae on startup
- **Memory workload** — 40% queries, 30% writes, 10% service discovery, 10% scope validation, 10% idle
- **Heartbeats** — every 15 seconds
- **Token refresh** — before expiry (60s buffer)
- **Deregistration** — graceful shutdown from Hyphae

## K6 Tests (endpoint-level)

Install K6: https://k6.io/docs/getting-started/installation/

```bash
# Token generation test
k6 run --env CLIENT_ID=sf-test-client \
        --env CLIENT_SECRET=secret \
        --env BASE_URL=http://localhost:3005 \
        k6/token-generation.js

# Memory queries test
k6 run --env CLIENT_ID=sf-test-client \
        --env CLIENT_SECRET=secret \
        --env OAUTH2_URL=http://localhost:3005 \
        --env BASE_URL=http://localhost:3001 \
        k6/memory-queries.js

# Service registry test
k6 run --env CLIENT_ID=sf-test-client \
        --env CLIENT_SECRET=secret \
        --env OAUTH2_URL=http://localhost:3005 \
        --env HYPHAE_URL=http://localhost:3006 \
        k6/service-registry.js

# Full agent lifecycle (most realistic)
k6 run --env CLIENT_ID=sf-test-client \
        --env CLIENT_SECRET=secret \
        --env OAUTH2_URL=http://localhost:3005 \
        --env HYPHAE_URL=http://localhost:3006 \
        --env MEMFORGE_URL=http://localhost:3001 \
        k6/full-agent-lifecycle.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIENT_ID` | *(required)* | OAuth2 client ID |
| `CLIENT_SECRET` | *(required)* | OAuth2 client secret |
| `OAUTH2_URL` | http://localhost:3005 | OAuth2 server base URL |
| `HYPHAE_URL` | http://localhost:3006 | Hyphae service registry URL |
| `MEMFORGE_URL` | http://localhost:3001 | MemForge memory service URL |

## CLI Overrides

```bash
# Override agent count or duration for quick smoke tests
node runner.js --scenario baseline --agents 5 --duration 60
```

## Output

- **JSON results**: `tests/scale/results/<scenario>-<timestamp>.json`
- **Markdown report**: `tests/scale/reports/scale-test-report-<timestamp>.md`
- **CSV export**: `tests/scale/reports/scale-test-metrics-<timestamp>.csv`

## Success Criteria (v1.2.0)

| Metric | Target |
|--------|--------|
| Error rate | <0.1% |
| Memory query p99 | <100ms |
| Token generation p99 | <100ms |
| Memory write p99 | <150ms |
| Service registration p99 | <200ms |
| Cache hit rate | >70% |
| Heap growth (1h) | <100MB |
| DB connections | ≤ pool size |

## Distributed Load

For multi-machine testing, set environment variables to point to the VPS:

```bash
export OAUTH2_URL=http://100.97.161.7:3005
export HYPHAE_URL=http://100.97.161.7:3006
export MEMFORGE_URL=http://100.97.161.7:3001
```

Or use K6 Cloud / K6 distributed execution for true distributed load.

## File Structure

```
tests/scale/
├── runner.js              # CLI entry point
├── lib/
│   ├── mock-agent.js      # Single agent simulation
│   ├── agent-pool.js      # N-agent pool manager
│   ├── metrics.js         # Histogram, counters, registry
│   └── reporter.js        # Report generation + CSV export
├── scenarios/
│   ├── baseline.js        # 10 agents, 10 minutes
│   ├── linear-scale.js    # 25→50→100→150 agents
│   ├── peak-burst.js      # 100 + 50% spike
│   └── sustained.js       # 1 hour sustained
├── k6/
│   ├── token-generation.js     # OAuth2 token endpoint
│   ├── memory-queries.js        # MemForge read/write
│   ├── service-registry.js     # Hyphae register/heartbeat
│   └── full-agent-lifecycle.js # Complete agent simulation
├── results/               # JSON test results (gitignored)
└── reports/               # Generated reports (gitignored)
```
