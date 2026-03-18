# Production Deployment Guide

**Version:** 1.0  
**Date:** 2026-03-18  
**Audience:** Operations team, DevOps engineers

---

## Pre-Deployment Checklist

### Infrastructure Requirements

- [ ] VPS provisioned (Debian 13+, 2+ cores, 4GB+ RAM, 20GB+ disk)
- [ ] SSH access available (key-based auth)
- [ ] Static IP or DNS record configured
- [ ] Firewall rules allowing: 3000, 3333, 3004 (or via reverse proxy)
- [ ] PostgreSQL 14+ available (local or managed service)
- [ ] NATS server available (local or managed service)
- [ ] Tailscale or VPN access configured (if internal network)

### Software Prerequisites

```bash
# On deployment target VPS
node --version        # v18.0.0 or higher
npm --version         # v8.0.0 or higher
psql --version        # PostgreSQL 14+
systemctl --version   # Systemd available
```

### Credentials & Secrets

- [ ] SSH key for VPS access
- [ ] PostgreSQL admin credentials (or sudo access)
- [ ] OAuth2 client credentials (generated during deployment)
- [ ] TLS certificates (self-signed or purchased)
- [ ] Backup of all credentials in secure vault

---

## Step 1: Provision Infrastructure

### 1.1 Create VPS

```bash
# Example: DigitalOcean / Hetzner / AWS
# Choose: Debian 13, 2+ cores, 4GB+ RAM, 20GB+ disk
# Assign static IP: e.g., 15.204.91.70
# Configure DNS: e.g., salishforge.com → 15.204.91.70
```

### 1.2 Set Up Networking

```bash
# SSH to VPS
ssh root@15.204.91.70

# Update system
apt-get update && apt-get upgrade -y

# Install dependencies
apt-get install -y \
  nodejs npm postgresql postgresql-contrib \
  curl wget git build-essential \
  systemd

# Create non-root user
useradd -m -s /bin/bash artificium
usermod -aG sudo artificium

# Set up SSH key
su - artificium
mkdir -p ~/.ssh
# Paste public key into ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys

# Disable root login via SSH
sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

### 1.3 Configure PostgreSQL

```bash
# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << SQL
CREATE DATABASE tidepool;
CREATE USER tidepool_admin WITH PASSWORD 'random-secure-password-here';
ALTER ROLE tidepool_admin WITH CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE tidepool TO tidepool_admin;
SQL

# Test connection
psql -h localhost -U tidepool_admin -d tidepool -c "SELECT 1;"
```

---

## Step 2: Deploy Services

### 2.1 Clone Repositories

```bash
cd /home/artificium

# Dashboard
git clone https://github.com/salishforge/dashboard.git
cd dashboard && git checkout v0.1.0-alpha
npm install && npm run build
cd ..

# MemForge
git clone https://github.com/salishforge/memforge.git
cd memforge && git checkout v0.1.0-alpha
npm install && npm run build
cd ..

# Hyphae
git clone https://github.com/salishforge/hyphae.git
cd hyphae && git checkout v0.1.0-alpha
npm install && npm run build
cd ..
```

### 2.2 Configure Environment Variables

**MemForge .env:**
```bash
cat > /home/artificium/memforge/.env << EOF
DATABASE_URL=postgres://memforge_user:secure-password@localhost:5432/tidepool
PORT=3333
NODE_ENV=production
CONSOLIDATION_BATCH_SIZE=500
CONSOLIDATION_THRESHOLD=50
EOF
chmod 600 /home/artificium/memforge/.env
```

**Hyphae .env:**
```bash
cat > /home/artificium/.hyphae.env << EOF
HYPHAE_AUTH_TOKEN=generate-secure-token-here
PORT=3004
NODE_ENV=production
EOF
chmod 600 /home/artificium/.hyphae.env
```

### 2.3 Generate TLS Certificates

```bash
# Self-signed (for internal/testing)
mkdir -p /etc/ssl/private

for SERVICE in dashboard memforge hyphae; do
  openssl req -x509 -newkey rsa:2048 \
    -keyout /etc/ssl/private/${SERVICE}.key \
    -out /etc/ssl/certs/${SERVICE}.crt \
    -days 365 -nodes \
    -subj "/CN=localhost/O=SalishForge"
  chmod 600 /etc/ssl/private/${SERVICE}.key
done

# OR: Use Let's Encrypt (for public)
# certbot certonly --standalone -d salishforge.com
```

---

## Step 3: Create Systemd Services

### 3.1 Health Dashboard

```bash
sudo tee /etc/systemd/system/health-dashboard.service << EOF
[Unit]
Description=Salish Forge Health Dashboard
After=network.target

[Service]
Type=simple
User=artificium
WorkingDirectory=/home/artificium/health-dashboard
ExecStart=/usr/bin/node dist/health.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
Environment="PORT=3000"

[Install]
WantedBy=multi-user.target
EOF
```

### 3.2 MemForge

```bash
sudo tee /etc/systemd/system/memforge.service << EOF
[Unit]
Description=MemForge Memory Service
After=network.target postgresql.service

[Service]
Type=simple
User=artificium
WorkingDirectory=/home/artificium/memforge
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
EnvironmentFile=/home/artificium/memforge/.env

[Install]
WantedBy=multi-user.target
EOF
```

### 3.3 Hyphae

```bash
sudo tee /etc/systemd/system/hyphae.service << EOF
[Unit]
Description=Hyphae Service Registry
After=network.target

[Service]
Type=simple
User=artificium
WorkingDirectory=/home/artificium
ExecStart=/usr/bin/node hyphae-secure.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
EnvironmentFile=/home/artificium/.hyphae.env

[Install]
WantedBy=multi-user.target
EOF
```

### 3.4 Enable Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable health-dashboard memforge hyphae
sudo systemctl start health-dashboard memforge hyphae

# Verify
sudo systemctl status health-dashboard memforge hyphae
```

---

## Step 4: Verify Deployment

### 4.1 Health Checks

```bash
# All services should respond
curl -s http://localhost:3000/health | jq .
curl -s http://localhost:3333/health | jq .
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3004/health | jq .

# Expected: {"status":"ok",...}
```

### 4.2 Database Verification

```bash
psql -U postgres -d tidepool -c "
  SELECT tablename FROM pg_tables 
  WHERE schemaname = 'public';
"

# Expected: hot_tier, warm_tier, cold_tier, consolidation_audit
```

### 4.3 Logs Review

```bash
# Check for errors
sudo journalctl -u memforge -n 50 --no-pager
sudo journalctl -u health-dashboard -n 50 --no-pager
sudo journalctl -u hyphae -n 50 --no-pager

# Should show: "Started successfully" or "Server listening"
```

---

## Step 5: Post-Deployment Configuration

### 5.1 Set Up Monitoring

```bash
# Install Prometheus (on same VPS or separate)
# Install Grafana (on same VPS or separate)

# Configure scrape target in prometheus.yml:
scrape_configs:
  - job_name: 'salish-forge'
    static_configs:
      - targets: 
        - 'localhost:3000/metrics'
        - 'localhost:3333/metrics'
        - 'localhost:3004/metrics'
```

### 5.2 Configure Backups

```bash
# Daily database backup
0 2 * * * pg_dump -U postgres tidepool | gzip > /backups/tidepool_$(date +\%Y\%m\%d).sql.gz

# Keep 30 days of backups
find /backups -mtime +30 -delete
```

### 5.3 Set Up Log Rotation

```bash
sudo tee /etc/logrotate.d/salish-forge << EOF
/var/log/salish-forge/*.log {
  daily
  rotate 7
  compress
  delaycompress
  notifempty
  create 0640 artificium artificium
  sharedscripts
}
EOF
```

---

## Step 6: Production Hardening

### 6.1 Firewall Configuration

```bash
# UFW firewall
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow 22/tcp

# Allow services (or reverse proxy only)
sudo ufw allow 3000/tcp   # Dashboard
sudo ufw allow 3333/tcp   # MemForge
sudo ufw allow 3004/tcp   # Hyphae

# Or use reverse proxy (nginx/haproxy) for external access
```

### 6.2 SSL/TLS Configuration

```bash
# If using nginx as reverse proxy:
sudo apt-get install -y nginx

# Configure nginx as reverse proxy with SSL termination
# Redirect HTTP → HTTPS
# Forward to backend services (http://localhost:3000, etc.)
```

### 6.3 OS Hardening

```bash
# Disable unnecessary services
sudo systemctl disable bluetooth avahi-daemon cups

# Update system regularly
sudo apt-get update && sudo apt-get upgrade -y

# Configure auto-security-updates
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Verification Checklist

After deployment, verify:

- [ ] All three services running (`sudo systemctl status`)
- [ ] Health endpoints responding (3000, 3333, 3004)
- [ ] Database connection working
- [ ] TLS certificates valid (if HTTPS)
- [ ] Logs clean (no errors in journalctl)
- [ ] Firewall configured
- [ ] Backups scheduled
- [ ] Monitoring configured (Prometheus/Grafana)
- [ ] SSH hardened (key-based auth only)
- [ ] OS hardened (unnecessary services disabled)

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
sudo journalctl -u memforge -f

# Common issues:
# - DATABASE_URL not set → Add to .env
# - Port already in use → Change PORT or kill process
# - Permission denied → Check file permissions
```

### Database Connection Error

```bash
# Test connection
psql -U memforge_user -d tidepool

# Issues:
# - User doesn't exist → Create with psql
# - Password wrong → Reset password
# - Database doesn't exist → Create with createdb
```

### Memory Growing

```bash
# Check for leaks
ps aux | grep node

# Restart if needed
sudo systemctl restart memforge

# Monitor over time
watch -n 5 'ps aux | grep node'
```

---

## Scaling (Future)

If you need to scale beyond single VPS:

1. **Horizontal Scaling:** Run multiple instances behind load balancer
2. **Database Replication:** Set up PostgreSQL replicas for read scaling
3. **Caching Layer:** Add Redis for hot data
4. **CDN:** Use CDN for static assets
5. **Multi-Region:** Deploy to multiple regions with failover

---

## Support & Runbooks

For operational procedures, see:
- OPERATIONS_RUNBOOKS.md — Daily operations
- QUICK_REFERENCE.md — Fast answers
- PRODUCTION_READINESS.md — Pre-launch checklist

---

**Created:** 2026-03-18  
**Version:** 1.0

