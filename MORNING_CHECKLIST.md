# Morning Startup Checklist - Hyphae System

**Time estimate: 2-3 minutes**

## Quick Start

### 1. SSH to VPS
```bash
ssh artificium@100.97.161.7
```

### 2. Set Environment & Start Agents
```bash
# Export the Gemini API key
export GOOGLE_API_KEY=$(grep GEMINI_API_KEY ~/.bashrc | cut -d'"' -f2)
export PORT=3050

# Start Flint in background
cd /home/artificium/workspace/hyphae-agents
node dist/flint-crewai-real.js > /tmp/flint.log 2>&1 &
FLINT_PID=$!

# Start Clio
export PORT=3051
node dist/clio-autogen-real.js > /tmp/clio.log 2>&1 &
CLIO_PID=$!

echo "Flint PID: $FLINT_PID"
echo "Clio PID: $CLIO_PID"

# Wait 10 seconds for startup
sleep 10

# Verify
tail /tmp/flint.log | grep "listening"
tail /tmp/clio.log | grep "listening"
```

### 3. Access Dashboard
**Open in browser:**
```
https://100.97.161.7:3200
```

**Accept certificate warning** (self-signed, normal)

**Login:**
- API Key: `VT2uV0CzNp0MkuXNAfHFtXdTSFSb/7KXVI712r+vbRw=`

### 4. Test Chat
- Select "Flint" from sidebar
- Type: "What's your status?"
- Should get agent response with capabilities and metrics
- Try "hello?" to test chat capability

### 5. Try Clio
- Switch to Clio
- Send message
- Should get Chief of Staff response

## What's Running

✅ Flint Agent (port 3050) - CrewAI + Gemini 2.5 Pro
✅ Clio Agent (port 3051) - AutoGen + Gemini 2.5 Pro  
✅ Hyphae Core (port 3100) - RPC coordination
✅ Proxy (port 8443) - JWT authentication
✅ Dashboard (port 3200) - HTTPS web UI

## Troubleshooting

### Agents Not Starting
```bash
# Check logs
tail -20 /tmp/flint.log
tail -20 /tmp/clio.log

# Verify environment variable
echo $GOOGLE_API_KEY  # Should show API key value

# Restart
pkill -f "node.*crewai\|node.*autogen"
export GOOGLE_API_KEY=$(grep GEMINI_API_KEY ~/.bashrc | cut -d'"' -f2)
cd /home/artificium/workspace/hyphae-agents
node dist/flint-crewai-real.js > /tmp/flint.log 2>&1 &
```

### Dashboard Not Loading
```bash
# Check proxy
curl http://localhost:8443/health

# Check dashboard
ps aux | grep "node.*dashboard"

# Test RPC
curl http://localhost:3100/api/health
```

## Production Notes

- All services run via nohup in background
- Logs in `/tmp/*.log`
- Agents configured for auto-restart on crash (systemd can be configured later)
- Database persists via PostgreSQL 
- Audit trail enabled for all RPC calls

## Next Steps

Once agents are running:
1. Test chat capability with both agents
2. Try multi-agent workflows (Flint → Clio → Flint)
3. Monitor logs for performance
4. Optional: Set up persistent systemd services
5. Optional: Integrate Telegram bots (code ready in hyphae-telegram/)

## Technical Details

- **Chat Capability**: Agents now support real conversation via Gemini 2.5 Pro
- **Environment Handling**: Agents read API key from ~/.bashrc as fallback
- **Authentication**: JWT tokens valid for 1 hour (regenerate as needed)
- **Rate Limiting**: 100 requests/min per user

---

**Estimated total time: 2-3 minutes**

All infrastructure is ready. Just need to start the agent processes.

Created: 2026-03-19 02:05 PDT
