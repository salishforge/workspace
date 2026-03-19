# Hyphae Core Implementation

**Status:** Phase 1 Complete - HTTP RPC Layer  
**Date:** March 19, 2026  
**Author:** Flint (CTO)

---

## Overview

Hyphae Core is the framework-agnostic coordination platform for multi-agent systems.

This document describes the Phase 1 implementation: HTTP RPC layer that enables agents to discover each other and communicate.

---

## Architecture

### Core Components

```
Hyphae HTTP RPC Server
├── Service Registry (agents register)
├── Service Discovery (find agents by capability/region)
├── RPC Coordination Layer (route calls between agents)
├── Audit Trail (log all interactions)
└── Relationship Tracking (build agent interaction graph)

Interfaces:
├── HTTP REST API (for agent registration + RPC calls)
├── PostgreSQL Database (persist registry + audit + relationships)
└── CLI Tool (human interaction)
```

### Database Schema

**hyphae_services** (Service Registry)
```sql
- id (UUID, primary key)
- agent_id (VARCHAR, unique) - "researcher", "analyzer", etc.
- name (VARCHAR) - Human-readable name
- capabilities (TEXT[]) - ["research", "investigate"]
- endpoint (VARCHAR) - Where to reach this agent
- transport (VARCHAR) - "http", "nats", "grpc"
- region (VARCHAR) - "us-west-2", "us-east-1", etc.
- version (VARCHAR) - Agent version
- metadata (JSONB) - Custom attributes (model, framework, etc.)
- registered_at (TIMESTAMP) - Registration time
- last_heartbeat (TIMESTAMP) - Last activity
- healthy (BOOLEAN) - Service status
```

**hyphae_rpc_audit** (RPC Call Log)
```sql
- id (UUID, primary key)
- trace_id (VARCHAR) - Correlation ID for call chain
- source_agent (VARCHAR) - Caller
- target_agent (VARCHAR) - Callee
- capability (VARCHAR) - What was called
- status (VARCHAR) - SUCCESS, FAILED, SERVICE_NOT_FOUND, RPC_TIMEOUT
- duration_ms (INTEGER) - How long it took
- error (TEXT) - Error message if failed
- called_at (TIMESTAMP) - When call initiated
- completed_at (TIMESTAMP) - When call completed
```

**hyphae_relationships** (Agent Interaction Graph)
```sql
- id (UUID, primary key)
- source_agent (VARCHAR) - Who called
- target_agent (VARCHAR) - Who was called
- capability (VARCHAR) - What capability was used
- call_count (INTEGER) - How many times called
- last_call (TIMESTAMP) - Most recent call
- avg_duration_ms (FLOAT) - Average call duration
```

### HTTP API

#### Service Registration

```
POST /api/services/register

Request:
{
  "agentId": "researcher",
  "name": "Research Agent",
  "capabilities": ["research", "investigate"],
  "endpoint": "http://localhost:3006",
  "transport": "http",
  "region": "us-west-2",
  "version": "1.0.0",
  "metadata": {
    "model": "gemini-2.5-pro",
    "framework": "crewai"
  }
}

Response:
{
  "success": true,
  "serviceId": "uuid",
  "agentId": "researcher",
  "message": "Service registered successfully",
  "traceId": "uuid"
}

Notes:
- If agentId already registered: Updates existing entry
- metadata is optional (for custom agent attributes)
- transport tells agents how to reach this service
```

#### Service Discovery

```
GET /api/services

Query Parameters:
- capability (optional) - Filter by capability
- region (optional) - Filter by region
- framework (optional) - Filter by framework (from metadata)
- healthy (optional) - true/false, default: true

Example:
GET /api/services?capability=research&region=us-west-2

Response:
{
  "success": true,
  "services": [
    {
      "agentId": "researcher",
      "name": "Research Agent",
      "capabilities": ["research", "investigate"],
      "endpoint": "http://localhost:3006",
      "transport": "http",
      "region": "us-west-2",
      "version": "1.0.0",
      "metadata": {...},
      "registeredAt": "2026-03-19T...",
      "lastHeartbeat": "2026-03-19T...",
      "healthy": true
    }
  ],
  "count": 1,
  "traceId": "uuid"
}
```

#### Get Service Details

```
GET /api/services/:agentId

Response:
{
  "success": true,
  "service": {
    "agentId": "researcher",
    ...
  },
  "traceId": "uuid"
}

Error (404 if not found):
{
  "success": false,
  "error": "Agent not found: researcher",
  "traceId": "uuid"
}
```

#### Make RPC Call

```
POST /api/rpc/call

Request:
{
  "sourceAgent": "analyzer",
  "targetAgent": "researcher",
  "capability": "research",
  "params": {
    "topic": "quantum computing",
    "depth": "comprehensive"
  },
  "timeout": 30000
}

Response (if target agent responds):
{
  "success": true,
  "result": {
    "findings": [...],
    "confidence": 0.95
  },
  "duration": 5234,
  "traceId": "uuid",
  "sourceAgent": "analyzer",
  "targetAgent": "researcher"
}

Error Response:
{
  "success": false,
  "error": "Target agent not found or unhealthy: researcher",
  "duration": 45,
  "traceId": "uuid",
  "sourceAgent": "analyzer",
  "targetAgent": "researcher"
}

Notes:
- timeout is milliseconds (default 30000 = 30 seconds)
- sourceAgent is for audit trail (who initiated call)
- Hyphae enforces timeout with Promise.race
- Every call logged in audit trail regardless of success
```

#### Query Audit Trail

```
GET /api/rpc/audit

Query Parameters:
- traceId (optional) - Filter by trace ID
- sourceAgent (optional) - Filter by caller
- targetAgent (optional) - Filter by callee
- capability (optional) - Filter by capability
- status (optional) - SUCCESS, FAILED, SERVICE_NOT_FOUND, RPC_TIMEOUT
- limit (optional) - Results per page, default 100, max 1000
- offset (optional) - Pagination offset, default 0

Response:
{
  "success": true,
  "audit": [
    {
      "id": "uuid",
      "traceId": "uuid",
      "sourceAgent": "analyzer",
      "targetAgent": "researcher",
      "capability": "research",
      "status": "SUCCESS",
      "durationMs": 5234,
      "error": null,
      "calledAt": "2026-03-19T...",
      "completedAt": "2026-03-19T..."
    }
  ],
  "count": 1,
  "limit": 100,
  "offset": 0,
  "traceId": "uuid"
}
```

#### System Health

```
GET /api/health

Response:
{
  "status": "healthy",
  "timestamp": "2026-03-19T..."
}
```

#### System Statistics

```
GET /api/stats

Response:
{
  "success": true,
  "stats": {
    "healthyServices": 3,
    "totalRpcCalls": 145,
    "successfulCalls": 142,
    "avgDurationMs": "234.56"
  },
  "traceId": "uuid"
}
```

---

## CLI Interface

### Interactive Mode

```bash
$ hyphae-cli

🚀 Hyphae CLI (interactive mode)
Commands: register, discover, call, audit, status, help, exit

> register researcher "Research Agent" research investigate
✅ Agent registered:
   Agent ID: researcher
   Name: Research Agent
   Capabilities: research, investigate
   Endpoint: http://localhost:3006
   Region: us-west-2
   Trace ID: 550e8400-e29b...

> discover --capability research
📋 Services Found: 1
─────────────────────────────────────────────────────────────
🤖 researcher
   Name: Research Agent
   Capabilities: research, investigate
   Endpoint: http://localhost:3006
   Transport: http
   Region: us-west-2
   Healthy: ✅
   Last Heartbeat: 2026-03-19 14:32:15

> call analyzer researcher research --params '{"topic":"AI","depth":"comprehensive"}'
📡 Making RPC call...
   From: analyzer
   To: researcher
   Capability: research
   Timeout: 30000ms

❌ RPC call failed
   Error: Target agent not found or unhealthy: researcher

> exit
```

### Command-Line Mode

```bash
# Register an agent
$ hyphae-cli register researcher "Research Agent" research investigate
✅ Agent registered...

# Discover services
$ hyphae-cli discover --capability research --region us-west-2
📋 Services Found: 1...

# Make RPC call
$ hyphae-cli call analyzer researcher research --params '{"topic":"AI"}'
📡 Making RPC call...

# Query audit trail
$ hyphae-cli audit --sourceAgent analyzer --limit 50
📊 RPC Audit Trail: 12 records...

# Check system status
$ hyphae-cli status
📈 Hyphae System Status
─────────────────────────────────────────────────────
Health: ✅ Healthy
Healthy Services: 3
Total RPC Calls: 145
Successful Calls: 142 (97.9%)
Avg Duration: 234.56ms
```

---

## Design Decisions

### Framework Agnostic

**Why?**
- Agents built with different frameworks (CrewAI, AutoGen, nanoclaw, OpenClaw) should work together
- Hyphae doesn't know or care about internal framework details
- Only contract: agents must register + handle `/rpc` endpoint

**How?**
- Service registration is minimal (endpoint + transport type, no framework coupling)
- RPC protocol is standardized (sourceAgent, targetAgent, capability, params)
- Each agent registers HOW to reach it (endpoint, transport)

### Transport Agnostic

**Why?**
- Different deployments need different transports
  - Simple setup: HTTP
  - High-throughput: NATS pub/sub
  - Strict request/reply: gRPC
  - Guaranteed delivery: Message queue

**How?**
- Service metadata includes transport type
- Discovery returns endpoint + transport info
- Agents know how to reach target based on transport
- Hyphae doesn't touch message streams (just metadata)

### Zero-Trust Tracking

**Why?**
- No audit trail = no accountability
- Can't troubleshoot without knowing what agents called what
- Need to detect cascading failures

**How?**
- Every call logged (success or failure)
- Trace IDs for correlation across multiple calls
- Relationship graph shows who talks to whom
- Metrics per capability (which calls are slowest?)

### Timeout Enforcement

**Why?**
- Hanging calls waste resources
- Deadlines must be hard (not suggested, not average)
- Agents might claim they're still working (without actual progress)

**How?**
- Client specifies timeout (default 30s)
- Server-side `Promise.race` against timeout
- Explicit `RPC_TIMEOUT` status in audit
- No hanging connections

### Error Messages

**Why?**
- Clear errors enable fast debugging
- Vague errors waste hours of troubleshooting

**How?**
- Each error type maps to specific cause
- Examples: `SERVICE_NOT_FOUND`, `RPC_TIMEOUT`, specific HTTP codes
- Audit trail captures exact error message
- Response includes status + error text

---

## Integration Points

### With Emergency Recovery Assistant (ERA)

```
When troubleshooting:
1. ERA queries hyphae_rpc_audit table directly (PostgreSQL)
2. ERA builds call chain from trace IDs
3. ERA identifies which agent is bottleneck (avg_duration_ms)
4. ERA suggests: restart agent? increase timeout? rebalance?
```

### With Distributed Tracing

```
Each RPC call includes traceId (UUID):
1. Client generates/includes traceId
2. Hyphae logs call with traceId
3. Target agent includes traceId in its own calls
4. Dashboard shows full call graph (A→B→C→D)
```

### With Service Relationships

```
As agents call each other:
1. Hyphae updates hyphae_relationships table
2. Builds semantic graph of agent interactions
3. Can answer: "which agent depends on researcher?"
4. Enables intelligent routing and load balancing
```

### With MemForge

```
Agents share context via MemForge:
1. Agent A stores findings in MemForge
2. Agent B queries MemForge (semantic search)
3. Both agents coordinate via Hyphae RPC
4. Combination enables: distributed memory + coordination
```

---

## Deployment

### Environment Variables

```bash
# Database connection
DB_HOST=100.97.161.7
DB_PORT=5432
DB_NAME=hyphae
DB_USER=postgres
DB_PASSWORD=postgres

# Server
PORT=3100
NODE_ENV=production

# Optional
HYPHAE_URL=http://localhost:3100 (for CLI)
```

### Docker Deployment

```dockerfile
FROM node:20

WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install

# Build TypeScript
COPY . .
RUN npm run build

# Start server
EXPOSE 3100
CMD ["node", "dist/http-rpc-server.js"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hyphae-core
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hyphae-core
  template:
    metadata:
      labels:
        app: hyphae-core
    spec:
      containers:
      - name: hyphae-core
        image: salishforge/hyphae-core:latest
        ports:
        - containerPort: 3100
        env:
        - name: DB_HOST
          value: postgres.default.svc.cluster.local
        - name: DB_NAME
          value: hyphae
        - name: PORT
          value: "3100"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3100
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 3100
          initialDelaySeconds: 5
          periodSeconds: 5
```

---

## Testing

### Unit Tests

```bash
npm test
```

Tests cover:
- Service registration (new + update)
- Service discovery (filters, pagination)
- RPC error handling
- Audit trail logging
- System health checks

### Integration Tests

```bash
npm test -- --integration
```

Tests cover:
- Multi-agent coordination
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
- 0% error rate under normal load
- 0.1% error rate under stress

---

## What's Next

### Phase 2: Emergency Recovery Assistant (ERA)

```
- Offline diagnostic engine
- Pattern analysis from audit trail
- Automated remediation suggestions
- Zero-trust approval workflow
```

### Phase 3: Distributed Tracing

```
- Trace spans (showing which agent did what)
- Critical path analysis
- Bottleneck identification
- Dashboard integration
```

### Phase 4: Agent Deployment

```
- Clio (AutoGen)
- Flint (CrewAI)
- Multi-framework coordination tests
- Production deployment
```

---

## Key Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Service Discovery Latency | <10ms | ✅ |
| RPC Call Overhead | <50ms p99 | ⏳ (needs perf testing) |
| Audit Logging Latency | <1ms | ✅ |
| Database Query Time | <100ms p99 | ✅ |
| Request Throughput | 1000+ req/sec | ⏳ |
| Error Detection | 100% of failures logged | ✅ |
| Audit Trail Completeness | 100% of calls logged | ✅ |

---

## Code Structure

```
hyphae/
├── http-rpc-server.ts          # Main HTTP server
├── cli.ts                       # CLI interface
├── package.json                 # Dependencies
├── tsconfig.json               # TypeScript config
└── tests/
    └── http-rpc-server.test.ts # Unit tests
```

---

## Conclusion

Hyphae Core Phase 1 provides the foundation for framework-agnostic multi-agent coordination:

✅ Service registry (agents announce themselves)  
✅ Service discovery (find agents by capability)  
✅ RPC coordination (framework-agnostic calling)  
✅ Audit trail (know what happened)  
✅ Relationship tracking (understand dependencies)  

Ready for Phase 2 (ERA) and agent deployment (CrewAI + AutoGen).

