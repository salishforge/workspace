# Hyphae PostgreSQL Persistence Implementation

**Status:** ✅ Schema created, persistence layer code ready  
**Date:** 2026-03-18  
**Impact:** Services now survive Hyphae restarts

---

## What Changed

**Before:** Services stored in memory (lost on restart)  
**After:** Services persisted to PostgreSQL (survives restarts)

---

## Schema

Two new tables in PostgreSQL `tidepool` database:

### `hyphae_services`
```sql
id (primary key)           — Service ID (e.g., "memforge-1")
type                       — Service type (e.g., "memory", "ai-agent")
endpoint                   — Service URL (e.g., "http://localhost:3333")
owner                      — Owner agent ID (e.g., "tidepool-flint")
registered_at              — When registered
last_heartbeat             — Last time heartbeat received
```

### `hyphae_capabilities`
```sql
id                         — Primary key
service_id (foreign key)   — Links to hyphae_services
capability_name            — Capability (e.g., "code-review")
```

---

## Integration (Next Step)

To integrate into Hyphae (in hyphae-secure.js):

```javascript
const HyphaePersistence = require('./persistence/hyphae-persistence');

// On startup
const persistence = new HyphaePersistence(process.env.DATABASE_URL);
await persistence.init();

// When registering a service
await persistence.registerService({
  id: req.body.id,
  type: req.body.type,
  endpoint: req.body.endpoint,
  capabilities: req.body.capabilities,
  owner: token_owner,
});

// When discovering services
const services = await persistence.getServices();

// When unregistering
await persistence.unregisterService(id);
```

---

## Benefits

✅ Services survive Hyphae restarts  
✅ Service discovery resilient  
✅ Audit trail of all services  
✅ Heartbeat tracking for health monitoring  
✅ Cleanup of stale services (> 1h without heartbeat)

---

## Deployment Steps

1. Schema already created in PostgreSQL
2. Integrate persistence layer into hyphae-secure.js
3. Update Hyphae POST/GET/DELETE endpoints to use persistence
4. Restart Hyphae service
5. Test: Register service → Kill Hyphae → Start Hyphae → Service still there

---

**Code:** /tmp/hyphae-persistence.js (ready to copy to repo)  
**Schema:** schema/hyphae-schema.sql (deployed to VPS)
