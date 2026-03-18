# Sub-Agent Container Specification

## Design Principle

Sub-agents (researcher, task workers, etc.) run in Docker containers with strict isolation from the host and from each other. Lead agents (Clio, Flint) run on bare metal with full system access and responsibility for managing sub-agent isolation.

---

## Container Specification

### Base Image
- `node:22-bookworm-slim` (lightweight, includes Node runtime, standard libc)
- Alternative: `python:3.12-slim` (for Python-based tasks)

### User & Permissions
- Run as non-root user `subagent` (UID 1000)
- No sudo, no privileged mode
- Drop Linux capabilities: `--cap-drop=ALL --cap-add=NET_BIND_SERVICE` (minimal network only)

### Volume Mounts (Read-Write)
- `--mount type=bind,source=/path/to/workspace/subagents/{session_id},target=/work,readonly=false`
  - Only the dedicated subdirectory is writable
  - Parent directories mounted read-only (if mounted at all)

### Volume Mounts (Read-Only)
- Optional: `/path/to/workspace/docs:/docs:ro` (reference docs, not modifiable)
- Do NOT mount: `/home/artificium/.openclaw/openclaw.json`, secrets, config files

### Network
- `--network none` by default (no network access)
- Exception: if task requires external APIs, use `--network bridge` with explicit DNS/firewall rules
- No access to VPS services (localhost:3333, localhost:5432, etc.)

### Resource Limits
- `--cpus=2` (2 CPU threads max)
- `--memory=4gb` (4GB RAM max)
- `--pids-limit=512` (max process count, prevent fork bombs)

### Restart Policy
- `--restart=no` (don't auto-restart; fail hard if the task crashes)

### Logging
- `--log-driver=json-file --log-opt max-size=10m --log-opt max-file=3`
  - Prevents runaway log files
  - Logs retained for 3 rotations (~30MB total)

---

## Execution Template (Bash)

```bash
docker run \
  --rm \
  --user subagent \
  --cap-drop=ALL \
  --cpus=2 \
  --memory=4gb \
  --pids-limit=512 \
  --network none \
  --mount type=bind,source=/home/artificium/.openclaw/workspace/subagents/run-${SESSION_ID},target=/work \
  --log-driver=json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  node:22-bookworm-slim \
  node /work/task.js
```

---

## Lifecycle Management

1. **Create:** Parent agent creates the session directory `/workspace/subagents/run-${SESSION_ID}`
2. **Run:** Docker container mounts only that directory as writable
3. **Cleanup:** After task completion, delete the session directory (`cleanup: delete` in sessions_spawn)

---

## Security Hardening Checklist

- [ ] No container has root or sudo
- [ ] No container has network access except as explicitly required
- [ ] Volume mounts enforce read-only for workspace root
- [ ] Resource limits prevent resource exhaustion
- [ ] Logging is time-limited and size-limited
- [ ] Sessions are ephemeral (no long-running containers)

---

*Specification v1, approved by CTO Flint per Clio's architecture review.*
