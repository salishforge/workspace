# Hyphae Dashboard

Web frontend for communicating with Hyphae agents.

## Features

✅ **Agent Discovery** — Automatically find all available agents  
✅ **Real-time Chat** — Direct communication with Flint and Clio  
✅ **RPC Call Builder** — Construct and send capability calls  
✅ **System Health** — Monitor Hyphae core and agent status  
✅ **Call History** — Track all RPC interactions  
✅ **Audit Trail** — View all agent transactions  

## Quick Start

### Installation

```bash
npm install
```

### Start Dashboard

```bash
npm start
```

The dashboard will be available at: `http://localhost:3200`

### Configuration

Environment variables:

```bash
DASHBOARD_PORT=3200                      # Dashboard port (default: 3200)
HYPHAE_PROXY_URL=http://localhost:3000   # Proxy URL
HYPHAE_CORE_URL=http://localhost:3100    # Hyphae core URL
```

## Usage

### 1. Authentication

Enter your API key to get a JWT token.

### 2. Select Agent

Choose Flint or Clio from the sidebar.

### 3. Send Message

Type your message and click Send (or press Enter).

The agent will respond with the result of your request.

## Architecture

```
Browser → Hyphae Dashboard (3200)
          ↓ (Node.js Express)
          ↓ Proxy (3000)
          ↓
          Hyphae Core (3100)
          ├─ Flint (3050)
          └─ Clio (3051)
```

## What Each Agent Can Do

### Flint (CTO)

- `execute_task` — Orchestrate complex work
- `analyze_code` — Code review and quality scoring
- `harden_security` — Vulnerability assessment
- `deploy_component` — Orchestrated deployments
- `status` — Real-time metrics

### Clio (Chief of Staff)

- `request_approval` — AI-powered approvals
- `coordinate_agents` — Multi-agent workflows
- `status_report` — Daily/weekly reporting
- `escalate_issue` — Urgent escalations
- `schedule_meeting` — Meeting orchestration
- `get_priorities` — Organizational context
- `status` — Real-time metrics

## Files

- `server.js` — Express backend (proxies to Hyphae)
- `public/index.html` — Frontend (React-free single-page app)
- `package.json` — Dependencies

## Development

For auto-reload during development:

```bash
npm install -g nodemon
npm run dev
```

## Deployment

See `../../DEPLOYMENT_COMPLETE.md` for full VPS deployment instructions.

---

Built for Salish Forge.
