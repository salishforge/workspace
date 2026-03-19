#!/bin/bash
# Health Dashboard Deployment Script
# Run this on the VPS as the tidepool user

set -e

INSTALL_DIR="/home/tidepool/health-dashboard"
PORT=${PORT:-3000}
NATS_URL=${NATS_URL:-"nats://localhost:4222"}

echo "Installing health dashboard to $INSTALL_DIR..."

# Create directory
mkdir -p $INSTALL_DIR
cd $INSTALL_DIR

# Copy files (assuming tar was extracted here)
# tar -xzf health-dashboard-src.tar.gz

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "Creating .env file..."
  cat > .env << EOF
NATS_URL=$NATS_URL
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=tidepool
PG_USER=postgres
PG_PASSWORD=${PG_PASSWORD:-postgres}
PORT=$PORT
NODE_ENV=production
EOF
fi

# Create systemd service
echo "Creating systemd service..."
sudo tee /etc/systemd/system/health-dashboard.service > /dev/null << EOF
[Unit]
Description=Tidepool Health Dashboard
After=network.target

[Service]
Type=simple
User=tidepool
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node dist/health.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
echo "Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable health-dashboard
sudo systemctl restart health-dashboard

# Wait a moment for startup
sleep 2

# Test the endpoint
echo "Testing health endpoint..."
RESULT=$(curl -s http://localhost:$PORT/health || echo "{\"error\":\"Failed\"}")
echo "Response: $RESULT"

if echo "$RESULT" | grep -q "agents"; then
  echo "✅ Health dashboard deployed successfully!"
  echo "Endpoint: http://localhost:$PORT/health"
  echo "Metrics: http://localhost:$PORT/metrics"
  echo "Liveness: http://localhost:$PORT/healthz"
else
  echo "⚠️  Health dashboard started but endpoint may not be ready yet"
  echo "Check logs: sudo journalctl -u health-dashboard -f"
fi
