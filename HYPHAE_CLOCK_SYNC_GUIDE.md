# Hyphae Clock Synchronization Guide

**Status:** Core system requirement (not optional)  
**Audience:** Agent developers, Hyphae operators  
**Date:** March 18, 2026

---

## Overview

**Clock synchronization is required for all agents joining the Hyphae mesh.**

This is not optional. It's a core security and audit requirement.

### Why?

1. **Prevents Agent Hallucination** — Agents can't claim they finished in the future
2. **Enforces Deadline Walls** — Sagas respect real timeout limits
3. **Ensures Audit Trail Authenticity** — Logs have ground truth timestamps
4. **Enables Fair Resource Allocation** — Actual elapsed time is tracked

---

## Agent Registration Flow

### Step 1: Prepare Registration Request

```typescript
const registrationRequest = {
  agentId: "my-agent-123",
  name: "Research Agent",
  framework: "nanoclaw",
  version: "1.0.0",
  capabilities: [
    {
      name: "research",
      description: "Research a topic",
      params: ["topic", "depth"],
      returns: "report"
    }
  ],
  endpoint: "http://my-agent:3006",
  healthCheckPath: "/health",
  region: "us-west",
  oauthClientId: "agent-123",
  authRequired: false,
  localTime: Date.now()  // ← REQUIRED: Current system time
};
```

### Step 2: Send Registration Request

```typescript
const response = await axios.post(
  "http://hyphae:3004/api/services/register",
  registrationRequest
);
```

### Step 3: Store Clock Offset

The response includes:
```json
{
  "success": true,
  "clockSync": {
    "status": "success",
    "hyphaeTime": 1742607720000,
    "agentLocalTime": 1742607715000,
    "offset": -5000,
    "message": "Clock synchronized: Agent is 5000ms behind Hyphae time..."
  }
}
```

**Store the offset:**
```typescript
const clockOffset = response.data.clockSync.offset;
// Store this in your agent's configuration or memory
```

### Step 4: Use Clock Offset for All RPC Calls

**Never use raw `Date.now()` for RPC timestamps.**

```typescript
// WRONG - will be rejected
const timestamp = Date.now();

// RIGHT - use corrected time
const timestamp = Date.now() + clockOffset;

// Make RPC call with corrected timestamp
const rpcResult = await axios.post(
  "http://hyphae:3004/api/rpc/call",
  {
    sourceAgent: "my-agent-123",
    targetAgent: "other-agent",
    capability: "research",
    params: { topic: "AI" },
    timestamp: timestamp  // ← Uses corrected time
  }
);
```

---

## Error Scenarios and Solutions

### Error: CLOCK_DESYNC_FAILED

**What It Means:**
```
CLOCK_DESYNC_FAILED: Agent clock is 8000ms behind of Hyphae time.

Details:
  - Hyphae authoritative time: 2026-03-18T22:06:00.000Z (1742607960000ms)
  - Agent reported time:       2026-03-18T22:05:52.000Z (1742607952000ms)
  - Time difference:           8000ms (8.0 seconds)
  - Tolerance limit:           5000ms

REMEDIATION:
  1. Check agent system clock: Run 'date' or equivalent on agent
  2. Sync system time: Use NTP (ntpd, chrony) or 'timedatectl set-time'
  3. Verify Hyphae time is correct: Compare with trusted time source
  4. Retry registration after correction
```

**Solution Steps:**

1. **Check your system time:**
   ```bash
   # Linux/Mac
   date
   
   # Windows
   Get-Date
   ```

2. **Enable NTP synchronization:**
   ```bash
   # Ubuntu/Debian
   sudo apt-get install chrony
   sudo systemctl start chrony
   
   # macOS
   # Already enabled by default
   
   # Windows
   w32tm /config /manualpeerlist:"pool.ntp.org" /syncfromflags:manual /update
   w32tm /resync
   ```

3. **Verify time is synchronized:**
   ```bash
   # Check if system time is synced
   timedatectl  # Shows sync status
   
   # Or manually sync
   sudo ntpdate -u pool.ntp.org
   ```

4. **Retry registration:**
   ```typescript
   const response = await axios.post(
     "http://hyphae:3004/api/services/register",
     { ...requestData, localTime: Date.now() }
   );
   ```

---

### Error: TIMESTAMP_INVALID (During RPC Call)

**What It Means:**
```
TIMESTAMP_INVALID: Reported timestamp is in the future.

Details:
  - Hyphae current time: 2026-03-18T22:06:00.000Z (1742607960000ms)
  - Timestamp received:  2026-03-18T22:06:03.000Z (1742607963000ms)
  - Time difference:     3000ms (3.00s in future)
  - Max allowed skew:    1000ms
  - Agent:               my-agent-123
  - RPC ID:             abc-def-123

LIKELY CAUSE:
  - Agent clock has drifted since registration
  - Agent not applying registered clock offset
  - Agent system time changed after registration
```

**Solution Steps:**

1. **Verify you're using the clock offset:**
   ```typescript
   // Check that you stored and are using the offset
   console.log("Clock offset:", this.clockOffset);
   
   // Verify you're adding it to all timestamps
   const timestamp = Date.now() + this.clockOffset;
   console.log("Corrected timestamp:", timestamp);
   ```

2. **Re-register to recalibrate:**
   ```typescript
   // If offset drifted, re-register
   const newRegistration = await axios.post(
     "http://hyphae:3004/api/services/register",
     { 
       agentId: "my-agent-123",
       // ... other fields
       localTime: Date.now()  // New calibration
     }
   );
   
   // Get new offset
   this.clockOffset = newRegistration.data.clockSync.offset;
   ```

3. **Check for system time changes:**
   - Look for system time adjustment events in logs
   - Disable any automatic time adjustment tools
   - Use continuous NTP sync instead

---

### Error: CLOCK_CHECK_FAILED (During Validation)

**What It Means:**
```
CLOCK_CHECK_FAILED: Cannot validate clock for agent my-agent-123.

Details:
  - Endpoint:  http://my-agent:3006
  - Error:     ECONNREFUSED (connection refused)
  - Time:      2026-03-18T22:06:00.000Z

LIKELY CAUSE:
  - Agent is down or unreachable
  - Network connectivity issue
  - Agent endpoint is wrong
```

**Solution Steps:**

1. **Verify agent is running:**
   ```bash
   curl http://my-agent:3006/health
   ```

2. **Check network connectivity:**
   ```bash
   ping my-agent
   nc -zv my-agent 3006  # Check port is open
   ```

3. **Verify endpoint in registration:**
   ```typescript
   // Make sure endpoint is correct
   endpoint: "http://my-agent:3006"  // Not localhost if running remotely
   ```

4. **Check firewall rules:**
   - Ensure agent port is accessible from Hyphae
   - Check network ACLs

---

## Handling Clock Drift

### What is Clock Drift?

Your agent's clock is running at a different rate than Hyphae's clock.

Example:
- Registration: Agent is 10ms behind
- 1 hour later: Agent is 100ms behind
- Drift rate: ~25 microseconds per second

### How to Detect It

Hyphae tracks drift rate:
```
Agent clock drifting: 0.025ms/sec
```

If you see this warning, your hardware clock is drifting.

### How to Fix It

**Option 1: Sync More Frequently (Quick Fix)**
- Re-register every hour instead of daily
- More frequent clock recalibration

**Option 2: Fix Hardware Clock (Proper Fix)**
- Replace battery in hardware clock (if applicable)
- Update BIOS to use better time source
- Enable hardware clock discipline in NTP

**Option 3: Use External NTP Server**
```bash
# Use public NTP pool instead of local source
timedatectl set-ntp true
timedatectl set-timezone UTC

# Verify sync status
timedatectl status
```

---

## Best Practices for Agents

### 1. Always Include `localTime` in Registration

```typescript
const registration = {
  agentId: "...",
  name: "...",
  localTime: Date.now(),  // ← ALWAYS include this
  ...
};
```

### 2. Store and Apply Clock Offset

```typescript
class MyAgent {
  private clockOffset = 0;
  
  async register() {
    const response = await axios.post(
      "http://hyphae:3004/api/services/register",
      { ...this.getRegistrationData(), localTime: Date.now() }
    );
    
    this.clockOffset = response.data.clockSync.offset;
  }
  
  getHyphaeTime() {
    return Date.now() + this.clockOffset;
  }
}
```

### 3. Use Corrected Time in All RPC Calls

```typescript
async callAgent(targetAgent, capability, params) {
  return axios.post(
    "http://hyphae:3004/api/rpc/call",
    {
      sourceAgent: this.agentId,
      targetAgent,
      capability,
      params,
      timestamp: this.getHyphaeTime()  // ← Always use corrected time
    }
  );
}
```

### 4. Handle Registration Errors Gracefully

```typescript
try {
  await this.register();
} catch (error) {
  if (error.response.status === 400) {
    const clockError = error.response.data;
    
    if (clockError.message.includes('CLOCK_DESYNC')) {
      console.error("Clock sync failed. Fix system time and retry.");
      // Don't proceed until clock is fixed
      process.exit(1);
    }
  }
  
  throw error;
}
```

### 5. Re-register on Startup

Even if previously registered, re-register on startup to recalibrate clock:

```typescript
async start() {
  // Force clock recalibration on startup
  await this.register();
  
  // Start serving RPC requests
  this.server.listen(this.port);
}
```

---

## Operator Commands

### Check Agent Clock Status

```bash
# List all agents and their clock status
curl http://hyphae:3004/api/services | jq '.[] | {name, clockStatus}'

# Check specific agent
curl http://hyphae:3004/api/services/my-agent-123 | jq '.clockStatus'
```

### View Clock Metrics

```bash
# Get detailed clock metrics
curl http://hyphae:3004/api/clock/metrics/my-agent-123 | jq .

# Shows: offset, drift rate, validation history
```

### Find Unhealthy Clocks

```bash
# List all agents with clock issues
curl http://hyphae:3004/api/clock/unhealthy | jq '.[] | {agentId, status, offset, driftRate}'
```

### Force Clock Revalidation

```bash
# Re-check all agent clocks
curl -X POST http://hyphae:3004/api/clock/revalidate-all

# Or specific agent
curl -X POST http://hyphae:3004/api/services/my-agent-123/clock-check
```

---

## Troubleshooting Checklist

- [ ] Agent system time matches Hyphae (within 5 seconds)
- [ ] NTP is enabled and syncing on agent
- [ ] Registration succeeds (no CLOCK_DESYNC errors)
- [ ] Clock offset is stored and used in RPC calls
- [ ] RPC calls include corrected timestamp
- [ ] No TIMESTAMP_INVALID errors during RPC
- [ ] Clock drift rate is stable (not growing)
- [ ] Agent re-registers on startup for fresh calibration

---

## Summary

**Clock synchronization is:**
- ✅ **Required** for all agents
- ✅ **Automatic** (done during registration)
- ✅ **Enforced** (failed registrations blocked)
- ✅ **Continuous** (drift is monitored)
- ✅ **Transparent** (agent just applies the offset)

**If you see clock errors:**
1. Fix system time (sync with NTP)
2. Re-register to recalibrate
3. Use the returned offset in all RPC calls
4. Retry

**Questions?** See error messages — they include detailed remediation steps.

