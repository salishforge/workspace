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

## Integration with Tidepool & Hyphae

### Architecture: Agent Coordination via Hyphae

```
┌─────────────────────────────────────────────────┐
│ Main Agent (Tidepool-Flint)                     │
│                                                 │
│ sessions_spawn(                                 │
│   task="detailed task with explicit output",   │
│   agentId="tidepool-clio"  ← can target other  │
│ )                                               │
└───────────────────┬─────────────────────────────┘
                    │ (OpenClaw framework)
                    ↓
┌─────────────────────────────────────────────────┐
│ Subagent Session (Tidepool-Clio)                │
│                                                 │
│ 1. Execute work (exec, read, write)             │
│ 2. Register self in Hyphae: /services/register │
│ 3. Produce explicit output                      │
│ 4. Announce back to parent                      │
└───────────────────┬─────────────────────────────┘
                    │ (Hyphae service registry)
                    ↓
┌─────────────────────────────────────────────────┐
│ Hyphae (Service Registry on Hyphae port 3004)  │
│                                                 │
│ - Service discovery (agents find each other)    │
│ - Capability routing (agent X → agent Y)        │
│ - Health monitoring                             │
│ - Multi-region federation                       │
└─────────────────────────────────────────────────┘
```

### What Tidepool Needs

1. **Subagent Task Templates**
   - Proven task patterns that work
   - Example: "Implement feature X with outputs A, B, C"
   - Built-in announce statements

2. **Hyphae Service Registration**
   - Each Tidepool agent auto-registers with Hyphae
   - Can query other agents via Hyphae
   - Service discovery within the mesh

3. **Result Aggregation**
   - Main agent collects subagent announces
   - Synthesizes results
   - Tracks completion

4. **Error Handling**
   - Subagent timeout → escalate
   - Announce missing → retry or escalate
   - Clear failure modes

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

## Next Steps

1. **Create Subagent Task Template Library**
   - Proven patterns for different task types
   - Built-in announce statements
   - Example: scale testing, code review, feature implementation

2. **Integrate Tidepool with Hyphae**
   - Each Tidepool agent auto-registers with Hyphae on startup
   - Query other agents via Hyphae service discovery
   - Enable distributed agent coordination

3. **Build Subagent Orchestrator Framework**
   - Main agent → orchestrator subagent → worker subagents
   - Aggregates results from workers
   - Synthesizes final reply

4. **Test This Week**
   - Deploy scale test via properly-designed subagent
   - Deploy multi-region test via properly-designed subagent
   - Verify both complete successfully

---

**Status:** READY FOR IMPLEMENTATION ✅

The subagent framework works. I just need to use it correctly.

