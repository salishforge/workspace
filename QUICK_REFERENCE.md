# Quick Reference Guide

**For:** When you need answers fast  
**Not:** Complete information (see detailed docs for that)

---

## Service Status Commands

```bash
# Check all services
sudo systemctl status health-dashboard memforge hyphae

# View logs (last 50 lines)
sudo journalctl -u memforge -n 50

# Follow logs (live)
sudo journalctl -u memforge -f

# Restart service
sudo systemctl restart memforge
```

---

## Health Checks

```bash
# Dashboard
curl http://localhost:3000/health

# MemForge
curl http://localhost:3333/health

# Hyphae (requires token)
TOKEN="test-auth-token-salish-forge-2026"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3004/health
```

---

## Common Operations

### Add Memory

```bash
curl -X POST http://localhost:3333/memory/flint/add \
  -H "Content-Type: application/json" \
  -d '{"content":"Your memory here"}'
```

### Search Memory

```bash
curl "http://localhost:3333/memory/flint/query?q=meeting"
```

### Register Service in Hyphae

```bash
TOKEN="test-auth-token-salish-forge-2026"

curl -X POST http://localhost:3004/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-service",
    "type": "worker",
    "capabilities": ["process"],
    "endpoint": "http://localhost:9000"
  }'
```

### List Services in Hyphae

```bash
TOKEN="test-auth-token-salish-forge-2026"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3004/services
```

---

## Environment Variables

### MemForge

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tidepool
PORT=3333
NODE_ENV=production
CONSOLIDATION_BATCH_SIZE=500
```

### Hyphae

```bash
HYPHAE_AUTH_TOKEN=test-auth-token-salish-forge-2026
PORT=3004
NODE_ENV=production
```

### Dashboard

```bash
PORT=3000
NODE_ENV=production
```

---

## File Locations

```
VPS: 100.97.161.7

/home/artificium/health-dashboard/    → Dashboard service
/home/artificium/memforge/            → MemForge service
/home/artificium/hyphae/              → Hyphae service

/etc/systemd/system/health-dashboard.service
/etc/systemd/system/memforge.service
/etc/systemd/system/hyphae.service

/home/artificium/memforge/.env        → Database URL
/home/artificium/.hyphae.env          → Hyphae token
```

---

## Common Issues & Fixes

### Service Won't Start

```bash
# Check logs
sudo journalctl -u memforge -n 50

# Try manual run to see error
cd /home/artificium/memforge
DATABASE_URL=postgres://... node dist/server.js
```

### Port Already in Use

```bash
# Kill process on port 3333
sudo fuser -k 3333/tcp

# Restart service
sudo systemctl restart memforge
```

### PostgreSQL Connection Error

```bash
# Test connection
psql -h localhost -U postgres -d tidepool

# Check if running
sudo systemctl status postgresql
```

### Memory Leaks

```bash
# Monitor memory over time
watch -n 5 'ps aux | grep node'

# Check if connections are being cleaned up
psql -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## Logs to Check

**Service Issues:**
```bash
sudo journalctl -u memforge -n 100
```

**Security Issues:**
```bash
sudo journalctl | grep Unauthorized
sudo journalctl | grep Forbidden
```

**Performance Issues:**
```bash
ps aux | grep node
free -h
```

---

## Quick Deployment Checklist

- [ ] Service running: `sudo systemctl status memforge`
- [ ] Port listening: `sudo ss -tulpn | grep 3333`
- [ ] Health check passes: `curl http://localhost:3333/health`
- [ ] Logs clean: No errors in `sudo journalctl -u memforge -n 20`
- [ ] Can add memory: `curl -X POST .../memory/test/add ...`
- [ ] Can search: `curl .../memory/test/query?q=test`

---

## Emergency Kill Switch

```bash
# Stop all services
sudo systemctl stop health-dashboard memforge hyphae

# Verify stopped
sudo systemctl status health-dashboard memforge hyphae

# Start all services
sudo systemctl start health-dashboard memforge hyphae
```

---

## Restart All Services (Safe)

```bash
# One at a time (safer than stopping all)
sudo systemctl restart health-dashboard
sleep 2
sudo systemctl restart memforge
sleep 2
sudo systemctl restart hyphae

# Verify all healthy
curl http://localhost:3000/health
curl http://localhost:3333/health
curl -H "Authorization: Bearer test-auth-token-salish-forge-2026" http://localhost:3004/health
```

---

## Database Commands

```bash
# Connect to database
psql -h localhost -U postgres -d tidepool

# Check memory tables
SELECT COUNT(*) FROM hot_tier;
SELECT COUNT(*) FROM warm_tier;
SELECT COUNT(*) FROM cold_tier;

# Check consolidation audit
SELECT * FROM consolidation_audit ORDER BY created_at DESC LIMIT 10;

# Check memory for specific agent
SELECT COUNT(*) FROM hot_tier WHERE agent_id = 'flint';
```

---

## Testing

```bash
# Load test dashboard (100 requests, 20 concurrent)
ab -n 100 -c 20 http://localhost:3000/health

# Load test memforge
ab -n 100 -c 20 http://localhost:3333/health

# Load test hyphae
for i in {1..100}; do
  curl -s -H "Authorization: Bearer test-auth-token-salish-forge-2026" \
    http://localhost:3004/services &
done
wait
```

---

## GitHub Commands

```bash
# Clone all repos
git clone https://github.com/salishforge/dashboard.git
git clone https://github.com/salishforge/memforge.git
git clone https://github.com/salishforge/hyphae.git

# Check out specific version
cd memforge && git checkout v0.1.0-alpha

# See releases
gh release list -R salishforge/memforge

# Create release
gh release create -R salishforge/memforge v0.2.0 --title "Release v0.2.0"
```

---

## SSH to VPS

```bash
# Basic SSH
ssh artificium@100.97.161.7

# With specific key
ssh -i /path/to/key artificium@100.97.161.7

# Copy file from VPS
scp artificium@100.97.161.7:/home/artificium/memforge/.env ./

# Copy file to VPS
scp ./file.env artificium@100.97.161.7:/home/artificium/memforge/.env
```

---

## Important URLs

```
Health Dashboard:  http://100.97.161.7:3000
MemForge:          http://100.97.161.7:3333
Hyphae:            http://100.97.161.7:3004

GitHub Dashboard:  https://github.com/salishforge/dashboard
GitHub MemForge:   https://github.com/salishforge/memforge
GitHub Hyphae:     https://github.com/salishforge/hyphae
```

---

## Secrets & Tokens

```
Hyphae Auth Token:        test-auth-token-salish-forge-2026
PostgreSQL User:          postgres
PostgreSQL Password:      postgres (TO BE ROTATED)
PostgreSQL Host:          localhost
PostgreSQL Port:          5432
PostgreSQL Database:      tidepool
```

**IMPORTANT:** These are test credentials. Rotate before production!

---

## Monitoring Commands

```bash
# CPU & Memory usage
top -u artificium

# Disk space
df -h

# Network connections
sudo ss -tulpn

# Open files per process
lsof -p <PID>

# Database connections
psql -c "SELECT usename, application_name, state FROM pg_stat_activity;"
```

---

## When to Escalate

- ✅ Normal: Service temporarily unavailable, restart fixes it
- ✅ Normal: Slow queries, optimize index
- ⚠️ Escalate: Service crashes immediately on start (check DATABASE_URL)
- ⚠️ Escalate: Memory grows indefinitely (memory leak)
- 🚨 Escalate: Unauthorized access attempts (security breach)
- 🚨 Escalate: Data corruption detected
- 🚨 Escalate: Multiple services down simultaneously

---

**Last Updated:** 2026-03-18  
**Print this if you like 📋**

