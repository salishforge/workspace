const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3200;
const HYPHAE_PROXY_URL = process.env.HYPHAE_PROXY_URL || 'http://localhost:3443';
const HYPHAE_CORE_URL = process.env.HYPHAE_CORE_URL || 'http://localhost:3100';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store tokens in memory (per session)
const sessionTokens = new Map();

// ============================================
// API Routes
// ============================================

// 1. Authenticate and get token
app.post('/api/auth/token', async (req, res) => {
  try {
    const { userId, apiKey } = req.body;
    
    if (!userId || !apiKey) {
      return res.status(400).json({ error: 'userId and apiKey required' });
    }

    const response = await axios.post(`${HYPHAE_PROXY_URL}/auth/token`, {
      userId,
      apiKey,
    });

    const token = response.data.token;
    sessionTokens.set(userId, token);

    res.json({
      success: true,
      token,
      expiresIn: response.data.expiresIn,
      userId,
    });
  } catch (error) {
    res.status(401).json({
      error: 'Authentication failed',
      details: error.message,
    });
  }
});

// 2. Get available services/agents
app.get('/api/services', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const response = await axios.get(`${HYPHAE_PROXY_URL}/api/services`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch services',
      details: error.message,
    });
  }
});

// 3. Make RPC call to agent
app.post('/api/rpc/call', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { sourceAgent, targetAgent, capability, params, timeout } = req.body;

    const response = await axios.post(
      `${HYPHAE_PROXY_URL}/api/rpc/call`,
      {
        sourceAgent,
        targetAgent,
        capability,
        params: params || {},
        timeout: timeout || 30000,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: 'RPC call failed',
      details: error.message,
    });
  }
});

// 4. Get health status
app.get('/api/health', async (req, res) => {
  try {
    const response = await axios.get(`${HYPHAE_CORE_URL}/api/health`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: 'Health check failed',
      details: error.message,
    });
  }
});

// 5. Get audit trail
app.get('/api/audit', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const limit = req.query.limit || 50;
    const response = await axios.get(
      `${HYPHAE_PROXY_URL}/api/rpc/audit?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch audit trail',
      details: error.message,
    });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start HTTPS server
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`🚀 Hyphae Dashboard running on https://localhost:${PORT}`);
  console.log(`   Proxy URL: ${HYPHAE_PROXY_URL}`);
  console.log(`   Core URL: ${HYPHAE_CORE_URL}`);
  console.log(`   ⚠️  Self-signed certificate (browser warning is normal)`);
});
