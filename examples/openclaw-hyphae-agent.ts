/**
 * OpenClaw Agent with Hyphae Integration
 * 
 * Example OpenClaw agent using Hyphae coordination
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

class OpenClawHyphaeAgent {
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
        if (capability === 'synthesize') {
          result = await this.synthesize(params.findings);
        } else if (capability === 'write') {
          result = await this.write(params.outline);
        } else if (capability === 'format') {
          result = await this.format(params.content);
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
        framework: 'openclaw',
        version: '1.0.0',
        capabilities: [
          { name: 'synthesize', description: 'Synthesize findings', params: ['findings'], returns: 'synthesis' },
          { name: 'write', description: 'Write content', params: ['outline'], returns: 'content' },
          { name: 'format', description: 'Format content', params: ['content'], returns: 'formatted' },
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

  private async synthesize(findings: any): Promise<string> {
    await new Promise((r) => setTimeout(r, 200));
    return `Synthesized: ${JSON.stringify(findings).substring(0, 50)}...`;
  }

  private async write(outline: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 200));
    return `Written content based on: ${outline}`;
  }

  private async format(content: string): Promise<string> {
    await new Promise((r) => setTimeout(r, 200));
    return `Formatted: ${content}`;
  }

  async start(port: number) {
    await this.register();
    this.startHeartbeat();
    this.app.listen(port, () => {
      console.log(`✅ OpenClaw agent on port ${port} (${this.config.agentId})`);
    });
  }
}

export { OpenClawHyphaeAgent };
