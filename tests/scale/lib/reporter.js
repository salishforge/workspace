/**
 * Scale Test Reporter
 *
 * Reads results from tests/scale/results/*.json and produces:
 *   - Markdown comparison table
 *   - ASCII latency trend
 *   - CSV export for spreadsheet analysis
 *   - Pass/fail verdict per scenario
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '../results');
const REPORTS_DIR = resolve(__dirname, '../reports');

// ─── Success criteria ─────────────────────────────────────────────────────────

const CRITERIA = {
  errorRatePct:          { max: 0.1,   label: 'Error rate',       unit: '%'  },
  'latency.memoryQuery.p99':    { max: 100,   label: 'Memory query p99', unit: 'ms' },
  'latency.tokenGeneration.p99':{ max: 100,   label: 'Token gen p99',    unit: 'ms' },
  'latency.memoryWrite.p99':    { max: 150,   label: 'Memory write p99', unit: 'ms' },
  'latency.serviceRegistration.p99': { max: 200, label: 'Svc reg p99',  unit: 'ms' },
};

// ─── CLI entry ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isLatest = args.includes('--latest');
  const file = args.find(a => a.endsWith('.json'));

  mkdirSync(REPORTS_DIR, { recursive: true });

  let results;
  if (file) {
    results = [JSON.parse(readFileSync(resolve(RESULTS_DIR, file), 'utf8'))];
  } else if (isLatest) {
    results = loadLatestResults(5);
  } else {
    results = loadAllResults();
  }

  if (results.length === 0) {
    console.log('No results found. Run a test scenario first.\n  node runner.js --scenario baseline');
    process.exit(0);
  }

  const report = generateReport(results);
  console.log(report.text);

  // Save report
  const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdPath  = resolve(REPORTS_DIR, `scale-test-report-${ts}.md`);
  const csvPath = resolve(REPORTS_DIR, `scale-test-metrics-${ts}.csv`);
  writeFileSync(mdPath,  report.markdown);
  writeFileSync(csvPath, report.csv);

  console.log(`\n  Saved: ${mdPath}`);
  console.log(`  Saved: ${csvPath}`);
}

// ─── Report generation ────────────────────────────────────────────────────────

function generateReport(results) {
  const lines = [];
  const mdLines = [];

  const header = `Scale Test Report — Salish Forge v1.2.0\nGenerated: ${new Date().toISOString()}\n`;
  lines.push(header);
  mdLines.push(`# ${header}`);

  // Summary table
  lines.push('## Scenario Summary\n');
  mdLines.push('## Scenario Summary\n');

  const cols = ['Scenario', 'Duration', 'RPS', 'Error%', 'Mem p99', 'Token p99', 'Pass?'];
  const rows = results.map(r => {
    const errRate = r.errors?.errorRatePct ?? 0;
    const memP99  = r.latency?.memoryQuery?.p99 ?? '—';
    const tokP99  = r.latency?.tokenGeneration?.p99 ?? '—';
    const dur     = (r.durationMs / 1000).toFixed(0) + 's';
    const pass    = _evaluateCriteria(r);
    return [
      r.scenario,
      dur,
      r.overallRps?.toString() ?? '—',
      errRate.toFixed(3) + '%',
      memP99 + 'ms',
      tokP99 + 'ms',
      pass.passed ? '✅ PASS' : '❌ FAIL',
    ];
  });

  lines.push(_asciiTable(cols, rows));
  mdLines.push(_markdownTable(cols, rows));

  // Detailed latency per scenario
  for (const r of results) {
    lines.push(`\n## ${r.scenario}\n`);
    mdLines.push(`\n## ${r.scenario}\n`);

    const latOps = Object.entries(r.latency ?? {});
    if (latOps.length > 0) {
      const latCols = ['Operation', 'Count', 'p50 ms', 'p95 ms', 'p99 ms', 'Mean ms'];
      const latRows = latOps.map(([op, s]) => [
        _camelToWords(op),
        String(s.count),
        String(s.p50),
        String(s.p95),
        String(s.p99),
        String(s.mean),
      ]);
      lines.push(_asciiTable(latCols, latRows));
      mdLines.push(_markdownTable(latCols, latRows));
    }

    // Success criteria evaluation
    const eval_ = _evaluateCriteria(r);
    lines.push('\nSuccess Criteria:');
    mdLines.push('\n**Success Criteria:**');
    for (const item of eval_.items) {
      const icon = item.pass ? '✅' : '❌';
      const line = `  ${icon} ${item.label}: ${item.actual} (limit: ${item.limit})`;
      lines.push(line);
      mdLines.push(line);
    }

    // Cache stats
    if (r.cacheSnapshots?.length > 0) {
      const last = r.cacheSnapshots[r.cacheSnapshots.length - 1];
      const hitLine = `  Cache hit rate (final): ${last.hitRatePct?.toFixed(1)}%`;
      const icon = (last.hitRatePct ?? 0) > 70 ? '✅' : '❌';
      lines.push(`${icon} ${hitLine}`);
      mdLines.push(`${icon} ${hitLine}`);
    }

    // Memory leak check
    if (r.resourceSnapshots?.length >= 2) {
      const first = r.resourceSnapshots[0].heapUsedMb;
      const last  = r.resourceSnapshots[r.resourceSnapshots.length - 1].heapUsedMb;
      const delta = last - first;
      const icon  = delta < 100 ? '✅' : '❌';
      lines.push(`${icon}   Heap growth: +${delta.toFixed(1)}MB (limit: <100MB)`);
      mdLines.push(`${icon}   Heap growth: +${delta.toFixed(1)}MB (limit: <100MB)`);
    }
  }

  // ASCII latency trend chart (if multiple scenarios)
  if (results.length > 1) {
    lines.push('\n## Latency Trend (Memory Query p99)\n');
    const chart = _asciiChart(
      results.map(r => r.scenario),
      results.map(r => r.latency?.memoryQuery?.p99 ?? 0),
      100
    );
    lines.push(chart);
  }

  // CSV export
  const csv = _buildCsv(results);

  return {
    text:     lines.join('\n'),
    markdown: mdLines.join('\n'),
    csv,
  };
}

// ─── Criteria evaluation ──────────────────────────────────────────────────────

function _evaluateCriteria(result) {
  const items = [];

  const check = (key, label, limit, unit, actual) => {
    const pass = actual !== null && actual !== undefined && actual <= limit;
    items.push({ label, limit: `${limit}${unit}`, actual: actual != null ? `${actual}${unit}` : '—', pass });
  };

  check('errorRate', 'Error rate <0.1%', 0.1, '%', result.errors?.errorRatePct);
  check('memP99',    'Memory query p99 <100ms', 100, 'ms', result.latency?.memoryQuery?.p99);
  check('tokP99',    'Token gen p99 <100ms', 100, 'ms', result.latency?.tokenGeneration?.p99);
  check('writeP99',  'Memory write p99 <150ms', 150, 'ms', result.latency?.memoryWrite?.p99);
  check('svcRegP99', 'Service reg p99 <200ms', 200, 'ms', result.latency?.serviceRegistration?.p99);

  return { passed: items.filter(i => !i.pass).length === 0, items };
}

// ─── Loading helpers ──────────────────────────────────────────────────────────

function loadAllResults() {
  try {
    const files = readdirSync(RESULTS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();
    return files.map(f => JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8')));
  } catch (_) { return []; }
}

function loadLatestResults(n) {
  try {
    const files = readdirSync(RESULTS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .slice(-n);
    return files.map(f => JSON.parse(readFileSync(resolve(RESULTS_DIR, f), 'utf8')));
  } catch (_) { return []; }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function _asciiTable(cols, rows) {
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map(r => (r[i] ?? '').length)));
  const sep  = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const fmt  = (row) => '|' + row.map((c, i) => ` ${(c ?? '').padEnd(widths[i])} `).join('|') + '|';
  return [sep, fmt(cols), sep, ...rows.map(fmt), sep].join('\n');
}

function _markdownTable(cols, rows) {
  const header = '| ' + cols.join(' | ') + ' |';
  const divider = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
  return [header, divider, body].join('\n');
}

function _asciiChart(labels, values, maxValue) {
  const HEIGHT = 10;
  const lines = [];
  const normalized = values.map(v => Math.round((v / maxValue) * HEIGHT));
  lines.push(`  ${maxValue}ms ┤`);
  for (let row = HEIGHT; row >= 0; row--) {
    const label = row === HEIGHT ? `>${maxValue}` : row === 0 ? '   0' : '    ';
    const bar = normalized.map(v => v >= row ? '███' : '   ').join(' ');
    lines.push(`  ${label} │ ${bar}`);
  }
  lines.push('       └' + labels.map(l => '───').join('─'));
  lines.push('         ' + labels.map(l => l.slice(0, 10).padEnd(12)).join(' '));
  return lines.join('\n');
}

function _buildCsv(results) {
  const rows = [
    ['scenario', 'duration_s', 'overall_rps', 'error_rate_pct',
     'mem_query_p50', 'mem_query_p95', 'mem_query_p99',
     'token_gen_p50', 'token_gen_p95', 'token_gen_p99',
     'mem_write_p50', 'mem_write_p95', 'mem_write_p99',
     'cache_hit_rate_pct', 'heap_used_mb'],
  ];

  for (const r of results) {
    const lastCache = r.cacheSnapshots?.[r.cacheSnapshots.length - 1];
    const lastHeap  = r.resourceSnapshots?.[r.resourceSnapshots.length - 1];
    rows.push([
      r.scenario,
      (r.durationMs / 1000).toFixed(1),
      r.overallRps ?? '',
      r.errors?.errorRatePct ?? '',
      r.latency?.memoryQuery?.p50 ?? '',
      r.latency?.memoryQuery?.p95 ?? '',
      r.latency?.memoryQuery?.p99 ?? '',
      r.latency?.tokenGeneration?.p50 ?? '',
      r.latency?.tokenGeneration?.p95 ?? '',
      r.latency?.tokenGeneration?.p99 ?? '',
      r.latency?.memoryWrite?.p50 ?? '',
      r.latency?.memoryWrite?.p95 ?? '',
      r.latency?.memoryWrite?.p99 ?? '',
      lastCache?.hitRatePct?.toFixed(1) ?? '',
      lastHeap?.heapUsedMb ?? '',
    ]);
  }

  return rows.map(r => r.join(',')).join('\n');
}

function _camelToWords(str) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

// Run as CLI
main().catch(err => { console.error(err); process.exit(1); });
