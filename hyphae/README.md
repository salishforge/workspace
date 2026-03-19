# Hyphae Core

**Framework-agnostic coordination platform for multi-agent systems**

Hyphae enables agents built with different frameworks (CrewAI, AutoGen, nanoclaw, OpenClaw, etc.) to discover each other and coordinate work through a standardized RPC protocol.

---

## What is Hyphae?

Hyphae is the **nervous system** for multi-agent AI systems:

1. **Service Registry** — Agents announce themselves and their capabilities
2. **Service Discovery** — Agents find each other by capability or region
3. **RPC Coordination** — Framework-agnostic calling protocol (agents can call other agents)
4. **Audit Trail** — Complete record of all interactions (for troubleshooting + learning)
5. **Emergency Recovery** — System diagnostics + zero-trust recovery operations

### Key Properties

- **Framework-Agnostic**: Works with CrewAI, AutoGen, nanoclaw, OpenClaw, custom agents
- **Transport-Agnostic**: Supports HTTP, NATS, gRPC (you pick based on deployment needs)
- **Zero-Trust**: All operations audited, recovery requires explicit approval + MFA
- **Offline-Capable**: Emergency Recovery Assistant runs with local model (Ollama + Qwen 7B)
- **Production-Ready**: Designed for scale, resilience, security

---

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start HTTP RPC server (port 3100)
npm run dev

# In another terminal, use CLI
npm run cli

# Run tests
npm test
```

### Docker (Recommended)

```bash
# Deploy with docker-compose
docker-compose up -d

# Verify
curl http://localhost:3100/api/health

# CLI
docker-compose exec hyphae-core npm run cli
```

---

## API Endpoints

### Service Registration

```bash
POST /api/services/register

# Register an agent
curl -X POST http://localhost:3100/api/services/register \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "researcher",
    "name": "Research Agent",
    "capabilities": ["research", "investigate"],
    "endpoint": "http://localhost:3006",
    "transport": "http",
    "region": "us-west-2",
    "version": "1.0.0"
  }'
```

### Service Discovery

```bash
GET /api/services

# Discover all services
curl http://localhost:3100/api/services

# Filter by capability
curl http://localhost:3100/api/services?capability=research

# Filter by region
curl http://localhost:3100/api/services?region=us-west-2
```

### RPC Call

```bash
POST /api/rpc/call

# Call another agent
curl -X POST http://localhost:3100/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "analyzer",
    "targetAgent": "researcher",
    "capability": "research",
    "params": {"topic": "AI"},
    "timeout": 30000
  }'
```

### Audit Trail

```bash
GET /api/rpc/audit

# View recent RPC calls
curl http://localhost:3100/api/rpc/audit

# Filter by source agent
curl http://localhost:3100/api/rpc/audit?sourceAgent=analyzer&limit=50
```

---

## CLI Usage

### Interactive Mode

```bash
npm run cli

> register researcher "Research Agent" research investigate
> discover --capability research
> call analyzer researcher research --params '{"topic":"AI"}'
> audit --sourceAgent analyzer
> status
> exit
```

### Command Line

```bash
# Register agent
npm run cli register researcher "Research Agent" research

# Discover services
npm run cli discover --capability research --region us-west-2

# Make RPC call
npm run cli call analyzer researcher research --params '{"topic":"AI"}'

# Query audit
npm run cli audit --sourceAgent analyzer --limit 100

# Check system status
npm run cli status
```

---

## File Structure

```
hyphae/
├── http-rpc-server.ts       # Main HTTP server (registry + RPC + audit)
├── cli.ts                   # CLI interface (registration, discovery, calls, audit)
├── era.ts                   # Emergency Recovery Assistant (diagnostics + recovery)
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── Dockerfile               # Container image
├── docker-compose.yml       # Local deployment
├── .dockerignore            # Docker build optimization
└── tests/
    └── http-rpc-server.test.ts  # Unit tests (20+ test cases)
```

---

## Configuration

### Environment Variables

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hyphae
DB_USER=postgres
DB_PASSWORD=postgres

# Server
PORT=3100
NODE_ENV=development
LOG_LEVEL=info

# ERA (Emergency Recovery Assistant)
ERA_ENABLED=true
ERA_PORT=3101
MFA_ENABLED=true
```

### Docker Compose Override

```bash
# Create .env file
cp .env.example .env

# Edit as needed
nano .env

# Deploy
docker-compose up -d
```

---

## Design Decisions

### Why Framework-Agnostic?

Different frameworks have different strengths:
- **CrewAI**: Great for team-based agents (crews)
- **AutoGen**: Excellent for conversation-based orchestration
- **nanoclaw**: Lightweight, open-source
- **Custom agents**: Built to your specs

Hyphae lets you use the right tool for each agent, then coordinate across frameworks.

### Why Transport-Agnostic?

Different deployments have different needs:
- **HTTP**: Simple, no dependencies, great for dev
- **NATS**: High-throughput, pub/sub patterns, regional
- **gRPC**: Strict RPC, binary protocol, low latency
- **Message Queue**: Guaranteed delivery, resilience

Hyphae tells agents HOW to reach each other, not WHAT to use.

### Why Zero-Trust for Recovery?

When things break, you need to trust the recovery system. Zero-trust means:
- Every write operation requires explicit approval
- MFA prevents unauthorized changes
- All actions logged immutably
- Clear impact review before execution

This prevents cascading failures from turning into disasters.

---

## Deployment

### Local

```bash
docker-compose up -d
curl http://localhost:3100/api/health
```

### VPS (Production)

See [HYPHAE_DEPLOYMENT_GUIDE.md](../HYPHAE_DEPLOYMENT_GUIDE.md) for:
- Full production setup
- Security hardening
- Backup/recovery
- Monitoring
- Troubleshooting

---

## Testing

### Unit Tests

```bash
npm test
```

Covers:
- Service registration (new + update)
- Service discovery (all filters)
- RPC call routing
- Audit logging
- Error handling

### Integration Tests

```bash
npm test -- --integration
```

Tests actual multi-agent coordination:
- Agent A calls Agent B
- Call chains (A→B→C)
- Timeout enforcement
- Audit trail completeness

### Load Testing

```bash
npm run load-test
```

Validates:
- 1000+ req/sec throughput
- <50ms p99 latency
- 0% error rate
- Service discovery performance

---

## API Documentation

Full API documentation available in [HYPHAE_CORE_IMPLEMENTATION.md](../HYPHAE_CORE_IMPLEMENTATION.md)

---

## Next Steps

### Phase 2: Agent Integration

1. Deploy Clio (AutoGen-based) to Hyphae
2. Deploy Flint (CrewAI-based) to Hyphae
3. Test multi-framework coordination

### Phase 3: Production Features

1. HTTPS/TLS
2. Rate limiting + DDoS protection
3. Multi-region federation
4. Disaster recovery automation

---

## Troubleshooting

### Server won't start

```bash
# Check logs
docker-compose logs hyphae-core

# Verify database
psql -h localhost -U postgres -d hyphae -c "SELECT 1"

# Check port
lsof -i :3100
```

### High error rate

```bash
# Query failures
curl "http://localhost:3100/api/rpc/audit?status=FAILED&limit=10"

# Check service health
curl http://localhost:3100/api/services

# Run diagnostics
docker-compose exec hyphae-core npm run era
```

### Slow responses

```bash
# Check database
docker-compose exec postgres psql -U postgres -d hyphae -c "SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 5"

# Check system load
docker stats
```

---

## Contributing

Issues or PRs welcome on GitHub: https://github.com/salishforge/workspace

---

## License

Proprietary - Salish Forge

---

## Questions?

See [HYPHAE_CORE_IMPLEMENTATION.md](../HYPHAE_CORE_IMPLEMENTATION.md) for architecture details.
See [HYPHAE_DEPLOYMENT_GUIDE.md](../HYPHAE_DEPLOYMENT_GUIDE.md) for operational runbooks.
