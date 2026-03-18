/**
 * OAuth2 Database Seeder
 *
 * Creates initial clients in the oauth2 database.
 * Run once after applying oauth2-schema.sql.
 *
 * Usage:
 *   DATABASE_URL=postgres://oauth2_user:oauth2_salish_2026@localhost:5432/oauth2 \
 *     node scripts/oauth2-seed.js
 *
 * Or with --show-secrets to print plaintext secrets (for .env setup):
 *   node scripts/oauth2-seed.js --show-secrets
 */

import pg from 'pg';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

async function hashSecret(plaintext) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(plaintext, salt, 32);
  return `${salt}:${hash.toString('hex')}`;
}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://oauth2_user:oauth2_salish_2026@localhost:5432/oauth2';

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Client definitions — each gets a randomly generated secret
// Override by setting env vars: DASHBOARD_SECRET, MEMFORGE_SECRET, HYPHAE_SECRET
//
// Scopes follow the service:action hierarchy defined in oauth2-scopes-schema.sql:
//   memforge:read    memforge:write
//   hyphae:read      hyphae:admin
//   system:admin
const CLIENTS = [
  {
    client_id: 'dashboard',
    secret: process.env.DASHBOARD_SECRET || randomBytes(20).toString('hex'),
    scopes: 'memforge:read system:admin',
    description: 'Health Dashboard service',
    scope_list: ['memforge:read', 'system:admin'],
  },
  {
    client_id: 'memforge',
    secret: process.env.MEMFORGE_SECRET || randomBytes(20).toString('hex'),
    scopes: 'memforge:read memforge:write',
    description: 'MemForge memory service',
    scope_list: ['memforge:read', 'memforge:write'],
  },
  {
    client_id: 'hyphae',
    secret: process.env.HYPHAE_SECRET || randomBytes(20).toString('hex'),
    scopes: 'hyphae:read hyphae:admin',
    description: 'Hyphae federation core',
    scope_list: ['hyphae:read', 'hyphae:admin'],
  },
];

const showSecrets = process.argv.includes('--show-secrets');

async function seed() {
  console.log('[oauth2-seed] Connecting to database...');
  await pool.query('SELECT 1');
  console.log('[oauth2-seed] Connected.\n');

  const secrets = [];

  for (const client of CLIENTS) {
    const hash = await hashSecret(client.secret);

    await pool.query(
      `INSERT INTO oauth2_clients (client_id, client_secret_hash, scopes, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id) DO UPDATE SET
         client_secret_hash = EXCLUDED.client_secret_hash,
         scopes = EXCLUDED.scopes,
         description = EXCLUDED.description,
         active = true`,
      [client.client_id, hash, client.scopes, client.description]
    );

    // Seed normalized scope assignments (requires oauth2-scopes-schema.sql to have been applied)
    try {
      for (const scope of client.scope_list) {
        await pool.query(
          `INSERT INTO oauth2_client_scopes (client_id, scope_name)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [client.client_id, scope]
        );
      }
      console.log(`[oauth2-seed] Upserted client: ${client.client_id} (scopes: ${client.scope_list.join(', ')})`);
    } catch (err) {
      // oauth2_client_scopes table may not exist yet — skip silently
      console.log(`[oauth2-seed] Upserted client: ${client.client_id} (scope table not available: ${err.message})`);
    }

    secrets.push({ client_id: client.client_id, secret: client.secret });
  }

  console.log('\n[oauth2-seed] Seeding complete.\n');

  if (showSecrets) {
    console.log('=== CLIENT SECRETS (save these to .env files) ===\n');
    for (const { client_id, secret } of secrets) {
      console.log(`${client_id.toUpperCase()}_OAUTH2_SECRET=${secret}`);
    }
    console.log('\n=== .env snippets ===');
    console.log('\n# health-dashboard/.env');
    console.log(`OAUTH2_CLIENT_ID=dashboard`);
    console.log(`OAUTH2_CLIENT_SECRET=${secrets.find(s => s.client_id === 'dashboard').secret}`);
    console.log(`OAUTH2_TOKEN_URL=http://localhost:3005/oauth2/token`);
    console.log(`OAUTH2_INTROSPECT_URL=http://localhost:3005/oauth2/introspect`);
    console.log(`# dashboard scopes: memforge:read system:admin`);

    console.log('\n# memforge-standalone/.env');
    console.log(`OAUTH2_CLIENT_ID=memforge`);
    console.log(`OAUTH2_CLIENT_SECRET=${secrets.find(s => s.client_id === 'memforge').secret}`);
    console.log(`OAUTH2_INTROSPECT_URL=http://localhost:3005/oauth2/introspect`);
    console.log(`OAUTH2_REQUIRED=true`);
    console.log(`# memforge scopes: memforge:read memforge:write`);

    console.log('\n# hyphae-service .env');
    console.log(`OAUTH2_CLIENT_ID=hyphae`);
    console.log(`OAUTH2_CLIENT_SECRET=${secrets.find(s => s.client_id === 'hyphae').secret}`);
    console.log(`OAUTH2_INTROSPECT_URL=http://localhost:3005/oauth2/introspect`);
    console.log(`OAUTH2_REQUIRED=true`);
    console.log(`# hyphae scopes: hyphae:read hyphae:admin`);
  } else {
    console.log('Run with --show-secrets to print plaintext secrets for .env setup.');
  }

  await pool.end();
}

seed().catch(err => {
  console.error('[oauth2-seed] Fatal:', err.message);
  process.exit(1);
});
