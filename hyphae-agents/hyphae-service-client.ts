/**
 * Hyphae Service Client
 * Agents use this to access all external services through Hyphae
 */

import axios from 'axios';

/**
 * Standard client all agents use (same interface always)
 */
export class HyphaeServiceClient {
  private hyphaeUrl: string;
  private agentId: string;
  private token?: string;

  constructor(
    hyphaeUrl: string,
    agentId: string,
    token?: string
  ) {
    this.hyphaeUrl = hyphaeUrl;
    this.agentId = agentId;
    this.token = token;
  }

  /**
   * Universal service request
   * SAME interface for all services: secrets, database, storage, etc.
   */
  async call(
    service: string,
    operation: string,
    params: Record<string, any>,
    options?: { timeout?: number; retryPolicy?: string }
  ): Promise<any> {
    try {
      const response = await axios.post(
        `${this.hyphaeUrl}/service/execute`,
        {
          sourceAgent: this.agentId,
          service,
          operation,
          params,
          context: {
            timeout: options?.timeout || 30000,
            retryPolicy: options?.retryPolicy || 'exponential',
          },
        },
        {
          headers: {
            Authorization: this.token ? `Bearer ${this.token}` : undefined,
          },
          timeout: (options?.timeout || 30000) + 5000, // HTTP timeout > request timeout
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error: any) {
      throw new Error(`Service call failed: ${error.message}`);
    }
  }

  /**
   * Helper: Get a secret (works with any secrets backend)
   * Could be core vault, 1Password, Azure, AWS, etc.
   * Agent doesn't care — same interface
   */
  async getSecret(secretName: string, service?: string): Promise<string> {
    const result = await this.call('secrets', 'get', {
      name: secretName,
      service: service || 'system',
    });
    return result;
  }

  /**
   * Helper: Set a secret
   */
  async setSecret(
    secretName: string,
    value: string,
    options?: { expiresInHours?: number; service?: string }
  ): Promise<void> {
    await this.call('secrets', 'set', {
      name: secretName,
      value,
      service: options?.service || 'system',
      expiresInHours: options?.expiresInHours,
    });
  }

  /**
   * Helper: Query database (works with any DB backend)
   */
  async query(sql: string, values?: any[]): Promise<any[]> {
    const result = await this.call(
      'database',
      'query',
      { sql, values }
    );
    return result;
  }

  /**
   * Helper: Store object in storage (S3, GCS, etc.)
   */
  async put(key: string, data: any, options?: { contentType?: string }): Promise<void> {
    await this.call('storage', 'put', {
      key,
      data,
      contentType: options?.contentType,
    });
  }

  /**
   * Helper: Retrieve object from storage
   */
  async get(key: string): Promise<any> {
    const result = await this.call('storage', 'get', { key });
    return result;
  }

  /**
   * Helper: Send HTTP request through Hyphae proxy
   */
  async http(
    method: string,
    path: string,
    options?: {
      body?: any;
      query?: Record<string, string>;
      headers?: Record<string, string>;
    }
  ): Promise<any> {
    const result = await this.call('http', 'request', {
      method,
      path,
      body: options?.body,
      query: options?.query,
      headers: options?.headers,
    });
    return result;
  }

  /**
   * Get available services and operations
   * (Agent can discover what's available)
   */
  async getAvailableServices(): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.hyphaeUrl}/service/available`,
        {
          headers: {
            Authorization: this.token ? `Bearer ${this.token}` : undefined,
          },
        }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get available services: ${error.message}`);
    }
  }

  /**
   * Get service status
   */
  async getServiceStatus(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.hyphaeUrl}/service/status`,
        {
          headers: {
            Authorization: this.token ? `Bearer ${this.token}` : undefined,
          },
        }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get service status: ${error.message}`);
    }
  }
}

/**
 * Example: Flint agent using Hyphae Service Client
 */
export async function exampleFlintUsage() {
  const hyphae = new HyphaeServiceClient(
    'http://localhost:3100',
    'flint'
  );

  // Get secrets (works with any backend: core vault, 1Password, Azure, AWS)
  const apiKey = await hyphae.getSecret('gemini.api_key');
  console.log('API Key loaded:', apiKey.substring(0, 10) + '...');

  // Query database (works with any DB: PostgreSQL, MySQL, etc.)
  const users = await hyphae.query(
    'SELECT * FROM users WHERE role = $1',
    ['admin']
  );
  console.log('Users:', users);

  // Store data (works with any storage: S3, GCS, Azure Blob, etc.)
  await hyphae.put('deployments/latest.json', {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });

  // Retrieve from storage
  const deployment = await hyphae.get('deployments/latest.json');
  console.log('Latest deployment:', deployment);

  // Make HTTP call through Hyphae
  const slackResponse = await hyphae.http('POST', '/chat.postMessage', {
    body: {
      channel: '#deployment',
      text: 'Deployment complete!',
    },
  });
  console.log('Slack response:', slackResponse);

  // Discover what services are available
  const services = await hyphae.getAvailableServices();
  console.log('Available services:', services);
}

/**
 * Example: Sub-agent using same client
 * (No agent-specific code, same interface)
 */
export async function exampleSubAgentUsage() {
  const hyphae = new HyphaeServiceClient(
    'http://localhost:3100',
    'task-processor-1'
  );

  // Same exact calls, different agent
  // Hyphae handles permissions and routing
  const dbPassword = await hyphae.getSecret('database.password');

  const results = await hyphae.query(
    'SELECT COUNT(*) as count FROM tasks WHERE status = $1',
    ['completed']
  );

  console.log('Task count:', results[0].count);
}
