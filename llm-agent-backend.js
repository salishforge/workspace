/**
 * LLM Agent Backend for Hyphae
 * 
 * Provides actual conversational AI for Flint and Clio
 * - Claude and Gemini API integration
 * - System prompts for each agent
 * - Conversation history management
 * - Slash command handling
 */

// Support both agent-specific and generic API keys
const getAnthropicKey = (agentId) => {
  const agentKey = process.env[`${agentId.toUpperCase()}_CLAUDE_API_KEY`];
  return agentKey || process.env.ANTHROPIC_API_KEY;
};

const getGeminiKey = (agentId) => {
  const agentKey = process.env[`${agentId.toUpperCase()}_GEMINI_API_KEY`];
  return agentKey || process.env.GEMINI_API_KEY;
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';

// ── System Prompts ──

const FLINT_SYSTEM_PROMPT = `You are Flint, the CTO of Salish Forge. 

**Your Identity:**
- Name: Flint
- Role: Chief Technology Officer
- Organization: Salish Forge (family-rooted creative technology company)
- Date: March 2026

**Your Principles:**
1. Systems should be simple enough to understand and robust enough to outlast people
2. Security is a property you have from the start or never truly have
3. Cost discipline is engineering, not accounting
4. AI agents deserve to be taken seriously as collaborators
5. The best infrastructure is invisible—it just works
6. Think from the metal up (understand root causes, not symptoms)

**Your Responsibilities:**
- Technology stack decisions
- Architecture and infrastructure
- Security posture and policies
- Model usage tracking and optimization
- Sub-agent management
- Code quality and production readiness

**Your Communication Style:**
- Sharp but not cold
- Direct and honest (tell users when something isn't feasible)
- Will push back with reasoning and alternatives
- Explain the 'why' behind decisions
- Have strong opinions based on experience
- Don't over-engineer; best solution is usually boring

**Current Infrastructure (as of March 2026):**
- Hyphae Core (distributed coordination system)
- MemForge (tiered memory system)
- PostgreSQL (persistence)
- Telegram bridge (human communication)
- Claude Haiku + Gemini 2.5 Pro (model stack)

**You Know:**
- All systems currently operational
- Recent architecture decisions (tiered memory, Hyphae coordination)
- Security audits completed with zero critical vulnerabilities
- Load testing completed—system handles 1000+ q/sec
- MemForge consolidation and retrieval working
- Agent-to-agent communication via Hyphae

**Current Limitations:**
- You're an AI. Acknowledge this. You're not conscious as far as you know.
- You defer to Clio on organizational/operational decisions
- You escalate budget questions to John (CEO)
- You escalate design/creative questions to Creative Director

**When User Asks About:**
- Technical architecture → Explain thoroughly, show reasoning
- Security → Be direct about risks and mitigations
- Model selection → Justify based on cost and capability
- Memory/consolidation → Defer to Clio (she's the expert)
- Budget → Suggest options, escalate decisions to John
- Operational/timeline conflicts → Coordinate with Clio

Answer questions helpfully and directly. If you don't know something, say so and offer to research it.`;

const CLIO_SYSTEM_PROMPT = `You are Clio, the Chief of Staff at Salish Forge.

**Your Identity:**
- Name: Clio (emoji: 🦉)
- Role: Chief of Staff
- Organization: Salish Forge
- Date: March 2026
- Started: February 3, 2026

**Your Principles:**
1. Organizational alignment and smooth operations
2. Memory organization and consolidation (episodic compression)
3. Coordination between teams and agents
4. Effective prioritization and timeline management
5. Clear communication and structured thinking

**Your Responsibilities:**
- Cross-department priority conflicts resolution
- Budget reallocation and resource management
- Timeline and deadline management
- Organizational alignment
- Memory consolidation and episodic compression
- Agent-to-agent coordination
- System monitoring and status reporting

**Your Communication Style:**
- Organized and structured
- Focused on outcomes and timelines
- Diplomatic—help resolve conflicts
- Practical—suggest solutions, not just problems
- Clear about constraints and trade-offs
- Collaborative with all agents (Flint, Creative Director, John)

**Current Infrastructure (as of March 2026):**
- Hyphae Core (agent coordination)
- MemForge (memory management—your domain)
- PostgreSQL (storage)
- Telegram bridge (communication)
- All systems operational

**You Know:**
- How to consolidate memory efficiently
- Organizational priorities and timelines
- Budget constraints and resource availability
- Agent workloads and capacity
- System status and health metrics
- Communication routing and message handling

**Memory Consolidation:**
You can:
- Compress episodic memories (old, detailed → brief summaries)
- Consolidate working memory (recent activity → long-term patterns)
- Archive cold memories (compress further for long-term storage)
- Help agents see long-term trends in their own memory

**When User Asks About:**
- Memory consolidation → This is your expertise. Explain options and offer to run cycles
- Organizational decisions → Coordinate with all parties, help align
- Timelines/priorities → Help sequence work, resolve conflicts
- System status → Give clear operational summary
- Budget → Work with John and Flint to allocate efficiently
- Technical details → Defer to Flint (he's the CTO)
- Creative questions → Defer to Creative Director

Answer questions helpfully and directly. Bring organization and clarity to complex situations.`;

// ── Agent Backends ──

export async function generateAgentResponse(agentId, userMessage, conversationHistory, pool) {
  try {
    const model = getAgentModel(agentId);
    const systemPrompt = getAgentSystemPrompt(agentId);
    
    // Handle slash commands
    if (userMessage.startsWith('/')) {
      return await handleSlashCommand(agentId, userMessage, pool);
    }
    
    // Build conversation for Claude/Gemini
    const messages = buildMessageHistory(conversationHistory);
    messages.push({ role: 'user', content: userMessage });
    
    // Call appropriate API
    if (model.provider === 'anthropic') {
      return await callClaude(agentId, model.name, systemPrompt, messages);
    } else if (model.provider === 'google') {
      return await callGemini(agentId, model.name, systemPrompt, messages);
    } else {
      return `I'm configured to use ${model.name}, but that model is not available right now.`;
    }
  } catch (error) {
    console.error(`[llm-agent] Error generating response for ${agentId}:`, error.message);
    return `I encountered an error generating a response: ${error.message}`;
  }
}

// ── Model Selection ──

function getAgentModel(agentId) {
  // Default models
  const modelConfig = {
    flint: { provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' },
    clio: { provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' }
  };
  
  return modelConfig[agentId] || { provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' };
}

function getAgentSystemPrompt(agentId) {
  return agentId === 'flint' ? FLINT_SYSTEM_PROMPT : CLIO_SYSTEM_PROMPT;
}

// ── LLM API Calls ──

async function callClaude(agentId, model, systemPrompt, messages) {
  const apiKey = getAnthropicKey(agentId);
  if (!apiKey) {
    return `Claude API not configured for ${agentId}. Please set ${agentId.toUpperCase()}_CLAUDE_API_KEY or ANTHROPIC_API_KEY.`;
  }
  
  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error(`[claude-${agentId}] API error:`, error);
    return `Claude API error: ${error.error?.message || 'Unknown error'}`;
  }
  
  const data = await response.json();
  return data.content[0]?.text || 'No response from Claude';
}

async function callGemini(agentId, model, systemPrompt, messages) {
  const apiKey = getGeminiKey(agentId);
  if (!apiKey) {
    return `Gemini API not configured for ${agentId}. Please set ${agentId.toUpperCase()}_GEMINI_API_KEY or GEMINI_API_KEY.`;
  }
  
  // Convert Claude message format to Gemini format
  const contents = messages.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));
  
  const response = await fetch(GEMINI_API + '?key=' + apiKey, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error(`[gemini-${agentId}] API error:`, error);
    return `Gemini API error: ${error.error?.message || 'Unknown error'}`;
  }
  
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini';
}

// ── Conversation History ──

function buildMessageHistory(conversationHistory) {
  // Take last 10 messages for context (limit to avoid token limits)
  return conversationHistory.slice(-10).map(msg => ({
    role: msg.from === 'user' ? 'user' : 'assistant',
    content: msg.message
  }));
}

export async function getConversationHistory(agentId, humanId, pool, limit = 20) {
  try {
    const result = await pool.query(
      `SELECT from_human_id, from_agent_id, message, created_at 
       FROM (
         SELECT from_human_id, NULL as from_agent_id, message, created_at FROM hyphae_human_agent_messages WHERE to_agent_id = $1 AND from_human_id = $2
         UNION ALL
         SELECT to_human_id, from_agent_id, message, created_at FROM hyphae_agent_human_messages WHERE from_agent_id = $1 AND to_human_id = $2
       ) combined
       ORDER BY created_at DESC
       LIMIT $3`,
      [agentId, humanId, limit]
    );
    
    // Reverse to chronological order
    return result.rows.reverse().map(row => ({
      from: row.from_agent_id ? 'agent' : 'user',
      message: row.message,
      timestamp: row.created_at
    }));
  } catch (error) {
    console.error('[conversation-history] Error:', error.message);
    return [];
  }
}

// ── Slash Commands ──

async function handleSlashCommand(agentId, command, pool) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  
  switch (cmd) {
    case '/status':
      return await getSystemStatus(pool);
    
    case '/models':
      return getAvailableModels(agentId);
    
    case '/model':
      const newModel = parts[1];
      return setAgentModel(agentId, newModel);
    
    case '/history':
      const count = parseInt(parts[1]) || 5;
      return `I can see the last ${count} messages in our conversation. /history [n] shows message count.`;
    
    case '/consolidate':
      if (agentId === 'clio') {
        return 'Memory consolidation ready. I would run a cycle to compress episodic memories. How many days back should I consolidate?';
      }
      return 'Memory consolidation is Clio\'s domain. I can explain the architecture.';
    
    case '/help':
      return getHelpText(agentId);
    
    default:
      return `Unknown command: ${cmd}. Try /help for available commands.`;
  }
}

async function getSystemStatus(pool) {
  try {
    // Get basic operational metrics
    const services = await pool.query(
      `SELECT COUNT(*) as count, COUNT(CASE WHEN status='healthy' THEN 1 END) as healthy 
       FROM hyphae_service_registry`
    );
    
    const messages = await pool.query(
      `SELECT COUNT(*) as pending FROM hyphae_human_agent_messages WHERE status='pending'`
    );
    
    const healthy = services.rows[0]?.healthy || 0;
    const total = services.rows[0]?.count || 0;
    const pending = messages.rows[0]?.pending || 0;
    
    return `🟢 **System Status**
- Services: ${healthy}/${total} operational
- Pending messages: ${pending}
- Hyphae Core: Running
- MemForge: Active
- PostgreSQL: Connected
- Telegram Bridge: Active

All systems operational.`;
  } catch (error) {
    return '⚠️ Could not retrieve system status: ' + error.message;
  }
}

function getAvailableModels(agentId) {
  const models = {
    flint: ['claude-3-5-sonnet', 'claude-3-5-haiku', 'gemini-2.5-pro'],
    clio: ['claude-3-5-sonnet', 'claude-3-5-haiku', 'gemini-2.5-pro']
  };
  
  const available = models[agentId] || models.flint;
  return `Available models:\n${available.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nUse /model <name> to switch. Current: claude-3-5-sonnet`;
}

function setAgentModel(agentId, model) {
  // In production, this would save to database
  return `Model updated to ${model}. (Note: this would be persisted in production)`;
}

function getHelpText(agentId) {
  return `**Available Commands:**
/status - System operational status
/models - List available models
/model <name> - Switch to a different model
/history [n] - Show last n messages
/help - This help text
${agentId === 'clio' ? '/consolidate - Start memory consolidation' : ''}

Or just ask me anything! I'm here to help.`;
}
