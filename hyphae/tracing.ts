/**
 * Distributed Tracing for Multi-Agent Coordination
 * 
 * Follow a task through multiple agents:
 * User Query → Agent A (researcher) → Agent B (analyzer) → Agent C (writer)
 * 
 * Visible in Dashboard with timings, errors, and full task flow.
 */

import Database from 'better-sqlite3';

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  service: string;
  agent: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'success' | 'error';
  error?: string;
  tags: Record<string, string | number>;
  logs: { timestamp: number; message: string; level: 'info' | 'warn' | 'error' }[];
}

interface Trace {
  traceId: string;
  rootOperation: string;
  spans: Span[];
  totalDuration: number;
  startTime: number;
  endTime: number;
  status: 'success' | 'partial' | 'error';
}

class DistributedTracer {
  private db: Database.Database;
  private activeTraces: Map<string, Trace> = new Map();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hyphae_traces (
        trace_id TEXT PRIMARY KEY,
        root_operation TEXT NOT NULL,
        total_duration INTEGER NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        status TEXT NOT NULL,
        spans JSON NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trace_start ON hyphae_traces(start_time);
      CREATE INDEX IF NOT EXISTS idx_trace_status ON hyphae_traces(status);

      CREATE TABLE IF NOT EXISTS hyphae_spans (
        span_id TEXT,
        trace_id TEXT,
        parent_span_id TEXT,
        operation_name TEXT NOT NULL,
        service TEXT NOT NULL,
        agent TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        tags JSON NOT NULL,
        logs JSON NOT NULL,
        PRIMARY KEY(trace_id, span_id),
        FOREIGN KEY(trace_id) REFERENCES hyphae_traces(trace_id)
      );

      CREATE INDEX IF NOT EXISTS idx_span_agent ON hyphae_spans(agent);
      CREATE INDEX IF NOT EXISTS idx_span_service ON hyphae_spans(service);
      CREATE INDEX IF NOT EXISTS idx_span_status ON hyphae_spans(status);
    `);
  }

  /**
   * Start a new trace
   */
  startTrace(traceId: string, rootOperation: string): Trace {
    const trace: Trace = {
      traceId,
      rootOperation,
      spans: [],
      totalDuration: 0,
      startTime: Date.now(),
      endTime: 0,
      status: 'success',
    };

    this.activeTraces.set(traceId, trace);
    return trace;
  }

  /**
   * Start a span (operation in an agent)
   */
  startSpan(
    traceId: string,
    operationName: string,
    agent: string,
    parentSpanId?: string
  ): Span {
    const spanId = this.generateSpanId();

    const span: Span = {
      traceId,
      spanId,
      parentSpanId,
      operationName,
      service: 'hyphae',
      agent,
      startTime: Date.now(),
      status: 'pending',
      tags: {
        'agent': agent,
        'operation': operationName,
      },
      logs: [],
    };

    const trace = this.activeTraces.get(traceId);
    if (trace) {
      trace.spans.push(span);
    }

    return span;
  }

  /**
   * End a span
   */
  endSpan(traceId: string, spanId: string, status: 'success' | 'error', error?: string) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (error) span.error = error;
  }

  /**
   * Add a log message to a span
   */
  logToSpan(
    traceId: string,
    spanId: string,
    message: string,
    level: 'info' | 'warn' | 'error' = 'info'
  ) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) return;

    span.logs.push({
      timestamp: Date.now(),
      message,
      level,
    });
  }

  /**
   * Add a tag to a span
   */
  tagSpan(traceId: string, spanId: string, key: string, value: string | number) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) return;

    span.tags[key] = value;
  }

  /**
   * End the trace
   */
  endTrace(traceId: string) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();
    trace.totalDuration = trace.endTime - trace.startTime;

    // Determine overall status
    if (trace.spans.some((s) => s.status === 'error')) {
      trace.status = trace.spans.every((s) => s.status === 'error') ? 'error' : 'partial';
    } else {
      trace.status = 'success';
    }

    this.saveTrace(trace);
    this.activeTraces.delete(traceId);
  }

  /**
   * Save trace to database
   */
  private saveTrace(trace: Trace) {
    const stmtTrace = this.db.prepare(`
      INSERT INTO hyphae_traces (
        trace_id, root_operation, total_duration, start_time, end_time, status, spans
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmtTrace.run(
      trace.traceId,
      trace.rootOperation,
      trace.totalDuration,
      trace.startTime,
      trace.endTime,
      trace.status,
      JSON.stringify(trace.spans)
    );

    // Save spans individually for querying
    const stmtSpan = this.db.prepare(`
      INSERT INTO hyphae_spans (
        span_id, trace_id, parent_span_id, operation_name, service, agent,
        start_time, end_time, duration, status, error, tags, logs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const span of trace.spans) {
      stmtSpan.run(
        span.spanId,
        span.traceId,
        span.parentSpanId || null,
        span.operationName,
        span.service,
        span.agent,
        span.startTime,
        span.endTime || null,
        span.duration || null,
        span.status,
        span.error || null,
        JSON.stringify(span.tags),
        JSON.stringify(span.logs)
      );
    }
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId: string): Trace | null {
    const stmt = this.db.prepare('SELECT * FROM hyphae_traces WHERE trace_id = ?');
    const row = stmt.get(traceId) as any;

    if (!row) return null;

    return {
      traceId: row.trace_id,
      rootOperation: row.root_operation,
      totalDuration: row.total_duration,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      spans: JSON.parse(row.spans),
    };
  }

  /**
   * Get all traces for an agent
   */
  getAgentTraces(agent: string, limit = 50): Trace[] {
    const query = `
      SELECT DISTINCT trace_id FROM hyphae_spans WHERE agent = ?
      ORDER BY start_time DESC LIMIT ?
    `;

    const rows = this.db.prepare(query).all(agent, limit) as any[];
    const traces: Trace[] = [];

    for (const row of rows) {
      const trace = this.getTrace(row.trace_id);
      if (trace) traces.push(trace);
    }

    return traces;
  }

  /**
   * Get trace analysis (for Dashboard)
   */
  getTraceAnalysis(traceId: string): {
    totalDuration: number;
    criticalPath: Span[];
    agentBreakdown: Record<string, { operations: number; totalTime: number }>;
    errors: Span[];
  } | null {
    const trace = this.getTrace(traceId);
    if (!trace) return null;

    // Calculate critical path (longest sequence of dependent spans)
    const criticalPath = this.findCriticalPath(trace.spans);

    // Agent breakdown
    const agentBreakdown: Record<string, { operations: number; totalTime: number }> = {};
    for (const span of trace.spans) {
      if (!agentBreakdown[span.agent]) {
        agentBreakdown[span.agent] = { operations: 0, totalTime: 0 };
      }
      agentBreakdown[span.agent].operations += 1;
      agentBreakdown[span.agent].totalTime += span.duration || 0;
    }

    // Errors
    const errors = trace.spans.filter((s) => s.status === 'error');

    return {
      totalDuration: trace.totalDuration,
      criticalPath,
      agentBreakdown,
      errors,
    };
  }

  /**
   * Find critical path (longest sequence of spans)
   */
  private findCriticalPath(spans: Span[]): Span[] {
    // Sort by start time, then find longest chain of dependent spans
    const sorted = [...spans].sort((a, b) => a.startTime - b.startTime);

    const chains: Span[][] = [];
    for (const span of sorted) {
      if (!span.parentSpanId) {
        chains.push([span]);
      } else {
        const parentChain = chains.find((c) => c.some((s) => s.spanId === span.parentSpanId));
        if (parentChain) {
          parentChain.push(span);
        } else {
          chains.push([span]);
        }
      }
    }

    return chains.length > 0 ? chains.reduce((a, b) => (a.length > b.length ? a : b)) : [];
  }

  /**
   * Generate span ID
   */
  private generateSpanId(): string {
    return Math.random().toString(36).substr(2, 16);
  }
}

export { DistributedTracer, Trace, Span };
