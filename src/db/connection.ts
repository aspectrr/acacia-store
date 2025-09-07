import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Database configuration
const config = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "acacia_store",
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "password",
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
  max: 20, // Maximum connections in pool
  idle_timeout: 20,
  connect_timeout: 10,
};

// Create connection string from config or use DATABASE_URL
const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}${config.ssl ? "?sslmode=require" : ""}`;

// Create postgres client
const client = postgres(connectionString, {
  max: config.max,
  idle_timeout: config.idle_timeout,
  connect_timeout: config.connect_timeout,
  ssl: config.ssl,
});

// Create drizzle database instance
export const db = drizzle(client, { schema });

// Migration client for running migrations
const migrationClient = postgres(connectionString, {
  max: 1,
  ssl: config.ssl,
});

export const migrationDb = drizzle(migrationClient);

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    console.log("✅ Database connection successful");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    return false;
  }
}

// Run migrations
export async function runMigrations() {
  try {
    console.log("🔄 Running database migrations...");
    await migrate(migrationDb, { migrationsFolder: "./drizzle" });
    console.log("✅ Migrations completed successfully");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

// Graceful shutdown
export async function closeConnection() {
  try {
    await client.end();
    await migrationClient.end();
    console.log("✅ Database connections closed");
  } catch (error) {
    console.error("❌ Error closing database connections:", error);
  }
}

// Export types for use throughout the application
export type Database = typeof db;
export type Schema = typeof schema;

// Health check query
export async function healthCheck() {
  try {
    const result = await client`SELECT
      current_database() as database,
      version() as version,
      current_user as user,
      inet_server_addr() as host,
      inet_server_port() as port,
      NOW() as timestamp
    `;
    return {
      status: "healthy",
      database: result[0],
      connection: "active",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    };
  }
}

// Database statistics
export async function getDatabaseStats() {
  try {
    const stats = await client`
      SELECT
        schemaname,
        tablename,
        attname as column_name,
        n_distinct,
        most_common_vals
      FROM pg_stats
      WHERE schemaname = 'public'
      ORDER BY schemaname, tablename, attname;
    `;

    const tableStats = await client`
      SELECT
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples
      FROM pg_stat_user_tables
      WHERE schemaname = 'public';
    `;

    return {
      columnStats: stats,
      tableStats: tableStats,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching database stats:", error);
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    };
  }
}

// Connection pool status
export function getConnectionStatus() {
  return {
    totalConnections: config.max,
    idleTimeout: config.idle_timeout,
    connectTimeout: config.connect_timeout,
    ssl: !!config.ssl,
    host: config.host,
    port: config.port,
    database: config.database,
  };
}
