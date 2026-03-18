/**
 * Scope-Based Role-Based Access Control (RBAC) for OAuth2
 * 
 * Scopes define what actions a client can perform:
 * - memforge:read — Query memory
 * - memforge:write — Create/update memory
 * - hyphae:read — List services
 * - hyphae:admin — Register/delete services
 * - system:admin — Administrative functions
 */

/**
 * Predefined scopes and their descriptions
 */
const SCOPES = {
  'memforge:read': 'Query and search memory',
  'memforge:write': 'Create, update, and delete memory entries',
  'hyphae:read': 'List and query services',
  'hyphae:admin': 'Register, update, and delete services',
  'dashboard:read': 'Access dashboard metrics',
  'system:admin': 'Administrative functions (cache clear, user management)',
};

/**
 * Default scopes for common clients
 */
const DEFAULT_CLIENT_SCOPES = {
  dashboard: ['dashboard:read', 'memforge:read', 'hyphae:read'],
  memforge: ['memforge:read', 'memforge:write', 'hyphae:read'],
  hyphae: ['hyphae:read', 'hyphae:admin', 'memforge:read'],
  external: ['memforge:read'],
};

/**
 * Express middleware: Check required scope
 * 
 * Usage:
 *   app.get('/api/memory', checkScope('memforge:read'), handler)
 */
function checkScope(requiredScope) {
  return (req, res, next) => {
    // Get OAuth2 token from request
    if (!req.oauth2) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No OAuth2 token provided',
      });
    }

    // Extract scopes from token
    const tokenScopes = req.oauth2.scope ? req.oauth2.scope.split(' ') : [];

    // Check if required scope is granted
    if (!tokenScopes.includes(requiredScope)) {
      console.log(`⛔ Authorization denied: ${req.oauth2.client_id} missing ${requiredScope} (has: ${tokenScopes.join(',')})`);

      return res.status(403).json({
        error: 'Insufficient permissions',
        required_scope: requiredScope,
        granted_scopes: tokenScopes,
        client_id: req.oauth2.client_id,
      });
    }

    // Authorization granted
    console.log(`✅ Authorization granted: ${req.oauth2.client_id} has ${requiredScope}`);
    next();
  };
}

/**
 * Express middleware: Check multiple scopes (any match)
 * 
 * Usage:
 *   app.get('/api/admin', checkAnyScope(['system:admin', 'hyphae:admin']), handler)
 */
function checkAnyScope(requiredScopes) {
  return (req, res, next) => {
    if (!req.oauth2) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No OAuth2 token provided',
      });
    }

    const tokenScopes = req.oauth2.scope ? req.oauth2.scope.split(' ') : [];
    const hasRequiredScope = requiredScopes.some(scope => tokenScopes.includes(scope));

    if (!hasRequiredScope) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required_scopes: requiredScopes,
        granted_scopes: tokenScopes,
      });
    }

    next();
  };
}

/**
 * Express middleware: Check all scopes (all must match)
 * 
 * Usage:
 *   app.post('/api/admin/full-access', checkAllScopes(['system:admin', 'memforge:write']), handler)
 */
function checkAllScopes(requiredScopes) {
  return (req, res, next) => {
    if (!req.oauth2) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No OAuth2 token provided',
      });
    }

    const tokenScopes = req.oauth2.scope ? req.oauth2.scope.split(' ') : [];
    const hasAllScopes = requiredScopes.every(scope => tokenScopes.includes(scope));

    if (!hasAllScopes) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required_scopes: requiredScopes,
        granted_scopes: tokenScopes,
      });
    }

    next();
  };
}

/**
 * Audit logging helper
 */
function auditLog(action, clientId, scope, allowed) {
  const status = allowed ? '✅' : '⛔';
  const timestamp = new Date().toISOString();
  console.log(`${status} [${timestamp}] ${clientId} ${action} ${scope}`);
}

/**
 * Initialize default scopes in database
 * 
 * Usage:
 *   await initializeScopesInDatabase(pool)
 */
async function initializeScopesInDatabase(pool) {
  console.log('🔧 Initializing predefined scopes...');

  for (const [scope, description] of Object.entries(SCOPES)) {
    try {
      await pool.query(
        `INSERT INTO oauth2_scope_definitions (scope, description)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [scope, description]
      );
    } catch (error) {
      console.error(`Error initializing scope ${scope}:`, error.message);
    }
  }

  console.log(`✅ Initialized ${Object.keys(SCOPES).length} predefined scopes`);
}

/**
 * Grant scopes to a client
 * 
 * Usage:
 *   await grantScopesToClient(pool, 'dashboard', ['memforge:read', 'hyphae:read'])
 */
async function grantScopesToClient(pool, clientId, scopes) {
  for (const scope of scopes) {
    try {
      await pool.query(
        `INSERT INTO oauth2_client_scopes (client_id, scope)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [clientId, scope]
      );
    } catch (error) {
      console.error(`Error granting ${scope} to ${clientId}:`, error.message);
    }
  }

  console.log(`✅ Granted ${scopes.length} scopes to ${clientId}`);
}

/**
 * Revoke scope from client
 */
async function revokeScopeFromClient(pool, clientId, scope) {
  await pool.query(
    'DELETE FROM oauth2_client_scopes WHERE client_id = $1 AND scope = $2',
    [clientId, scope]
  );

  console.log(`✅ Revoked ${scope} from ${clientId}`);
}

/**
 * Get client scopes
 */
async function getClientScopes(pool, clientId) {
  const result = await pool.query(
    'SELECT scope FROM oauth2_client_scopes WHERE client_id = $1 ORDER BY scope',
    [clientId]
  );

  return result.rows.map(r => r.scope);
}

module.exports = {
  SCOPES,
  DEFAULT_CLIENT_SCOPES,
  checkScope,
  checkAnyScope,
  checkAllScopes,
  auditLog,
  initializeScopesInDatabase,
  grantScopesToClient,
  revokeScopeFromClient,
  getClientScopes,
};
