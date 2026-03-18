/**
 * CrewAI ↔ MemForge Adapter
 * 
 * Enables CrewAI agents and crews to use Salish Forge MemForge for memory management.
 * Integrates with CrewAI's tool ecosystem.
 */

import axios, { AxiosInstance } from 'axios';

export interface CrewMemForgeConfig {
  baseUrl: string;      // http://100.97.161.7:3333
  crewId: string;       // Crew identifier
  agentId: string;      // Individual agent identifier (within crew)
  timeout?: number;
}

export interface CrewMemoryEntry {
  content: string;
  agentId: string;      // Which agent in crew added this
  conversationId?: string;
  turnNumber?: number;
  metadata?: Record<string, any>;
}

export interface CrewSearchResult {
  id: string;
  content: string;
  similarity: number;
  source_agent: string;
  metadata?: Record<string, any>;
}

/**
 * CrewMemForgeAdapter - Bridges CrewAI to MemForge
 */
export class CrewMemForgeAdapter {
  private client: AxiosInstance;
  private config: CrewMemForgeConfig;
  private crewMemoryId: string;

  constructor(config: CrewMemForgeConfig) {
    this.config = {
      ...config,
      timeout: config.timeout || 5000,
    };

    this.crewMemoryId = `${this.config.crewId}-collective`;

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Store a memory entry from a crew member
   * 
   * @param content - The memory content
   * @param agentId - Which agent is storing this
   * @param metadata - Optional metadata
   * @returns Memory ID
   */
  async addMemory(
    content: string,
    agentId: string = this.config.agentId,
    metadata?: Record<string, any>
  ): Promise<string> {
    try {
      const enrichedMetadata = {
        ...metadata,
        source_agent: agentId,
        crew_id: this.config.crewId,
        timestamp: new Date().toISOString(),
      };

      const response = await this.client.post(
        `/memory/${this.crewMemoryId}/add`,
        {
          content,
          metadata: enrichedMetadata,
        }
      );

      return response.data.id;
    } catch (error) {
      console.error('Failed to add crew memory:', error);
      throw error;
    }
  }

  /**
   * Search crew memory (shared by all agents)
   * 
   * @param query - Search query
   * @param agentId - Optional filter by agent
   * @param limit - Max results
   * @returns Search results
   */
  async searchMemory(
    query: string,
    agentId?: string,
    limit: number = 10
  ): Promise<CrewSearchResult[]> {
    try {
      const response = await this.client.get(
        `/memory/${this.crewMemoryId}/query`,
        { params: { q: query, limit } }
      );

      let results: CrewSearchResult[] = response.data.results.map((result: any) => ({
        id: result.id,
        content: result.content,
        similarity: result.similarity,
        source_agent: result.metadata?.source_agent || 'unknown',
        metadata: result.metadata,
      }));

      // Filter by agent if specified
      if (agentId) {
        results = results.filter((r) => r.source_agent === agentId);
      }

      return results;
    } catch (error) {
      console.error('Failed to search crew memory:', error);
      throw error;
    }
  }

  /**
   * Get memories from a specific agent
   * 
   * @param agentId - The agent to query
   * @param limit - Max results
   * @returns Memories from that agent
   */
  async getAgentMemory(agentId: string, limit: number = 20): Promise<CrewSearchResult[]> {
    try {
      const response = await this.client.get(
        `/memory/${this.crewMemoryId}/query`,
        {
          params: {
            q: `agent:${agentId}`,
            limit,
          },
        }
      );

      return response.data.results
        .filter((r: any) => r.metadata?.source_agent === agentId)
        .map((result: any) => ({
          id: result.id,
          content: result.content,
          similarity: result.similarity,
          source_agent: agentId,
          metadata: result.metadata,
        }));
    } catch (error) {
      console.error('Failed to get agent memory:', error);
      throw error;
    }
  }

  /**
   * Get crew-wide statistics
   */
  async getStats(): Promise<Record<string, any>> {
    try {
      const response = await this.client.get(`/memory/${this.crewMemoryId}/stats`);
      return {
        crew_id: this.config.crewId,
        ...response.data,
      };
    } catch (error) {
      console.error('Failed to get crew stats:', error);
      throw error;
    }
  }

  /**
   * Clear all crew memory
   */
  async clearMemory(): Promise<void> {
    try {
      await this.client.delete(`/memory/${this.crewMemoryId}/`);
    } catch (error) {
      console.error('Failed to clear crew memory:', error);
      throw error;
    }
  }

  /**
   * Consolidate crew memory
   */
  async consolidateMemory(): Promise<Record<string, any>> {
    try {
      const response = await this.client.post(
        `/memory/${this.crewMemoryId}/consolidate`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to consolidate crew memory:', error);
      throw error;
    }
  }
}

/**
 * CrewAI Tool Integration
 * 
 * Usage with CrewAI:
 * 
 * const memAdapter = new CrewMemForgeAdapter({
 *   baseUrl: 'http://100.97.161.7:3333',
 *   crewId: 'research-crew-1',
 *   agentId: 'researcher-agent'
 * });
 * 
 * // Create tool for agents to use
 * const rememberTool = {
 *   name: 'remember',
 *   description: 'Store information in crew memory',
 *   function: async (content: string) => {
 *     const id = await memAdapter.addMemory(content);
 *     return `Stored in memory: ${id}`;
 *   }
 * };
 * 
 * const recallTool = {
 *   name: 'recall',
 *   description: 'Search crew memory for relevant information',
 *   function: async (query: string) => {
 *     const results = await memAdapter.searchMemory(query, undefined, 5);
 *     return results.map(r => r.content).join('\n\n');
 *   }
 * };
 * 
 * // Add tools to agent
 * agent.tools = [rememberTool, recallTool];
 */

export default CrewMemForgeAdapter;
