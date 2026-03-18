# Development Setup Guide

## Prerequisites

- Node.js >= 18.x (use nvm or similar for version management)
- npm >= 9.x
- PostgreSQL 14+ (for MemForge)
- NATS server (for Hyphae)
- Docker & Docker Compose (optional, for containerized dev)
- Git 2.x+

## Quick Start

### 1. Clone all three repos

```bash
git clone https://github.com/salishforge/dashboard.git
git clone https://github.com/salishforge/memforge.git
git clone https://github.com/salishforge/hyphae.git
```

### 2. Set up each service

#### Health Dashboard

```bash
cd dashboard
npm install
cp .env.example .env
npm run build
npm run dev
# Runs on http://localhost:3000
```

#### MemForge

```bash
cd memforge
npm install
cp .env.example .env
# Update .env with PostgreSQL credentials
npm run build
npm run dev
# Runs on http://localhost:3001
```

#### Hyphae

```bash
cd hyphae
npm install
cp .env.example .env
# Update .env with NATS server address
npm run build
npm run dev
# Runs on http://localhost:3002
```

### 3. Start dependencies

#### PostgreSQL (if not running)

```bash
# Using Docker
docker run -d \
  --name salish-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=salish_forge \
  -p 5432:5432 \
  postgres:15
```

#### NATS (if not running)

```bash
# Using Docker
docker run -d \
  --name salish-nats \
  -p 4222:4222 \
  nats:latest
```

### 4. Run tests

```bash
# In each service directory
npm test

# With coverage
npm run test:coverage
```

### 5. Linting & formatting

```bash
# Check linting
npm run lint

# Format code
npm run format
```

## Docker Compose (Full Stack)

```bash
docker-compose up -d
```

This starts:
- PostgreSQL (port 5432)
- NATS (port 4222)
- Health Dashboard (port 3000)
- MemForge (port 3001)
- Hyphae (port 3002)

## Environment Variables

### Dashboard

```
PORT=3000
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=salish_forge
PG_USER=postgres
PG_PASSWORD=postgres
```

### MemForge

```
PORT=3001
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=salish_forge
PG_USER=postgres
PG_PASSWORD=postgres
```

### Hyphae

```
PORT=3002
NATS_URL=nats://localhost:4222
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=salish_forge
PG_USER=postgres
PG_PASSWORD=postgres
```

## Common Commands

### Build

```bash
npm run build
```

### Development (watch mode)

```bash
npm run dev
```

### Test

```bash
npm test              # Run tests once
npm run test:watch   # Run tests in watch mode
npm run test:coverage # With coverage report
```

### Lint

```bash
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
```

### Format

```bash
npm run format        # Format code with Prettier
```

### Clean

```bash
npm run clean         # Remove build artifacts
npm run clean:all     # Also remove node_modules
```

## Git Workflow

### Create a feature branch

```bash
git checkout -b feature/my-feature
git checkout -b fix/my-bugfix
```

### Before committing

```bash
npm run lint:fix
npm run format
npm test
```

### Push and create PR

```bash
git push origin feature/my-feature
# Then create a PR on GitHub
```

## Debugging

### VSCode Debug Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "MemForge Debug",
      "program": "${workspaceFolder}/dist/index.js",
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "sourceMaps": true
    }
  ]
}
```

### View Logs

```bash
# Dashboard
tail -f ~/.pm2/logs/dashboard-out.log

# MemForge
tail -f ~/.pm2/logs/memforge-out.log

# Hyphae
tail -f ~/.pm2/logs/hyphae-out.log
```

## Testing APIs Locally

### Health Dashboard

```bash
curl http://localhost:3000/health
```

### MemForge

```bash
# Add event
curl -X POST http://localhost:3001/memory/test-agent/add \
  -H "Content-Type: application/json" \
  -d '{"content":"test event"}'

# Query memory
curl http://localhost:3001/memory/test-agent/query?q=test

# Get health
curl http://localhost:3001/health
```

### Hyphae

```bash
# Register service
curl -X POST http://localhost:3002/services \
  -H "Content-Type: application/json" \
  -d '{
    "id": "memforge-1",
    "type": "memory",
    "capabilities": ["query", "add"]
  }'

# List services
curl http://localhost:3002/services

# Get health
curl http://localhost:3002/health
```

## Troubleshooting

### Port already in use

```bash
# Find process using port
lsof -i :3000
# Kill it
kill -9 <PID>
```

### PostgreSQL connection refused

- Verify PostgreSQL is running: `psql -U postgres -h localhost`
- Check .env variables match running instance
- Reset: `npm run db:reset`

### NATS connection refused

- Verify NATS is running: `echo "PING" | nc localhost 4222`
- Check NATS_URL in .env

### Tests failing

```bash
# Clear cache and reinstall
npm run clean:all
npm install
npm test
```

## Resources

- [Node.js Documentation](https://nodejs.org/docs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Express.js Guide](https://expressjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [NATS Documentation](https://docs.nats.io/)

## Questions?

Open an issue or ask in Slack/Discord.
