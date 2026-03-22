# Step 3: Production Deployment & Clio Testing Plan

**Status:** Ready to execute  
**Timeline:** Est. 2-3 hours for full testing cycle  
**Decision Point:** Tag v1.1.0 release on successful Clio memory tests  

---

## Step 3a: Deploy MemForge v1.1.0 to Production

### Prerequisites
- MemForge service currently running (check status)
- PostgreSQL tidepool database accessible
- Ollama running on localhost:11434
- dist/ directory built and ready (already done)

### Deployment Steps

1. **Stop current MemForge service**
```bash
ssh artificium@100.97.161.7 "systemctl stop memforge || sudo kill $(lsof -t -i :3333) || true"
```

2. **Backup current version**
```bash
ssh artificium@100.97.161.7 "cd /home/artificium/memforge && \
  cp -r dist dist.backup.1.0.0 && \
  git tag current-production-1.0.0 && \
  echo 'Backup created'"
```

3. **Verify v1.1.0 build artifacts exist**
```bash
ssh artificium@100.97.161.7 "ls -lh /home/artificium/memforge/dist/ | grep -E '(embedding|memory-manager)'"
```

4. **Start with v1.1.0**
```bash
ssh artificium@100.97.161.7 "cd /home/artificium/memforge && \
  export EMBEDDING_PROVIDER=ollama && \
  export EMBEDDING_MODEL=nomic-embed-text-v2-moe && \
  export EMBEDDING_ENABLED=true && \
  npm start 2>&1 | head -20"
```

5. **Verify connectivity**
```bash
curl -s http://100.97.161.7:3333/health | jq .
```

---

## Step 3b: Test Clio Memory Consolidation with Vectors

### Objective
Run consolidation for Clio agent and verify vectors are generated.

### Execution

1. **Trigger consolidation with vectors enabled**
```bash
curl -X POST http://100.97.161.7:3333/memory/clio/consolidate \
  -H "Content-Type: application/json" \
  -d '{"withVectors": true}'
```

Expected response:
```json
{
  "run_id": 123,
  "agent_id": "clio",
  "hot_rows_processed": 150,
  "warm_rows_created": 3,
  "vectors_generated": 3,
  "embedding_model": "nomic-embed-text-v2-moe",
  "status": "complete"
}
```

2. **Verify vectors stored in database**
```bash
ssh artificium@100.97.161.7 "PGPASSWORD='87898176a435deb3a4adee201742bac06f8bee298af2a8a132a9c22cc440cfc3' psql -h localhost -p 5432 -U memforge_user -d tidepool << 'EOF'
SELECT COUNT(*) as vectors_count FROM warm_tier 
WHERE agent_id = 'clio' AND embedding IS NOT NULL;

SELECT id, content, embedding_model 
FROM warm_tier 
WHERE agent_id = 'clio' AND embedding IS NOT NULL 
LIMIT 3;
EOF
"
```

Expected: 3 rows with non-null embedding + embedding_model

3. **Check vector quality**
```bash
ssh artificium@100.97.161.7 "PGPASSWORD='87898176a435deb3a4adee201742bac06f8bee298af2a8a132a9c22cc440cfc3' psql -h localhost -p 5432 -U memforge_user -d tidepool << 'EOF'
SELECT id, 
  LENGTH(embedding::text) as embedding_size,
  ARRAY_LENGTH(string_to_array(embedding::text, ','), 1) as dimensions
FROM warm_tier 
WHERE agent_id = 'clio' AND embedding IS NOT NULL 
LIMIT 1;
EOF
"
```

Expected: ~768 dimensions per vector

---

## Step 3c: Test Memory Retrieval Quality

### Objective
Compare hybrid vector search vs keyword-only search on Clio's memory.

### Test Cases

**Test 1: Recent memory retrieval**
```bash
# Keyword-only
curl -s "http://100.97.161.7:3333/memory/clio/query?q=consolidation" | jq '.results | length'

# Hybrid vector search
curl -s "http://100.97.161.7:3333/memory/clio/vector-search?q=consolidation" | jq '.results | length'
```

**Test 2: Semantic relevance**
```bash
# Query about memory system concepts
curl -s "http://100.97.161.7:3333/memory/clio/vector-search?q=sleep+cycle+memory+embedding" | jq '.results[0:2]'
```

**Test 3: Score comparison**
```bash
# Check that hybrid scores are reasonable (0-1 range)
curl -s "http://100.97.161.7:3333/memory/clio/vector-search?q=decision+making&limit=5" | \
  jq '.results | map({content: .content[0:50], score: .vector_score})'
```

Expected: All vector_scores in [0, 1] range

---

## Step 3d: Get Acceptable Test Responses from Clio

### Objective
Verify Clio can recall memory using the new vector layer and responds correctly.

### Memory Test 1: Early Conversation Retrieval

**Request to Clio:**
> "Recall our first conversation. What was the initial context when you were first deployed? Use your memory system."

**Expected Response:**
- ✅ Clio recalls early conversations (March 9-10)
- ✅ Mentions John Brooke as CEO (not "Corey")
- ✅ References SOUL.md, CTO_PROFILE.md from bootstrap
- ✅ Correct organizational context
- ✅ Episodic details accurate

**Success Criteria:**
- Recall accuracy >90%
- No hallucinations about early interactions
- Proper names and dates correct
- Context from MEMORY.md integrated

### Memory Test 2: Memory Consolidation Awareness

**Request to Clio:**
> "Describe the memory consolidation system you just went through. What happened during consolidation?"

**Expected Response:**
- ✅ Describes hot → warm tier transition
- ✅ Mentions vector embedding (new in v1.1)
- ✅ References to earlier events now consolidated
- ✅ Awareness of search capabilities

**Success Criteria:**
- Accurate description of consolidation process
- Awareness of vector enhancement
- References to actual consolidated memories

### Memory Test 3: Semantic Search Verification

**Request to Clio:**
> "What was discussed about memory architecture and why? Search deeply."

**Expected Response:**
- ✅ Retrieves discussion of sleep-cycle model
- ✅ References SPEC.md and design decisions
- ✅ Connects to vector layer implementation
- ✅ Shows semantic understanding (not just keyword match)

**Success Criteria:**
- Retrieves semantically related memories
- Quality improvement over keyword-only search
- Comprehensive context integration

---

## Step 3e: Review Test Results

### Acceptance Criteria

| Criteria | Status | Notes |
|----------|--------|-------|
| **Deployment** | | MemForge v1.1.0 running |
| **Vector generation** | | 3+ vectors for Clio |
| **Vector quality** | | 768-dim, valid JSON |
| **Hybrid search** | | <100ms latency |
| **Clio recalls correctly** | | >90% accuracy |
| **Early details accessible** | | MEMORY.md integrated |
| **No hallucinations** | | Names/dates accurate |
| **Semantic quality** | | Better than keyword search |

### Decision Gate

**When all criteria met:**
- ✅ Tag release: `git tag v1.1.0`
- ✅ Push to GitHub: `git push origin v1.1.0`
- ✅ Publish to npm: `npm publish`

**If issues found:**
- Rollback to v1.0.0
- Document issues
- Fix in v1.1.1

---

## Rollback Plan (If Needed)

```bash
# Stop v1.1.0
ssh artificium@100.97.161.7 "systemctl stop memforge"

# Restore v1.0.0
ssh artificium@100.97.161.7 "cd /home/artificium/memforge && \
  rm -rf dist && \
  cp -r dist.backup.1.0.0 dist && \
  npm start"

# Verify
curl -s http://100.97.161.7:3333/health
```

---

## Timeline

| Phase | Duration | Total |
|-------|----------|-------|
| 3a: Deploy | 15 min | 15 min |
| 3b: Consolidate | 5 min | 20 min |
| 3c: Test retrieval | 10 min | 30 min |
| 3d: Get Clio tests | 30 min | 60 min |
| 3e: Review & tag | 10 min | 70 min |

**Total estimated:** ~70 minutes (1h 10m)

---

## Success Scenario

```
✅ MemForge v1.1.0 deployed to production
✅ Clio consolidation complete with 3 vectors
✅ Hybrid search quality verified
✅ Clio recalls early conversations accurately
✅ No hallucinations, proper names/dates
✅ Semantic search quality improved
→ Tag v1.1.0 release
→ Publish to npm
```

---

## Failure Scenario (Contingency)

If Clio memory tests fail:

1. **Diagnose issue**
   - Check vector dimensions (should be 768)
   - Verify hybrid search formula
   - Check Ollama connectivity

2. **Fix & retest**
   - May require v1.1.1 patch
   - Identify root cause
   - Deploy fix

3. **Hold release**
   - Do not publish v1.1.0
   - Wait for confirmed v1.1.1

---

## Ready to Proceed

**Step 3a is ready to execute on your approval.**

Commands prepared to:
1. Deploy MemForge v1.1.0
2. Run Clio consolidation with vectors
3. Test memory retrieval quality
4. Get Clio memory test responses
5. Tag and publish release on acceptance

Approve Step 3a deployment?

⚡ Flint
