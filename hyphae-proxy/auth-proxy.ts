/**
 * Hyphae Authenticated Proxy Server
 * 
 * Sits in front of Hyphae services and provides:
 * - OAuth2/JWT token validation
 * - Rate limiting per user
 * - Request/response logging
 * - SSL/TLS termination ready
 * 
 * Access external Hyphae while keeping internal services private
 */

import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

interface AuthToken {
  userId: string;
  role: "admin" | "user" | "readonly";
  iat: number;
  exp: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

// Configuration
const INTERNAL_HYPHAE = process.env.INTERNAL_HYPHAE || "http://localhost:3100";
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3000");
const RATE_LIMIT_REQUESTS = 100; // Per minute
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Rate limiting store
const rateLimitStore = new Map<string, RateLimitEntry>();

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * Validate JWT token from Authorization header
 */
function validateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing or invalid Authorization header",
      example: "Authorization: Bearer <jwt-token>",
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthToken;
    (req as any).user = decoded;
    (req as any).traceId = uuidv4();
    next();
  } catch (err: any) {
    res.status(401).json({
      error: "Invalid token",
      message: err.message,
    });
  }
}

// ============================================================================
// RATE LIMITING MIDDLEWARE
// ============================================================================

/**
 * Rate limit per user (100 requests per minute)
 */
function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user.userId;
  const now = Date.now();

  let entry = rateLimitStore.get(userId);

  // Create new entry or reset if window expired
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    };
    rateLimitStore.set(userId, entry);
    return next();
  }

  // Check limit
  if (entry.count >= RATE_LIMIT_REQUESTS) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      limit: RATE_LIMIT_REQUESTS,
      window: "1 minute",
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
  }

  // Increment counter
  entry.count++;
  next();
}

// ============================================================================
// PROXY ENDPOINTS
// ============================================================================

/**
 * Proxy: GET /api/services
 * List available agents
 */
app.get("/api/services", validateToken, rateLimitMiddleware, async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const userId = (req as any).user.userId;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/services`, {
      params: req.query,
    });

    console.log(`[${traceId}] ${userId} - GET /api/services (${response.data.count} services)`);

    res.json({
      ...response.data,
      traceId,
    });
  } catch (err: any) {
    console.error(`[${traceId}] Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

/**
 * Proxy: GET /api/services/:agentId
 * Get specific agent details
 */
app.get("/api/services/:agentId", validateToken, rateLimitMiddleware, async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const userId = (req as any).user.userId;
  const { agentId } = req.params;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/services/${agentId}`);

    console.log(`[${traceId}] ${userId} - GET /api/services/${agentId}`);

    res.json({
      ...response.data,
      traceId,
    });
  } catch (err: any) {
    console.error(`[${traceId}] Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

/**
 * Proxy: POST /api/rpc/call
 * Call an agent via RPC
 */
app.post("/api/rpc/call", validateToken, rateLimitMiddleware, async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const userId = (req as any).user.userId;
  const { sourceAgent, targetAgent, capability, params, timeout } = req.body;

  // Validate required fields
  if (!sourceAgent || !targetAgent || !capability) {
    return res.status(400).json({
      error: "Missing required fields: sourceAgent, targetAgent, capability",
      traceId,
    });
  }

  // Set sourceAgent to authenticated user (security)
  const finalSourceAgent = userId;

  try {
    const response = await axios.post(
      `${INTERNAL_HYPHAE}/api/rpc/call`,
      {
        sourceAgent: finalSourceAgent,
        targetAgent,
        capability,
        params,
        timeout: timeout || 30000,
      },
      {
        timeout: (timeout || 30000) + 5000,
        headers: {
          "X-Trace-Id": traceId,
        },
      }
    );

    console.log(
      `[${traceId}] ${userId} - RPC ${finalSourceAgent} → ${targetAgent}.${capability} (${response.data.duration}ms)`
    );

    res.json({
      ...response.data,
      traceId,
    });
  } catch (err: any) {
    console.error(`[${traceId}] RPC Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

/**
 * Proxy: GET /api/rpc/audit
 * Query RPC audit trail
 */
app.get("/api/rpc/audit", validateToken, rateLimitMiddleware, async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const userId = (req as any).user.userId;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/rpc/audit`, {
      params: req.query,
    });

    console.log(`[${traceId}] ${userId} - GET /api/rpc/audit (${response.data.count} records)`);

    res.json({
      ...response.data,
      traceId,
    });
  } catch (err: any) {
    console.error(`[${traceId}] Error: ${err.message}`);
    res.status(err.response?.status || 500).json({
      error: err.message,
      traceId,
    });
  }
});

/**
 * Proxy: GET /api/health
 * System health check
 */
app.get("/api/health", validateToken, rateLimitMiddleware, async (req: Request, res: Response) => {
  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/health`);
    res.json(response.data);
  } catch (err: any) {
    res.status(503).json({
      error: "Hyphae service unavailable",
    });
  }
});

/**
 * Proxy: GET /api/stats
 * System statistics
 */
app.get("/api/stats", validateToken, rateLimitMiddleware, async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;

  try {
    const response = await axios.get(`${INTERNAL_HYPHAE}/api/stats`);
    res.json({
      ...response.data,
      traceId,
    });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      traceId,
    });
  }
});

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

/**
 * POST /auth/token
 * Generate JWT token (admin-only for now)
 * 
 * In production, this would validate against an OAuth2 provider or user database
 */
app.post("/auth/token", express.json(), (req: Request, res: Response) => {
  const { userId, apiKey, role = "user" } = req.body;

  // Simple validation (in production: check against database or OAuth2)
  if (!userId || !apiKey) {
    return res.status(400).json({
      error: "Missing userId or apiKey",
    });
  }

  // Validate API key (in production: lookup from database)
  const validApiKeys: Record<string, string> = {
    "john-broker": "key-" + process.env.JOHN_API_KEY || "default",
  };

  if (validApiKeys[userId] !== apiKey) {
    return res.status(401).json({
      error: "Invalid credentials",
    });
  }

  // Generate token
  const token = jwt.sign(
    {
      userId,
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    },
    JWT_SECRET
  );

  res.json({
    token,
    expiresIn: 3600,
    type: "Bearer",
  });
});

/**
 * GET /health
 * Proxy server health check (doesn't require auth)
 */
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PROXY_PORT, () => {
  console.log(`🔐 Hyphae Authenticated Proxy running on port ${PROXY_PORT}`);
  console.log(`   Internal Hyphae: ${INTERNAL_HYPHAE}`);
  console.log(`   Rate limit: ${RATE_LIMIT_REQUESTS} requests per minute`);
  console.log("");
  console.log("Endpoints:");
  console.log("  GET    /api/services");
  console.log("  GET    /api/services/:agentId");
  console.log("  POST   /api/rpc/call");
  console.log("  GET    /api/rpc/audit");
  console.log("  GET    /api/health");
  console.log("  GET    /api/stats");
  console.log("  POST   /auth/token");
  console.log("");
  console.log("All endpoints require: Authorization: Bearer <jwt-token>");
  console.log("");
});

export { app };
