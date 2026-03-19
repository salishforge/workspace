/**
 * Nanoclaw Agent with Hyphae Integration
 * 
 * Example nanoclaw agent that:
 * 1. Registers with Hyphae on startup
 * 2. Discovers other agents via Hyphae
 * 3. Calls other agents through Hyphae RPC
 */

import express from 'express';
import axios from 'axios';

interface HyphaeConfig {
  registryUrl: string;
  agentId: string;
  agentName: string;
  endpoint: string;
  region: string;
}

class NanoclawHyphaeAgent {
  private app: express.Application;
  private config: HyphaeConfig;

  constructor(config: HyphaeConfig) {
    this.config = config;
    this.app = express();
    this.setupExpress();
  }

  private setupExpress() {
    this.app.use(express.json());

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        capacity: Math.random() * 0.5,
      });
    });

    this.app.post('/rpc', async (req, res) => {
      const { traceId, sourceAgent, capability, params } = req.body;
      console.log(`[RPC] ${sourceAgent} → ${capability}:`, params);

      try {
        let result;
        if (capability === 'research') {
          result = await this.research(params.topic, params.depth);
        } else if (capability === 'analyze') {
          result = await this.analyze(params.data);
        } else if (capability === 'review') {
          result = await this.review(params.content);
        } else {
          return res.status(404).json({ error: `Unknown: ${capability}` });
        }

        res.json({ traceId, success: true, result });
      } catch (error) {
        res.status(500).json({
          traceId,
          success: false,
          error: String(error),
        });
      }
    });
  }

  async register() {
    try {
      const response = await axios.post(`${this.config.registryUrl}/api/services/register`, {
        agentId: this.config.agentId,
        name: this.config.agentName,
        framework: 'nanoclaw',
        version: '1.0.0',
        capabilities: [
          { name: 'research', description: 'Research a topic', params: ['topic', 'depth'], returns: 'report' },
          { name: 'analyze', description: 'Analyze data', params: ['data'], returns: 'analysis' },
          { name: 'review', description: 'Review content', params: ['content'], returns: 'review' },
        ],
        endpoint: this.config.endpoint,
        healthCheckPath: '/health',
        region: this.config.region,
        oauthClientId: 'agent-' + this.config.agentId,
        authRequired: false,
      });
      console.log('✅ Registered:', response.data);
    } catch (error) {
      console.error('❌ Registration failed:', error);
      throw error;
    }
  }

  startHeartbeat(intervalMs = 30000) {
    setInterval(async () => {
      try {
        await axios.post(`${this.config.registryUrl}/api/services/${this.config.agentId}/heartbeat`, {
          capacity: Math.random() * 0.5,
        });
      } catch (error) {
        console.error('Heartbeat failed');
      }
    }, intervalMs);
  }

  async discoverServices(capability?: string) {
    const url = new URL(`${this.config.registryUrl}/api/services`);
    if (capability) url.searchParams.append('capability', capability);
    const response = await axios.get(url.toString());
    return response.data;
  }

  async callAgent(targetAgentId: string, capability: string, params: Record<string, any>) {
    const response = await axios.post(`${this.config.registryUrl}/api/rpc/call`, {
      sourceAgent: this.config.agentId,
      targetAgent: targetAgentId,
      capability,
      params,
      timeout: 30000,
    });
    return response.data;
  }

  private async research(topic: string, depth: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 200));
    return `Research: "${topic}" (${depth})`;
  }

  private async analyze(data: string): Promise<object> {
    await new Promise((r) => setTimeout(r, 200));
    return { sentiment: 'positive', length: data.length };
  }

  private async review(content: string): Promise<object> {
    await new Promise((r) => setTimeout(r, 200));
    return { quality: 0.9, issues: [] };
  }

  async start(port: number) {
    await this.register();
    this.startHeartbeat();
    this.app.listen(port, () => {
      console.log(`✅ Nanoclaw agent on port ${port} (${this.config.agentId})`);
    });
  }
}

export { NanoclawHyphaeAgent };
