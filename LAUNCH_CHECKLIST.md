# CTO Launch Checklist
## Everything needed to bring the CTO online

---

## Pre-Launch: John's Action Items

### Hardware (Day 0 — Tomorrow/Next Day)
- [ ] Power on mini PC
- [ ] Install Ubuntu 24.04 LTS (or verify existing OS)
- [ ] Connect to local network (Ethernet preferred)
- [ ] Ensure internet access

### Telegram Bot (5 minutes — Can do now)
- [ ] Open Telegram → search `@BotFather`
- [ ] Send `/newbot`
- [ ] Name: `Salish Forge CTO` (or similar)
- [ ] Username: `salishforge_cto_bot` (must be unique, end in `bot`)
- [ ] **Save the bot token** — send it to Clio when ready
- [ ] Send `/setdescription` → "Salish Forge CTO — Technical Leadership"
- [ ] Send `/setabouttext` → "Chief Technology Officer, Salish Forge"

### Anthropic API Key (5 minutes — Can do now)
- [ ] Go to `console.anthropic.com`
- [ ] Create new API key (name: "Salish Forge CTO")
- [ ] **Save the key** — send it to Clio when ready
- [ ] Note: This is separate from Clio's key (redundancy + budget tracking)

### Optional: Google/OpenAI Keys
- [ ] Create separate Google AI API key for CTO (if budget allows)
- [ ] Create separate OpenAI API key for CTO (if budget allows)
- [ ] These can wait — Anthropic key is sufficient to boot

---

## Launch Day: Setup Sequence

### Step 1: Base System (John — 15 min)
```bash
# SSH into mini PC
ssh user@mini-pc-ip

# Download and run setup script
curl -O https://raw.githubusercontent.com/... # or SCP from Clio
# OR: Clio SCPs the script over Tailscale
sudo bash setup-cto-machine.sh
```

### Step 2: Tailscale Mesh (John — 5 min)
```bash
sudo tailscale up
# Authenticate via URL provided
# Note the Tailscale IP (100.x.x.x) — share with Clio
```

### Step 3: Clio SSH Access (John — 5 min)
```bash
# Get Clio's public key (Clio will provide)
echo "ssh-ed25519 AAAA... clio@vps" >> /home/cto/.ssh/authorized_keys
```

### Step 4: Clio Takes Over (Clio via SSH — 30 min)
Once Clio has SSH access, she will:
- [ ] Verify system health (Node.js, PostgreSQL, Docker)
- [ ] SCP bootstrap files (BOOTSTRAP.md, CTO_PROFILE.md, AGENTS.md, Charter)
- [ ] Configure OpenClaw gateway (Telegram token, API keys, workspace)
- [ ] Set up tiered memory system (PostgreSQL schema, API)
- [ ] Configure systemd service for OpenClaw
- [ ] Verify Tailscale connectivity to VPS
- [ ] Final security audit

### Step 5: First Boot (CTO Agent — Autonomous)
- [ ] OpenClaw gateway starts
- [ ] CTO agent reads BOOTSTRAP.md
- [ ] CTO agent reads charter and profile
- [ ] CTO agent forms identity (SOUL.md, IDENTITY.md)
- [ ] CTO agent introduces themselves to Clio via Telegram

### Step 6: Integration (Clio + CTO + John — 1-2 hours)
- [ ] Clio welcomes CTO, establishes working relationship
- [ ] CTO reviews current infrastructure (VPS, databases, services)
- [ ] CTO proposes communication architecture
- [ ] John meets CTO, establishes relationship
- [ ] CTO begins first task: inter-agent communication design

---

## What Clio Prepares Now (Before Hardware)

All in `/home/artificium/.openclaw/workspace/cto-bootstrap/`:
- [x] `BOOTSTRAP.md` — Birth certificate
- [x] `CTO_PROFILE.md` — Visionary DNA
- [x] `AGENTS.md` — Operating procedures
- [x] `SALISH_FORGE_ORG_CHARTER.md` — Org charter
- [x] `setup-cto-machine.sh` — Automated setup script
- [x] `LAUNCH_CHECKLIST.md` — This file
- [ ] SSH key pair for Clio's access (generate when ready)
- [ ] OpenClaw config template (Telegram token + API key placeholders)
- [ ] Tiered memory schema + API setup script

---

## Post-Launch: First Week Milestones

### Day 1: Identity + Orientation
- CTO chooses name, writes SOUL.md
- CTO audits existing infrastructure
- CTO establishes communication with Clio

### Day 2-3: Communication Architecture
- CTO delivers inter-agent communication design
- CTO proposes sub-agent security framework
- CTO sets up budget tracking system

### Day 4-5: Security + Infrastructure
- CTO hardens their own machine
- CTO reviews VPS security posture
- CTO proposes security standards for org

### Day 6-7: Ready for Creative Director
- Communication infrastructure deployed
- Security framework documented
- Onboarding process ready for next agent

---

## Emergency Contacts

If something goes wrong during setup:
- **Clio:** Available 24/7 via Telegram (current bot)
- **John:** Telegram direct message
- **VPS:** 15.204.91.70 (Tailscale: 100.97.161.7) — Clio's home base
- **OpenClaw docs:** https://docs.openclaw.ai

---

*When the mini PC is powered on and connected, we're 45 minutes from a living CTO.*
