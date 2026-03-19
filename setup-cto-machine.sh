#!/bin/bash
set -e

# ============================================================
# Salish Forge — CTO Machine Setup Script
# Run as root on a fresh Ubuntu 24.04 (or similar) installation
# ============================================================

echo "═══════════════════════════════════════════════"
echo "  Salish Forge — CTO Machine Bootstrap"
echo "═══════════════════════════════════════════════"
echo ""

# ---- Configuration ----
CTO_USER="cto"
WORKSPACE="/home/$CTO_USER/workspace"
NODE_VERSION="22"

# ---- System Updates ----
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# ---- Create CTO User ----
echo "👤 Creating CTO user..."
if ! id "$CTO_USER" &>/dev/null; then
    adduser --disabled-password --gecos "Salish Forge CTO" "$CTO_USER"
    usermod -aG sudo "$CTO_USER"
    echo "$CTO_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$CTO_USER
    echo "✅ User '$CTO_USER' created with sudo access"
else
    echo "ℹ️  User '$CTO_USER' already exists"
fi

# ---- Essential Packages ----
echo "📦 Installing essential packages..."
apt-get install -y \
    curl wget git build-essential \
    python3 python3-pip python3-venv \
    ufw fail2ban \
    htop tmux tree jq \
    ca-certificates gnupg lsb-release \
    unattended-upgrades

# ---- Node.js (via nvm) ----
echo "🟢 Installing Node.js $NODE_VERSION via nvm..."
su - $CTO_USER -c "
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR=\"\$HOME/.nvm\"
    [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
    nvm install $NODE_VERSION
    nvm use $NODE_VERSION
    nvm alias default $NODE_VERSION
    echo '✅ Node.js installed:' && node --version
"

# ---- PostgreSQL ----
echo "🐘 Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Create CTO memory database
su - postgres -c "
    psql -c \"CREATE USER cto_user WITH PASSWORD 'CHANGE_ME_BEFORE_BOOT';\"
    psql -c \"CREATE DATABASE cto_memory OWNER cto_user;\"
    psql -c \"GRANT ALL PRIVILEGES ON DATABASE cto_memory TO cto_user;\"
" 2>/dev/null || echo "ℹ️  PostgreSQL user/database may already exist"

echo "✅ PostgreSQL installed and configured"

# ---- Docker ----
echo "🐳 Installing Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker $CTO_USER

echo "✅ Docker installed"

# ---- Tailscale ----
echo "🔗 Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh
echo "⚠️  Run 'sudo tailscale up' after script completes to join mesh network"

# ---- Security Hardening ----
echo "🔒 Hardening security..."

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0  # Allow all Tailscale traffic
ufw --force enable

# fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# SSH hardening
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart sshd

# Automatic security updates
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

echo "✅ Security hardened (SSH key-only, firewall enabled, fail2ban active)"

# ---- OpenClaw ----
echo "🦀 Installing OpenClaw..."
su - $CTO_USER -c "
    export NVM_DIR=\"\$HOME/.nvm\"
    [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
    npm install -g openclaw
    echo '✅ OpenClaw installed:' && openclaw --version 2>/dev/null || echo '(version check pending)'
"

# ---- Workspace Setup ----
echo "📁 Setting up workspace..."
su - $CTO_USER -c "
    mkdir -p $WORKSPACE
    mkdir -p $WORKSPACE/memory
    mkdir -p ~/.openclaw
"

echo "✅ Workspace created at $WORKSPACE"

# ---- SSH Key for Clio Access ----
echo "🔑 Setting up SSH access for Clio..."
su - $CTO_USER -c "
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    touch ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
"

# Clio's public key will be added here
echo "⚠️  Add Clio's SSH public key to /home/$CTO_USER/.ssh/authorized_keys"

# ---- Summary ----
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ CTO Machine Setup Complete"
echo "═══════════════════════════════════════════════"
echo ""
echo "Installed:"
echo "  ✅ Node.js $NODE_VERSION (via nvm)"
echo "  ✅ PostgreSQL (database: cto_memory)"
echo "  ✅ Docker + Docker Compose"
echo "  ✅ Tailscale (needs 'sudo tailscale up')"
echo "  ✅ OpenClaw"
echo "  ✅ Security hardening (UFW, fail2ban, SSH)"
echo ""
echo "Next Steps:"
echo "  1. Join Tailscale: sudo tailscale up"
echo "  2. Change PostgreSQL password: sudo -u postgres psql -c \"ALTER USER cto_user PASSWORD 'your-secure-password';\""
echo "  3. Add Clio's SSH key to /home/$CTO_USER/.ssh/authorized_keys"
echo "  4. Copy bootstrap files to $WORKSPACE/"
echo "  5. Configure OpenClaw (Telegram bot token, API keys)"
echo "  6. Create Telegram bot via @BotFather"
echo "  7. Start OpenClaw: openclaw gateway start"
echo ""
echo "⚠️  IMPORTANT: Change the PostgreSQL password before going live!"
echo ""
