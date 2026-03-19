const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Configuration
const INTERNAL_HYPHAE = process.env.INTERNAL_HYPHAE || 'http://localhost:3100';
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '3000');
const VALID_API_KEY = process.env.VALID_API_KEY || 'default-key';

const rateLimitStore = new Map();
const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60 * 1000;

console.log(`🚀 Hyphae Proxy starting on port ${PROXY_PORT}`);
console.log(`   INTERNAL_HYPHAE: ${INTERNAL_HYPHAE}`);
console.log(`   API Key validation: ${VALID_API_KEY ? 'enabled' : 'disabled'}`);

// Auth token storage (simple in-memory)
const validTokens = new Map();

// ============================================================================
// AUTHENTICATION
// ============================================================================

app.post('/auth/token', (req, res) => {
  const { userId, apiKey } = req.body;

  if (!userId || !apiKey) {
    return res.status(400).json({
      error: 'Missing userId or apiKey',
    });
  }

  console.log(`[AUTH] Validating token request for user: ${userId}`);

  // Validate API key
  if (apiKey !== VALID_API_KEY) {
    console.log(`[AUTH] ❌ Invalid API key for ${userId}`);
    return res.status(401).json({
      error: 'Invalid credentials',
      details: 'API key does not match configured key',
    });
  }

  console.log(`[AUTH] ✅ Valid API key for ${userId}`);

  // Generate simple token (just a UUID for now)
  const token = uuidv4();
  validTokens.set(token, {
    userId,
    expiresAt: Date.now() + 3600000, // 1 hour
  });

  console.log(`[AUTH] Token issued: ${token.substring(0, 8)}...`);

  res.json({
    token,
    expiresIn: 3600,
    type: 'Bearer',
  });
});

// ============================================================================
// TOKEN VALIDATION MIDDLEWARE
// ============================================================================

function validateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Missing or invalid Authorization header',
      example: 'Authorization: Bearer <token>',
    });
  }

  const token = authHeader.substring(7);
  const tokenData = validTokens.get(token);

  if (!tokenData || tokenData.expiresAt < Date.now()) {
    return res.status(401).json({
      error: 'Invalid or expired token',
    });
  }

  req.user = tokenData;
  req.traceId = uuidv4();
  next();
}

// ============================================================================
// RATE LIMITING MIDDLEWARE
// ============================================================================

function rateLimitMiddleware(req, res, next) {
  const userId = req.user.userId;
  const now = Date.now();

  let entry = rateLimitStore.get(userId);

  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    };
    rateLimitStore.set(userId, entry);
    return next();
  }

  if (entry.count >= RATE_LIMIT_REQUESTS) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit: RATE_LIMIT_REQUESTS,
      window: '1 minute',
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
  }

  entry.count++;
  next();
}

// ============================================================================
// PROXY ENDPOINTS
// ============================================================================

app.get('/api/services', validateToken, rateLimitMiddleware, async (req, res) => {
  const traceId = req.traceId;
  const userId = req.user.userId;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/services`, {
      params: req.query,
    });

    console.log(`[${traceId}] ${userId} - GET /api/services (${response.data.count} services)`);
    res.json({ ...response.data, traceId });
  } catch (err) {
    console.error(`[${traceId}] Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

app.post('/api/rpc/call', validateToken, rateLimitMiddleware, async (req, res) => {
  const traceId = req.traceId;
  const userId = req.user.userId;
  const { sourceAgent, targetAgent, capability, params, timeout } = req.body;

  if (!sourceAgent || !targetAgent || !capability) {
    return res.status(400).json({
      error: 'Missing required fields: sourceAgent, targetAgent, capability',
      traceId,
    });
  }

  // Agent endpoint mapping (bypass Hyphae Core for direct calls)
  const agentEndpoints = {
    'flint': 'http://localhost:3050/rpc',
    'clio': 'http://localhost:3051/rpc',
  };

  const endpoint = agentEndpoints[targetAgent];
  if (!endpoint) {
    return res.status(404).json({
      error: `Unknown agent: ${targetAgent}`,
      traceId,
    });
  }

  try {
    const response = await axios.post(
      endpoint,
      {
        sourceAgent: userId,
        targetAgent,
        capability,
        params: params || {},
        timeout: timeout || 30000,
      },
      {
        timeout: (timeout || 30000) + 5000,
        headers: { 'X-Trace-Id': traceId },
      }
    );

    console.log(`[${traceId}] ${userId} - RPC ${userId} → ${targetAgent}.${capability}`);
    res.json({ ...response.data, traceId });
  } catch (err) {
    console.error(`[${traceId}] RPC Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

app.get('/api/rpc/audit', validateToken, rateLimitMiddleware, async (req, res) => {
  const traceId = req.traceId;
  const userId = req.user.userId;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/rpc/audit`, {
      params: req.query,
    });

    console.log(`[${traceId}] ${userId} - GET /api/rpc/audit (${response.data.count} records)`);
    res.json({ ...response.data, traceId });
  } catch (err) {
    console.error(`[${traceId}] Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

app.get('/api/health', validateToken, rateLimitMiddleware, async (req, res) => {
  const traceId = req.traceId;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/health`);
    res.json({ ...response.data, traceId });
  } catch (err) {
    res.status(500).json({
      error: 'System health check failed',
      traceId,
    });
  }
});

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Start server
app.listen(PROXY_PORT, () => {
  console.log(`✅ Hyphae Proxy listening on port ${PROXY_PORT}`);
  console.log(`   API endpoints:`);
  console.log(`     POST   /auth/token`);
  console.log(`     GET    /api/services`);
  console.log(`     POST   /api/rpc/call`);
  console.log(`     GET    /api/rpc/audit`);
  console.log(`     GET    /api/health`);
  console.log(`     GET    /health (no auth required)`);
});
