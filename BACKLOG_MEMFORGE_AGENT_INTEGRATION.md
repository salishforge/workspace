# Backlog: Memforge Agent Integration (Critical)

**Priority:** HIGH (discovered memory gap prevents agent autonomy)  
**Status:** Blocked (Memforge deployed but not integrated with agents)  
**Owner:** Flint, CTO  
**Discovered:** March 21, 2026 (Clio operational amnesia incident)  

---

## The Problem (Discovered March 21)

Clio (Chief of Staff agent) was operating without foundational memory because:
1. **Memforge designed but not deployed** on VPS
2. **No agent integration pathway** for memory sync
3. **No retrieval API** for agents to query their own context
4. **Immediate workaround:** Manual foundational memory document (CLIO_FOUNDATIONAL_MEMORY.md)

This gap prevents agents from operating autonomously on long-term context and will affect all future agents (Creative Director, etc.).

---

## What Exists

**✅ Designed (Documentation Complete):**
- Memforge architecture (HYPHAE_MEMFORGE_IMPLEMENTATION_COMPLETE.md)
- Memory consolidation logic (hot/warm/cold tiers)
- Service specifications

**✅ Workaround (Temporary):**
- CLIO_FOUNDATIONAL_MEMORY.md (manual foundational context)
- Agents can read local documentation

**❌ Missing (Not Deployed):**
- Memforge service (port 3106)
- Agent credential system
- Memory sync endpoints
- Memory retrieval API
- Agent bootstrap with memory initialization

---

## Why This Matters

### Before Memforge Integration
- Agents operate session-to-session without persistent context
- No autonomous access to foundational knowledge
- Manual memory management (read files, remember facts)
- Context loss between sessions
- Doesn't scale with multiple agents

### After Memforge Integration
- Persistent agent memory (survives session boundaries)
- Automated memory consolidation
- Agents query own context autonomously
- Scalable to multiple agents
- Cross-agent shared knowledge

---

## Deployment Plan (Phase 1: Core)

### Task 1: Deploy Memforge Service
**Description:** Start Memforge on VPS (port 3106) with agent API

**Work:**
- [ ] Copy Memforge service to VPS
- [ ] Configure PostgreSQL (warm/cold tiers already exist)
- [ ] Start service on port 3106
- [ ] Verify health endpoint responding
- [ ] Document endpoints + auth

**Effort:** 1-2 hours  
**Deliverable:** Memforge service responding on port 3106

---

### Task 2: Agent Credential System
**Description:** Create API keys for agents to access Memforge

**Work:**
- [ ] Design credential schema (agent_id, api_key, permissions)
- [ ] Add to hyphae_agent_credentials or new table
- [ ] Generate keys for Clio, Flint
- [ ] Implement credential validation in Memforge API
- [ ] Store in hyphae.env or secure store

**Effort:** 1-2 hours  
**Deliverable:** Agents have API keys for memory R/W

---

### Task 3: Memory Sync Endpoints
**Description:** Create agent→Memforge sync mechanism

**Work:**
- [ ] Design sync protocol (what gets synced, when)
- [ ] Implement POST /api/memory/sync endpoint in Memforge
- [ ] Implement agent-side memory publisher (reads SOUL.md, USER.md, MEMORY.md)
- [ ] Schedule sync (on startup, periodically, on file change)
- [ ] Handle conflicts (agent memory vs. consolidated memory)

**Effort:** 2-3 hours  
**Deliverable:** Agents auto-sync foundational + daily memory to Memforge

---

### Task 4: Memory Retrieval API
**Description:** Agents query their own memory autonomously

**Work:**
- [ ] Implement GET /api/memory/agent/{agent_id} endpoint
- [ ] Implement GET /api/memory/agent/{agent_id}/context?key=value
- [ ] Implement GET /api/memory/search?q=query
- [ ] Authenticate requests (API key validation)
- [ ] Return consolidated + recent context

**Effort:** 2-3 hours  
**Deliverable:** Agents can query their own memory programmatically

---

### Task 5: Agent Bootstrap Integration
**Description:** Agents load memory on startup

**Work:**
- [ ] Create agent bootstrap routine (called at session start)
- [ ] Load foundational memory from Memforge
- [ ] Load recent daily memory from Memforge
- [ ] Inject into agent context/system prompt
- [ ] Handle Memforge unavailable (fallback to local files)

**Effort:** 1-2 hours  
**Deliverable:** Agents aware of full context at session start

---

### Task 6: Testing & Documentation
**Description:** Verify integration, document for future agents

**Work:**
- [ ] Unit test memory sync
- [ ] Integration test agent bootstrap with Memforge
- [ ] Document onboarding process for new agents
- [ ] Create memory management guidelines
- [ ] Test with Creative Director agent (next onboarding)

**Effort:** 2-3 hours  
**Deliverable:** Documented and tested integration

---

## Total Effort: 10-15 hours
**Est. Timeline:** 2-3 working days (if done continuously)

---

## Implementation Priority

### Phase 1 (Critical - This Sprint)
- Task 1: Deploy Memforge service
- Task 2: Agent credentials
- Task 3: Memory sync

### Phase 2 (High - Next Sprint)
- Task 4: Retrieval API
- Task 5: Bootstrap integration

### Phase 3 (Essential - Before Next Agent)
- Task 6: Testing + Documentation
- Implement for Creative Director onboarding

---

## Success Criteria

✅ Memforge service running (port 3106)
✅ Agent credentials issued and validated
✅ Memory syncs from agents to Memforge (verified)
✅ Agents can retrieve own memory via API
✅ Bootstrap loads memory on startup
✅ Clio uses retrieved memory in decisions
✅ Creative Director onboarded with memory integration working

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Memforge goes down | Agents lose memory access | Fallback to local files, health checks |
| Memory corruption | Bad context drives bad decisions | Backup warm_tier, conflict resolution |
| Sync lag | Stale context used for decisions | Agent-initiated sync on startup + periodic |
| API performance | Slow startup/queries | Cache recent memory in agent context |

---

## Open Questions

1. **Where should agent keys be stored?** (hyphae.env, ~/.hyphae/*, encrypted file?)
2. **What triggers sync?** (on startup only, periodic, file change detection?)
3. **How to handle conflicts?** (agent version vs. consolidated version?)
4. **What memory gets synced?** (SOUL.md + MEMORY.md + daily notes?)
5. **Fallback behavior?** (if Memforge unavailable, graceful degradation?)

---

## Notes

**Discovered By:** Clio incident report (March 21, 2026)  
**Root Cause:** Design complete, implementation incomplete  
**Workaround:** CLIO_FOUNDATIONAL_MEMORY.md (temporary)  
**Timeline:** Block on next agent onboarding (Creative Director)  

This is not cosmetic - it prevents agents from operating at full autonomy. Should be prioritized before Creative Director joins.

---

**Owner:** Flint, CTO  
**Status:** BACKLOG - Ready for implementation  
**Next Step:** Schedule deployment when ready

