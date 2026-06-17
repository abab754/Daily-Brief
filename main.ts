import "dotenv/config";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "./server.js";
import { getAuthUrl, handleAuthCallback, isConfigured } from "./google-api.js";
import { initDb } from "./token-store.js";
import { createSessionToken, verifySessionToken, createOAuthState, verifyOAuthState } from "./session.js";
import { rateLimit } from "./rate-limit.js";

// --- Security headers middleware ---
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

// Pending OAuth states (CSRF protection) - short TTL
const pendingStates = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 min TTL
  for (const [state, ts] of pendingStates) {
    if (ts < cutoff) pendingStates.delete(state);
  }
}, 60 * 1000).unref();

async function startStreamableHTTPServer(
  createServer: (googleUserId: string | null) => McpServer
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const isProd = process.env.NODE_ENV === "production";

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  if (isProd) app.set("trust proxy", 1);
  app.use(cors());
  app.use(cookieParser());
  app.use(securityHeaders);

  // Rate limiting
  app.use("/mcp", rateLimit(120, 60 * 1000));      // 120 req/min for MCP
  app.use("/auth", rateLimit(10, 60 * 1000));       // 10 req/min for auth

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // OAuth2: redirect to Google consent screen
  app.get("/auth/google", (_req: Request, res: Response) => {
    const state = createOAuthState();
    pendingStates.set(state, Date.now());
    const url = getAuthUrl(state);
    if (!url) {
      res.status(500).send("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
      return;
    }
    // Store state in short-lived cookie for CSRF verification
    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000, // 10 min
    });
    res.redirect(url);
  });

  // OAuth2: handle callback
  app.get("/auth/google/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const expectedState = req.cookies?.oauth_state;

    if (!code) {
      res.status(400).send("Missing authorization code");
      return;
    }
    if (!state || !expectedState || !verifyOAuthState(state, expectedState)) {
      res.status(403).send("Invalid OAuth state. Please try again.");
      return;
    }

    // Clear state cookie
    res.clearCookie("oauth_state");
    pendingStates.delete(state);

    try {
      const { googleUserId } = await handleAuthCallback(code);
      const sessionToken = createSessionToken(googleUserId);

      // Set session cookie
      res.cookie("session", sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: "/",
      });

      res.send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>Connected!</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                 display: flex; align-items: center; justify-content: center; height: 100vh;
                 margin: 0; background: #f9fafb; color: #111827; }
          .card { text-align: center; padding: 48px; border-radius: 16px;
                  background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 500px; }
          h1 { color: #16a34a; margin: 0 0 8px; font-size: 1.4rem; }
          p { color: #6b7280; margin: 0; line-height: 1.6; }
          .check { font-size: 2.5rem; margin-bottom: 12px; }
          .token { margin-top: 16px; padding: 8px; background: #f3f4f6; border-radius: 8px;
                   font-family: monospace; font-size: 0.7rem; word-break: break-all;
                   color: #374151; user-select: all; cursor: pointer; max-height: 60px; overflow: auto; }
          .hint { font-size: 0.75rem; color: #9ca3af; margin-top: 8px; }
        </style></head>
        <body><div class="card">
          <div class="check">&#10003;</div>
          <h1>Google Account Connected</h1>
          <p>You can close this tab and refresh your briefing.</p>
          <div class="token" title="Click to select">${sessionToken}</div>
          <p class="hint">For CLI clients: use this token as a Bearer token</p>
        </div></body></html>
      `);
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.status(500).send("Authentication failed. Please try again.");
    }
  });

  // Logout
  app.post("/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie("session", { path: "/" });
    res.json({ ok: true });
  });

  // MCP endpoint
  app.all("/mcp", async (req: Request, res: Response) => {
    // Extract user from session cookie or Authorization header
    const sessionToken = req.cookies?.session
      || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
    const googleUserId = sessionToken ? verifySessionToken(sessionToken) : null;

    const server = createServer(googleUserId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log(`Daily Briefing MCP server listening on http://localhost:${port}/mcp`);
    if (isConfigured()) {
      console.log(`Google OAuth: http://localhost:${port}/auth/google`);
    } else {
      console.log(`\nGoogle API not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.`);
    }
    console.log(`Environment: ${isProd ? "production" : "development"}`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startStdioServer(
  createServer: (googleUserId: string | null) => McpServer
): Promise<void> {
  // stdio mode: single user, auto-detect from DB
  await createServer(null).connect(new StdioServerTransport());
}

async function main() {
  // Initialize database
  initDb();

  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
