/**
 * Saga Pattern for Distributed Multi-Agent Transactions
 * 
 * Enables multi-agent workflows with automatic compensation on failure.
 * Example: Agent A initiates workflow, calls B → C → D in sequence or parallel.
 * If D fails, automatically compensate (undo) C, B, A in reverse order.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

interface SagaStep {
  stepId: string;
  agentId: string;
  capability: string;
  params: Record<string, any>;
  compensationCapability?: string;
  compensationParams?: Record<string, any>;
  timeout: number;
}

interface SagaDefinition {
  sagaId: string;
  name: string;
  description: string;
  steps: SagaStep[];
  parallelism?: 'sequential' | 'parallel';
  timeout: number;
}

interface SagaExecution {
  executionId: string;
  sagaId: string;
  initiatorAgent: string;
  status: 'pending' | 'in_progress' | 'completed' | 'compensating' | 'failed';
  startedAt: number;
  completedAt?: number;
  steps: SagaStepExecution[];
  error?: string;
}

interface SagaStepExecution {
  stepId: string;
  agentId: string;
  status: 'pending' | 'executing' | 'succeeded' | 'failed' | 'compensating' | 'compensated';
  result?: any;
  error?: string;
  executedAt?: number;
  compensatedAt?: number;
}

class SagaOrchestrator {
  private db: Database.Database;
  private registry: any; // HyphaeServiceRegistry instance

  constructor(dbPath: string, registry: any) {
    this.db = new Database(dbPath);
    this.registry = registry;
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hyphae_sagas (
        saga_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        definition JSON NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hyphae_saga_executions (
        execution_id TEXT PRIMARY KEY,
        saga_id TEXT NOT NULL,
        initiator_agent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        steps JSON NOT NULL,
        error TEXT,
        FOREIGN KEY(saga_id) REFERENCES hyphae_sagas(saga_id)
      );

      CREATE INDEX IF NOT EXISTS idx_saga_exec_status ON hyphae_saga_executions(status);
      CREATE INDEX IF NOT EXISTS idx_saga_exec_initiator ON hyphae_saga_executions(initiator_agent);
    `);
  }

  /**
   * Define a new saga
   */
  defineSaga(saga: SagaDefinition): { success: boolean; sagaId: string; error?: string } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO hyphae_sagas (saga_id, name, description, definition, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        saga.sagaId,
        saga.name,
        saga.description || '',
        JSON.stringify(saga),
        Date.now()
      );

      return { success: true, sagaId: saga.sagaId };
    } catch (error) {
      return { success: false, sagaId: '', error: String(error) };
    }
  }

  /**
   * Execute a saga
   */
  async executeSaga(sagaId: string, initiatorAgent: string): Promise<SagaExecution> {
    const executionId = crypto.randomUUID();
    const execution: SagaExecution = {
      executionId,
      sagaId,
      initiatorAgent,
      status: 'pending',
      startedAt: Date.now(),
      steps: [],
      error: undefined,
    };

    try {
      // Load saga definition
      const sagaStmt = this.db.prepare('SELECT definition FROM hyphae_sagas WHERE saga_id = ?');
      const sagaRow = sagaStmt.get(sagaId) as any;

      if (!sagaRow) {
        execution.status = 'failed';
        execution.error = `Saga not found: ${sagaId}`;
        this.saveSagaExecution(execution);
        return execution;
      }

      const sagaDef: SagaDefinition = JSON.parse(sagaRow.definition);
      execution.status = 'in_progress';
      this.saveSagaExecution(execution);

      // Execute steps
      const executeSequential = sagaDef.parallelism !== 'parallel';

      if (executeSequential) {
        await this.executeStepsSequential(execution, sagaDef);
      } else {
        await this.executeStepsParallel(execution, sagaDef);
      }

      // If all steps succeeded
      const allSucceeded = execution.steps.every((s) => s.status === 'succeeded');

      if (allSucceeded) {
        execution.status = 'completed';
        execution.completedAt = Date.now();
      } else {
        // At least one step failed, trigger compensation
        execution.status = 'compensating';
        await this.compensate(execution, sagaDef);
        execution.status = 'failed';
        execution.completedAt = Date.now();
      }
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completedAt = Date.now();
    }

    this.saveSagaExecution(execution);
    return execution;
  }

  /**
   * Execute steps sequentially
   */
  private async executeStepsSequential(execution: SagaExecution, sagaDef: SagaDefinition) {
    for (const step of sagaDef.steps) {
      const stepExec: SagaStepExecution = {
        stepId: step.stepId,
        agentId: step.agentId,
        status: 'pending',
      };

      execution.steps.push(stepExec);

      try {
        stepExec.status = 'executing';
        this.saveSagaExecution(execution);

        // Call the agent via Hyphae RPC
        const rpcResult = await this.registry.call(
          execution.initiatorAgent,
          step.agentId,
          step.capability,
          step.params,
          { timeout: step.timeout, scope: 'saga:execute' }
        );

        if (rpcResult.success) {
          stepExec.status = 'succeeded';
          stepExec.result = rpcResult.result;
          stepExec.executedAt = Date.now();
        } else {
          stepExec.status = 'failed';
          stepExec.error = rpcResult.error;
          return; // Stop here, will compensate
        }
      } catch (error) {
        stepExec.status = 'failed';
        stepExec.error = error instanceof Error ? error.message : String(error);
        return; // Stop here, will compensate
      }
    }
  }

  /**
   * Execute steps in parallel
   */
  private async executeStepsParallel(execution: SagaExecution, sagaDef: SagaDefinition) {
    const promises = sagaDef.steps.map(async (step) => {
      const stepExec: SagaStepExecution = {
        stepId: step.stepId,
        agentId: step.agentId,
        status: 'executing',
      };

      execution.steps.push(stepExec);

      try {
        const rpcResult = await this.registry.call(
          execution.initiatorAgent,
          step.agentId,
          step.capability,
          step.params,
          { timeout: step.timeout, scope: 'saga:execute' }
        );

        if (rpcResult.success) {
          stepExec.status = 'succeeded';
          stepExec.result = rpcResult.result;
          stepExec.executedAt = Date.now();
        } else {
          stepExec.status = 'failed';
          stepExec.error = rpcResult.error;
        }
      } catch (error) {
        stepExec.status = 'failed';
        stepExec.error = error instanceof Error ? error.message : String(error);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Compensate (undo) successful steps in reverse order
   */
  private async compensate(execution: SagaExecution, sagaDef: SagaDefinition) {
    // Find all succeeded steps in reverse order
    const succeededSteps = execution.steps
      .filter((s) => s.status === 'succeeded')
      .reverse();

    for (const stepExec of succeededSteps) {
      try {
        // Find original step definition
        const stepDef = sagaDef.steps.find((s) => s.stepId === stepExec.stepId);
        if (!stepDef || !stepDef.compensationCapability) {
          continue; // No compensation defined
        }

        stepExec.status = 'compensating';
        this.saveSagaExecution(execution);

        // Call compensation capability
        const compensationParams = stepDef.compensationParams || {};
        const rpcResult = await this.registry.call(
          execution.initiatorAgent,
          stepExec.agentId,
          stepDef.compensationCapability,
          compensationParams,
          { timeout: stepDef.timeout, scope: 'saga:compensate' }
        );

        if (rpcResult.success) {
          stepExec.status = 'compensated';
          stepExec.compensatedAt = Date.now();
        } else {
          stepExec.status = 'compensating'; // Mark as failed compensation
          console.error(`Compensation failed for step ${stepExec.stepId}: ${rpcResult.error}`);
        }
      } catch (error) {
        console.error(`Compensation error for step ${stepExec.stepId}:`, error);
      }
    }
  }

  /**
   * Save saga execution
   */
  private saveSagaExecution(execution: SagaExecution) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO hyphae_saga_executions (
        execution_id, saga_id, initiator_agent, status, started_at, completed_at, steps, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      execution.executionId,
      execution.sagaId,
      execution.initiatorAgent,
      execution.status,
      execution.startedAt,
      execution.completedAt || null,
      JSON.stringify(execution.steps),
      execution.error || null
    );
  }

  /**
   * Get execution status
   */
  getExecution(executionId: string): SagaExecution | null {
    const stmt = this.db.prepare('SELECT * FROM hyphae_saga_executions WHERE execution_id = ?');
    const row = stmt.get(executionId) as any;

    if (!row) return null;

    return {
      executionId: row.execution_id,
      sagaId: row.saga_id,
      initiatorAgent: row.initiator_agent,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      steps: JSON.parse(row.steps),
      error: row.error,
    };
  }
}

export { SagaOrchestrator, SagaDefinition, SagaStep, SagaExecution };
