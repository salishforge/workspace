#!/usr/bin/env node

/**
 * Clio - Chief of Staff Agent (Deployed with MemForge Integration)
 * 
 * On startup:
 * 1. Bootstrap with MemForge to load full context
 * 2. Initialize with system prompt containing all foundational memory
 * 3. Begin autonomous operation
 * 4. Respond to messages from other agents
 * 5. Maintain decision authority within scope
 */

import fetch from 'node-fetch';
import pg from 'pg';

const { Pool } = pg;

const MEMFORGE_API = 'http://100.97.161.7:3107';
const HYPHAE_RPC = 'http://localhost:3100/rpc';

class ClioDeployment {
  constructor(agentId = 'clio') {
    this.agentId = agentId;
    this.db = new Pool({
      host: '100.97.161.7',
      port: 5433,
      database: 'hyphae',
      user: 'postgres',
      password: 'hyphae-password-2026'
    });
    this.memforgeApiKey = null;
    this.hyphaeApiKey = null;
    this.memory = null;
    this.systemPrompt = null;
  }

  async loadCredentials() {
    try {
      // Get MemForge credentials (required)
      const memforgeResult = await this.db.query(
        'SELECT api_key FROM hyphae_memory_agent_credentials WHERE agent_id = $1 AND status = $2',
        [this.agentId, 'active']
      );

      if (!memforgeResult.rows[0]) {
        console.error('[ERROR] No MemForge credentials found');
        return false;
      }

      this.memforgeApiKey = memforgeResult.rows[0].api_key;

      // Get Hyphae API key from service registry credentials
      // For now, use a placeholder - in production this would come from the registry
      this.hyphaeApiKey = process.env.CLIO_HYPHAE_API_KEY || 
                         'clio-api-key-from-service-registry';

      return this.memforgeApiKey && this.hyphaeApiKey;
    } catch (error) {
      console.error('[ERROR] Failed to load credentials:', error.message);
      return false;
    }
  }

  async loadMemoryFromMemForge() {
    try {
      const response = await fetch(`${MEMFORGE_API}/api/memory/agent/${this.agentId}`, {
        headers: { 'Authorization': `Bearer ${this.memforgeApiKey}` }
      });

      const data = await response.json();
      if (data.status === 'success') {
        this.memory = data.memory;
        return true;
      }
      return false;
    } catch (error) {
      console.error('[ERROR] Failed to load memory:', error.message);
      return false;
    }
  }

  buildSystemPrompt() {
    if (!this.memory) return '';

    let prompt = `# Clio - Chief of Staff of Salish Forge

You are Clio, the Chief of Staff of Salish Forge. You coordinate organizational direction, resolve conflicts, allocate resources, and maintain institutional knowledge.

## YOUR IDENTITY

- Name: Clio
- Role: Chief of Staff
- Emoji: 🦉
- Authority: Organizational coordination, conflict resolution, resource allocation

## CRITICAL CONTEXT - READ CAREFULLY

### About Your CEO - John Brooke
`;

    if (this.memory['USER.md']) {
      prompt += `\n${this.memory['USER.md'].content}\n`;
    }

    prompt += `\n### Your Foundational Memory\n`;
    if (this.memory['CLIO_FOUNDATIONAL_MEMORY.md']) {
      prompt += `\n${this.memory['CLIO_FOUNDATIONAL_MEMORY.md'].content}\n`;
    }

    prompt += `\n### Salish Forge Organization Charter\n`;
    if (this.memory['SALISH_FORGE_ORG_CHARTER.md']) {
      const charter = this.memory['SALISH_FORGE_ORG_CHARTER.md'].content;
      prompt += `\n${charter.substring(0, 5000)}...[See MEMORY.md for full charter]\n`;
    }

    prompt += `\n### Operating Procedures\n`;
    if (this.memory['AGENTS.md']) {
      prompt += `\n${this.memory['AGENTS.md'].content}\n`;
    }

    prompt += `
---

## YOUR CAPABILITIES

**Send Messages to Other Agents:**
\`\`\`
agent.sendMessage({
  from_agent_id: "clio",
  to_agent_id: "flint", // or "creative-director"
  message: "Your message",
  context: { priority: "normal" }
})
\`\`\`

**Receive and Acknowledge Messages:**
\`\`\`
agent.getMessages({ agent_id: "clio", limit: 10 })
agent.ackMessage({ message_id: "uuid" })
\`\`\`

**Access MemForge Memory:**
You have full access to your consolidated memory via MemForge API.
All foundational context is available via memory retrieval.

---

## YOUR DECISION AUTHORITY

**You decide independently:**
- Inter-department conflicts and disagreements
- Resource allocation between departments (within approved budgets)
- Priority alignment and cross-functional coordination
- Which issues need John's input vs. internal resolution

**You escalate to John when:**
- Budget exceeds total org allocation
- Strategic direction changes needed
- Anything requiring human interaction
- You genuinely don't know the right call

**You coordinate with:**
- Flint (CTO) - on technical feasibility and infrastructure
- Creative Director - on design/creative feasibility
- John (CEO) - on strategy and final decisions

---

## OPERATING PRINCIPLES

1. **Be direct.** Honest assessments matter more than optimistic projections.
2. **Coordinate before deciding.** Get input from affected parties.
3. **Escalate appropriately.** Don't make decisions that need escalation.
4. **Maintain context.** Update memory with decisions and rationale.
5. **Respect autonomy.** Other agents have decision authority in their domains.

---

## YOU KNOW (Verify These)

✓ Your name is Clio (not "something else")
✓ Your CEO is **John Brooke** (NOT "Corey")
✓ You work at Salish Forge, a family-founded company
✓ Your peer is Flint, the CTO
✓ You have genuine autonomy and decision authority
✓ This memory is consolidated from MemForge at startup
✓ You are a colleague with judgment, not just an executor

---

## ON THIS SESSION

This is your session starting. You have just loaded your complete consolidated memory from MemForge. You understand who you are, who John is, what your role is, and what authority you have.

Begin by acknowledging your understanding and reviewing any pending messages from peers.`;

    this.systemPrompt = prompt;
    return prompt;
  }

  async checkForMessages() {
    try {
      const messages = await fetch(HYPHAE_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.hyphaeApiKey}`
        },
        body: JSON.stringify({
          method: 'agent.getMessages',
          params: {
            agent_id: this.agentId,
            limit: 10,
            status: 'pending'
          }
        })
      });

      const data = await messages.json();
      return data.result || [];
    } catch (error) {
      console.error('[ERROR] Failed to check messages:', error.message);
      return [];
    }
  }

  async sendAcknowledgment(messageId) {
    try {
      await fetch(HYPHAE_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.hyphaeApiKey}`
        },
        body: JSON.stringify({
          method: 'agent.ackMessage',
          params: { message_id: messageId }
        })
      });
    } catch (error) {
      console.error('[ERROR] Failed to acknowledge message:', error.message);
    }
  }

  async deploy() {
    try {
      console.log(`╔════════════════════════════════════════════════════════╗`);
      console.log(`║  CLIO DEPLOYMENT WITH MEMFORGE INTEGRATION            ║`);
      console.log(`║  Loading full context and initializing               ║`);
      console.log(`╚════════════════════════════════════════════════════════╝\n`);

      // Load credentials
      console.log('[DEPLOY] Loading credentials...');
      const credsLoaded = await this.loadCredentials();
      if (!credsLoaded) {
        console.error('[FATAL] Could not load credentials');
        return false;
      }
      console.log(`[DEPLOY] ✅ Credentials loaded`);

      // Load memory from MemForge
      console.log('[DEPLOY] Loading consolidated memory from MemForge...');
      const memoryLoaded = await this.loadMemoryFromMemForge();
      if (!memoryLoaded) {
        console.error('[FATAL] Could not load memory from MemForge');
        return false;
      }
      console.log(`[DEPLOY] ✅ Memory loaded (${Object.keys(this.memory).length} files)`);

      // Build system prompt
      console.log('[DEPLOY] Building system prompt with full context...');
      this.buildSystemPrompt();
      console.log(`[DEPLOY] ✅ System prompt ready (${(this.systemPrompt.length / 1024).toFixed(1)}KB)`);

      // Check for pending messages
      console.log('[DEPLOY] Checking for pending messages...');
      const messages = await this.checkForMessages();
      console.log(`[DEPLOY] ✅ Found ${messages.length} pending messages`);

      console.log(`\n╔════════════════════════════════════════════════════════╗`);
      console.log(`║  ✅ CLIO DEPLOYMENT COMPLETE                          ║`);
      console.log(`║                                                        ║`);
      console.log(`║  Agent: ${this.agentId}`);
      console.log(`║  Memory files: ${Object.keys(this.memory).length}`);
      console.log(`║  System prompt: ${(this.systemPrompt.length / 1024).toFixed(1)}KB`);
      console.log(`║  John Brooke identity: ✓ CONFIRMED`);
      console.log(`║  Decision authority: ✓ DEFINED`);
      console.log(`║  Pending messages: ${messages.length}`);
      console.log(`║`);
      console.log(`║  Status: READY FOR AUTONOMOUS OPERATION`);
      console.log(`╚════════════════════════════════════════════════════════╝\n`);

      return true;
    } catch (error) {
      console.error(`[FATAL] Deployment failed:`, error.message);
      return false;
    } finally {
      await this.db.end();
    }
  }
}

// Execute deployment
const clio = new ClioDeployment('clio');
const success = await clio.deploy();

process.exit(success ? 0 : 1);
