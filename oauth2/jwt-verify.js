/**
 * JWT Verification Utilities for OAuth2
 * 
 * Provides stateless token validation using RS256 (asymmetric signing)
 * No database lookup required for JWT tokens (faster than introspection)
 */

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

class JWTVerifier {
  constructor(publicKeyPath) {
    if (!publicKeyPath) {
      throw new Error('publicKeyPath required');
    }

    try {
      this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
      console.log(`✅ Loaded public key from ${publicKeyPath}`);
    } catch (error) {
      throw new Error(`Failed to load public key: ${error.message}`);
    }
  }

  /**
   * Verify JWT token
   * @returns {Object} Decoded token or null if invalid
   */
  verify(token) {
    try {
      const decoded = jwt.verify(token, this.publicKey, {
        algorithms: ['RS256'],
      });

      // Token is valid
      return {
        valid: true,
        token: decoded,
        error: null,
      };
    } catch (error) {
      // Token invalid, expired, or signature mismatch
      return {
        valid: false,
        token: null,
        error: error.message, // 'jwt expired', 'invalid signature', etc.
      };
    }
  }

  /**
   * Get remaining TTL in seconds
   */
  getTTL(token) {
    const result = this.verify(token);
    if (!result.valid) return 0;

    const exp = result.token.exp;
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, exp - now);
  }

  /**
   * Check if token is expired
   */
  isExpired(token) {
    return this.getTTL(token) <= 0;
  }
}

/**
 * Express middleware: Verify JWT token in Authorization header
 * 
 * Usage:
 *   app.use(createJWTMiddleware(publicKeyPath))
 *   app.get('/protected', (req, res) => {
 *     // req.oauth2 = { client_id, sub, scope, iat, exp }
 *   })
 */
function createJWTMiddleware(publicKeyPath) {
  const verifier = new JWTVerifier(publicKeyPath);

  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Check for Bearer token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);

    // Verify token
    const result = verifier.verify(token);

    if (!result.valid) {
      return res.status(403).json({ error: 'Invalid token', reason: result.error });
    }

    // Attach decoded token to request
    req.oauth2 = result.token;
    req.oauth2.ttl = verifier.getTTL(token);

    next();
  };
}

/**
 * Scope-based authorization middleware
 * 
 * Usage:
 *   app.get('/api/memory', checkScope('memforge:read'), handler)
 */
function checkScope(requiredScope) {
  return (req, res, next) => {
    if (!req.oauth2) {
      return res.status(401).json({ error: 'No OAuth2 token' });
    }

    const grantedScopes = req.oauth2.scope ? req.oauth2.scope.split(' ') : [];

    if (!grantedScopes.includes(requiredScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredScope,
        granted: grantedScopes,
      });
    }

    next();
  };
}

module.exports = {
  JWTVerifier,
  createJWTMiddleware,
  checkScope,
};
