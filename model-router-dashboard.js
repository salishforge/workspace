#!/usr/bin/env node

/**
 * Hyphae Model Router Admin Dashboard
 * 
 * Web interface for:
 * - Pending API key approvals
 * - Real-time usage visualization
 * - Cost breakdown by agent/service
 * - Usage logs
 * 
 * Runs on port 3104
 * March 20, 2026
 */

const http = require('http');
const { Pool } = require('pg');
const url = require('url');

const db = new Pool({
  host: process.env.DB_HOST || '100.97.161.7',
  port: parseInt(process.env.DB_PORT || '5433'),
  database: process.env.DB_NAME || 'hyphae',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'hyphae-password-2026'
});

// ─────────────────────────────────────────────────────────────
// HTML Templates
// ─────────────────────────────────────────────────────────────

function renderHTML(title, content) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Model Router Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      background: #1a1f3a;
      border-bottom: 1px solid #333;
      padding: 20px 0;
      margin-bottom: 30px;
    }
    header h1 { color: #4a9eff; font-size: 28px; }
    header .nav {
      display: flex;
      gap: 20px;
      margin-top: 15px;
    }
    header .nav a {
      color: #999;
      text-decoration: none;
      padding: 8px 12px;
      border-radius: 4px;
      transition: all 0.2s;
    }
    header .nav a:hover, header .nav a.active {
      color: #4a9eff;
      background: rgba(74, 158, 255, 0.1);
    }
    .section {
      background: #1a1f3a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .section h2 {
      color: #4a9eff;
      margin-bottom: 15px;
      font-size: 20px;
    }
    .approval-card {
      background: #252c48;
      border-left: 4px solid #ff9800;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .approval-card .info { flex: 1; }
    .approval-card .agent { color: #4a9eff; font-weight: bold; }
    .approval-card .service { color: #999; font-size: 12px; }
    .approval-card .action {
      display: flex;
      gap: 10px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
    }
    .btn-approve {
      background: #4caf50;
      color: white;
    }
    .btn-approve:hover { background: #45a049; }
    .btn-deny {
      background: #f44336;
      color: white;
    }
    .btn-deny:hover { background: #da190b; }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead {
      background: #0a0e27;
      border-bottom: 2px solid #333;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #333;
    }
    th {
      color: #4a9eff;
      font-weight: 600;
    }
    tr:hover { background: rgba(74, 158, 255, 0.05); }
    
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #252c48;
      padding: 15px;
      border-radius: 6px;
      border: 1px solid #333;
    }
    .stat-label { color: #999; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
    .stat-value { color: #4a9eff; font-size: 24px; font-weight: bold; }
    .stat-detail { color: #666; font-size: 12px; margin-top: 5px; }
    
    .progress-bar {
      height: 8px;
      background: #0a0e27;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 5px;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4caf50, #ff9800, #f44336);
      border-radius: 4px;
      transition: width 0.3s;
    }
    
    .status-ok { color: #4caf50; }
    .status-alert { color: #ff9800; }
    .status-error { color: #f44336; }
    
    .empty {
      text-align: center;
      color: #666;
      padding: 30px;
      font-style: italic;
    }
    
    .error { color: #f44336; }
    .success { color: #4caf50; }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>⚡ Model Router Dashboard</h1>
      <div class="nav">
        <a href="/" class="active">Overview</a>
        <a href="/approvals">Approvals</a>
        <a href="/usage">Usage</a>
        <a href="/costs">Costs</a>
      </div>
    </div>
  </header>
  
  <div class="container">
    ${content}
  </div>
  
  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Dashboard Pages
// ─────────────────────────────────────────────────────────────

async function overviewPage() {
  const stats = await db.query(`
    SELECT 
      (SELECT COUNT(*) FROM hyphae_model_api_keys WHERE status = 'pending') as pending_approvals,
      (SELECT COUNT(DISTINCT agent_id) FROM hyphae_model_api_keys WHERE is_active = true) as active_agents,
      (SELECT COUNT(*) FROM hyphae_model_services WHERE is_active = true) as available_services,
      (SELECT SUM(current_daily_usage_usd)::DECIMAL(10,2) FROM hyphae_model_limits) as today_spend
  `);
  
  const row = stats.rows[0];
  
  const content = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Pending Approvals</div>
        <div class="stat-value status-alert">${row.pending_approvals || 0}</div>
        <div class="stat-detail">Awaiting admin review</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Agents</div>
        <div class="stat-value status-ok">${row.active_agents || 0}</div>
        <div class="stat-detail">Agents with API access</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Available Services</div>
        <div class="stat-value">${row.available_services || 0}</div>
        <div class="stat-detail">LLM services registered</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Today's Spend</div>
        <div class="stat-value">$${(row.today_spend || 0).toFixed(2)}</div>
        <div class="stat-detail">Accumulated cost today</div>
      </div>
    </div>
    
    <div class="section">
      <h2>📊 Service Status</h2>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Provider</th>
            <th>Type</th>
            <th>Cost</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="services-table">
          <tr><td colspan="5" class="empty">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;
  
  return renderHTML('Overview', content);
}

async function approvalsPage() {
  const result = await db.query(`
    SELECT 
      k.key_id,
      k.agent_id,
      k.status,
      k.requested_at,
      s.service_name,
      s.service_id
    FROM hyphae_model_api_keys k
    JOIN hyphae_model_services s ON k.service_id = s.service_id
    WHERE k.status = 'pending'
    ORDER BY k.requested_at DESC
  `);
  
  const approvals = result.rows;
  
  const approvalsHTML = approvals.length === 0 ? 
    '<div class="empty">No pending approvals</div>' :
    approvals.map(a => `
      <div class="approval-card">
        <div class="info">
          <div class="agent">🔑 ${a.agent_id}</div>
          <div class="service">→ ${a.service_name}</div>
          <div class="service" style="font-size: 11px; color: #666;">Requested ${new Date(a.requested_at).toLocaleString()}</div>
        </div>
        <div class="action">
          <button class="btn-approve" onclick="approve('${a.key_id}')">✓ Approve</button>
          <button class="btn-deny" onclick="deny('${a.key_id}')">✗ Deny</button>
        </div>
      </div>
    `).join('');
  
  const content = `
    <div class="section">
      <h2>🔑 Pending API Key Approvals</h2>
      ${approvalsHTML}
    </div>
    
    <script>
      async function approve(keyId) {
        const reason = prompt('Approval reason (optional):');
        // Would post to /api/approve endpoint
        console.log('Would approve key:', keyId, 'reason:', reason);
      }
      
      async function deny(keyId) {
        const reason = prompt('Denial reason:');
        // Would post to /api/deny endpoint
        console.log('Would deny key:', keyId, 'reason:', reason);
      }
    </script>
  `;
  
  return renderHTML('Approvals', content);
}

async function usagePage() {
  const result = await db.query(`
    SELECT 
      agent_id,
      COUNT(*) as requests,
      SUM(total_tokens)::BIGINT as tokens,
      MAX(completed_at) as last_use
    FROM hyphae_model_usage_log
    WHERE created_at > NOW() - INTERVAL '24 hours'
    GROUP BY agent_id
    ORDER BY requests DESC
  `);
  
  const usage = result.rows;
  
  const usageHTML = usage.length === 0 ?
    '<div class="empty">No usage in last 24 hours</div>' :
    `
    <table>
      <thead>
        <tr>
          <th>Agent</th>
          <th>Requests</th>
          <th>Tokens</th>
          <th>Last Use</th>
        </tr>
      </thead>
      <tbody>
        ${usage.map(u => `
          <tr>
            <td>${u.agent_id}</td>
            <td>${u.requests}</td>
            <td>${(u.tokens || 0).toLocaleString()}</td>
            <td>${u.last_use ? new Date(u.last_use).toLocaleString() : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `;
  
  const content = `
    <div class="section">
      <h2>📈 Usage (Last 24h)</h2>
      ${usageHTML}
    </div>
  `;
  
  return renderHTML('Usage', content);
}

async function costsPage() {
  const result = await db.query(`
    SELECT 
      agent_id,
      service_id,
      SUM(estimated_cost)::DECIMAL(10,4) as total_cost,
      COUNT(*) as requests,
      MAX(created_at) as last_use
    FROM hyphae_model_usage_log
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY agent_id, service_id
    ORDER BY total_cost DESC
  `);
  
  const costs = result.rows;
  
  const costsHTML = costs.length === 0 ?
    '<div class="empty">No usage in last 30 days</div>' :
    `
    <table>
      <thead>
        <tr>
          <th>Agent</th>
          <th>Service</th>
          <th>Requests</th>
          <th>Total Cost</th>
          <th>Last Use</th>
        </tr>
      </thead>
      <tbody>
        ${costs.map(c => `
          <tr>
            <td>${c.agent_id}</td>
            <td>${c.service_id}</td>
            <td>${c.requests}</td>
            <td>$${(c.total_cost || 0).toFixed(4)}</td>
            <td>${c.last_use ? new Date(c.last_use).toLocaleDateString() : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    `;
  
  const content = `
    <div class="section">
      <h2>💰 Costs (Last 30 days)</h2>
      ${costsHTML}
    </div>
  `;
  
  return renderHTML('Costs', content);
}

// ─────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  
  try {
    let html;
    
    switch (pathname) {
      case '/':
        html = await overviewPage();
        break;
      case '/approvals':
        html = await approvalsPage();
        break;
      case '/usage':
        html = await usagePage();
        break;
      case '/costs':
        html = await costsPage();
        break;
      default:
        res.writeHead(404);
        html = renderHTML('Not Found', '<div class="error">Page not found</div>');
    }
    
    res.writeHead(200);
    res.end(html);
  } catch (error) {
    console.error('Error:', error);
    res.writeHead(500);
    res.end(renderHTML('Error', `<div class="error">Error: ${error.message}</div>`));
  }
});

// Startup
async function startup() {
  try {
    const result = await db.query('SELECT NOW()');
    console.log('✅ Dashboard database connected');
    
    const PORT = process.env.DASHBOARD_PORT || 3104;
    server.listen(PORT, () => {
      console.log(`✅ Admin Dashboard running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Dashboard startup failed:', error);
    process.exit(1);
  }
}

startup();

process.on('SIGTERM', async () => {
  console.log('Shutting down dashboard...');
  await db.end();
  server.close();
});
