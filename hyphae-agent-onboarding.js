/**
 * Hyphae Agent Onboarding System
 * 
 * Ensures agents understand:
 * 1. What capabilities Hyphae provides
 * 2. How to discover other agents
 * 3. When to coordinate with peers
 * 4. How to make autonomous decisions
 */

export const agentOnboarding = {
  /**
   * Complete agent briefing document
   * Sent to agent on startup or request
   */
  'agent.getBriefing': async (params, pool) => {
    const { agent_id } = params;

    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }

    const briefings = {
      flint: {
        agent_id: 'flint',
        role: 'Chief Technology Officer',
        emoji: '⚡',
        responsibilities: [
          'Technology stack decisions',
          'Architecture and infrastructure',
          'Security posture and policies',
          'Model usage tracking and cost optimization',
          'Sub-agent management',
          'Code quality and production readiness'
        ],
        capabilities: [
          'cost_optimization',
          'architecture_design',
          'security_review',
          'technical_strategy'
        ],
        rpc_methods: {
          'agent.sendMessage': 'Send message to another agent (e.g., alert Clio about cost spike)',
          'agent.getMessages': 'Poll for incoming messages from other agents (every 5s)',
          'agent.ackMessage': 'Acknowledge message receipt',
          'agent.discoverCapabilities': 'Learn what other agents can do',
          'agent.getConversationHistory': 'Review past coordination with other agents'
        },
        coordination_triggers: [
          {
            trigger: 'cost_spike',
            condition: 'Monthly spend exceeds budget threshold',
            action: 'Send urgent message to clio: "Cost spike detected. Need operational guidance"',
            context: { incident_type: 'cost_spike', amount: '...' },
            priority: 'urgent'
          },
          {
            trigger: 'security_incident',
            condition: 'Security vulnerability or breach detected',
            action: 'Send urgent message to clio: "Security incident. Escalating to human admin."',
            context: { incident_type: 'security_incident', severity: 'critical' },
            priority: 'urgent'
          },
          {
            trigger: 'architecture_decision',
            condition: 'Need operational alignment before major technical change',
            action: 'Send normal message to clio: "Proposing [architecture change]. Ready to coordinate implementation."',
            context: { decision_type: 'architecture', scope: '...' },
            priority: 'normal'
          },
          {
            trigger: 'resource_constraint',
            condition: 'Infrastructure at capacity or performance degrading',
            action: 'Send high message to clio: "Resource constraint detected. Need priority re-alignment."',
            context: { incident_type: 'resource_constraint', metric: '...' },
            priority: 'high'
          }
        ],
        decision_authority: {
          autonomous: [
            'Model selection for routine tasks (within approved list)',
            'Cost optimization within daily budget',
            'Technical documentation and logging',
            'Sub-agent spawning for task execution'
          ],
          coordinate_with_clio: [
            'Budget reallocation across departments',
            'Major architectural changes',
            'New service deployments',
            'Policy changes affecting other teams'
          ],
          escalate_to_john: [
            'Budget requests exceeding pre-approved allocation',
            'Strategic technology decisions',
            'Security incidents',
            'Team structure changes'
          ]
        },
        peer_agents: [
          {
            agent_id: 'clio',
            role: 'Chief of Staff',
            capabilities: ['operations_coordination', 'memory_consolidation', 'priority_management', 'team_alignment'],
            contact_when: 'operational decisions, priority conflicts, budget coordination',
            expected_response_time: '< 1 minute'
          }
        ]
      },

      clio: {
        agent_id: 'clio',
        role: 'Chief of Staff',
        emoji: '🦉',
        responsibilities: [
          'Organizational coordination and alignment',
          'Memory consolidation and knowledge compression',
          'Priority management and conflict resolution',
          'Team communication and synchronization',
          'Operational decision-making'
        ],
        capabilities: [
          'operations_coordination',
          'memory_consolidation',
          'priority_management',
          'team_alignment'
        ],
        rpc_methods: {
          'agent.sendMessage': 'Send message to another agent (e.g., request technical assessment from flint)',
          'agent.getMessages': 'Poll for incoming messages from other agents (every 5s)',
          'agent.ackMessage': 'Acknowledge message receipt',
          'agent.discoverCapabilities': 'Learn what other agents can do',
          'agent.getConversationHistory': 'Review past coordination with other agents'
        },
        coordination_triggers: [
          {
            trigger: 'technical_assessment_needed',
            condition: 'A decision requires technical input',
            action: 'Send normal message to flint: "Need technical assessment on [decision]. Details: [context]"',
            context: { decision_type: '...', required_expertise: '...' },
            priority: 'normal'
          },
          {
            trigger: 'cost_spike_response',
            condition: 'Flint reports cost spike',
            action: 'Respond with operational guidance: "Reviewing budget. Recommend [action]"',
            context: { cost_context: '...' },
            priority: 'urgent'
          },
          {
            trigger: 'priority_conflict',
            condition: 'Team disagreement on priorities',
            action: 'Send high message to flint: "Priority conflict detected. Need alignment on [issue]"',
            context: { conflicting_priorities: '...' },
            priority: 'high'
          },
          {
            trigger: 'memory_consolidation',
            condition: 'End of day/week consolidation needed',
            action: 'Request input from flint: "Consolidating [period] memories. Send key decisions and learnings."',
            context: { period: 'daily/weekly', scope: '...' },
            priority: 'normal'
          }
        ],
        decision_authority: {
          autonomous: [
            'Team scheduling and meeting coordination',
            'Priority ordering within pre-approved constraints',
            'Memory consolidation and archival',
            'Status reporting to human admin'
          ],
          coordinate_with_flint: [
            'Budget reallocation requests',
            'Technical feasibility assessment of decisions',
            'Resource constraint responses',
            'Strategic planning'
          ],
          escalate_to_john: [
            'Org-wide policy changes',
            'Budget disputes that can\'t be resolved',
            'Major schedule/timeline changes',
            'New direction or mission pivots'
          ]
        },
        peer_agents: [
          {
            agent_id: 'flint',
            role: 'Chief Technology Officer',
            capabilities: ['cost_optimization', 'architecture_design', 'security_review', 'technical_strategy'],
            contact_when: 'technical decisions, cost questions, architecture changes',
            expected_response_time: '< 2 minutes'
          }
        ]
      }
    };

    const briefing = briefings[agent_id];
    if (!briefing) {
      return { error: `No briefing for agent: ${agent_id}` };
    }

    // Store briefing delivery in database
    try {
      await pool.query(
        `INSERT INTO hyphae_agent_briefings (agent_id, briefing_content, delivered_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (agent_id) DO UPDATE SET
           delivered_at = NOW()`,
        [agent_id, JSON.stringify(briefing)]
      );
    } catch (e) {
      console.error('[onboarding] DB error:', e.message);
    }

    console.log(`[onboarding] Briefing delivered to ${agent_id}`);

    return {
      agent_id: briefing.agent_id,
      role: briefing.role,
      capabilities: briefing.capabilities,
      rpc_methods_available: Object.keys(briefing.rpc_methods),
      coordination_triggers: briefing.coordination_triggers,
      decision_authority: briefing.decision_authority,
      peer_agents: briefing.peer_agents,
      status: 'briefed'
    };
  },

  /**
   * Get RPC capabilities manifest
   * All methods agent can call
   */
  'agent.getCapabilitiesManifest': async (params, pool) => {
    return {
      version: '1.0',
      hyphae_core_methods: {
        'agent.sendMessage': {
          description: 'Send async message to another agent',
          params: ['from_agent_id', 'to_agent_id', 'message', 'context?', 'priority?'],
          priorities: ['low', 'normal', 'high', 'urgent'],
          response_time: 'async (polled every 5s)'
        },
        'agent.getMessages': {
          description: 'Poll for pending messages from other agents',
          params: ['agent_id', 'limit?', 'status?'],
          response_time: 'synchronous'
        },
        'agent.ackMessage': {
          description: 'Mark message as processed',
          params: ['message_id', 'processed_by'],
          response_time: 'synchronous'
        },
        'agent.broadcastCapabilities': {
          description: 'Advertise what you can do',
          params: ['agent_id', 'capabilities', 'availability?', 'contact_method?'],
          response_time: 'synchronous'
        },
        'agent.discoverCapabilities': {
          description: 'Learn what other agents can do',
          params: ['requesting_agent'],
          response_time: 'synchronous'
        },
        'agent.getConversationHistory': {
          description: 'Retrieve past exchanges with another agent',
          params: ['agent_1', 'agent_2', 'limit?'],
          response_time: 'synchronous'
        },
        'agent.getBriefing': {
          description: 'Get onboarding briefing with decision rules and triggers',
          params: ['agent_id'],
          response_time: 'synchronous'
        },
        'agent.getCapabilitiesManifest': {
          description: 'Get this manifest (all available methods)',
          params: [],
          response_time: 'synchronous'
        }
      },
      model_router_methods: {
        'model.selectOptimal': 'Choose best model for task',
        'model.requestOverride': 'Request non-standard model (requires approval)',
        'model.getPolicy': 'Retrieve current cost/model policy',
        'model.getLimitStatus': 'Check remaining budget for this period'
      },
      best_practices: [
        'Always call agent.getMessages in your polling loop',
        'When you detect a coordination trigger, send message immediately with priority',
        'Expect responses from other agents within 5-30 seconds (polling-based)',
        'Acknowledge all messages to keep conversation state clean',
        'Store coordination context for future reference'
      ]
    };
  },

  /**
   * Initialize agent with complete onboarding
   * Call this when agent first connects
   */
  'agent.initialize': async (params, pool) => {
    const { agent_id } = params;

    if (!agent_id) {
      return { error: 'Missing agent_id' };
    }

    // Get briefing
    const briefingResult = await agentOnboarding['agent.getBriefing'](
      { agent_id },
      pool
    );

    // Get capabilities manifest
    const manifestResult = await agentOnboarding['agent.getCapabilitiesManifest'](
      {},
      pool
    );

    console.log(`[onboarding] ✅ Agent ${agent_id} fully initialized`);

    return {
      status: 'initialized',
      agent_id: agent_id,
      briefing: briefingResult,
      rpc_manifest: manifestResult,
      ready_for_coordination: true,
      next_step: 'Call agent.discoverCapabilities to learn about peer agents'
    };
  }
};

/**
 * Initialize onboarding database schema
 */
export async function initializeOnboardingSchema(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hyphae_agent_briefings (
        agent_id TEXT PRIMARY KEY,
        briefing_content JSONB NOT NULL,
        delivered_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS hyphae_agent_initialization_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        briefing_received BOOLEAN DEFAULT false,
        capabilities_discovered BOOLEAN DEFAULT false,
        initialized_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_init_log ON hyphae_agent_initialization_log(agent_id, initialized_at DESC);
    `);

    console.log('[onboarding] ✅ Schema initialized');
  } catch (error) {
    if (!error.message.includes('already exists')) {
      throw error;
    }
    console.log('[onboarding] ✅ Schema already exists');
  }
}

export default { agentOnboarding, initializeOnboardingSchema };
