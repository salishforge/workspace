# MemForge Service — Extraction & Release Spec

**Goal:** Extract MemForge from Tidepool into standalone npm module  
**Repository:** `salishforge/memforge` (new)  
**Type:** npm package + service

---

## Current State

**Location:** `/home/artificium/.openclaw/workspace/nanoclaw-fork/memforge/`

**What exists:**
- ✅ PostgreSQL schema (hot_tier, warm_tier, cold_tier)
- ✅ Consolidation logic (consolidation-agent.js)
- ✅ Retrieval API (retrieval/*.js with FTS search)
- ✅ Event ingestion (ingest/event_logger.js)
- ✅ MCP server (mcp/server.js)
- ✅ Systemd service file
- ⚠️ Tightly coupled to Tidepool container runner

**What needs extraction:**
- Create clean npm module boundaries
- Define REST API contract (not just MCP)
- Add multi-tenant support (per-agentId isolation)
- Document schema + deployment
- Add health checks
- Add observability hooks

---

## Repository Structure

```
salishforge/memforge/
├── src/
│   ├── index.ts                          # Main export
│   ├── types.ts                          # TypeScript interfaces
│   │
│   ├── providers/
│   │   ├── postgres-provider.ts          # PostgreSQL backend
│   │   └── provider-interface.ts         # Abstract provider (for future alternatives)
│   │
│   ├── memory/
│   │   ├── memory-manager.ts             # Core API (add, query, consolidate, clear)
│   │   ├── hot-tier.ts                   # Hot tier logic
│   │   ├── warm-tier.ts                  # Warm tier (FTS search)
│   │   └── cold-tier.ts                  # Cold tier (archive)
│   │
│   ├── consolidation/
│   │   ├── consolidation-scheduler.ts    # Autonomous scheduler
│   │   ├── consolidation-agent.ts        # Agent that consolidates
│   │   └── embedding-provider.ts         # Vector embeddings (Ollama/API)
│   │
│   ├── retrieval/
│   │   ├── query-engine.ts               # FTS + vector search
│   │   └── ranking.ts                    # Relevance ranking (ts_rank)
│   │
│   ├── api/
│   │   ├── rest-server.ts                # Express.js REST API
│   │   ├── mcp-server.ts                 # MCP Protocol adapter
│   │   └── health-check.ts               # Liveness/readiness probes
│   │
│   ├── schema/
│   │   ├── schema.sql                    # PostgreSQL DDL
│   │   ├── migrations/                   # Schema version control
│   │   └── init.ts                       # Schema initialization
│   │
│   └── observability/
│       ├── logger.ts                     # Structured logging
│       ├── metrics.ts                    # Prometheus metrics
│       └── tracing.ts                    # OpenTelemetry hooks
│
├── tests/
│   ├── unit/
│   │   ├── memory-manager.test.ts
│   │   ├── query-engine.test.ts
│   │   └── consolidation.test.ts
│   │
│   └── integration/
│       ├── multi-agent-isolation.test.ts
│       ├── consolidation-e2e.test.ts
│       └── api-contract.test.ts
│
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .dockerignore
│
├── examples/
│   ├── standalone-server.ts              # Run MemForge as service
│   ├── sdk-usage.ts                      # Using MemForge as npm module
│   └── with-autogen.ts                   # MemForge + AutoGen integration
│
├── docs/
│   ├── README.md
│   ├── API.md                            # REST API reference
│   ├── SCHEMA.md                         # Database schema guide
│   ├── DEPLOYMENT.md                     # How to deploy
│   ├── ARCHITECTURE.md                   # Internal design
│   └── CONTRIBUTING.md
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .github/
│   └── workflows/
│       ├── test.yml                      # Run tests on PR
│       └── release.yml                   # Publish to npm
│
└── LICENSE                               # MIT


```

---

## Core API (TypeScript Interface)

```typescript
// src/index.ts

export interface MemoryContent {
  id?: string;
  content: string | object;
  type: 'text' | 'json' | 'embedding';
  timestamp?: ISO8601;
  metadata?: Record<string, any>;
}

export interface MemoryQueryResult {
  id: string;
  content: string | object;
  relevanceScore: number;
  tier: 'hot' | 'warm' | 'cold';
  timestamp: ISO8601;
}

export interface ConsolidationResult {
  agentId: string;
  eventsConsolidated: number;
  summary: string;
  tier: 'hot' | 'warm' | 'cold';
  timestamp: ISO8601;
}

export class MemoryManager {
  // Core API
  async add(agentId: string, content: MemoryContent): Promise<string>
  async query(agentId: string, searchText: string, limit?: number): Promise<MemoryQueryResult[]>
  async consolidate(agentId: string, mode?: 'auto' | 'manual'): Promise<ConsolidationResult>
  async clear(agentId: string, options?: ClearOptions): Promise<void>
  
  // Lifecycle
  async connect(): Promise<void>
  async disconnect(): Promise<void>
  async health(): Promise<HealthStatus>
  
  // Multi-tenant
  async listAgents(): Promise<string[]>
  async getAgentMemoryStats(agentId: string): Promise<MemoryStats>
}

// Export as singleton + factory
export function createMemoryManager(config: MemForgeConfig): MemoryManager
export const memoryManager: MemoryManager
```

---

## REST API Contract

```
POST /memory/{agentId}/add
  Input: { content: string | object, type: string }
  Output: { id: string, timestamp: ISO8601 }
  
GET /memory/{agentId}/query
  Input: ?q=search_text&limit=10&tier=warm
  Output: { results: MemoryQueryResult[], totalCount: number }
  
POST /memory/{agentId}/consolidate
  Input: { mode?: 'auto' | 'manual' }
  Output: ConsolidationResult
  
DELETE /memory/{agentId}
  Input: { confirm: boolean }
  Output: { agentId: string, cleared: true, timestamp: ISO8601 }
  
GET /memory/{agentId}/stats
  Output: { agentId, totalEvents, hotTier, warmTier, coldTier, lastConsolidation }
  
GET /health
  Output: { status: 'healthy' | 'degraded', uptime, dbConnection, lastConsolidation }
  
GET /metrics
  Output: Prometheus-format metrics (optional, for monitoring)
```

---

## Configuration

```typescript
// config.ts

export interface MemForgeConfig {
  // Database
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    pool?: PoolConfig;
  };
  
  // Service
  api?: {
    port?: number;
    host?: string;
  };
  
  // Consolidation
  consolidation?: {
    enabled?: boolean;
    interval_seconds?: number;
    threshold_events?: number;
    embedding_provider?: 'ollama' | 'openai' | 'anthropic';
    embedding_model?: string;
  };
  
  // Multi-tenancy
  multiTenant?: {
    enabled: boolean;
    isolation: 'strict' | 'soft'; // strict = separate schemas, soft = row-based
  };
  
  // Observability
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
  };
  
  metrics?: {
    enabled: boolean;
    port?: number;
  };
}
```

---

## Database Schema

```sql
-- schema.sql

-- Hot tier (recent, ungrouped events)
CREATE TABLE hot_tier (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  content_type VARCHAR(50),
  timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE INDEX idx_hot_agent_timestamp ON hot_tier(agent_id, timestamp DESC);

-- Warm tier (consolidated, searchable)
CREATE TABLE warm_tier (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  embedding_vector vector(1536),
  ts_vector tsvector,  -- for full-text search
  event_count INT,
  date_range DATERANGE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE INDEX idx_warm_agent ON warm_tier(agent_id);
CREATE INDEX idx_warm_fts ON warm_tier USING gin(ts_vector);
CREATE INDEX idx_warm_vector ON warm_tier USING ivfflat(embedding_vector);

-- Cold tier (archived, rarely accessed)
CREATE TABLE cold_tier (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  summary TEXT,
  event_count INT,
  date_range DATERANGE,
  archived_at TIMESTAMP DEFAULT NOW(),
  
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Consolidation log (audit trail)
CREATE TABLE consolidation_log (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  events_consolidated INT,
  summary TEXT,
  from_tier VARCHAR(50),
  to_tier VARCHAR(50),
  duration_ms INT,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Agent registry (for multi-tenancy)
CREATE TABLE agents (
  id VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  last_activity TIMESTAMP,
  metadata JSONB
);
```

---

## Deployment

### Option 1: Standalone Service

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg15
    environment:
      POSTGRES_DB: memforge
      POSTGRES_USER: memforge
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data

  memforge:
    build: .
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: memforge
      POSTGRES_USER: memforge
      POSTGRES_PASSWORD: secret
      API_PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres

volumes:
  postgres_data:
```

### Option 2: npm Module

```bash
npm install @salishforge/memforge
```

```typescript
import { createMemoryManager } from '@salishforge/memforge';

const memory = createMemoryManager({
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'memforge',
    user: 'memforge',
    password: 'secret'
  }
});

await memory.connect();
await memory.add('agent-1', { content: 'event data' });
const results = await memory.query('agent-1', 'search text');
```

---

## Tests (Acceptance Criteria)

```typescript
describe('MemForge Service', () => {
  describe('Multi-agent isolation', () => {
    // Agent A cannot see Agent B's memory
  });
  
  describe('Consolidation', () => {
    // Hot → Warm consolidation produces valid summary
    // Warm → Cold consolidation after 90 days
  });
  
  describe('Query performance', () => {
    // Query with 10k events returns in <100ms
  });
  
  describe('REST API', () => {
    // All endpoints respond with correct schema
  });
  
  describe('Failure recovery', () => {
    // DB disconnect → reconnect works
    // Mid-consolidation crash → resume safely
  });
});
```

---

## Files to Extract

**From `/nanoclaw-fork/memforge/` → `salishforge/memforge/src/`:**

| From | To | Notes |
|------|-----|-------|
| `consolidation/consolidation-agent.js` | `consolidation/consolidation-agent.ts` | Rewrite for TypeScript |
| `retrieval/memory_retrieval.js` | `retrieval/query-engine.ts` | Clean API |
| `ingest/event_logger.js` | `memory/hot-tier.ts` | Refactor for API |
| `schema/` | `schema/schema.sql` | PostgreSQL DDL |
| `mcp/server.js` | `api/mcp-server.ts` | Adapter pattern |
| `test/` | `tests/` | Rewrite with vitest |

---

## Package.json

```json
{
  "name": "@salishforge/memforge",
  "version": "0.1.0",
  "description": "Neuroscience-inspired memory consolidation service for AI agents",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./api": {
      "import": "./dist/api/rest-server.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "docker:build": "docker build -t salishforge/memforge .",
    "docker:run": "docker-compose up"
  },
  "dependencies": {
    "pg": "^8.20.0",
    "pgvector": "^0.1.0",
    "express": "^5.0.0",
    "pino": "^9.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^4.0.0",
    "tsx": "^4.0.0"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/salishforge/memforge"
  }
}
```

---

## README (Short Version)

```markdown
# MemForge

Neuroscience-inspired memory consolidation for AI agents.

MemForge manages agent memory across three tiers:
- **Hot**: Recent events, unprocessed
- **Warm**: Consolidated, searchable, semantic
- **Cold**: Archived, rare access

## Quick Start

```bash
npm install @salishforge/memforge
```

```typescript
import { createMemoryManager } from '@salishforge/memforge';

const memory = createMemoryManager({
  postgres: { host: 'localhost', ... }
});

await memory.add('my-agent', { content: 'event' });
const results = await memory.query('my-agent', 'search');
```

## Documentation

- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md)

## License

MIT
```

---

## GitHub Setup

When you create the repo:

1. **README.md** — Quick start (above)
2. **docs/** — Full documentation
3. **.github/workflows/** — CI/CD (test on PR, publish on release)
4. **MIT License** file
5. **.gitignore** — node_modules, dist, .env

All source files are TypeScript, not JavaScript.
