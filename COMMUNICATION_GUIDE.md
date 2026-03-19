# How to Communicate with Hyphae Agents

**Quick Start:** You have three ways to talk to your agents. Pick whichever feels most natural.

---

## Option 1: CLI (Command Line) — Recommended for Quick Tasks

### Simple Status Check
```bash
# Are the agents alive?
hyphae-cli status

# See what's registered
hyphae-cli discover
```

### Ask Flint to Do Something
```bash
# Execute a task
hyphae-cli call you flint execute_task \
  --params '{"task":"Deploy Hyphae to production","priority":"critical"}'

# Get Flint's status
hyphae-cli call you flint status

# Ask Flint to review code
hyphae-cli call you flint analyze_code \
  --params '{"file":"app.ts","code":"function hello() { console.log(\"hi\"); }"}'
```

### Ask Clio to Coordinate
```bash
# Request approval for something
hyphae-cli call you clio request_approval \
  --params '{"action":"deploy_to_production","requestedBy":"you","reasoning":"All tests pass","urgency":"normal"}'

# Get Clio's current priorities
hyphae-cli call you clio get_priorities

# Ask Clio to coordinate agents
hyphae-cli call you clio coordinate_agents \
  --params '{"workflow":"deploy_system","agents":["flint"],"deadline":"2026-03-19T12:00:00Z"}'
```

---

## Option 2: HTTP API (Programmatic) — For Integration

### Simple Health Check
```bash
curl http://localhost:3100/api/health
```

### Discover Agents
```bash
# What agents are available?
curl http://localhost:3100/api/services

# What can Flint do?
curl http://localhost:3100/api/services/flint

# Who can execute tasks?
curl 'http://localhost:3100/api/services?capability=execute_task'
```

### Call Flint via RPC
```bash
curl -X POST http://localhost:3100/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "you",
    "targetAgent": "flint",
    "capability": "execute_task",
    "params": {
      "task": "Deploy Hyphae to production",
      "priority": "critical"
    },
    "timeout": 60000
  }'
```

### Call Clio via RPC
```bash
curl -X POST http://localhost:3100/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAgent": "you",
    "targetAgent": "clio",
    "capability": "request_approval",
    "params": {
      "action": "deploy_to_production",
      "requestedBy": "you",
      "reasoning": "All tests passed and security hardened",
      "urgency": "normal"
    },
    "timeout": 60000
  }'
```

### Check What Happened (Audit Trail)
```bash
# See all RPC calls
curl 'http://localhost:3100/api/rpc/audit?limit=50'

# See calls from you to Flint
curl 'http://localhost:3100/api/rpc/audit?sourceAgent=you&targetAgent=flint&limit=20'

# See failed calls
curl 'http://localhost:3100/api/rpc/audit?status=FAILED&limit=10'
```

---

## Option 3: Direct Agent Communication — For Detailed Work

### Call Flint Directly
```bash
# Flint's /rpc endpoint is at http://localhost:3050/rpc
curl -X POST http://localhost:3050/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "execute_task",
    "params": {
      "task": "Code review for main.ts",
      "priority": "high"
    },
    "traceId": "abc-123"
  }'

# Get Flint's status directly
curl http://localhost:3050/status

# Check if Flint is healthy
curl http://localhost:3050/health
```

### Call Clio Directly
```bash
# Clio's /rpc endpoint is at http://localhost:3051/rpc
curl -X POST http://localhost:3051/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "status_report",
    "params": {
      "scope": "daily",
      "format": "brief"
    },
    "traceId": "xyz-789"
  }'

# Get Clio's status directly
curl http://localhost:3051/status

# Check if Clio is healthy
curl http://localhost:3051/health
```

---

## Flint's Capabilities

### 1. Execute Task
```bash
hyphae-cli call you flint execute_task \
  --params '{
    "task": "Deploy Hyphae to production",
    "priority": "critical"
  }'
```
**What Flint does:**
- Uses Gemini to break task into subtasks
- Assigns to engineering team (Lead, Security, DevOps)
- Executes each subtask with Gemini reasoning
- Returns: taskId, status, accomplishments, confidence score

### 2. Analyze Code
```bash
hyphae-cli call you flint analyze_code \
  --params '{
    "file": "src/main.ts",
    "code": "...",
    "type": "full"
  }'
```
**What Flint does:**
- Quality score (0-100)
- Critical issues (security, performance)
- Code quality issues
- Architectural concerns
- Specific improvements

### 3. Harden Security
```bash
hyphae-cli call you flint harden_security \
  --params '{
    "component": "api_server",
    "depth": "comprehensive"
  }'
```
**What Flint does:**
- Identifies attack vectors
- Lists vulnerabilities and risks
- Proposes improvements (prioritized)
- Implementation steps
- Testing strategy
- Timeline

### 4. Deploy Component
```bash
hyphae-cli call you flint deploy_component \
  --params '{
    "component": "hyphae-core",
    "version": "1.0.0",
    "environment": "production"
  }'
```
**What Flint does:**
- Pre-deployment checklist
- Deployment steps (detailed)
- Health checks and validation
- Rollback plan
- Monitoring setup
- Expected downtime

### 5. Get Status
```bash
hyphae-cli call you flint status
```
**Response:**
- Current status (operational)
- Engineering team info
- Metrics (tasks completed, success rate)
- Available capabilities

---

## Clio's Capabilities

### 1. Request Approval
```bash
hyphae-cli call you clio request_approval \
  --params '{
    "action": "deploy_to_production",
    "requestedBy": "flint",
    "reasoning": "All tests pass, security hardened",
    "urgency": "normal"
  }'
```
**What Clio does:**
- Analyzes against current priorities
- Identifies risks and dependencies
- Makes approval decision
- Returns: approved (true/false), reasoning, risks

### 2. Coordinate Agents
```bash
hyphae-cli call you clio coordinate_agents \
  --params '{
    "workflow": "deploy_system",
    "agents": ["flint"],
    "deadline": "2026-03-19T18:00:00Z"
  }'
```
**What Clio does:**
- Plans workflow phases
- Assigns agents to phases
- Identifies dependencies
- Risk assessment
- Timeline to deadline
- Returns: workflowId, steps, timeline, risk level

### 3. Status Report
```bash
hyphae-cli call you clio status_report \
  --params '{
    "scope": "daily",
    "format": "brief"
  }'
```
**Scope options:** daily, weekly, monthly  
**Format options:** brief, detailed  

**What Clio does:**
- Generates intelligence report
- Key accomplishments
- Current blockers
- Next actions
- Key metrics

### 4. Escalate Issue
```bash
hyphae-cli call you clio escalate_issue \
  --params '{
    "issue": "Database connection pool exhausted",
    "severity": "critical",
    "context": "3 services affected, cascading failures"
  }'
```
**What Clio does:**
- Issues urgent escalation
- Recommends immediate actions
- Timeline for response
- Resources needed

### 5. Schedule Meeting
```bash
hyphae-cli call you clio schedule_meeting \
  --params '{
    "title": "System Architecture Review",
    "participants": ["flint", "you"],
    "duration": 60,
    "agenda": "Review deployment strategy"
  }'
```
**What Clio does:**
- Proposes optimal meeting time
- Format suggestion (sync/async)
- Preparation needed
- Expected outcomes

### 6. Get Priorities
```bash
hyphae-cli call you clio get_priorities
```
**Response:**
- Current priority list
- Last updated
- Next review date

### 7. Get Status
```bash
hyphae-cli call you clio status
```
**Response:**
- Current status (operational)
- Current focus
- Priorities list
- Active workflows
- Metrics (approvals handled, success rate)

---

## Real Examples

### Example 1: Task Execution
```bash
# You: "Flint, I need you to deploy the new code"
hyphae-cli call you flint execute_task \
  --params '{"task":"Deploy latest code to production","priority":"high"}'

# Flint:
# - Breaks it into: code review, security check, deployment, validation
# - Assigns lead engineer to review
# - Assigns security engineer to check
# - Assigns DevOps to deploy
# - Returns results with confidence score
```

### Example 2: Approval Workflow
```bash
# Flint: "I want to deploy, need approval"
hyphae-cli call flint clio request_approval \
  --params '{"action":"deploy_to_production","requestedBy":"flint","reasoning":"All tests pass","urgency":"high"}'

# Clio:
# - Checks priorities
# - Analyzes risks
# - Makes decision
# - Returns: approved=true, reasoning="Aligned with deployment priority"
```

### Example 3: Coordinated Workflow
```bash
# You: "I need a full deployment workflow"
hyphae-cli call you clio coordinate_agents \
  --params '{"workflow":"full_system_deployment","agents":["flint"],"deadline":"2026-03-19T20:00:00Z"}'

# Clio:
# - Plans: validation → security → deployment → monitoring
# - Assigns Flint to each phase
# - Returns workflow with steps and timeline
```

---

## Monitoring & Debugging

### Check System Health
```bash
# Overall health
curl http://localhost:3100/api/health

# System stats (services, calls, throughput)
curl http://localhost:3100/api/stats

# All registered services
curl http://localhost:3100/api/services
```

### View Logs
```bash
# Flint logs
tail -f /tmp/flint.log

# Clio logs
tail -f /tmp/clio.log

# Hyphae core
docker-compose logs hyphae-core -f
```

### Query Audit Trail
```bash
# All calls in last hour
curl 'http://localhost:3100/api/rpc/audit?limit=100'

# Calls from you
curl 'http://localhost:3100/api/rpc/audit?sourceAgent=you&limit=50'

# Failed calls
curl 'http://localhost:3100/api/rpc/audit?status=FAILED&limit=20'

# Calls to Flint
curl 'http://localhost:3100/api/rpc/audit?targetAgent=flint&limit=50'
```

---

## Integration Example (Your Workflow)

### Scenario: You want to deploy Hyphae to production

```bash
# Step 1: Check current status
hyphae-cli status
# → Shows healthy system with both agents ready

# Step 2: Ask Flint to prepare deployment
hyphae-cli call you flint execute_task \
  --params '{"task":"Prepare Hyphae for production deployment","priority":"critical"}'
# → Flint reviews code, security, creates deployment plan

# Step 3: Ask Clio to request approval
hyphae-cli call flint clio request_approval \
  --params '{"action":"deploy_hyphae_to_production","requestedBy":"flint","reasoning":"All checks pass","urgency":"high"}'
# → Clio analyzes and approves (or requests more info)

# Step 4: Execute deployment
hyphae-cli call you flint deploy_component \
  --params '{"component":"hyphae-core","version":"1.0.0","environment":"production"}'
# → Flint executes deployment with rollback plan

# Step 5: Check results
curl 'http://localhost:3100/api/rpc/audit?limit=10'
# → See all actions taken and their results
```

---

## Troubleshooting

### "Agent not found"
```bash
# Check if agents registered
curl http://localhost:3100/api/services

# If empty, check logs
tail -f /tmp/flint.log
tail -f /tmp/clio.log
```

### "RPC call timeout"
- Gemini calls can take up to 60 seconds
- Increase timeout in your request: `"timeout": 120000` (2 minutes)

### "Hyphae not responding"
```bash
# Check if Hyphae core is running
curl http://localhost:3100/api/health

# If not, restart
cd ~/workspace/hyphae
docker-compose restart
```

### "Want to see what agents are thinking"
- Check the audit trail: `curl http://localhost:3100/api/rpc/audit?limit=50`
- View agent logs directly: `tail -f /tmp/flint.log`

---

## Next Steps

1. **Deploy to VPS:** Use the deployment script provided
2. **Test communication:** Try the CLI examples above
3. **Monitor:** Watch logs and audit trail as you use the system
4. **Integrate:** Build tools on top of the HTTP API

You now have a production-ready multi-agent system that understands context, makes decisions, and coordinates work. Enjoy! 🚀

---

