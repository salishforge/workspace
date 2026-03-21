# MemForge Agent Integration Guide

**Status:** ✅ PRODUCTION READY  
**Date:** March 21, 2026  
**Endpoints:** Port 3107 (Agent API)  

---

## Overview

MemForge is a persistent memory system for Salish Forge agents. It allows agents to:
1. **Sync** their local memory files (SOUL.md, MEMORY.md, etc.) to a central store
2. **Retrieve** consolidated memory for context injection
3. **Search** their own memory autonomously
4. **Persist** memory across sessions

---

## Architecture

```
Agent (Clio, Flint)
    ↓
hyphae-agent-memory-sync.js (client library)
    ↓
MemForge Agent API (port 3107)
    ↓
PostgreSQL hyphae_agent_memory table
```

---

## Agent Credentials

Each agent has a unique API key for memory operations:

```sql
SELECT agent_id, api_key, permissions 
FROM hyphae_memory_agent_credentials 
WHERE agent_id IN ('clio', 'flint');
```

**Permissions:**
- `read`: Agent can retrieve own memory
- `write`: Agent can sync memory
- `sync`: Agent can force consolidation

---

## How Agents Use It

### 1. Load Credentials (Bootstrap)

```javascript
// On agent startup
const agentId = 'clio';
const credentials = await loadAgentMemoryCredentials(agentId);
// credentials = { apiKey: 'memforge_clio_xxx', permissions: {...} }
```

### 2. Sync Memory Periodically

```javascript
const sync = new AgentMemorySync(agentId, apiKey);

// Sync all local memory files
const result = await sync.syncMemory();
// Reads: SOUL.md, USER.md, MEMORY.md, daily notes
// Pushes to MemForge
```

### 3. Retrieve Memory for Context

```javascript
const memoryContext = await sync.getMemoryContext();
// Returns formatted memory as string for system prompt injection

// Use in agent initialization:
const systemPrompt = `
You are ${agentId}.

${memoryContext}

... rest of prompt
`;
```

### 4. Search Memory

```javascript
const results = await sync.searchMemory('John');
// Returns all memory entries matching "John"
```

---

## API Endpoints

### POST /api/memory/sync
Agent pushes memory files to consolidation.

**Request:**
```
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "agent_id": "clio",
  "files": {
    "SOUL.md": "# Content...",
    "USER.md": "# Content...",
    "MEMORY.md": "# Content..."
  },
  "metadata": {
    "sync_time": "2026-03-21T19:45:00Z"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "consolidation_id": "uuid",
  "files_synced": 3,
  "timestamp": "2026-03-21T19:45:00Z"
}
```

---

### GET /api/memory/agent/{agent_id}
Agent retrieves all consolidated memory.

**Request:**
```
Authorization: Bearer {api_key}
```

**Response:**
```json
{
  "status": "success",
  "agent_id": "clio",
  "memory": {
    "SOUL.md": {
      "content": "...",
      "created_at": "2026-03-21T19:45:00Z",
      "updated_at": "2026-03-21T19:45:00Z"
    },
    "USER.md": {...},
    "MEMORY.md": {...}
  },
  "file_count": 3
}
```

---

### GET /api/memory/agent/{agent_id}/search?q={query}
Search memory for a query.

**Request:**
```
Authorization: Bearer {api_key}
?q=query_string
```

**Response:**
```json
{
  "status": "success",
  "query": "John",
  "results": [
    {
      "memory_type": "USER.md",
      "content": "# John Brooke - CEO",
      "timestamp": "2026-03-21T19:45:00Z"
    }
  ],
  "result_count": 1
}
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 401 | Unauthorized (invalid API key) |
| 403 | Forbidden (agent ID mismatch) |
| 400 | Bad request (invalid JSON) |
| 500 | Server error |

---

## Database Schema

```sql
CREATE TABLE hyphae_agent_memory (
  id UUID PRIMARY KEY,
  agent_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,    -- SOUL.md, USER.md, MEMORY.md, etc.
  content TEXT NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE (agent_id, memory_type)
);

CREATE TABLE hyphae_memory_agent_credentials (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL UNIQUE,
  api_key VARCHAR(255) NOT NULL UNIQUE,
  permissions JSONB,
  status VARCHAR(50),
  created_at TIMESTAMP
);
```

---

## Implementation Checklist

### For Existing Agents (Clio, Flint)

- [ ] Load memory credentials on startup
- [ ] Call syncMemory() on initialization
- [ ] Call retrieveMemory() to get context
- [ ] Inject memory into system prompt
- [ ] Test search functionality
- [ ] Verify memory persists across sessions

### For New Agents

1. **Register with Hyphae** (done: hyphae-agent-bootstrap.js)
2. **Create memory credentials** (done: hyphae_memory_agent_credentials table)
3. **Load credentials** on startup (via agent bootstrap)
4. **Sync memory** on each session (via AgentMemorySync)
5. **Inject context** into system prompt
6. **Test retrieval** with memory API

---

## Testing

### Manual Test

```bash
# Using the CLI from hyphae-agent-memory-sync.js
node hyphae-agent-memory-sync.js clio {api_key}

# Expected output:
# [MEMORY] ✅ Read SOUL.md (xxx chars)
# [MEMORY] ✅ Read USER.md (xxx chars)
# [SYNC] ✅ Memory synced (3 files)
# [RETRIEVE] ✅ Retrieved 3 memory files
```

### Integration Test

```javascript
// test-memforge-agent-integration.js
const sync = new AgentMemorySync('clio', apiKey);
await sync.syncMemory();
const memory = await sync.retrieveMemory();
assert(memory.status === 'success');
assert(memory.file_count >= 3);
```

---

## Security Considerations

1. **API Keys** - Stored in PostgreSQL, never in logs
2. **Credentials** - Unique per agent, not shared
3. **Memory** - Encrypted at rest (PostgreSQL with SSL)
4. **Access Control** - Agent can only access own memory
5. **Audit Trail** - All syncs logged with timestamps

---

## Troubleshooting

### Memory Sync Returns 401
- Check API key is valid
- Verify credentials in database: `SELECT * FROM hyphae_memory_agent_credentials`

### Retrieved Memory is Empty
- Agent may not have synced yet
- Call syncMemory() first, then retrieval

### Search Returns No Results
- Query might not match content (case-sensitive with ILIKE)
- Memory might not be synced yet

---

## Future Enhancements

1. **Automatic Sync** - Sync on file change (inotify)
2. **Memory Tiers** - Hot/warm/cold with archival
3. **Consolidation** - Automated summary generation
4. **Sharing** - Agents share common context
5. **Versioning** - Track memory changes over time

---

## Quick Reference

**File:** hyphae-agent-memory-sync.js  
**Port:** 3107  
**Table:** hyphae_agent_memory  
**Credentials:** hyphae_memory_agent_credentials  

---

**Deployed:** March 21, 2026, 19:45 UTC  
**Status:** Production Ready  
**Owner:** Flint, CTO

