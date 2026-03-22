# Vector Layer Deployment Status - IN PROGRESS

**Date:** 2026-03-21 18:30 PDT  
**Status:** Blocked on pgvector availability  
**Progress:** 70% complete  

---

## What's Done ✅

1. **Code Deployed to VPS**
   - `consolidation_agent.js` (1297 lines) → `/home/artificium/hyphae-staging/memforge/consolidation/`
   - `embedding.js` (150 lines) → `/home/artificium/hyphae-staging/memforge/consolidation/`

2. **Infrastructure Verified**
   - PostgreSQL 15.17 running on localhost:5433 ✅
   - pg_trgm extension available ✅
   - Ollama running on localhost:11434 ✅
   - nomic-embed-text model available ✅
   - Database connectivity working ✅

3. **Database Tables Created**
   - `memory_vectors` (with JSONB embedding fallback) ✅
   - `hot_tier` (for distillation) ✅
   - Indexes created for fuzzy search ✅

---

## The Problem ❌

**pgvector Extension NOT Available**

```
ERROR: extension "vector" is not available
DETAIL: Could not open extension control file 
  "/usr/local/share/postgresql/extension/vector.control": 
  No such file or directory.
```

**Root Cause:**
- VPS has PostgreSQL 15
- System has `postgresql-17-pgvector` installed (only for PG 17)
- pgvector not compiled for PostgreSQL 15

**Impact:**
- Cannot use native `vector(768)` type
- Cannot use HNSW index for fast ANN search
- Hybrid search formula still works (just slower)

---

## Current Workarounds

### Option 1: JSON-Based Fallback (CURRENT)
```sql
CREATE TABLE memory_vectors (
  ...
  embedding JSONB,  -- Store as JSON array
  embedding_raw TEXT,  -- Store as string
  ...
);
```

**Pros:**
- Works immediately
- No dependencies
- Hybrid search formula still functional
- Can test memory consolidation end-to-end

**Cons:**
- No vector index acceleration
- Similarity search slower (linear scan)
- Not production-optimal
- Plan for eventual pgvector upgrade

### Option 2: Install pgvector for PG 15
```bash
apt install postgresql-15-pgvector
# OR
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
make install
```

**Pros:**
- Full vector search capability
- HNSW index acceleration
- Production-ready
- ~92% token efficiency

**Cons:**
- Requires build tools (gcc, etc.)
- ~10-15 minutes to compile
- Risk: Build failure
- Need to test carefully

### Option 3: Upgrade PostgreSQL to 17
```bash
pg_upgrade from 15 to 17
```

**Pros:**
- pgvector works out-of-the-box
- Modern PostgreSQL version
- Future-proof

**Cons:**
- Major version upgrade
- ~30 minutes downtime
- Risk: Compatibility issues
- Requires careful testing

---

## Recommendation

**Start with Option 1 (JSON fallback), then upgrade to Option 2 (build pgvector):**

**Phase A (30 minutes - Current):**
1. Use JSON-based memory_vectors table
2. Complete consolidation cycle for Clio & Flint
3. Verify memory quality
4. Test hybrid search formula

**Phase B (15 minutes):**
1. Install build tools on VPS
2. Build pgvector for PostgreSQL 15
3. Migrate memory_vectors to use vector(768)
4. Enable HNSW index

**Phase C (5 minutes):**
1. Re-run consolidation with pgvector
2. Verify performance
3. Compare token costs

---

## Next Steps

### If Continue with JSON Fallback:
```bash
# Adjust consolidation_agent.js to use JSONB instead of pgvector
# embedding.js already outputs JSON-compatible format
# Hybrid search formula: vector score calculation changes from:
#   (1 - (embedding <=> $vec)) → cosine_similarity(embedding_json, query_json)
```

### If Build pgvector for PG 15:
```bash
ssh artificium@100.97.161.7
sudo apt install postgresql-server-dev-15 build-essential
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
make install
# Restart PostgreSQL
# Update memory_vectors schema to use vector(768)
```

---

## Decision Required

**John:**  
Which approach?
- A) Continue with JSON fallback (fastest, let's test everything)
- B) Build pgvector now (slower, production-ready)
- C) Upgrade to PostgreSQL 17 (riskiest, most future-proof)

I recommend **A** → **B** staged approach:
1. Test consolidation with JSON (30 min)
2. Build pgvector if tests pass (15 min)
3. Go to production

---

## Timeline Impact

- **Option A (JSON):** +30 minutes testing, then +15 min to build pgvector
- **Option B (pgvector now):** +15 minutes to build, +30 minutes testing
- **Option C (PG upgrade):** +45 minutes (risky)

**Recommendation:** Go with Option A→B (test first, optimize after)

---

⚡ Flint
