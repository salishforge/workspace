# Hyphae Core Deployment Guide

**Status:** Ready for VPS Deployment  
**Date:** March 19, 2026  
**Target Environment:** VPS at 100.97.161.7

---

## Quick Start

### Local Development

```bash
# Install dependencies
cd hyphae
npm install

# Build TypeScript
npm run build

# Start HTTP RPC server
npm run dev

# In another terminal, use CLI
npm run cli

# Run tests
npm test
```

### Docker Deployment

```bash
# Build image
docker build -t salishforge/hyphae-core:latest .

# Run with docker-compose
docker-compose up -d

# Verify
curl http://localhost:3100/api/health
```

---

## VPS Deployment (Production)

### Prerequisites

- VPS: 100.97.161.7 (running PostgreSQL on port 5432)
- PostgreSQL databases created:
  - `hyphae` (main database)
  - `hyphae_audit` (append-only audit logs)
  - `hyphae_backup` (daily snapshots)
- Node.js 20+ installed
- Docker + Docker Compose installed (optional but recommended)

### Installation

**1. Clone repository and checkout feature branch**

```bash
cd /home/artificium/dev
git clone https://github.com/salishforge/workspace.git
cd workspace
git checkout feat/hyphae-core
```

**2. Install dependencies**

```bash
cd hyphae
npm install --production
npm run build
```

**3. Create .env file**

```bash
cat > .env << 'EOF'
# Database
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=hyphae
DB_USER=hyphae_user
DB_PASSWORD=<SECURE_PASSWORD>

# Server
PORT=3100
NODE_ENV=production

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/hyphae/server.log

# TLS (optional for now)
TLS_ENABLED=false
TLS_CERT=/etc/hyphae/cert.pem
TLS_KEY=/etc/hyphae/key.pem

# ERA
ERA_ENABLED=true
ERA_PORT=3101
MFA_ENABLED=true

# Backup
BACKUP_ENABLED=true
BACKUP_PATH=/var/lib/hyphae/backups
BACKUP_INTERVAL=86400
EOF
```

**4. Create database**

```bash
# Connect to PostgreSQL
psql -h 127.0.0.1 -U postgres

# Create database and user
CREATE DATABASE hyphae;
CREATE USER hyphae_user WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE hyphae TO hyphae_user;

# Initialize schema (server does this automatically)
exit
```

**5. Create systemd service**

```bash
sudo cat > /etc/systemd/system/hyphae-core.service << 'EOF'
[Unit]
Description=Hyphae Core - Multi-Agent Coordination Platform
After=network.target postgresql.service

[Service]
Type=simple
User=hyphae
WorkingDirectory=/home/artificium/dev/workspace/hyphae
EnvironmentFile=/home/artificium/dev/workspace/hyphae/.env
ExecStart=/usr/bin/node dist/http-rpc-server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Resource limits
MemoryLimit=1G
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF

# Create user
sudo useradd -r -s /bin/false hyphae

# Start service
sudo systemctl daemon-reload
sudo systemctl enable hyphae-core
sudo systemctl start hyphae-core

# Check status
sudo systemctl status hyphae-core
```

**6. Verify installation**

```bash
# Check health
curl http://localhost:3100/api/health

# Check stats
curl http://localhost:3100/api/stats

# Should see:
# {"status":"healthy","timestamp":"2026-03-19T..."}
# {"success":true,"stats":{"healthyServices":0,...}}
```

---

## Docker Deployment (Recommended)

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose ports
EXPOSE 3100 3101

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3100/api/health || exit 1

# Run server
CMD ["node", "dist/http-rpc-server.js"]
```

### docker-compose.yml

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    container_name: hyphae-postgres
    environment:
      POSTGRES_DB: hyphae
      POSTGRES_USER: hyphae_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hyphae_user"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - hyphae

  hyphae-core:
    build: .
    container_name: hyphae-core
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: hyphae
      DB_USER: hyphae_user
      DB_PASSWORD: ${DB_PASSWORD}
      PORT: 3100
      NODE_ENV: production
      LOG_LEVEL: info
    ports:
      - "127.0.0.1:3100:3100"
      - "127.0.0.1:3101:3101"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    networks:
      - hyphae
    volumes:
      - hyphae_logs:/var/log/hyphae
      - hyphae_backups:/var/lib/hyphae/backups

  era:
    build:
      context: .
      dockerfile: Dockerfile.era
    container_name: hyphae-era
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: hyphae
      DB_USER: hyphae_user
      DB_PASSWORD: ${DB_PASSWORD}
      ERA_PORT: 3101
      NODE_ENV: production
    ports:
      - "127.0.0.1:3101:3101"
    depends_on:
      postgres:
        condition: service_healthy
      hyphae-core:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - hyphae
    stdin_open: true
    tty: true

volumes:
  postgres_data:
    driver: local
  hyphae_logs:
    driver: local
  hyphae_backups:
    driver: local

networks:
  hyphae:
    driver: bridge
```

### Deploy to VPS

```bash
# SSH to VPS
ssh ubuntu@100.97.161.7

# Clone workspace
cd /home/ubuntu
git clone https://github.com/salishforge/workspace.git
cd workspace

# Create .env
cat > hyphae/.env << 'EOF'
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=hyphae
DB_USER=hyphae_user
DB_PASSWORD=<GENERATE_SECURE_PASSWORD>
PORT=3100
NODE_ENV=production
EOF

# Deploy with docker-compose
cd hyphae
docker-compose up -d

# Verify
docker-compose ps
curl http://localhost:3100/api/health
docker-compose logs hyphae-core
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | hyphae | Database name |
| `DB_USER` | postgres | Database user |
| `DB_PASSWORD` | (required) | Database password |
| `PORT` | 3100 | HTTP server port |
| `NODE_ENV` | development | Environment (production/development) |
| `LOG_LEVEL` | info | Log level (debug/info/warn/error) |
| `ERA_ENABLED` | true | Enable ERA |
| `ERA_PORT` | 3101 | ERA port |
| `TLS_ENABLED` | false | Enable HTTPS |
| `TLS_CERT` | (optional) | TLS certificate path |
| `TLS_KEY` | (optional) | TLS key path |

---

## Monitoring

### Health Checks

```bash
# Basic health
curl http://localhost:3100/api/health

# System stats
curl http://localhost:3100/api/stats

# Service count
curl http://localhost:3100/api/services | jq '.count'
```

### Logs

```bash
# Docker
docker-compose logs -f hyphae-core

# Systemd
sudo journalctl -u hyphae-core -f

# File
tail -f /var/log/hyphae/server.log
```

### Database Monitoring

```bash
# Connect to database
psql -h 127.0.0.1 -U hyphae_user -d hyphae

# Check service count
SELECT COUNT(*) FROM hyphae_services WHERE healthy = true;

# Check RPC call rate
SELECT COUNT(*) FROM hyphae_rpc_audit WHERE called_at > NOW() - INTERVAL '1 hour';

# Check error rate
SELECT status, COUNT(*) FROM hyphae_rpc_audit WHERE called_at > NOW() - INTERVAL '1 hour' GROUP BY status;

# Check slowest services
SELECT target_agent, AVG(duration_ms) as avg_duration FROM hyphae_rpc_audit WHERE duration_ms IS NOT NULL GROUP BY target_agent ORDER BY avg_duration DESC;
```

---

## Backup & Recovery

### Automated Backups

```bash
# PostgreSQL backup (daily)
0 2 * * * pg_dump -h 127.0.0.1 -U hyphae_user hyphae > /var/lib/hyphae/backups/hyphae-$(date +\%Y\%m\%d).sql

# Compress
0 3 * * * gzip /var/lib/hyphae/backups/hyphae-*.sql

# Clean old backups
0 4 * * * find /var/lib/hyphae/backups -name "*.sql.gz" -mtime +30 -delete
```

### Restore from Backup

```bash
# Restore latest backup
psql -h 127.0.0.1 -U hyphae_user -d hyphae < /var/lib/hyphae/backups/hyphae-latest.sql

# Or restore specific date
psql -h 127.0.0.1 -U hyphae_user -d hyphae < /var/lib/hyphae/backups/hyphae-20260319.sql
```

---

## Security

### Network Security

```bash
# Only allow localhost access (use SSH tunnel for remote)
ufw default deny incoming
ufw allow 22/tcp
ufw allow 127.0.0.1:3100
ufw allow 127.0.0.1:3101
ufw enable

# SSH tunnel from aihome to VPS
ssh -L 3100:127.0.0.1:3100 ubuntu@100.97.161.7
```

### Database Security

```bash
# Use strong password
openssl rand -base64 32

# Create restricted user
CREATE ROLE hyphae_user WITH PASSWORD 'password' LOGIN;
GRANT CONNECT ON DATABASE hyphae TO hyphae_user;
GRANT USAGE ON SCHEMA public TO hyphae_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hyphae_user;

# Audit table (append-only)
CREATE TABLE hyphae_audit_immutable (
  id UUID PRIMARY KEY,
  event TEXT NOT NULL,
  admin TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  hash VARCHAR(64) NOT NULL,
  previous_hash VARCHAR(64)
);
```

### Secrets Management

```bash
# Never commit .env
echo ".env" >> .gitignore

# Use 1Password CLI for secrets
op read "op://Salish Forge/Hyphae DB Password/password"

# Or systemd EnvironmentFile
sudo cat > /etc/hyphae/secrets.env << 'EOF'
DB_PASSWORD=<SECURE>
TLS_KEY_PASSWORD=<SECURE>
EOF

chmod 600 /etc/hyphae/secrets.env

# Reference in service
EnvironmentFile=/etc/hyphae/secrets.env
```

---

## Troubleshooting

### Server Won't Start

```bash
# Check logs
docker-compose logs hyphae-core

# Verify database connection
psql -h 127.0.0.1 -U hyphae_user -d hyphae -c "SELECT 1"

# Check port availability
lsof -i :3100

# Restart
docker-compose restart hyphae-core
```

### High Error Rate

```bash
# Query audit trail
curl "http://localhost:3100/api/rpc/audit?status=FAILED&limit=10"

# Check service health
curl "http://localhost:3100/api/services"

# Run ERA diagnostics
docker-compose exec era node dist/era.js
```

### Slow Responses

```bash
# Check database queries
SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;

# Check service response times
curl "http://localhost:3100/api/stats"

# Check for cascading failures
curl "http://localhost:3100/api/rpc/audit?status=RPC_TIMEOUT&limit=100"
```

---

## What's Next

### Phase 2: Agent Integration

1. **Deploy Clio (AutoGen)**
   - Register with Hyphae
   - Test coordination via RPC

2. **Deploy Flint (CrewAI)**
   - Register with Hyphae
   - Test multi-agent workflows

3. **Multi-Framework Testing**
   - Clio (AutoGen) → Hyphae → Flint (CrewAI)
   - Verify framework agnostic coordination

### Phase 3: Production Hardening

1. HTTPS/TLS
2. Rate limiting
3. Load balancing
4. Multi-region federation
5. Disaster recovery

---

## Support

**Issues?**
1. Check ERA diagnostics: `docker-compose exec era node dist/era.js`
2. Query logs: `docker-compose logs -f hyphae-core`
3. Review audit trail: `curl http://localhost:3100/api/rpc/audit`
4. Open issue on GitHub with: logs + stats + configuration

