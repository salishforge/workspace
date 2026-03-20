/**
 * MemForge Integration Client
 * 
 * For use by agents (Flint, Clio, etc.) to discover and integrate with MemForge
 * through the Hyphae Service Registry.
 */

export class MemForgeClient {
  constructor(options = {}) {
    this.hyphaeRpcUrl = options.hyphaeRpcUrl || process.env.HYPHAE_RPC_URL || 'http://localhost:3102';
    this.hypaeBearerToken = options.hypaeBearerToken || process.env.HYPHAE_BEARER_TOKEN || '';
    this.agentId = options.agentId || process.env.AGENT_ID || 'agent-unknown';
    this.discovered = false;
    this.integrated = false;
    this.memforgeServices = [];
  }

  /**
   * Discover MemForge services available through Hyphae
   */
  async discoverMemForge() {
    try {
      console.log(`[agent] Discovering MemForge services...`);

      const discovery = {
        jsonrpc: '2.0',
        method: 'services.discover',
        params: {
          agent_id: this.agentId,
          filters: {
            service_type: 'memory',
            healthy: true,
            required_capabilities: ['queryByText', 'getHotTier']
          }
        },
        id: 'discover-memforge-' + Date.now()
      };

      const response = await this.callHyphaeRPC(discovery);
      const services = response.result?.services || [];

      if (services.length === 0) {
        console.warn('[agent] No MemForge service available');
        return false;
      }

      // Filter for MemForge specifically
      this.memforgeServices = services.filter(s => s.service_name.includes('MemForge'));

      if (this.memforgeServices.length === 0) {
        console.warn('[agent] MemForge not available');
        return false;
      }

      console.log(`[agent] ✓ Discovered ${this.memforgeServices.length} MemForge service(s)`);
      this.discovered = true;
      return true;

    } catch (error) {
      console.warn(`[agent] MemForge discovery failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Integrate with MemForge services
   */
  async integrateWithMemForge() {
    if (!this.discovered) {
      const discovered = await this.discoverMemForge();
      if (!discovered) return false;
    }

    try {
      console.log(`[agent] Integrating with MemForge...`);

      for (const service of this.memforgeServices) {
        const integration = {
          jsonrpc: '2.0',
          method: 'services.integrate',
          params: {
            agent_id: this.agentId,
            service_id: service.service_id,
            integration_type: 'routed', // Route through Hyphae for security
            capabilities_needed: service.capabilities.map(c => c.id)
          },
          id: 'integrate-' + service.service_id
        };

        const response = await this.callHyphaeRPC(integration);

        if (!response.result?.integrated) {
          throw new Error(`Failed to integrate with ${service.service_name}`);
        }

        // Store integration config
        if (!global.MEMORY_SERVICES) {
          global.MEMORY_SERVICES = {};
        }

        global.MEMORY_SERVICES[service.service_id] = {
          service_id: service.service_id,
          service_name: service.service_name,
          endpoint: response.result.integration_config.service_endpoint,
          auth_token: response.result.integration_config.agent_authorization,
          routed_via_hyphae: response.result.integration_config.routing_via_hyphae,
          caching_enabled: response.result.integration_config.caching_enabled
        };

        console.log(`[agent] ✓ Integrated with ${service.service_name}`);
      }

      this.integrated = true;
      return true;

    } catch (error) {
      console.warn(`[agent] MemForge integration failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Query MemForge memory through Hyphae
   */
  async queryMemory(queryText) {
    if (!this.integrated) {
      const integrated = await this.integrateWithMemForge();
      if (!integrated) {
        console.warn('[agent] Cannot query memory (MemForge not integrated)');
        return [];
      }
    }

    try {
      const retrievalService = global.MEMORY_SERVICES['memforge-retrieval'];
      if (!retrievalService) {
        throw new Error('MemForge retrieval service not integrated');
      }

      // Build request (if routed via Hyphae, use services.call method)
      const request = retrievalService.routed_via_hyphae
        ? {
            jsonrpc: '2.0',
            method: 'services.call',
            params: {
              service_id: 'memforge-retrieval',
              method: 'queryByText',
              params: { agentId: this.agentId, queryText }
            },
            id: 'query-' + Date.now()
          }
        : {
            method: 'queryByText',
            params: { agentId: this.agentId, queryText }
          };

      const response = await this.callHyphaeRPC(request);
      return response.result || [];

    } catch (error) {
      console.warn(`[agent] Memory query failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Get hot-tier memory (most important/recent)
   */
  async getHotTier() {
    if (!this.integrated) {
      await this.integrateWithMemForge();
    }

    try {
      const retrievalService = global.MEMORY_SERVICES['memforge-retrieval'];
      if (!retrievalService) {
        throw new Error('MemForge retrieval service not integrated');
      }

      const request = {
        jsonrpc: '2.0',
        method: 'services.call',
        params: {
          service_id: 'memforge-retrieval',
          method: 'getHotTier',
          params: { agentId: this.agentId }
        },
        id: 'hot-tier-' + Date.now()
      };

      const response = await this.callHyphaeRPC(request);
      return response.result || {};

    } catch (error) {
      console.warn(`[agent] Hot tier query failed: ${error.message}`);
      return {};
    }
  }

  /**
   * Internal: Call Hyphae RPC
   */
  async callHyphaeRPC(rpcRequest) {
    const response = await fetch(this.hyphaeRpcUrl + '/rpc', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.hypaeBearerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rpcRequest),
      timeout: 5000
    });

    if (!response.ok) {
      throw new Error(`Hyphae returned ${response.status}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(`Hyphae error: ${result.error.message}`);
    }

    return result;
  }
}

export default MemForgeClient;
