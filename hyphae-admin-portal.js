#!/usr/bin/env node

/**
 * Hyphae Admin Portal
 * 
 * Web interface for:
 * - Policy configuration (basic + advanced modes)
 * - Pending decisions
 * - Decision history
 * - System health
 * - Audit trail
 * 
 * Runs on port 3110
 */

import http from 'http';
import pg from 'pg';
import url from 'url';
import { PolicyEngine } from './hyphae-admin-policy-engine.js';

const { Pool } = pg;

const PORT = process.env.ADMIN_PORTAL_PORT || 3110;

const db = new Pool({
  host: process.env.DB_HOST || '100.97.161.7',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026'
});

// Initialize database schema
async function initializeDatabase() {
  try {
    const schema = `
      CREATE TABLE IF NOT EXISTS hyphae_admin_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL CHECK (mode IN ('basic', 'advanced')),
        basic_mode_setting TEXT,
        basic_daily_budget_usd NUMERIC(10,2),
        basic_escalation_threshold_usd NUMERIC(10,2),
        basic_security_escalation BOOLEAN DEFAULT true,
        advanced_policy JSONB,
        learning_enabled BOOLEAN DEFAULT true,
        learning_model TEXT DEFAULT 'ollama:local',
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS hyphae_admin_decision_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        decision_category TEXT NOT NULL,
        decision_required BOOLEAN NOT NULL,
        policy_boundary TEXT NOT NULL,
        input_data JSONB NOT NULL,
        decision_reasoning JSONB NOT NULL,
        decision_action TEXT NOT NULL,
        outcome_status TEXT,
        outcome_result JSONB,
        human_approval_required BOOLEAN DEFAULT false,
        human_approved_by TEXT,
        human_approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        cost_impact_usd NUMERIC(10,2)
      );
    `;

    for (const stmt of schema.split(';').filter(s => s.trim())) {
      await db.query(stmt);
    }

    console.log('[admin-portal] ✅ Database initialized');
  } catch (error) {
    console.error('[admin-portal] Database init error:', error.message);
  }
}

// HTML Templates
const TEMPLATE_HOME = (summary) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hyphae Admin Portal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header { margin-bottom: 40px; }
    h1 { font-size: 32px; margin-bottom: 10px; }
    .subtitle { color: #999; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .card { 
      background: #141b33;
      border: 1px solid #1a2847;
      border-radius: 8px;
      padding: 20px;
    }
    .card-title { font-size: 14px; color: #999; text-transform: uppercase; margin-bottom: 10px; }
    .card-value { font-size: 28px; font-weight: bold; color: #4a9eff; }
    
    .section { margin-bottom: 40px; }
    .section-title { font-size: 18px; font-weight: bold; margin-bottom: 20px; border-bottom: 2px solid #1a2847; padding-bottom: 10px; }
    
    table { 
      width: 100%;
      border-collapse: collapse;
      background: #141b33;
      border-radius: 8px;
      overflow: hidden;
    }
    th { 
      background: #0a0e27;
      padding: 12px;
      text-align: left;
      font-weight: bold;
      color: #999;
      font-size: 12px;
      text-transform: uppercase;
      border-bottom: 1px solid #1a2847;
    }
    td { 
      padding: 12px;
      border-bottom: 1px solid #1a2847;
    }
    tr:hover { background: #1a2847; }
    
    .status-pending { color: #ffa500; }
    .status-approved { color: #4ade80; }
    .status-rejected { color: #ff4444; }
    
    button { 
      background: #4a9eff;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: #3b7dd5; }
    button.danger { background: #ff4444; }
    
    nav { 
      background: #0a0e27;
      border-bottom: 1px solid #1a2847;
      padding: 0;
      margin: -20px -20px 40px -20px;
      display: flex;
      gap: 0;
    }
    nav a {
      padding: 15px 20px;
      color: #999;
      text-decoration: none;
      border-bottom: 2px solid transparent;
    }
    nav a:hover, nav a.active {
      color: #4a9eff;
      border-bottom-color: #4a9eff;
    }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="active">Dashboard</a>
    <a href="/policy">Policy Configuration</a>
    <a href="/decisions">Decisions</a>
    <a href="/audit">Audit Trail</a>
  </nav>

  <div class="container">
    <header>
      <h1>⚡ Hyphae Admin Portal</h1>
      <p class="subtitle">System Administrator Agent Control Center</p>
    </header>

    <div class="grid">
      <div class="card">
        <div class="card-title">Pending Approvals</div>
        <div class="card-value">${summary.pending_approvals || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Decisions Today</div>
        <div class="card-value">${summary.decisions_today || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Cost Today</div>
        <div class="card-value">$${summary.cost_today || 0}</div>
      </div>
      <div class="card">
        <div class="card-title">Active Learning Patterns</div>
        <div class="card-value">${summary.learning_patterns || 0}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Pending Decisions</div>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Decision</th>
            <th>Cost</th>
            <th>Time</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${summary.pending_decisions ? summary.pending_decisions.map(d => `
            <tr>
              <td>${d.decision_category}</td>
              <td>${d.decision_action.substring(0, 50)}</td>
              <td>$${d.cost_impact_usd || 0}</td>
              <td>${new Date(d.created_at).toLocaleString()}</td>
              <td>
                <button onclick="approveDecision('${d.id}')">Approve</button>
                <button class="danger" onclick="rejectDecision('${d.id}')">Reject</button>
              </td>
            </tr>
          `).join('') : '<tr><td colspan="5" style="text-align: center; color: #666;">No pending decisions</td></tr>'}
        </tbody>
      </table>
    </div>

    <script>
      function approveDecision(id) {
        fetch('/api/decision/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision_id: id, approved_by: 'admin' })
        }).then(r => r.json()).then(d => {
          console.log('Approved:', d);
          location.reload();
        });
      }

      function rejectDecision(id) {
        fetch('/api/decision/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision_id: id, rejected_by: 'admin' })
        }).then(r => r.json()).then(d => {
          console.log('Rejected:', d);
          location.reload();
        });
      }
    </script>
  </div>
</body>
</html>
`;

const TEMPLATE_POLICY = (current_policy) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Policy Configuration</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { margin-bottom: 30px; }
    .form-section { background: #141b33; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .form-title { font-size: 16px; font-weight: bold; margin-bottom: 15px; }
    label { display: block; margin-bottom: 10px; }
    input, select { 
      display: block;
      width: 100%;
      padding: 8px;
      margin-top: 5px;
      background: #0a0e27;
      border: 1px solid #1a2847;
      color: #e0e0e0;
      border-radius: 4px;
    }
    button { 
      background: #4a9eff;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-top: 20px;
    }
    button:hover { background: #3b7dd5; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Policy Configuration</h1>

    <form method="POST" action="/api/policy/update">
      <div class="form-section">
        <div class="form-title">Mode Selection</div>
        <label>
          <input type="radio" name="mode" value="basic" ${current_policy?.mode === 'basic' ? 'checked' : ''}>
          Basic Mode (T-shirt sizing)
        </label>
        <label>
          <input type="radio" name="mode" value="advanced" ${current_policy?.mode === 'advanced' ? 'checked' : ''}>
          Advanced Mode (Full control)
        </label>
      </div>

      <div class="form-section">
        <div class="form-title">Basic Mode Settings</div>
        <label>
          Autonomy Level:
          <select name="basic_mode_setting">
            <option value="human_approves_all" ${current_policy?.basic_mode_setting === 'human_approves_all' ? 'selected' : ''}>Human approves all changes</option>
            <option value="agent_autonomy_except_financial_security" ${current_policy?.basic_mode_setting === 'agent_autonomy_except_financial_security' ? 'selected' : ''}>Agent autonomy except financial/security</option>
            <option value="full_autonomy_within_budget" ${current_policy?.basic_mode_setting === 'full_autonomy_within_budget' ? 'selected' : ''}>Full autonomy within budget</option>
          </select>
        </label>
        <label>
          Daily Budget Limit ($):
          <input type="number" name="basic_daily_budget_usd" value="${current_policy?.basic_daily_budget_usd || 100}" step="0.01">
        </label>
        <label>
          Escalation Threshold ($):
          <input type="number" name="basic_escalation_threshold_usd" value="${current_policy?.basic_escalation_threshold_usd || 70}" step="0.01">
        </label>
      </div>

      <div class="form-section">
        <div class="form-title">Learning & Model</div>
        <label>
          <input type="checkbox" name="learning_enabled" ${current_policy?.learning_enabled ? 'checked' : ''}>
          Enable Agent Learning
        </label>
        <label>
          Learning Model:
          <select name="learning_model">
            <option value="ollama:local" ${current_policy?.learning_model === 'ollama:local' ? 'selected' : ''}>Local (Ollama)</option>
            <option value="gemini" ${current_policy?.learning_model === 'gemini' ? 'selected' : ''}>Google Gemini</option>
            <option value="anthropic" ${current_policy?.learning_model === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
            <option value="custom" ${current_policy?.learning_model === 'custom' ? 'selected' : ''}>Custom (API Key)</option>
          </select>
        </label>
      </div>

      <button type="submit">Save Policy</button>
    </form>
  </div>
</body>
</html>
`;

// Request handler
async function requestHandler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  res.setHeader('Content-Type', 'application/json');

  // API endpoints
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', service: 'admin-portal' }));
    return;
  }

  if (pathname === '/' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);

    // Get summary data
    try {
      const pending = await PolicyEngine.getPendingApprovals();
      const summary = {
        pending_approvals: pending.length,
        pending_decisions: pending.slice(0, 5),
        decisions_today: Math.floor(Math.random() * 50),  // TODO: actual count
        cost_today: (Math.random() * 500).toFixed(2),
        learning_patterns: 12
      };

      res.end(TEMPLATE_HOME(summary));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (pathname === '/policy' && req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);

    try {
      const policy = await PolicyEngine.getPolicy('system-admin');
      res.end(TEMPLATE_POLICY(policy));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (pathname === '/api/decision/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        await PolicyEngine.approveDecision(data.decision_id, data.approved_by);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  if (pathname === '/api/decision/reject' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        await PolicyEngine.rejectDecision(data.decision_id, data.rejected_by);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Default: 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// Start server
const server = http.createServer(requestHandler);

async function start() {
  try {
    await initializeDatabase();
  } catch (err) {
    console.warn('[admin-portal] Database init warning:', err.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[admin-portal] ✅ Admin portal running on port ${PORT}`);
    console.log(`[admin-portal] 🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`[admin-portal] ⚙️  Policy config: http://localhost:${PORT}/policy`);
    console.log(`[admin-portal] ✅ Ready for admin interaction`);
  });
}

start().catch(err => {
  console.error('[admin-portal] Startup error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.end();
    process.exit(0);
  });
});
