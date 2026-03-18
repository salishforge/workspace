/**
 * AutoGen ↔ MemForge Adapter
 * 
 * Enables AutoGen agents to use Salish Forge MemForge for memory management.
 * Bridges AutoGen's memory abstraction to MemForge's semantic search capabilities.
 */

import axios, { AxiosInstance } from 'axios';

export interface MemForgeConfig {
  baseUrl: string;      // http://100.97.161.7:3333
  agentId: string;      // AutoGen agent identifier
  timeout?: number;     // Request timeout (default: 5000ms)
}

export interface MemoryEntry {
  content: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
}

/**
 * AutoGenMemoryAdapter - Bridges AutoGen agents to MemForge
 */
export class AutoGenMemoryAdapter {
  private client: AxiosInstance;
  private config: MemForgeConfig;

  constructor(config: MemForgeConfig) {
    this.config = {
      ...config,
      timeout: config.timeout || 5000,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Store a memory entry
   * 
   * @param content - The content to store
   * @param metadata - Optional metadata (tags, importance, etc.)
   * @returns Memory ID
   */
  async addMemory(content: string, metadata?: Record<string, any>): Promise<string> {
    try {
      const response = await this.client.post(
        `/memory/${this.config.agentId}/add`,
        { content, metadata }
      );
      return response.data.id;
    } catch (error) {
      console.error('Failed to add memory to MemForge:', error);
      throw error;
    }
  }

  /**
   * Search memory using semantic search
   * 
   * @param query - Search query
   * @param limit - Max results (default: 10)
   * @returns Search results with similarity scores
   */
  async searchMemory(query: string, limit: number = 10): Promise<SearchResult[]> {
    try {
      const response = await this.client.get(
        `/memory/${this.config.agentId}/query`,
        { params: { q: query, limit } }
      );

      return response.data.results.map((result: any) => ({
        id: result.id,
        content: result.content,
        similarity: result.similarity,
        metadata: result.metadata,
      }));
    } catch (error) {
      console.error('Failed to search memory:', error);
      throw error;
    }
  }

  /**
   * Get memory statistics
   * 
   * @returns Statistics about stored memory
   */
  async getStats(): Promise<Record<string, any>> {
    try {
      const response = await this.client.get(`/memory/${this.config.agentId}/stats`);
      return response.data;
    } catch (error) {
      console.error('Failed to get memory stats:', error);
      throw error;
    }
  }

  /**
   * Clear all memory for this agent
   */
  async clearMemory(): Promise<void> {
    try {
      await this.client.delete(`/memory/${this.config.agentId}/`);
    } catch (error) {
      console.error('Failed to clear memory:', error);
      throw error;
    }
  }

  /**
   * Consolidate memory (move to warm/cold tiers)
   */
  async consolidateMemory(): Promise<Record<string, any>> {
    try {
      const response = await this.client.post(
        `/memory/${this.config.agentId}/consolidate`
      );
      return response.data;
    } catch (error) {
      console.error('Failed to consolidate memory:', error);
      throw error;
    }
  }
}

/**
 * AutoGen Memory Manager Integration
 * 
 * Usage with AutoGen GroupChat:
 * 
 * const memoryAdapter = new AutoGenMemoryAdapter({
 *   baseUrl: 'http://100.97.161.7:3333',
 *   agentId: 'autogen-team-1'
 * });
 * 
 * // Use in conversation handlers
 * agent.register_reply(
 *   [ConversableAgent, Agent],
 *   reply_func=async (messages, sender, config) => {
 *     // Store conversation turn
 *     await memoryAdapter.addMemory(
 *       messages[messages.length - 1].content,
 *       { role: messages[messages.length - 1].role }
 *     );
 *     
 *     // Search relevant context
 *     const context = await memoryAdapter.searchMemory(
 *       'relevant topic',
 *       limit: 5
 *     );
 *     
 *     // Use context in response generation
 *     return generate_response_with_context(context);
 *   }
 * );
 */

export default AutoGenMemoryAdapter;
