import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { serve } from "@hono/node-server";

// Import database connection and utilities
import {
  db,
  testConnection,
  runMigrations,
  closeConnection,
  healthCheck,
} from "./db/connection.js";

// Import route handlers
import extensionRoutes from "./routes/extensions";
import userRoutes from "./routes/users";
import installationRoutes from "./routes/installations";
import adminRoutes from "./routes/admin";
import uploadRoutes from "./routes/uploads";

// Import middleware
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { errorHandler } from "./middleware/errorHandler";

// Import types
import type { ServerConfig } from "./types/index.js";

// Server configuration
const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || "3000"),
  host: process.env.HOST || "localhost",
  nodeEnv: process.env.NODE_ENV || "development",
  jwtSecret: process.env.JWT_SECRET || "your-super-secret-jwt-key",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "50000000"), // 50MB
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  extensionsDir: process.env.EXTENSIONS_DIR || "./extensions",
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5173"
  ).split(","),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"), // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || "12"),
  extensionTimeout: parseInt(process.env.EXTENSION_TIMEOUT || "30000"), // 30 seconds
  maxExtensionSize: parseInt(process.env.MAX_EXTENSION_SIZE || "10000000"), // 10MB
};

// Create Hono app
const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: serverConfig.allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposeHeaders: ["X-Total-Count", "X-Page-Count"],
    credentials: true,
    maxAge: 86400, // 24 hours
  }),
);

// Rate limiting
app.use("*", rateLimitMiddleware(serverConfig));

// Health check endpoint
app.get("/health", async (c) => {
  const dbHealth = await healthCheck();
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    environment: serverConfig.nodeEnv,
    uptime: process.uptime(),
    database: dbHealth,
    memory: {
      used: process.memoryUsage().heapUsed / 1024 / 1024,
      total: process.memoryUsage().heapTotal / 1024 / 1024,
      rss: process.memoryUsage().rss / 1024 / 1024,
    },
  };

  const statusCode = dbHealth.status === "healthy" ? 200 : 503;
  return c.json(health, statusCode);
});

// API info endpoint
app.get("/", (c) => {
  return c.json({
    name: process.env.REGISTRY_NAME || "Acacia Extension Store",
    description:
      process.env.REGISTRY_DESCRIPTION ||
      "A marketplace for serverless function and React component extensions",
    version: process.env.REGISTRY_VERSION || "1.0.0",
    apiVersion: process.env.API_VERSION || "v1",
    documentation: "/api/docs",
    endpoints: {
      health: "/health",
      auth: "/api/v1/auth",
      extensions: "/api/v1/extensions",
      users: "/api/v1/users",
      installations: "/api/v1/installations",
      reviews: "/api/v1/reviews",
      uploads: "/api/v1/uploads",
      admin: "/api/v1/admin",
    },
    timestamp: new Date().toISOString(),
  });
});

// API Documentation endpoint
app.get("/api/docs", (c) => {
  return c.json({
    openapi: "3.0.0",
    info: {
      title: "Acacia Extension Store API",
      version: "1.0.0",
      description:
        "API for managing extensions, installations, and user accounts",
    },
    servers: [
      {
        url: `http://${serverConfig.host}:${serverConfig.port}/api/v1`,
        description: "Development server",
      },
    ],
    paths: {
      "/auth/register": {
        post: {
          summary: "Register a new user",
          tags: ["Authentication"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "username", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    username: { type: "string", minLength: 3, maxLength: 50 },
                    password: { type: "string", minLength: 8 },
                    displayName: { type: "string", maxLength: 100 },
                  },
                },
              },
            },
          },
        },
      },
      "/auth/login": {
        post: {
          summary: "Login user",
          tags: ["Authentication"],
        },
      },
      "/extensions": {
        get: {
          summary: "List extensions",
          tags: ["Extensions"],
        },
        post: {
          summary: "Create extension",
          tags: ["Extensions"],
          security: [{ bearerAuth: [] }],
        },
      },
      "/extensions/{id}": {
        get: {
          summary: "Get extension by ID",
          tags: ["Extensions"],
        },
        put: {
          summary: "Update extension",
          tags: ["Extensions"],
          security: [{ bearerAuth: [] }],
        },
        delete: {
          summary: "Delete extension",
          tags: ["Extensions"],
          security: [{ bearerAuth: [] }],
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  });
});

// API Routes
const apiPrefix = `/api/${process.env.API_VERSION || "v1"}`;

// Mount route handlers
app.route(`${apiPrefix}/extensions`, extensionRoutes);
app.route(`${apiPrefix}/users`, userRoutes);
app.route(`${apiPrefix}/installations`, installationRoutes);
app.route(`${apiPrefix}/uploads`, uploadRoutes);
app.route(`${apiPrefix}/admin`, adminRoutes);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      code: "NOT_FOUND",
      message: "The requested resource was not found",
      timestamp: new Date().toISOString(),
      path: c.req.path,
      method: c.req.method,
    },
    404,
  );
});

// Global error handler
app.onError(errorHandler);

// Graceful shutdown handler
let server: any;

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🔄 Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    console.log("📡 Closing HTTP server...");
    server.close((err: any) => {
      if (err) {
        console.error("❌ Error closing server:", err);
        process.exit(1);
      }
      console.log("✅ HTTP server closed");
    });
  }

  // Close database connections
  await closeConnection();

  console.log("✅ Graceful shutdown completed");
  process.exit(0);
};

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Unhandled error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown("unhandledRejection");
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  gracefulShutdown("uncaughtException");
});

// Start server
async function startServer() {
  try {
    console.log("🚀 Starting Acacia Extension Store Server...");
    console.log(`📋 Environment: ${serverConfig.nodeEnv}`);
    console.log(`🔗 Host: ${serverConfig.host}:${serverConfig.port}`);

    // Test database connection
    console.log("🔄 Testing database connection...");
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error("Failed to connect to database");
    }

    // Run migrations if in development
    if (serverConfig.nodeEnv === "development") {
      try {
        await runMigrations();
      } catch (error) {
        console.warn("⚠️  Migration warning:", error);
        // Continue startup even if migrations fail in development
      }
    }

    // Start HTTP server
    console.log("🔄 Starting HTTP server...");
    server = serve({
      fetch: app.fetch,
      port: serverConfig.port,
      hostname: serverConfig.host,
    });

    console.log(
      `✅ Server running at http://${serverConfig.host}:${serverConfig.port}`,
    );
    console.log(
      `📚 API Documentation: http://${serverConfig.host}:${serverConfig.port}/api/docs`,
    );
    console.log(
      `❤️  Health Check: http://${serverConfig.host}:${serverConfig.port}/health`,
    );
    console.log(
      `🏪 Extension Store API: http://${serverConfig.host}:${serverConfig.port}${apiPrefix}`,
    );

    if (serverConfig.nodeEnv === "development") {
      console.log("\n🛠️  Development mode enabled");
      console.log("   • Hot reload: ✅");
      console.log("   • Detailed logging: ✅");
      console.log("   • Auto migrations: ✅");
      console.log("   • CORS: Permissive");
    }

    console.log("\n🎯 Ready to accept connections!");
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Export for testing
export { app, serverConfig };

// Start server if this file is run directly
if (import.meta.main) {
  startServer();
}
