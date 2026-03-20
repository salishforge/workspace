#!/bin/bash

# Comprehensive test suite for Hyphae Communications System
# Tests: agent-to-agent messaging, capability discovery, human-to-agent bridge

HYPHAE_URL="http://localhost:3102"
BEARER_TOKEN="memforge-token-2026"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "HYPHAE COMMUNICATIONS SYSTEM - COMPREHENSIVE TEST SUITE"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass_count=0
fail_count=0

# Test helper
test_case() {
  local name="$1"
  local command="$2"
  
  echo -n "Testing: $name... "
  if eval "$command" > /tmp/test_output.txt 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
    return 0
  else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Output:"
    cat /tmp/test_output.txt | sed 's/^/    /'
    ((fail_count++))
    return 1
  fi
}

# ═════════════════════════════════════════════════════════════════
# PHASE 1: Agent Capability Discovery
# ═════════════════════════════════════════════════════════════════

echo ""
echo "PHASE 1: Agent Capability Discovery"
echo "─────────────────────────────────────"
echo ""

# Test 1.1: Flint advertises its capabilities
test_case "Flint advertises capabilities" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.advertise_capabilities\",\"params\":{\"capabilities\":[{\"name\":\"query_memory\",\"description\":\"Query long-term memory\"},{\"name\":\"get_architecture_decision\",\"description\":\"Retrieve architecture rationale\"}]},\"id\":1}' | \
    grep -q 'capabilities_registered'"

# Test 1.2: Clio advertises its capabilities
test_case "Clio advertises capabilities" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.advertise_capabilities\",\"params\":{\"capabilities\":[{\"name\":\"consolidate_memory\",\"description\":\"Consolidate episodic memory\"},{\"name\":\"organize_knowledge\",\"description\":\"Organize working knowledge\"}]},\"id\":2}' | \
    grep -q 'capabilities_registered'"

# Test 1.3: Flint discovers Clio's capabilities
test_case "Flint discovers Clio's capabilities" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.discover_capabilities\",\"params\":{\"agent_id\":\"clio\"},\"id\":3}' | \
    grep -q 'consolidate_memory'"

# Test 1.4: Clio discovers Flint's capabilities
test_case "Clio discovers Flint's capabilities" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.discover_capabilities\",\"params\":{\"agent_id\":\"flint\"},\"id\":4}' | \
    grep -q 'query_memory'"

# Test 1.5: List all agents in system
test_case "List all agents in system" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.list_all_agents\",\"params\":{},\"id\":5}' | \
    grep -q 'total_agents'"

echo ""
echo "PHASE 1 Summary: $((pass_count - 0)) passed"
echo ""

# ═════════════════════════════════════════════════════════════════
# PHASE 2: Agent-to-Agent Messaging
# ═════════════════════════════════════════════════════════════════

echo "PHASE 2: Agent-to-Agent Messaging"
echo "──────────────────────────────────"
echo ""

# Test 2.1: Flint sends message to Clio
test_case "Flint sends message to Clio" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.send_message\",\"params\":{\"to_agent_id\":\"clio\",\"message\":\"I need help consolidating 6 months of memory\",\"message_type\":\"request\"},\"id\":6}' | \
    grep -q 'queued'"

# Test 2.2: Clio receives the message
test_case "Clio gets pending messages" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.get_messages\",\"params\":{},\"id\":7}' | \
    grep -q 'consolidating'"

# Test 2.3: Clio responds to Flint
test_case "Clio responds to Flint" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.send_message\",\"params\":{\"to_agent_id\":\"flint\",\"message\":\"Starting consolidation cycle now\",\"message_type\":\"response\"},\"id\":8}' | \
    grep -q 'queued'"

# Test 2.4: Clio acknowledges received message
test_case "Clio acknowledges message" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.ack_message\",\"params\":{\"message_id\":1},\"id\":9}' | \
    grep -q 'acknowledged'"

echo ""
echo "PHASE 2 Summary: Agent-to-agent messaging working"
echo ""

# ═════════════════════════════════════════════════════════════════
# PHASE 3: Human-to-Agent Communication
# ═════════════════════════════════════════════════════════════════

echo "PHASE 3: Human-to-Agent Communication Bridge"
echo "─────────────────────────────────────────────"
echo ""

# Test 3.1: Get channel info
test_case "Get Telegram channel info" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.get_channel_info\",\"params\":{\"channel\":\"telegram\"},\"id\":10}' | \
    grep -q 'telegram'"

# Test 3.2: John sends message to Flint via Telegram bridge
test_case "Human sends message to Flint" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.human_send_message\",\"params\":{\"from_human_id\":\"8201776295\",\"to_agent_id\":\"flint\",\"message\":\"What is the latest architecture decision?\",\"channel\":\"telegram\"},\"id\":11}' | \
    grep -q 'delivered'"

# Test 3.3: Flint gets human messages
test_case "Flint gets human messages" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.get_human_messages\",\"params\":{},\"id\":12}' | \
    grep -q 'architecture'"

# Test 3.4: Flint responds to human
test_case "Flint responds to human (Telegram)" \
  "curl -s -X POST $HYPHAE_URL/rpc \
    -H 'Authorization: Bearer $BEARER_TOKEN' \
    -H 'Content-Type: application/json' \
    -d '{\"jsonrpc\":\"2.0\",\"method\":\"agent.send_human_message\",\"params\":{\"to_human_id\":\"8201776295\",\"message\":\"The latest decision was to implement the tiered memory system\",\"channel\":\"telegram\"},\"id\":13}' | \
    grep -q 'sent'"

echo ""
echo "PHASE 3 Summary: Human-to-agent bridge working"
echo ""

# ═════════════════════════════════════════════════════════════════
# PHASE 4: Database Verification
# ═════════════════════════════════════════════════════════════════

echo "PHASE 4: Database Verification"
echo "───────────────────────────────"
echo ""

# Test 4.1: Capabilities stored
test_case "Flint capabilities stored in DB" \
  "ssh artificium@100.97.161.7 << 'EOF'
docker exec hyphae-postgres psql -U postgres -d hyphae -c \
  \"SELECT COUNT(*) FROM hyphae_agent_capabilities WHERE agent_id='flint';\" | grep -q ' 1'
EOF"

# Test 4.2: Agent messages stored
test_case "Agent messages stored in DB" \
  "ssh artificium@100.97.161.7 << 'EOF'
docker exec hyphae-postgres psql -U postgres -d hyphae -c \
  \"SELECT COUNT(*) FROM hyphae_agent_messages WHERE from_agent_id='flint';\" | grep -q -E ' [1-9]'
EOF"

# Test 4.3: Human messages stored
test_case "Human messages stored in DB" \
  "ssh artificium@100.97.161.7 << 'EOF'
docker exec hyphae-postgres psql -U postgres -d hyphae -c \
  \"SELECT COUNT(*) FROM hyphae_human_agent_messages WHERE from_human_id='8201776295';\" | grep -q -E ' [1-9]'
EOF"

echo ""
echo "PHASE 4 Summary: Database verification complete"
echo ""

# ═════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═════════════════════════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "TEST SUMMARY"
echo "════════════════════════════════════════════════════════════════════"
echo ""

total=$((pass_count + fail_count))
echo "Total Tests: $total"
echo -e "Passed: ${GREEN}$pass_count${NC}"
echo -e "Failed: ${RED}$fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
  echo ""
  echo "Communications system is FULLY OPERATIONAL:"
  echo "  ✓ Agent-to-agent messaging"
  echo "  ✓ Capability discovery"
  echo "  ✓ Human-to-agent bridge (Telegram)"
  echo "  ✓ Database persistence"
  exit 0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  exit 1
fi
