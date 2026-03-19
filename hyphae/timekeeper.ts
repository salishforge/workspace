/**
 * Hyphae Timekeeper Service
 *
 * Core service providing ground truth for time across the multi-agent mesh.
 * Prevents agent hallucination, enforces deadline walls, and ensures audit trail authenticity.
 *
 * - All RPC calls use timekeeper-provided timestamps
 * - All sagas enforce real timeout walls
 * - All traces have wall-clock accuracy
 * - Clock sync is REQUIRED at service registration
 * - Continuous clock validation detects drift
 */

import Database from 'better-sqlite3';
import axios from 'axios';

interface TimePoint {
  unix: number; // milliseconds since epoch
  sequence: number; // logical clock for ordering
  nonce: string; // prevents replay/reuse
}

interface ClockSyncRequest {
  agentId: string;
  localTime: number; // agent's Date.now() at request time
}

interface ClockSyncResponse {
  status: 'success' | 'error';
  hyphaeTime: number; // authoritative current time
  agentLocalTime: number; // echo of what agent reported
  offset: number; // milliseconds (negative = agent behind, positive = agent ahead)
  clockTolerance: number; // max allowed offset in milliseconds
  message: string; // human-readable explanation
}

interface ClockMetrics {
  agentId: string;
  offsets: { timestamp: number; offset: number }[]; // recent samples
  averageOffset: number;
  driftRate: number; // milliseconds per second (can be negative)
  lastValidation: number;
  status: 'healthy' | 'degraded' | 'critical';
}

class HyphaeTimekeeper {
  private db: Database.Database;
  private sequence: number = 0;
  private ntpOffset: number = 0; // Offset from system time to "true time" (for future NTP sync)
  private clockTolerance: number; // max offset allowed at registration

  constructor(dbPath: string, clockTolerance: number = 5000) {
    this.db = new Database(dbPath);
    this.clockTolerance = clockTolerance; // Default: 5 seconds
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hyphae_timekeeper (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hyphae_clock_metrics (
        agent_id TEXT PRIMARY KEY,
        offset_samples JSON NOT NULL,
        average_offset REAL NOT NULL,
        drift_rate REAL NOT NULL,
        last_validation INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'healthy',
        validation_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_clock_metrics_status ON hyphae_clock_metrics(status);
      CREATE INDEX IF NOT EXISTS idx_clock_metrics_lastval ON hyphae_clock_metrics(last_validation);
    `);

    // Initialize sequence number
    const seqRow = this.db
      .prepare("SELECT value FROM hyphae_timekeeper WHERE key = 'sequence'")
      .get() as any;
    if (!seqRow) {
      this.db.prepare("INSERT INTO hyphae_timekeeper (key, value) VALUES ('sequence', '0')").run();
    } else {
      this.sequence = parseInt(seqRow.value, 10);
    }
  }

  /**
   * Get current time with sequence number
   * Used internally by Hyphae for authoritative timestamps
   */
  now(): TimePoint {
    const unix = Date.now() + this.ntpOffset;
    this.sequence++;

    // Persist sequence number periodically (every 1000 increments)
    if (this.sequence % 1000 === 0) {
      this.db
        .prepare("UPDATE hyphae_timekeeper SET value = ? WHERE key = 'sequence'")
        .run(String(this.sequence));
    }

    return {
      unix,
      sequence: this.sequence,
      nonce: this.generateNonce(),
    };
  }

  /**
   * Calculate deadline for a given duration
   */
  deadline(durationMs: number): { unix: number; sequence: number } {
    const timePoint = this.now();
    return {
      unix: timePoint.unix + durationMs,
      sequence: timePoint.sequence,
    };
  }

  /**
   * Synchronize clock with an agent at registration time
   * This is REQUIRED for all agents joining the mesh
   */
  syncAgentClock(request: ClockSyncRequest): ClockSyncResponse {
    const hyphaeTimePoint = this.now();
    const hyphaeTime = hyphaeTimePoint.unix;
    const agentLocalTime = request.localTime;
    const offset = hyphaeTime - agentLocalTime;

    // Check if offset is within tolerance
    if (Math.abs(offset) > this.clockTolerance) {
      const direction = offset > 0 ? 'behind (slow)' : 'ahead (fast)';
      const absOffset = Math.abs(offset);
      const secondsOff = (absOffset / 1000).toFixed(1);

      return {
        status: 'error',
        hyphaeTime,
        agentLocalTime,
        offset,
        clockTolerance: this.clockTolerance,
        message: `CLOCK_DESYNC_FAILED: Agent clock is ${absOffset}ms ${direction} of Hyphae time.
        
Details:
  - Hyphae authoritative time: ${new Date(hyphaeTime).toISOString()} (${hyphaeTime}ms)
  - Agent reported time:       ${new Date(agentLocalTime).toISOString()} (${agentLocalTime}ms)
  - Time difference:           ${absOffset}ms (${secondsOff} seconds)
  - Tolerance limit:           ${this.clockTolerance}ms
  
REMEDIATION:
  1. Check agent system clock: Run 'date' or equivalent on agent
  2. Sync system time: Use NTP (ntpd, chrony) or 'timedatectl set-time'
  3. Verify Hyphae time is correct: Compare with trusted time source
  4. Retry registration after correction
  
If you continue to see this error:
  - Your system may have a hardware clock issue
  - Network time sync may not be working
  - Contact infrastructure team if persistent`,
      };
    }

    // Initialize clock metrics for this agent
    this.initializeClockMetrics(request.agentId, offset);

    return {
      status: 'success',
      hyphaeTime,
      agentLocalTime,
      offset,
      clockTolerance: this.clockTolerance,
      message: `Clock synchronized: Agent is ${offset}ms ${offset < 0 ? 'behind' : 'ahead'} of Hyphae time. Use this offset for all timestamps.`,
    };
  }

  /**
   * Validate that an RPC call's timestamp is recent and accurate
   */
  validateTimestamp(
    timestamp: number,
    context: { agentId?: string; rpcId?: string }
  ): { valid: boolean; error?: string } {
    const timePoint = this.now();
    const timeDiff = Math.abs(timePoint.unix - timestamp);

    // Allow small clock skew (1 second default)
    const maxSkew = 1000;

    if (timeDiff > maxSkew) {
      const direction = timestamp > timePoint.unix ? 'future' : 'past';
      const secondsOff = (timeDiff / 1000).toFixed(2);

      return {
        valid: false,
        error: `TIMESTAMP_INVALID: Reported timestamp is in the ${direction}.

Details:
  - Hyphae current time: ${new Date(timePoint.unix).toISOString()} (${timePoint.unix}ms)
  - Timestamp received:  ${new Date(timestamp).toISOString()} (${timestamp}ms)
  - Time difference:     ${timeDiff}ms (${secondsOff}s in ${direction})
  - Max allowed skew:    ${maxSkew}ms
  ${context.agentId ? `  - Agent:              ${context.agentId}` : ''}
  ${context.rpcId ? `  - RPC ID:             ${context.rpcId}` : ''}

LIKELY CAUSE:
  - Agent clock has drifted since registration
  - Agent not applying registered clock offset
  - Agent system time changed after registration

REMEDIATION:
  1. Agent should re-register to recalibrate clock offset
  2. Check agent system time hasn't changed
  3. If persistent, agent clock may be defective`,
      };
    }

    return { valid: true };
  }

  /**
   * Continuous validation of agent clocks
   * Should be called periodically (e.g., every 30 seconds) for all registered agents
   */
  async validateAgentClockSync(agentId: string, agentEndpoint: string): Promise<ClockMetrics> {
    const timePoint = this.now();

    try {
      // Query agent for its current local time
      const response = await axios.get(`${agentEndpoint}/health`, {
        timeout: 2000,
        headers: { 'X-Hyphae-Clock-Check': 'true' },
      });

      const agentLocalTime = response.data.agentLocalTime || response.data.timestamp || Date.now();
      const offset = timePoint.unix - agentLocalTime;

      // Get existing metrics
      const existing = this.getClockMetrics(agentId);

      // Calculate drift rate (change in offset over time)
      let driftRate = 0;
      if (existing && existing.offsets.length > 0) {
        const lastSample = existing.offsets[existing.offsets.length - 1];
        const timeDelta = timePoint.unix - lastSample.timestamp;
        const offsetDelta = offset - lastSample.offset;

        if (timeDelta > 0) {
          driftRate = (offsetDelta / timeDelta) * 1000; // ms per second
        }
      }

      // Add new sample (keep last 100)
      const newSamples = [
        ...(existing?.offsets || []),
        { timestamp: timePoint.unix, offset },
      ].slice(-100);

      // Calculate average offset
      const averageOffset = newSamples.reduce((sum, s) => sum + s.offset, 0) / newSamples.length;

      // Determine status based on drift rate
      let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
      if (Math.abs(driftRate) > 0.1) status = 'degraded'; // drifting >100ms per 1000 seconds
      if (Math.abs(driftRate) > 1.0) status = 'critical'; // drifting >1s per 1000 seconds
      if (Math.abs(offset) > this.clockTolerance) status = 'critical'; // exceeds tolerance

      // Store metrics
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO hyphae_clock_metrics (
          agent_id, offset_samples, average_offset, drift_rate, 
          last_validation, status, validation_count
        ) VALUES (?, ?, ?, ?, ?, ?, (COALESCE((SELECT validation_count FROM hyphae_clock_metrics WHERE agent_id = ?), 0) + 1))
      `
        )
        .run(
          agentId,
          JSON.stringify(newSamples),
          averageOffset,
          driftRate,
          timePoint.unix,
          status,
          agentId
        );

      // Log warnings if necessary
      if (status === 'critical' && Math.abs(offset) > this.clockTolerance) {
        console.error(`⚠️ CRITICAL: Agent ${agentId} clock sync FAILED.
          
Details:
  - Current offset:    ${offset}ms
  - Tolerance:         ${this.clockTolerance}ms
  - Drift rate:        ${driftRate.toFixed(3)}ms/sec
  - Status:            ${status.toUpperCase()}
  
ACTION: Agent should re-register to resync clock. If re-registration fails, agent may be rejected from mesh.`);
      } else if (status === 'degraded') {
        console.warn(`⚠️ WARNING: Agent ${agentId} clock is drifting.
          
Details:
  - Current offset:    ${offset}ms
  - Average offset:    ${averageOffset.toFixed(1)}ms
  - Drift rate:        ${driftRate.toFixed(3)}ms/sec (increasing drift over time)
  
ACTION: Monitor closely. If drift continues, agent may need clock maintenance.`);
      }

      return {
        agentId,
        offsets: newSamples,
        averageOffset,
        driftRate,
        lastValidation: timePoint.unix,
        status,
      };
    } catch (error) {
      // Can't reach agent for validation
      const errorMsg = error instanceof Error ? error.message : String(error);

      console.error(`❌ CLOCK_CHECK_FAILED: Cannot validate clock for agent ${agentId}.
      
Details:
  - Endpoint:  ${agentEndpoint}
  - Error:     ${errorMsg}
  - Time:      ${new Date(timePoint.unix).toISOString()}
  
LIKELY CAUSE:
  - Agent is down or unreachable
  - Network connectivity issue
  - Agent endpoint is wrong
  
ACTION:
  1. Verify agent is running and healthy
  2. Check network connectivity to agent
  3. Verify agent endpoint in service registry
  4. If persistent, may need to deregister and re-register agent`);

      // Return degraded metrics
      const existing = this.getClockMetrics(agentId);
      return {
        agentId,
        offsets: existing?.offsets || [],
        averageOffset: existing?.averageOffset || 0,
        driftRate: existing?.driftRate || 0,
        lastValidation: timePoint.unix,
        status: 'critical', // Unreachable = critical
      };
    }
  }

  /**
   * Get clock metrics for an agent
   */
  getClockMetrics(agentId: string): ClockMetrics | null {
    const row = this.db
      .prepare('SELECT * FROM hyphae_clock_metrics WHERE agent_id = ?')
      .get(agentId) as any;

    if (!row) return null;

    return {
      agentId: row.agent_id,
      offsets: JSON.parse(row.offset_samples),
      averageOffset: row.average_offset,
      driftRate: row.drift_rate,
      lastValidation: row.last_validation,
      status: row.status,
    };
  }

  /**
   * Get all agents with clock issues
   */
  getUnhealthyClocks(): { agentId: string; status: string; offset: number; driftRate: number }[] {
    const rows = this.db
      .prepare(
        `
      SELECT agent_id, status, average_offset, drift_rate 
      FROM hyphae_clock_metrics 
      WHERE status IN ('degraded', 'critical')
      ORDER BY status DESC, last_validation DESC
    `
      )
      .all() as any[];

    return rows.map((row) => ({
      agentId: row.agent_id,
      status: row.status,
      offset: row.average_offset,
      driftRate: row.drift_rate,
    }));
  }

  /**
   * Initialize clock metrics when agent first registers
   */
  private initializeClockMetrics(agentId: string, initialOffset: number) {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO hyphae_clock_metrics (
        agent_id, offset_samples, average_offset, drift_rate, last_validation, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        agentId,
        JSON.stringify([{ timestamp: this.now().unix, offset: initialOffset }]),
        initialOffset,
        0, // No drift yet
        this.now().unix,
        'healthy' // Newly registered agents start healthy
      );
  }

  /**
   * Generate unique nonce to prevent replay attacks
   */
  private generateNonce(): string {
    return Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  }

  /**
   * Check if a service should be rejected from mesh due to clock issues
   */
  shouldRejectService(agentId: string): { reject: boolean; reason?: string } {
    const metrics = this.getClockMetrics(agentId);

    if (!metrics) {
      // No metrics = not registered yet (OK)
      return { reject: false };
    }

    if (metrics.status === 'critical') {
      return {
        reject: true,
        reason: `Agent ${agentId} has critical clock sync issue. Offset: ${metrics.averageOffset}ms, Drift: ${metrics.driftRate.toFixed(3)}ms/sec. Agent must re-register and fix clock.`,
      };
    }

    return { reject: false };
  }
}

export { HyphaeTimekeeper, TimePoint, ClockSyncRequest, ClockSyncResponse, ClockMetrics };
