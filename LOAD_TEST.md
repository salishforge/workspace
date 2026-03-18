# Load Testing Framework

**Purpose:** Validate MemForge and Hyphae performance and stability under load

---

## Test Environment

**Target Services:**
- Health Dashboard: http://100.97.161.7:3000
- MemForge: http://100.97.161.7:3333
- Hyphae: http://100.97.161.7:3004

**Tools:**
- Apache JMeter (distributed load testing)
- k6 (modern load testing, JavaScript)
- wrk (HTTP benchmarking)
- PostgreSQL pgBench (database load)

---

## Test Scenarios

### 1. Health Dashboard Load Test

```bash
# Tool: wrk (simple, built-in)
wrk -t4 -c100 -d30s http://100.97.161.7:3000/health
```

**Metrics:**
- Latency (p50, p95, p99)
- Throughput (requests/sec)
- Error rate
- Memory usage

**Expected:** <100ms p95 latency, zero errors

---

### 2. MemForge Query Load Test

```bash
# Multiple concurrent queries
for i in {1..100}; do
  curl -s http://100.97.161.7:3333/memory/test-agent-$i/query?q=test &
done
wait

# Or use Apache Bench:
ab -n 1000 -c 100 http://100.97.161.7:3333/health
```

**Test Vectors:**
- Large number of agents (1000+)
- Concurrent queries (100+ simultaneous)
- Large payload size (1MB documents)
- Long-running consolidation

**Expected:** <500ms p95, handle 100+ concurrent

---

### 3. MemForge Data Ingestion Load Test

```bash
# Bulk insert events
for i in {1..10000}; do
  curl -X POST http://100.97.161.7:3333/memory/test-agent/add \
    -H "Content-Type: application/json" \
    -d "{\"content\":\"Event $i\",\"type\":\"test\"}" &
  [ $((i % 100)) -eq 0 ] && wait
done
```

**Expected:** 1000+ events/sec ingestion rate

---

### 4. Hyphae Service Discovery Load Test

```bash
# Register many services
for i in {1..1000}; do
  curl -s -X POST http://100.97.161.7:3004/services \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"service-$i\",\"type\":\"type-$(($i % 10))\",\"capabilities\":[\"a\",\"b\"]}" &
  [ $((i % 100)) -eq 0 ] && wait
done

# Query service discovery
wrk -t4 -c100 -d30s http://100.97.161.7:3004/services
```

**Expected:** Register 1000+ services, query <50ms latency

---

### 5. Cross-Service Load Test

```
Client → Hyphae (discover MemForge)
      → MemForge (query)
      → Response back through Hyphae
```

**Measures end-to-end latency with service coordination**

---

## Performance Baseline

| Service | Metric | Target | Current |
|---------|--------|--------|---------|
| **Dashboard** | p95 latency | <100ms | TBD |
| **MemForge** | p95 latency | <500ms | TBD |
| **MemForge** | Throughput | 100+ req/s | TBD |
| **MemForge** | Ingest rate | 1000+ events/s | TBD |
| **Hyphae** | p95 latency | <50ms | TBD |
| **Hyphae** | Service register | <100ms | TBD |

---

## Stress Test (Failure Points)

### Memory Exhaustion
- Continuously add events until OOM
- Document max capacity

### Connection Exhaustion
- Open 1000+ concurrent connections
- Measure degradation

### Database Connection Pool Exhaustion
- Max connections to PostgreSQL
- Verify graceful degradation

### CPU Saturation
- Run consolidation while under query load
- Measure impact

---

## Soak Testing (24+ hours)

Run normal load for extended period:
- Detect memory leaks
- Measure stability
- Identify slow degradation

```bash
# Low-load continuous test
while true; do
  curl -s http://100.97.161.7:3333/health > /dev/null
  sleep 1
done
```

---

## Reporting

Create `LOAD_TEST_RESULTS.md` with:
- Test date/time
- Service versions
- Hardware specs
- Test parameters
- Results (latency, throughput, errors)
- Graphs/charts
- Recommendations

---

## Automation (CI/CD)

```yaml
# .github/workflows/load-test.yml
name: Load Tests

on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sunday 2 AM
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install k6
        run: sudo apt-get install -y k6
      - name: Run load tests
        run: k6 run tests/load-test.js
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: load-test-results
          path: results/
```

---

## k6 Script Example

```javascript
// tests/load-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // Ramp-up
    { duration: '5m', target: 100 },   // Stay at 100
    { duration: '1m', target: 0 },     // Ramp-down
  ],
};

export default function() {
  // Health check
  let res = http.get('http://100.97.161.7:3000/health');
  check(res, { 'health status 200': (r) => r.status === 200 });

  // MemForge query
  res = http.get('http://100.97.161.7:3333/memory/test/query?q=test');
  check(res, { 'query status 200': (r) => r.status === 200 });

  // Hyphae discovery
  res = http.get('http://100.97.161.7:3004/services');
  check(res, { 'services status 200': (r) => r.status === 200 });
}
```

---

## Next Steps

1. Install load testing tools (k6, wrk, JMeter)
2. Run baseline tests (capture current performance)
3. Identify bottlenecks
4. Implement optimizations
5. Re-test and verify improvements
6. Automate in CI/CD for regression prevention
