/**
 * Scale Test Runner — Salish Forge v1.2.0
 *
 * Usage:
 *   node runner.js --scenario baseline
 *   node runner.js --scenario linear-scale
 *   node runner.js --scenario peak-burst
 *   node runner.js --scenario sustained
 *   node runner.js --scenario all
 *   node runner.js --scenario baseline --agents 20 --duration 300
 *
 * Required env vars:
 *   CLIENT_ID        OAuth2 client ID
 *   CLIENT_SECRET    OAuth2 client secret
 *
 * Optional env vars (defaults to localhost):
 *   OAUTH2_URL       http://localhost:3005
 *   HYPHAE_URL       http://localhost:3006
 *   MEMFORGE_URL     http://localhost:3001
 */

import { run as runBaseline   } from './scenarios/baseline.js';
import { run as runLinear     } from './scenarios/linear-scale.js';
import { run as runBurst      } from './scenarios/peak-burst.js';
import { run as runSustained  } from './scenarios/sustained.js';

// ─── Config from env + CLI ────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .reduce((pairs, arg, i, arr) => {
      if (arg.startsWith('--')) pairs.push([arg.slice(2), arr[i + 1] ?? true]);
      return pairs;
    }, [])
);

const scenario = args.scenario ?? 'baseline';

const baseConfig = {
  oauth2Url:    process.env.OAUTH2_URL    ?? 'http://localhost:3005',
  hyphaeUrl:    process.env.HYPHAE_URL    ?? 'http://localhost:3006',
  memforgeUrl:  process.env.MEMFORGE_URL  ?? 'http://localhost:3001',
  clientId:     process.env.CLIENT_ID     ?? '',
  clientSecret: process.env.CLIENT_SECRET ?? '',

  // CLI overrides
  ...(args.agents   ? { agentCount: parseInt(args.agents) }   : {}),
  ...(args.duration ? { durationMs: parseInt(args.duration) * 1000 } : {}),
};

// ─── Validation ───────────────────────────────────────────────────────────────

function validate() {
  const errors = [];

  if (!baseConfig.clientId) {
    errors.push('CLIENT_ID environment variable is required');
  }
  if (!baseConfig.clientSecret) {
    errors.push('CLIENT_SECRET environment variable is required');
  }

  if (errors.length > 0) {
    console.error('\n  Configuration errors:\n');
    errors.forEach(e => console.error(`    ❌ ${e}`));
    console.error('\n  Example:');
    console.error('    CLIENT_ID=sf-test-client CLIENT_SECRET=my-secret node runner.js --scenario baseline\n');
    process.exit(1);
  }
}

// ─── Pre-flight health check ─────────────────────────────────────────────────

async function checkServices() {
  const services = [
    { name: 'OAuth2',    url: `${baseConfig.oauth2Url}/oauth2/health` },
    { name: 'Hyphae',    url: `${baseConfig.hyphaeUrl}/health` },
    { name: 'MemForge',  url: `${baseConfig.memforgeUrl}/health` },
  ];

  console.log('\n  Pre-flight service check:');
  let allUp = true;

  for (const svc of services) {
    try {
      const resp = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
      const ok = resp.ok;
      console.log(`    ${ok ? '✅' : '❌'} ${svc.name.padEnd(12)} ${svc.url}`);
      if (!ok) allUp = false;
    } catch (err) {
      console.log(`    ❌ ${svc.name.padEnd(12)} ${svc.url} (${err.message})`);
      allUp = false;
    }
  }

  if (!allUp) {
    console.error('\n  ⚠️  Some services are unreachable. Run docker-compose up or start services first.');
    console.error('     docker-compose up -d\n');
    process.exit(1);
  }

  console.log('  All services healthy.\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(72));
  console.log('  SALISH FORGE SCALE TESTS — v1.2.0');
  console.log(`  Scenario: ${scenario}`);
  console.log(`  Services: OAuth2=${baseConfig.oauth2Url} Hyphae=${baseConfig.hyphaeUrl} MemForge=${baseConfig.memforgeUrl}`);
  console.log('═'.repeat(72));

  validate();
  await checkServices();

  const startTs = Date.now();

  try {
    switch (scenario) {
      case 'baseline':
        await runBaseline(baseConfig);
        break;

      case 'linear-scale':
      case 'linear':
        await runLinear(baseConfig);
        break;

      case 'peak-burst':
      case 'burst':
        await runBurst(baseConfig);
        break;

      case 'sustained':
        await runSustained(baseConfig);
        break;

      case 'all':
        console.log('\n  Running ALL scenarios sequentially. Total time: ~1h 40m\n');
        await runBaseline(baseConfig);
        await sleep(30_000); // cool-down between scenarios

        await runLinear(baseConfig);
        await sleep(30_000);

        await runBurst(baseConfig);
        await sleep(30_000);

        await runSustained(baseConfig);
        break;

      default:
        console.error(`\n  Unknown scenario: "${scenario}"`);
        console.error('  Available: baseline | linear-scale | peak-burst | sustained | all\n');
        process.exit(1);
    }

    const totalMs = Date.now() - startTs;
    console.log(`\n  Total test run: ${(totalMs / 1000 / 60).toFixed(1)} minutes`);
    console.log('  Run "node lib/reporter.js --latest" to generate the full report.\n');

  } catch (err) {
    console.error(`\n  ❌ Test run failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();
