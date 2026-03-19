/**
 * Hyphae Load Testing Suite
 * 
 * Validates system performance under load:
 * - 1000+ req/sec throughput
 * - <50ms p99 latency
 * - <0.1% error rate
 */

import axios from "axios";
import { performance } from "perf_hooks";

const HYPHAE_URL = process.env.HYPHAE_URL || "http://localhost:3100";

interface LoadTestResult {
  name: string;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
  errorRate: number;
}

class LoadTester {
  private results: LoadTestResult[] = [];

  /**
   * Run a single test scenario
   */
  async runTest(
    name: string,
    endpoint: string,
    requestCount: number,
    concurrency: number
  ): Promise<LoadTestResult> {
    console.log(`\n📊 ${name}`);
    console.log(`   Requests: ${requestCount}, Concurrency: ${concurrency}`);

    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;

    const startTime = performance.now();

    // Create request batches
    const batchSize = concurrency;
    for (let i = 0; i < requestCount; i += batchSize) {
      const batch = [];
      const end = Math.min(i + batchSize, requestCount);

      for (let j = i; j < end; j++) {
        batch.push(this.makeRequest(endpoint, latencies));
      }

      try {
        const results = await Promise.allSettled(batch);
        successful += results.filter((r) => r.status === "fulfilled").length;
        failed += results.filter((r) => r.status === "rejected").length;
      } catch {
        failed++;
      }

      // Progress indicator
      const progress = Math.min(end, requestCount);
      process.stdout.write(
        `\r   Progress: ${progress}/${requestCount} (${((progress / requestCount) * 100).toFixed(1)}%)`
      );
    }

    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds

    // Sort latencies for percentile calculations
    latencies.sort((a, b) => a - b);

    const result: LoadTestResult = {
      name,
      duration,
      totalRequests: requestCount,
      successfulRequests: successful,
      failedRequests: failed,
      avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      p50Latency: this.percentile(latencies, 50),
      p95Latency: this.percentile(latencies, 95),
      p99Latency: this.percentile(latencies, 99),
      throughput: requestCount / duration,
      errorRate: (failed / requestCount) * 100,
    };

    this.results.push(result);
    this.printResult(result);

    return result;
  }

  /**
   * Make a single HTTP request
   */
  private async makeRequest(
    endpoint: string,
    latencies: number[]
  ): Promise<void> {
    const start = performance.now();

    try {
      const response = await axios.get(endpoint, {
        timeout: 30000,
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      const latency = performance.now() - start;
      latencies.push(latency);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Calculate percentile
   */
  private percentile(array: number[], p: number): number {
    if (array.length === 0) return 0;
    const index = Math.ceil((p / 100) * array.length) - 1;
    return array[Math.max(0, index)];
  }

  /**
   * Print test result
   */
  private printResult(result: LoadTestResult): void {
    console.log(`\n   ✅ Completed`);
    console.log(
      `      Throughput: ${result.throughput.toFixed(0)} req/sec (target: 1000+)`
    );
    console.log(
      `      Latency p50: ${result.p50Latency.toFixed(2)}ms, p95: ${result.p95Latency.toFixed(2)}ms, p99: ${result.p99Latency.toFixed(2)}ms (target: <50ms)`
    );
    console.log(
      `      Success: ${result.successfulRequests}/${result.totalRequests}, Error rate: ${result.errorRate.toFixed(3)}% (target: <0.1%)`
    );
    console.log(
      `      Duration: ${result.duration.toFixed(2)}s`
    );

    // Status
    const throughputOK = result.throughput >= 1000;
    const latencyOK = result.p99Latency < 50;
    const errorOK = result.errorRate < 0.1;

    if (throughputOK && latencyOK && errorOK) {
      console.log(`      Status: 🟢 PASS`);
    } else {
      console.log(`      Status: 🟡 ${throughputOK ? "✅" : "❌"} throughput, ${latencyOK ? "✅" : "❌"} latency, ${errorOK ? "✅" : "❌"} errors`);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log("🔥 HYPHAE LOAD TESTING SUITE");
    console.log(`Hyphae URL: ${HYPHAE_URL}`);
    console.log("━".repeat(60));

    try {
      // Test 1: Service discovery (light load)
      await this.runTest(
        "Test 1: Service Discovery (Light)",
        `${HYPHAE_URL}/api/services`,
        1000,
        10
      );

      // Test 2: Service discovery (medium load)
      await this.runTest(
        "Test 2: Service Discovery (Medium)",
        `${HYPHAE_URL}/api/services`,
        5000,
        50
      );

      // Test 3: Service discovery (heavy load)
      await this.runTest(
        "Test 3: Service Discovery (Heavy)",
        `${HYPHAE_URL}/api/services`,
        10000,
        100
      );

      // Test 4: Health checks
      await this.runTest(
        "Test 4: Health Checks",
        `${HYPHAE_URL}/api/health`,
        5000,
        50
      );

      // Test 5: Statistics
      await this.runTest(
        "Test 5: System Statistics",
        `${HYPHAE_URL}/api/stats`,
        2000,
        20
      );

      // Summary
      this.printSummary();
    } catch (err) {
      console.error("❌ Load test failed:", err);
      process.exit(1);
    }
  }

  /**
   * Print summary
   */
  private printSummary(): void {
    console.log("\n" + "━".repeat(60));
    console.log("📋 LOAD TEST SUMMARY");
    console.log("━".repeat(60));

    const avgThroughput =
      this.results.reduce((a, r) => a + r.throughput, 0) / this.results.length;
    const avgP99 =
      this.results.reduce((a, r) => a + r.p99Latency, 0) / this.results.length;
    const totalErrors = this.results.reduce((a, r) => a + r.failedRequests, 0);
    const totalRequests = this.results.reduce((a, r) => a + r.totalRequests, 0);

    console.log(`Total requests: ${totalRequests}`);
    console.log(`Total failures: ${totalErrors} (${((totalErrors / totalRequests) * 100).toFixed(3)}%)`);
    console.log(`Average throughput: ${avgThroughput.toFixed(0)} req/sec`);
    console.log(`Average p99 latency: ${avgP99.toFixed(2)}ms`);

    const passed = this.results.filter(
      (r) => r.throughput >= 1000 && r.p99Latency < 50 && r.errorRate < 0.1
    );

    console.log(`\nTests passed: ${passed.length}/${this.results.length}`);

    if (passed.length === this.results.length) {
      console.log("🟢 ALL TESTS PASSED");
    } else {
      console.log("🟡 SOME TESTS FAILED");
      console.log(
        "\nFailing tests:"
      );
      for (const result of this.results) {
        if (!(result.throughput >= 1000 && result.p99Latency < 50 && result.errorRate < 0.1)) {
          console.log(`  - ${result.name}`);
          if (result.throughput < 1000) {
            console.log(`    Throughput: ${result.throughput.toFixed(0)} (need 1000+)`);
          }
          if (result.p99Latency >= 50) {
            console.log(`    p99 Latency: ${result.p99Latency.toFixed(2)}ms (need <50ms)`);
          }
          if (result.errorRate >= 0.1) {
            console.log(`    Error rate: ${result.errorRate.toFixed(3)}% (need <0.1%)`);
          }
        }
      }
    }

    console.log("━".repeat(60));
  }
}

// Run tests
const tester = new LoadTester();
tester.runAllTests().catch(console.error);
