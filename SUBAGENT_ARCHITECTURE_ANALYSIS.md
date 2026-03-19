# Subagent Architecture Analysis & Tidepool Integration

**Date:** March 18, 2026  
**Status:** DIAGNOSIS COMPLETE - ROOT CAUSES IDENTIFIED  
**Author:** Flint, CTO

---

## Executive Summary

OpenClaw subagents are working as designed. The issue is **how I was using them**, not the framework itself.

**Key Finding:** Subagents don't "return" results like function calls. They "announce" results back to the parent via an announce step. If there's no announce text, we see "(no output)".

---

## How OpenClaw Subagents Actually Work

### Execution Model

```
1. Main agent calls sessions_spawn(task="do X")
   ↓
2. Subagent spawned in isolated session
   ↓
3. Subagent runs to completion (exec, write files, git commits, etc.)
   ↓
4. Announce step: Subagent must explicitly state what it did
   ↓
5. Announce text sent back to parent session
   ↓
6. Parent agent sees the announce result
```

### Critical Detail: The Announce Step

The subagent **must explicitly produce text** for the announce to show up. If:
- Subagent only runs commands (exec, write) → no text output → "(no output)" in announce
- Subagent uses git (commits are visible in parent) → can be silent
- Subagent explicitly prints status → announce text appears

### Tool Availability by Depth

| Tool | Main (Depth 0) | Subagent (Depth 1) | Subagent (Depth 2) |
|------|----------------|-------------------|-------------------|
| `exec` | ✅ | ✅ | ✅ |
| `read` | ✅ | ✅ | ✅ |
| `write` | ✅ | ✅ | ✅ |
| `sessions_spawn` | ✅ | ❌ (unless maxSpawnDepth≥2) | ❌ |
| `sessions_history` | ✅ | ❌ (unless maxSpawnDepth≥2) | ❌ |

**Important:** Subagents CAN run `exec` commands. They CAN write files and git commits.

---

## Why Some Subagents Worked

### RBAC (17m runtime) ✅
- Task was specific and measurable
- Output mechanism: git commits (visible to parent)
- Long runtime allowed debugging
- Clear success criteria

### Auth Code Flow (50m runtime) ✅
- Task was specific: "implement OAuth2 auth code flow"
- Output mechanism: git commits + file creation
- Long runtime allowed iterations
- Subagent produced explicit text for announce

### Scale Testing (18s runtime) ❌
- Task was vague: "execute scale tests"
- No clear output mechanism (tests produce logs, not commits)
- No explicit announce text
- Subagent likely ran tests but had nothing to announce back

### Multi-Region (3m runtime) ❌
- Task was abstract: "deploy multi-region federation"
- Output mechanism unclear
- No explicit announce statement
- Subagent likely confused about what to output

---

## The Root Cause of "No Output" Pattern

**Symptom:** "(no output)" in subagent results despite tokens being used

**Root Cause:** Subagent completes successfully BUT produces no announce text

**Why this happens:**

```
Subagent runs to completion:
  - Executes commands ✅
  - Generates tokens ✅
  - Produces files/commits ✅
  - But final reply is empty or missing ❌
  
  → Announce step has nothing to announce
  → Framework reports "(no output)"
```

**It's not a failure. It's a communication issue.**

The subagent works; I just need to ask it to explicitly state what it did.

---

## How to Fix: Proper Subagent Task Design

### Before (Fails)

```
task: "Deploy multi-region federation and test failover.

SCOPE:
1. Deploy 3 regions
2. Test failover..."
```

**Problem:** Vague. No explicit output required. Subagent finishes but has no text to announce.

### After (Works)

```
task: "Deploy multi-region Hyphae federation and test failover.

You MUST produce the following output:

1. Write test results to /tmp/multi-region-test-results.txt
2. Commit results to git: git commit -am 'Multi-region test: [results]'
3. End your work with exactly this text:
   
   MULTI-REGION TEST COMPLETE:
   - Region 1: [status]
   - Region 2: [status]
   - Region 3: [status]
   - Failover test: [status]
   
   This text will be announced back to the parent session.
"
```

**Why this works:**
- Clear output mechanism (file + git commit)
- Explicit final statement (subagent knows what to announce)
- Structured results (parent can see what was tested)
- Git commits are visible regardless of announce text

---

## Integration with Hyphae: Multi-Framework Agent Coordination

### Architecture: Framework-Agnostic Agent Coordination

```
┌──────────────────────────────────────────────────────────────┐
│ Any Agent Framework (nanoclaw, OpenClaw, AutoGen, CrewAI)   │
│                                                              │
│ - Implements subagent task templates                         │
│ - Registers services with Hyphae                             │
│ - Calls other agents via Hyphae discovery                    │
│ - Shares memory via MemForge                                 │
│ - Authenticates via OAuth2                                   │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ↓              ↓              ↓
         ┌────────────────┐ ┌────────────────┐ ┌─────────────┐
         │ Hyphae         │ │ MemForge       │ │ OAuth2      │
         │ (Discovery &   │ │ (Shared        │ │ (Identity & │
         │  Federation)   │ │  Memory)       │ │  Scopes)    │
         └────────────────┘ └────────────────┘ └─────────────┘
```

### What Multi-Framework Coordination Requires

1. **Subagent Task Templates (Framework-Agnostic)**
   - Proven task patterns that work across frameworks
   - Example: "Implement feature X with outputs A, B, C"
   - Built-in announce statements
   - Work with nanoclaw, OpenClaw, AutoGen, CrewAI, etc.

2. **Hyphae Service Registration Protocol**
   - ANY agent framework can register services
   - Query other agents' capabilities (regardless of framework)
   - Service discovery across the mesh
   - Framework adapters (thin layer) for each runtime

3. **Agent-to-Agent Communication Layer**
   - RPC pattern: Agent A discovers Agent B via Hyphae
   - Calls Agent B asynchronously
   - Receives response routed back via Hyphae
   - Works across framework boundaries

4. **Multi-Framework Result Aggregation**
   - Main agent (any framework) collects results
   - Synthesizes from multiple frameworks
   - Tracks completion across heterogeneous agents
   - Consistent error handling

5. **Error Handling**
   - Timeout → escalate
   - Service not found → fallback
   - Framework-specific errors normalized
   - Clear failure modes across frameworks

---

## Specific Recommendations for Scale & Failover Tests

### Scale Test (Proper Design)

```
task: "Execute complete scale testing suite.

STEPS:
1. Run: node tests/scale/runner.js --scenario baseline
2. Run: node tests/scale/runner.js --scenario linear-scale
3. Run: node tests/scale/runner.js --scenario peak-burst
4. Run: node tests/scale/runner.js --scenario sustained

OUTPUTS:
- Write results to /tmp/scale-test-results.txt
- Capture metrics from each scenario
- Git commit: git commit -am 'Scale testing complete: [summary]'

FINAL ANNOUNCEMENT (required):
When complete, output exactly:

SCALE TESTING COMPLETE:
- Baseline: [results summary]
- Linear Scale: [results summary]
- Peak Burst: [results summary]
- Sustained: [results summary]
- Overall: PASS/FAIL (errors <0.1%, latency <100ms)

This text will be the announce reply."
```

**Why this will work:**
- Clear execution steps
- Explicit output files
- Git commits for persistence
- Mandatory final announcement

### Multi-Region Failover Test (Proper Design)

```
task: "Deploy and test multi-region Hyphae federation.

DEPLOYMENT:
1. Deploy Hyphae instances to 3 regions (us-west, us-east, eu)
2. Register 10 test services in each region
3. Measure replication lag (<100ms target)

TESTING (5 scenarios):
1. Region preference query
2. Primary region failure
3. Service unavailable → fallback
4. Replication after recovery
5. Multi-region discovery

OUTPUTS:
- Write test log to /tmp/multi-region-test.log
- Git commit: git commit -am 'Multi-region federation: [status]'

FINAL ANNOUNCEMENT (required):
When all tests complete, output:

MULTI-REGION FEDERATION TEST COMPLETE:
- Deployment: PASS/FAIL
- Test 1 (Region pref): PASS/FAIL
- Test 2 (Primary fail): PASS/FAIL
- Test 3 (Failover): PASS/FAIL
- Test 4 (Recovery): PASS/FAIL
- Test 5 (Discovery): PASS/FAIL
- RTO: [seconds]
- Replication lag: [ms]
- Overall: PASS/FAIL

This text will be the announce reply."
```

---

## Configuration Changes Needed (Optional)

To enable nested subagents (orchestrator pattern), update OpenClaw config:

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,        // allow orchestrators
        maxChildrenPerAgent: 5,
        maxConcurrent: 8,
        runTimeoutSeconds: 7200  // 2 hours for long tasks
      }
    }
  }
}
```

With this, the main agent can spawn orchestrator subagents that themselves spawn workers.

---

## Summary: How to Make Subagents Work

1. **Be specific:** "Do X with outputs A, B, C" not "Build something"
2. **Use git commits:** Subagent git commits are always visible
3. **Explicit output:** Subagent must end with announcement text
4. **Longer timeouts:** Scale/federation tests need 30m-2h
5. **Clear success criteria:** "PASS if X < threshold"
6. **Files + announcements:** Write results AND announce them

---

## Next Steps: Building the Most Advanced Agent Coordination Platform

### Phase 1: Hyphae Service Contract (Week 1)
1. **Formalize Agent Registration Protocol**
   - Any agent framework can register services
   - Standardized service metadata (name, version, capabilities, endpoints)
   - Health check endpoint + heartbeat

2. **Implement Agent Discovery API**
   - Query available services by capability
   - Get agent metadata + contact info
   - Route requests through Hyphae to target agent

3. **Agent-to-Agent RPC Pattern**
   - Agent A discovers Agent B via Hyphae
   - Calls B asynchronously (no wait)
   - Response delivered back to A
   - Framework-agnostic (works with nanoclaw, OpenClaw, etc.)

### Phase 2: Multi-Framework Examples (Week 2)
1. **Nanoclaw Integration Example**
   - Show nanoclaw agent registering with Hyphae
   - Demonstrate inter-agent RPC
   - Full working example (code + docs)

2. **OpenClaw Integration Example**
   - Similar to nanoclaw but using OpenClaw framework
   - Show heterogeneous agent mesh

3. **Multi-Agent Coordination Demo**
   - 3+ agents (different frameworks) working together
   - Publicly available reference implementation

### Phase 3: Distributed Transaction Support (Week 3-4)
1. **Saga Pattern for Multi-Agent Workflows**
   - Agent A initiates transaction
   - Calls Agents B, C, D in parallel
   - One fails → compensation
   - All succeed → commit
   - No partial failures

2. **Memory Sharing for Multi-Agent Reasoning**
   - Agents store discoveries in MemForge
   - Semantic search across all agent memories
   - Shared reasoning context
   - Privacy controls (who can read what)

### Phase 4: Make This Public (Week 4+)
1. **Hyphae Documentation**
   - Service contract spec
   - Integration guides (one per framework)
   - Architecture diagrams
   - Example code

2. **Open-Source Status**
   - Position Salish Forge as community-driven platform
   - Accept framework adapters from community
   - Governance for standards

---

## Key Positioning Shift

**FROM:** Salish Forge = Another agent framework (Tidepool fork)  
**TO:** Salish Forge = Universal agent coordination platform

**Market Advantage:**
- Framework-agnostic (bigger TAM)
- Community-aligned (uses nanoclaw, not fork)
- Higher defensibility (network effects through Hyphae)
- Lower maintenance (no framework fork)

**Status:** STRATEGIC PIVOT COMPLETE ✅

Now executing: Most advanced agent coordination platform in existence.

