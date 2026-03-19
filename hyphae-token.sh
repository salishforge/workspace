#!/bin/bash

# Hyphae JWT Token Generator
# Usage: ./hyphae-token.sh [api-key]

set -e

PROXY_URL="${HYPHAE_PROXY_URL:-https://100.97.161.7:3000}"
USER_ID="${HYPHAE_USER_ID:-john-broker}"
API_KEY="${1:-$(read -sp 'Enter API key: ' key; echo $key)}"

if [ -z "$API_KEY" ]; then
  echo "❌ API key required"
  exit 1
fi

echo "🔐 Requesting token from Hyphae proxy..."
echo ""

RESPONSE=$(curl -s -X POST "$PROXY_URL/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{
    \"userId\": \"$USER_ID\",
    \"apiKey\": \"$API_KEY\"
  }")

TOKEN=$(echo "$RESPONSE" | jq -r '.token // empty')
EXPIRES=$(echo "$RESPONSE" | jq -r '.expiresIn // empty')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token"
  echo "$RESPONSE" | jq .
  exit 1
fi

echo "✅ Token received!"
echo ""
echo "Token (valid for $EXPIRES seconds):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$TOKEN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Usage:"
echo "  export TOKEN='$TOKEN'"
echo "  curl -H \"Authorization: Bearer \$TOKEN\" https://100.97.161.7:3000/api/services"
echo ""
echo "Or save to file:"
echo "  echo \"$TOKEN\" > ~/.hyphae-token"
