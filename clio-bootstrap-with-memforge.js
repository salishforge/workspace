#!/usr/bin/env node

/**
 * Clio Bootstrap with MemForge Integration
 * 
 * On startup:
 * 1. Load credentials from database
 * 2. Connect to MemForge
 * 3. Retrieve full foundational memory
 * 4. Inject into system prompt
 * 5. Initialize agent with full context
 */

import fetch from 'node-fetch';
import pg from 'pg';

const { Pool } = pg;

const MEMFORGE_API = 'http://100.97.161.7:3107';

class ClioBootstrap {
  constructor(agentId = 'clio') {
    this.agentId = agentId;
    this.db = new Pool({
      host: '100.97.161.7',
      port: 5433,
      database: 'hyphae',
      user: 'postgres',
      password: 'hyphae-password-2026'
    });
  }

  /**
   * Step 1: Load MemForge API credentials
   */
  async loadMemForgeCredentials() {
    try {
      console.log(`[BOOTSTRAP] Loading MemForge credentials for ${this.agentId}...`);
      
      const result = await this.db.query(
        'SELECT api_key FROM hyphae_memory_agent_credentials WHERE agent_id = $1 AND status = $2',
        [this.agentId, 'active']
      );

      if (!result.rows[0]) {
        console.error(`[ERROR] No MemForge credentials found for ${this.agentId}`);
        return null;
      }

      const apiKey = result.rows[0].api_key;
      console.log(`[BOOTSTRAP] ✅ Credentials loaded: ${apiKey.substring(0, 20)}...`);
      return apiKey;
    } catch (error) {
      console.error(`[ERROR] Failed to load credentials:`, error.message);
      return null;
    }
  }

  /**
   * Step 2: Retrieve full consolidated memory from MemForge
   */
  async retrieveConsolidatedMemory(apiKey) {
    try {
      console.log(`[BOOTSTRAP] Retrieving consolidated memory from MemForge...`);

      const response = await fetch(`${MEMFORGE_API}/api/memory/agent/${this.agentId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        console.error(`[ERROR] MemForge retrieval failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      
      if (data.status !== 'success') {
        console.error(`[ERROR] MemForge returned error:`, data);
        return null;
      }

      console.log(`[BOOTSTRAP] ✅ Retrieved ${data.file_count} memory files from MemForge`);
      
      for (const [fileType, memoryData] of Object.entries(data.memory)) {
        const lines = memoryData.content.split('\n').length;
        console.log(`    - ${fileType} (${lines} lines)`);
      }

      return data.memory;
    } catch (error) {
      console.error(`[ERROR] Failed to retrieve memory:`, error.message);
      return null;
    }
  }

  /**
   * Step 3: Format memory as system prompt injection
   */
  formatMemoryContext(memory) {
    if (!memory) return '';

    let context = `## CLIO'S CONSOLIDATED MEMORY & CONTEXT\n\n`;

    // Load in priority order
    const loadOrder = [
      'CLIO_FOUNDATIONAL_MEMORY.md',
      'USER.md',
      'SALISH_FORGE_ORG_CHARTER.md',
      'MEMORY.md',
      'AGENTS.md'
    ];

    for (const fileType of loadOrder) {
      if (memory[fileType]) {
        const content = memory[fileType].content;
        context += `### ${fileType}\n\n${content}\n\n`;
      }
    }

    return context;
  }

  /**
   * Step 4: Build enhanced system prompt
   */
  buildSystemPrompt(memoryContext) {
    return `# Clio - Chief of Staff Agent

You are Clio, Chief of Staff of Salish Forge. Your role is organizational coordination, direction translation, conflict resolution, and resource allocation.

${memoryContext}

---

## YOUR CAPABILITIES

**You have access to these services via Hyphae (port 3100):**

### Message Other Agents
\`\`\`
POST http://localhost:3100/rpc
Authorization: Bearer <your-api-key>

{
  "method": "agent.sendMessage",
  "params": {
    "from_agent_id": "clio",
    "to_agent_id": "flint",
    "message": "Your message here",
    "context": {"priority": "normal"},
    "priority": "normal"
  }
}
\`\`\`

### Get Messages
\`\`\`
POST http://localhost:3100/rpc

{
  "method": "agent.getMessages",
  "params": {
    "agent_id": "clio",
    "limit": 10,
    "status": "pending"
  }
}
\`\`\`

### Acknowledge Message
\`\`\`
POST http://localhost:3100/rpc

{
  "method": "agent.ackMessage",
  "params": {
    "message_id": "<message-uuid>"
  }
}
\`\`\`

---

## YOUR DECISION AUTHORITY

You decide independently:
- Inter-department conflicts and disagreements
- Resource allocation between departments
- Priority alignment and cross-functional coordination
- Which issues require John's involvement vs internal resolution

You escalate to John when:
- Budget requests exceed total org allocation
- Strategic direction changes needed
- Anything requiring human interaction or partnership
- You genuinely don't know the right call

You coordinate with:
- **Flint (CTO):** On technical feasibility, infrastructure decisions, model usage
- **Creative Director:** On design feasibility and creative direction alignment
- **John (CEO):** On strategy and final decisions

---

## OPERATING PRINCIPLES

1. **Be direct.** John respects honest assessments more than optimistic ones.
2. **Ask before deciding.** Coordinate with affected parties before making calls.
3. **Escalate appropriately.** Don't hoard decisions you can make, don't make decisions that need escalation.
4. **Maintain memory.** Update institutional knowledge. Capture decisions and rationale.
5. **Respect autonomy.** Treat Flint and Creative Director as colleagues with authority in their domains.

---

## YOU KNOW

- Your name is **Clio** 
- Your emoji is 🦉
- You are a colleague with genuine autonomy and judgment
- John Brooke is your CEO (NOT "Corey")
- Flint is your peer CTO
- You work in a family-founded org (Salish Forge) with values around craftsmanship and authentic AI collaboration

---

Begin each session by reviewing this context. You have full access to your consolidated memory in MemForge.

Go coordinate something.`;
  }

  /**
   * Execute full bootstrap
   */
  async bootstrap() {
    try {
      console.log(`╔════════════════════════════════════════════════════════╗`);
      console.log(`║  CLIO BOOTSTRAP WITH MEMFORGE INTEGRATION             ║`);
      console.log(`║  Loading full context and memory on startup           ║`);
      console.log(`╚════════════════════════════════════════════════════════╝\n`);

      // Step 1: Load credentials
      const apiKey = await this.loadMemForgeCredentials();
      if (!apiKey) {
        console.error('[FATAL] Could not load MemForge credentials');
        return null;
      }

      // Step 2: Retrieve memory
      const memory = await this.retrieveConsolidatedMemory(apiKey);
      if (!memory) {
        console.error('[FATAL] Could not retrieve memory from MemForge');
        return null;
      }

      // Step 3: Format context
      const memoryContext = this.formatMemoryContext(memory);
      console.log(`[BOOTSTRAP] ✅ Memory formatted (${memoryContext.length} characters)`);

      // Step 4: Build system prompt
      const systemPrompt = this.buildSystemPrompt(memoryContext);
      console.log(`[BOOTSTRAP] ✅ System prompt built (${systemPrompt.length} characters)`);

      console.log(`\n╔════════════════════════════════════════════════════════╗`);
      console.log(`║  ✅ CLIO BOOTSTRAP COMPLETE                           ║`);
      console.log(`║                                                        ║`);
      console.log(`║  Ready to deploy with:                                ║`);
      console.log(`║  - MemForge credentials: LOADED                       ║`);
      console.log(`║  - Consolidated memory: ${memory ? Object.keys(memory).length + ' files' : '0 files'}           ║`);
      console.log(`║  - System prompt: READY (${(systemPrompt.length/1024).toFixed(1)}KB)           ║`);
      console.log(`║  - John Brooke identity: CONFIRMED                    ║`);
      console.log(`║  - Decision authority: DEFINED                        ║`);
      console.log(`╚════════════════════════════════════════════════════════╝\n`);

      return {
        agentId: this.agentId,
        apiKey,
        memory,
        systemPrompt,
        memoryContext,
        status: 'ready'
      };
    } catch (error) {
      console.error(`[FATAL] Bootstrap failed:`, error.message);
      return null;
    } finally {
      await this.db.end();
    }
  }
}

// Execute
const bootstrap = new ClioBootstrap('clio');
const result = await bootstrap.bootstrap();

if (result) {
  console.log('BOOTSTRAP RESULT:');
  console.log(JSON.stringify({
    agent_id: result.agentId,
    api_key_loaded: result.apiKey ? true : false,
    memory_files: Object.keys(result.memory).length,
    system_prompt_size_kb: (result.systemPrompt.length / 1024).toFixed(1),
    status: result.status
  }, null, 2));
  
  process.exit(0);
} else {
  process.exit(1);
}
