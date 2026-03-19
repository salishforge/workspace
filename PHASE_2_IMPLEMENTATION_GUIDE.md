# Phase 2: Agent Implementation Guide

**Status:** Ready to Start  
**Date:** March 19, 2026  
**Goal:** Integrate real CrewAI + AutoGen agents with Gemini models

---

## Overview

Phase 2 transforms mock agents into production-ready implementations:

1. **Flint (CrewAI)** — Real multi-agent crew with engineering team
2. **Clio (AutoGen)** — Real conversation-based orchestration
3. **Gemini Integration** — Google's latest models for cost + capability
4. **VPS Deployment** — Live system testing
5. **Load Testing** — Verify 1000+ req/sec under load

---

## Prerequisites

### Local Development

```bash
# Node.js 20+
node --version

# Python 3.9+ (for CrewAI + AutoGen)
python --version

# Install dependencies
cd hyphae-agents
npm install
pip install crewai autogen-agentchat google-generativeai
```

### API Keys

```bash
# Get Gemini API key
# https://makersuite.google.com/app/apikey

# Set environment
export GOOGLE_API_KEY="your-api-key"
export HYPHAE_URL="http://localhost:3100"
```

---

## Step 1: Flint (CrewAI) Implementation

### Install CrewAI

```bash
pip install crewai crewai-tools
```

### Update flint-crewai.ts to use Real CrewAI

Replace mock implementation with real CrewAI:

```typescript
import { FlintAgent } from "./flint-crewai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// In initialize():
private async setupCrew(): Promise<void> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  
  // Create engineering team agents
  const engineerAgent = {
    role: "Senior Software Engineer",
    goal: "Build production-quality code",
    backstory: "Expert in full-stack development and architecture",
    tools: [...] // Code review, testing, deployment tools
  };
  
  const securityAgent = {
    role: "Security Engineer",
    goal: "Harden systems against attacks",
    backstory: "Specialist in application security and compliance",
    tools: [...] // Security scanning, penetration testing tools
  };
  
  const devopsAgent = {
    role: "DevOps Engineer",
    goal: "Ensure reliable deployment and operations",
    backstory: "Expert in infrastructure and continuous delivery",
    tools: [...] // Docker, Kubernetes, monitoring tools
  };
  
  // Create tasks
  const tasks = [
    {
      description: "Review code for quality and security",
      agent: engineerAgent,
      expectedOutput: "Code review report with improvements"
    },
    {
      description: "Run security checks and hardening",
      agent: securityAgent,
      expectedOutput: "Security audit with remediation steps"
    },
    {
      description: "Prepare deployment package",
      agent: devopsAgent,
      expectedOutput: "Deployment manifests and runbooks"
    }
  ];
  
  // Create crew
  this.crew = new Crew({
    agents: [engineerAgent, securityAgent, devopsAgent],
    tasks: tasks,
    verbose: true,
    llm: genAI.getGenerativeModel({ model: "gemini-2.5-pro" })
  });
}

// In handleCapability() for execute_task:
private async executeTask(params, traceId): Promise<any> {
  const { task, priority } = params;
  
  // Use real crew kickoff
  const result = await this.crew.kickoff({
    task: task,
    priority: priority,
    deadline: new Date(Date.now() + 3600000).toISOString()
  });
  
  return {
    taskId: uuidv4(),
    status: "completed",
    result: result,
    traceId
  };
}
```

### Test Flint Locally

```bash
# Terminal 1: Start Hyphae
cd hyphae && docker-compose up -d

# Terminal 2: Start Flint
cd hyphae-agents
npm run build
npm run start:flint

# Terminal 3: Test
curl -X POST http://localhost:3100/api/rpc/call \
  -d '{
    "sourceAgent": "test_client",
    "targetAgent": "flint",
    "capability": "execute_task",
    "params": {"task": "Review code for quality", "priority": "high"},
    "timeout": 60000
  }' \
  -H "Content-Type: application/json"
```

---

## Step 2: Clio (AutoGen) Implementation

### Install AutoGen

```bash
pip install autogen-agentchat
```

### Update clio-autogen.ts to use Real AutoGen

Replace mock implementation:

```typescript
import { ClioAgent } from "./clio-autogen";
import { GoogleGenerativeAI } from "@google/generative-ai";

// In initialize():
private async setupConversationGroup(): Promise<void> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  
  // Create agents
  const coordinatorAgent = {
    name: "Coordinator",
    system_message: "You are Clio, Chief of Staff. Coordinate agents and consult with John.",
    model: "gemini-2.5-pro",
    genai: genAI
  };
  
  const approvalAgent = {
    name: "Approver",
    system_message: "You are John's proxy. Approve or deny requests based on priorities.",
    model: "gemini-2.5-pro",
    genai: genAI
  };
  
  // Create group chat
  this.groupChat = new GroupChat({
    agents: [coordinatorAgent, approvalAgent],
    messages: [],
    max_round: 10
  });
  
  this.manager = new GroupChatManager(this.groupChat);
}

// In handleCapability() for request_approval:
private async requestApproval(params, traceId): Promise<any> {
  const { action, requestedBy, reasoning, urgency } = params;
  
  // Use real conversation
  const response = await this.manager.initiate_chat({
    messages: `${requestedBy} requests approval for: ${action}\nReasoning: ${reasoning}\nUrgency: ${urgency}`,
    summary_method: "reflection_with_llm"
  });
  
  const approved = response.summary.includes("approved");
  
  return {
    approvalId: uuidv4(),
    action,
    approved,
    reasoning: response.summary,
    decidedBy: "john_proxy",
    traceId
  };
}
```

### Test Clio Locally

```bash
# Terminal 2: Start Clio
cd hyphae-agents
npm run start:clio

# Terminal 3: Test
curl -X POST http://localhost:3100/api/rpc/call \
  -d '{
    "sourceAgent": "flint",
    "targetAgent": "clio",
    "capability": "request_approval",
    "params": {
      "action": "deploy_to_production",
      "requestedBy": "flint",
      "reasoning": "All tests passed, security hardened",
      "urgency": "normal"
    },
    "timeout": 60000
  }' \
  -H "Content-Type: application/json"
```

---

## Step 3: Multi-Agent Coordination Test

### Test Clio → Flint Workflow

```typescript
// Simulate: Clio receives task from human, coordinates with Flint

async function testMultiAgentWorkflow() {
  const hyphae = "http://localhost:3100";
  
  // 1. Clio receives task
  console.log("1️⃣ Clio receives: Deploy Hyphae to production");
  
  // 2. Clio consults with John proxy (AutoGen)
  const approval = await axios.post(`${hyphae}/api/rpc/call`, {
    sourceAgent: "human_client",
    targetAgent: "clio",
    capability: "request_approval",
    params: {
      action: "deploy_to_production",
      requestedBy: "human_client",
      reasoning: "Ready for production launch",
      urgency: "high"
    },
    timeout: 60000
  });
  
  if (!approval.data.result.approved) {
    console.log("❌ Deployment rejected");
    return;
  }
  
  console.log("2️⃣ John approves deployment");
  
  // 3. Clio coordinates Flint to execute deployment
  const execution = await axios.post(`${hyphae}/api/rpc/call`, {
    sourceAgent: "clio",
    targetAgent: "flint",
    capability: "execute_task",
    params: {
      task: "Deploy Hyphae to production VPS",
      priority: "critical"
    },
    timeout: 120000
  });
  
  console.log("3️⃣ Flint executes deployment");
  console.log("   Result:", execution.data.result);
  
  // 4. Clio reports back to John
  const report = await axios.post(`${hyphae}/api/rpc/call`, {
    sourceAgent: "clio",
    targetAgent: "clio",
    capability: "status_report",
    params: { scope: "deployment" },
    timeout: 30000
  });
  
  console.log("4️⃣ Clio reports to John");
  console.log("   Status:", report.data.result);
}
```

---

## Step 4: VPS Deployment

### Deploy to VPS

```bash
# 1. SSH to VPS
ssh ubuntu@100.97.161.7
cd workspace

# 2. Ensure Hyphae is running
cd hyphae
docker-compose up -d
curl http://localhost:3100/api/health

# 3. Deploy agents
cd ../hyphae-agents
npm install
npm run build

# 4. Start agents in tmux (persistent)
tmux new-session -d -s flint "npm run start:flint"
tmux new-session -d -s clio "npm run start:clio"

# 5. Verify registration
curl http://localhost:3100/api/services
```

### Test End-to-End

```bash
# From local machine
HYPHAE_URL="http://100.97.161.7:3100"

# Check services registered
curl $HYPHAE_URL/api/services

# Test RPC call
curl -X POST $HYPHAE_URL/api/rpc/call \
  -d '{...}' \
  -H "Content-Type: application/json"

# Query audit trail
curl "$HYPHAE_URL/api/rpc/audit?limit=50"
```

---

## Step 5: Load Testing

### Set Up Load Test

```bash
# Using Apache Bench (ab)
ab -n 10000 -c 100 http://localhost:3100/api/services

# Using wrk
wrk -t12 -c400 -d30s http://localhost:3100/api/services

# Using custom load test
npm run load-test
```

### Target Metrics

- **Throughput:** 1000+ req/sec
- **Latency p99:** <50ms (service discovery)
- **Error Rate:** <0.1%
- **Timeout Accuracy:** Hard deadline within 10ms

---

## Integration Checklist

### Flint (CrewAI)

- [ ] CrewAI installed
- [ ] Engineering team agents created
- [ ] Gemini model integrated
- [ ] execute_task implemented with crew kickoff
- [ ] analyze_code calls Gemini for code review
- [ ] harden_security uses security tools
- [ ] deploy_component orchestrates deployment
- [ ] Tested locally with real tasks
- [ ] Deployed to VPS
- [ ] Load tested (100+ concurrent)

### Clio (AutoGen)

- [ ] AutoGen installed
- [ ] Coordinator + Approver agents created
- [ ] Gemini model integrated
- [ ] request_approval uses conversation group
- [ ] coordinate_agents orchestrates workflows
- [ ] status_report generates real reports
- [ ] escalate_issue notifies humans
- [ ] Tested locally with real workflows
- [ ] Deployed to VPS
- [ ] Load tested (100+ concurrent)

### Integration

- [ ] Clio discovers Flint via Hyphae
- [ ] Flint discovers Clio via Hyphae
- [ ] RPC calls work both directions
- [ ] Audit trail captures all interactions
- [ ] Timeouts enforced on all calls
- [ ] Error messages clear + actionable
- [ ] Health checks passing
- [ ] System stats showing correct data

---

## Common Issues & Fixes

### CrewAI Agent Not Responding

```
Issue: execute_task returns empty result
Fix:
1. Check Gemini API key is set
2. Verify crew initialization completed
3. Check logs for Gemini errors
4. Increase timeout (tasks can be slow)
```

### AutoGen Conversation Stuck

```
Issue: request_approval hangs indefinitely
Fix:
1. Set max_round limit (10-20)
2. Add termination condition
3. Monitor token usage
4. Check Gemini rate limits
```

### Low Throughput

```
Issue: System handles <100 req/sec
Fix:
1. Check database connections (pool size)
2. Verify network bandwidth
3. Monitor CPU/memory usage
4. Profile slow endpoints
5. Add caching for discovery queries
```

---

## Deployment Timeline

| Phase | Task | Duration | Owner |
|-------|------|----------|-------|
| 1 | Setup environments (CrewAI, AutoGen) | 30 min | Flint |
| 2 | Implement Flint real agent | 2 hours | Flint |
| 3 | Implement Clio real agent | 2 hours | Flint |
| 4 | Integration testing (local) | 1 hour | Flint |
| 5 | VPS deployment | 1 hour | Flint |
| 6 | Load testing | 1 hour | Flint |
| 7 | Production validation | 1 hour | John |
| **Total** | | **8 hours** | |

---

## Success Criteria

✅ Both agents register with Hyphae  
✅ Service discovery returns both agents  
✅ RPC calls work both directions  
✅ Audit trail complete + accurate  
✅ Timeouts enforced (no hanging calls)  
✅ Gemini models responding correctly  
✅ System handles 1000+ req/sec  
✅ 24-hour stability test passes  
✅ Zero data loss  
✅ Clear audit trail for all operations  

---

## What's After Phase 2?

### Phase 3 (Production Hardening)
- HTTPS/TLS
- Rate limiting
- Multi-region federation
- Disaster recovery automation
- Enterprise security

### Phase 4 (Scaling)
- Add researcher agent
- Add analyzer agent
- Add writer agent
- Custom agent templates

---

## Questions?

Refer to:
- HYPHAE_AGENT_INTEGRATION_GUIDE.md (agent templates)
- HYPHAE_CORE_IMPLEMENTATION.md (architecture)
- HYPHAE_DEPLOYMENT_GUIDE.md (operations)

