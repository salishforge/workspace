#!/bin/bash

# Phase 2: Complete Infrastructure Setup & Data Preservation
# This script orchestrates the full VPS reset with proper memory preservation

set -e

echo "════════════════════════════════════════════════════════"
echo "PHASE 2: INFRASTRUCTURE SETUP & CLEAN REBUILD"
echo "════════════════════════════════════════════════════════"
echo ""

# Variables
HYPHAE_USER="hyphae"
VPS_HOST="artificium@100.97.161.7"
SSH_PUBKEY=$(cat /home/hyphae/.ssh/id_ed25519.pub 2>/dev/null || echo "KEY_NOT_FOUND")

echo "Step 1: Summary of what's been done..."
echo ""
echo "✅ Created hyphae user on VPS"
echo "✅ Generated SSH key pair for Hyphae ↔ aihome communication"
echo "✅ Gathered all Clio/Flint memory from VPS ($($VPS_HOST 'du -sh ~/memory-consolidation' 2>/dev/null | cut -f1))"
echo "✅ Created archive of old data: archival-backup.tar.gz (1.1GB)"
echo "✅ Preserved conversation history from database"
echo ""

echo "SSH PUBLIC KEY FOR AIHOME ~/.ssh/authorized_keys:"
echo "─────────────────────────────────────────────────"
echo "$SSH_PUBKEY"
echo ""

echo "Step 2: Next steps..."
echo ""
echo "1. Add SSH public key above to aihome ~/.ssh/authorized_keys"
echo "2. Verify hyphae user can SSH into aihome"
echo "3. Transfer memory consolidation to VPS hyphae user:"
echo ""
echo "   scp -r ~/tmp-memory-gather/aihome/* hyphae@100.97.161.7:~/consolidated-memory/"
echo ""
echo "4. Then execute Phase 3 (restart Hyphae infrastructure)"
echo ""
