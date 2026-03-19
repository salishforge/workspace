/**
 * 3-Agent Multi-Framework Coordination Demo
 * 
 * Agents:
 * 1. Nanoclaw Researcher (port 3006) - researches topics
 * 2. OpenClaw Analyzer (port 3007) - analyzes findings
 * 3. AutoGen Writer (port 3008) - writes synthesis
 * 
 * Workflow: Researcher → Analyzer → Writer
 */

import axios from 'axios';

const HYPHAE_URL = 'http://localhost:3004';

interface AgentInfo {
  id: string;
  name: string;
  framework: string;
  port: number;
  endpoint: string;
}

class ThreeAgentDemo {
  private agents: AgentInfo[] = [
    {
      id: 'nanoclaw-researcher',
      name: 'Researcher',
      framework: 'nanoclaw',
      port: 3006,
      endpoint: 'http://localhost:3006',
    },
    {
      id: 'openclaw-analyzer',
      name: 'Analyzer',
      framework: 'openclaw',
      port: 3007,
      endpoint: 'http://localhost:3007',
    },
    {
      id: 'autogen-writer',
      name: 'Writer',
      framework: 'autogen',
      port: 3008,
      endpoint: 'http://localhost:3008',
    },
  ];

  async runDemo() {
    console.log('🚀 Starting 3-Agent Multi-Framework Demo\n');

    try {
      // Step 1: Register all agents
      console.log('Step 1: Registering agents with Hyphae...');
      for (const agent of this.agents) {
        try {
          await axios.post(`${HYPHAE_URL}/api/services/register`, {
            agentId: agent.id,
            name: agent.name,
            framework: agent.framework,
            version: '1.0.0',
            capabilities: this.getCapabilities(agent.framework),
            endpoint: agent.endpoint,
            healthCheckPath: '/health',
            region: 'us-west',
            oauthClientId: 'agent-' + agent.id,
            authRequired: false,
          });
          console.log(`  ✅ ${agent.name} (${agent.framework})`);
        } catch (error) {
          console.error(`  ❌ Failed to register ${agent.name}`);
        }
      }

      // Step 2: Verify service discovery
      console.log('\nStep 2: Discovering services...');
      const allServices = await axios.get(`${HYPHAE_URL}/api/services`);
      console.log(`  ✅ Found ${allServices.data.length} services`);

      // Step 3: Execute workflow
      console.log('\nStep 3: Executing workflow...');

      const topic = 'Quantum Computing Breakthroughs';
      console.log(`\n📊 Topic: "${topic}"\n`);

      // Researcher finds information
      console.log('1️⃣  Researcher: Researching topic...');
      const researchResult = await axios.post(`${HYPHAE_URL}/api/rpc/call`, {
        sourceAgent: 'demo-orchestrator',
        targetAgent: 'nanoclaw-researcher',
        capability: 'research',
        params: { topic, depth: 'deep' },
        timeout: 30000,
      });

      console.log(`   📝 Research: ${researchResult.data.result}`);

      // Analyzer analyzes findings
      console.log('\n2️⃣  Analyzer: Analyzing findings...');
      const analysisResult = await axios.post(`${HYPHAE_URL}/api/rpc/call`, {
        sourceAgent: 'demo-orchestrator',
        targetAgent: 'openclaw-analyzer',
        capability: 'analyze',
        params: { data: researchResult.data.result },
        timeout: 30000,
      });

      console.log(`   📊 Analysis:`, analysisResult.data.result);

      // Writer creates synthesis
      console.log('\n3️⃣  Writer: Creating synthesis...');
      const synthesisResult = await axios.post(`${HYPHAE_URL}/api/rpc/call`, {
        sourceAgent: 'demo-orchestrator',
        targetAgent: 'autogen-writer',
        capability: 'write',
        params: { outline: 'Summary of quantum computing breakthroughs' },
        timeout: 30000,
      });

      console.log(`   ✍️  Synthesis: ${synthesisResult.data.result}`);

      console.log('\n✅ Demo Complete!\n');

      // Step 4: Show mesh topology
      console.log('Step 4: Mesh Topology');
      const topology = await axios.get(`${HYPHAE_URL}/api/mesh/topology`);
      console.log(`  Services: ${topology.data.metrics.totalServices}`);
      console.log(`  Healthy: ${topology.data.metrics.healthyServices}`);
      console.log(`  Avg Capacity: ${(topology.data.metrics.averageCapacity * 100).toFixed(1)}%`);

      console.log('\n🎉 Multi-Framework Agent Coordination Works!\n');
    } catch (error) {
      console.error('❌ Demo failed:', error instanceof Error ? error.message : error);
    }
  }

  private getCapabilities(framework: string): any[] {
    const capabilities: Record<string, any[]> = {
      nanoclaw: [
        {
          name: 'research',
          description: 'Research a topic',
          params: ['topic', 'depth'],
          returns: 'report',
        },
      ],
      openclaw: [
        {
          name: 'analyze',
          description: 'Analyze findings',
          params: ['data'],
          returns: 'analysis',
        },
      ],
      autogen: [
        {
          name: 'write',
          description: 'Write content',
          params: ['outline'],
          returns: 'content',
        },
      ],
    };

    return capabilities[framework] || [];
  }
}

// Run demo
const demo = new ThreeAgentDemo();
demo.runDemo().catch(console.error);
