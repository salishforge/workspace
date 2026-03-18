#!/usr/bin/env node

/**
 * Generate RSA key pair for JWT signing
 * Usage: node oauth2/jwt-keygen.js
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const keyDir = path.join(__dirname, 'keys');

// Create keys directory if it doesn't exist
if (!fs.existsSync(keyDir)) {
  fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  console.log(`✅ Created ${keyDir} directory (mode 0700)`);
}

// Generate RSA key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

// Write private key (secret, mode 0600)
const privateKeyPath = path.join(keyDir, 'jwt-private.pem');
fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
console.log(`✅ Generated ${privateKeyPath} (mode 0600)`);

// Write public key (can be public, mode 0644)
const publicKeyPath = path.join(keyDir, 'jwt-public.pem');
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
console.log(`✅ Generated ${publicKeyPath} (mode 0644)`);

// Extract kid (key ID) from public key hash
const keyId = crypto
  .createHash('sha256')
  .update(publicKey)
  .digest('hex')
  .substring(0, 8);

console.log(`\n✅ Key Pair Generated`);
console.log(`   Key ID: ${keyId}`);
console.log(`   Private: ${privateKeyPath} (SECRET - mode 0600)`);
console.log(`   Public:  ${publicKeyPath}`);
console.log(`\n📋 To deploy:`);
console.log(`   1. Copy jwt-private.pem to oauth2-server deployment`);
console.log(`   2. Set JWT_PRIVATE_KEY env var to file path or contents`);
console.log(`   3. Endpoint /oauth2/.well-known/jwks.json will use public key`);
