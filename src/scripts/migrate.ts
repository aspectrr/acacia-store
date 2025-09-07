import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrationDb, testConnection, closeConnection } from '../db/connection.js';

// Load environment variables
config();

async function runMigrations() {
  console.log('🚀 Starting database migration...');
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.DB_NAME || 'acacia_store'}`);

  try {
    // Test database connection first
    console.log('🔄 Testing database connection...');
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to database');
    }
    console.log('✅ Database connection successful');

    // Run migrations
    console.log('🔄 Running database migrations...');
    console.log('📁 Migration folder: ./drizzle');

    await migrate(migrationDb, {
      migrationsFolder: './drizzle',
    });

    console.log('✅ All migrations completed successfully!');

    // Get migration status
    try {
      const migrationTable = await migrationDb.execute(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '__drizzle_migrations'
      `);

      if (migrationTable.length > 0) {
        const migrations = await migrationDb.execute(`
          SELECT id, hash, created_at
          FROM __drizzle_migrations
          ORDER BY created_at DESC
          LIMIT 5
        `);

        console.log('\n📊 Recent migrations:');
        migrations.forEach((migration: any, index: number) => {
          const status = index === 0 ? '🟢' : '⚪';
          const date = new Date(migration.created_at).toLocaleDateString();
          console.log(`   ${status} ${migration.id} (${date})`);
        });
      }
    } catch (error) {
      console.warn('⚠️  Could not fetch migration history:', error);
    }

    // Verify table creation
    console.log('\n🔍 Verifying table creation...');
    const tables = await migrationDb.execute(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const expectedTables = [
      'users',
      'extensions',
      'extension_versions',
      'extension_installations',
      'extension_reviews',
      'extension_categories',
      'api_keys'
    ];

    const actualTables = tables.map((table: any) => table.table_name);
    const missingTables = expectedTables.filter(table => !actualTables.includes(table));
    const extraTables = actualTables.filter(table =>
      !expectedTables.includes(table) &&
      !table.startsWith('__drizzle') &&
      !table.startsWith('pg_')
    );

    if (missingTables.length === 0) {
      console.log('✅ All expected tables created successfully');
      console.log(`📊 Total tables: ${actualTables.length}`);
    } else {
      console.warn('⚠️  Missing tables:', missingTables);
    }

    if (extraTables.length > 0) {
      console.log('📋 Additional tables found:', extraTables);
    }

    // Check for enum types
    console.log('\n🔍 Verifying enum types...');
    const enums = await migrationDb.execute(`
      SELECT typname
      FROM pg_type
      WHERE typtype = 'e'
      AND typname IN ('extension_status', 'installation_status', 'user_role')
      ORDER BY typname
    `);

    const expectedEnums = ['extension_status', 'installation_status', 'user_role'];
    const actualEnums = enums.map((e: any) => e.typname);

    if (expectedEnums.every(e => actualEnums.includes(e))) {
      console.log('✅ All enum types created successfully');
    } else {
      const missingEnums = expectedEnums.filter(e => !actualEnums.includes(e));
      console.warn('⚠️  Missing enum types:', missingEnums);
    }

    // Migration completed successfully
    console.log('\n🎉 Database migration completed successfully!');
    console.log('🔗 You can now start the server');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);

    if (error instanceof Error) {
      console.error('Error details:', error.message);

      // Provide helpful error messages
      if (error.message.includes('ECONNREFUSED')) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('   • Make sure PostgreSQL is running');
        console.error('   • Check your database connection settings in .env');
        console.error('   • Verify the database exists');
      } else if (error.message.includes('permission denied')) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('   • Check database user permissions');
        console.error('   • Make sure the user can create tables and schemas');
      } else if (error.message.includes('does not exist')) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('   • Create the database first');
        console.error('   • Check the database name in your .env file');
      }
    }

    process.exit(1);
  } finally {
    // Close database connections
    await closeConnection();
  }
}

// Handle script execution
async function main() {
  const args = process.argv.slice(2);
  const forceFlag = args.includes('--force') || args.includes('-f');
  const helpFlag = args.includes('--help') || args.includes('-h');

  if (helpFlag) {
    console.log(`
📖 Database Migration Script

Usage: bun run src/scripts/migrate.ts [options]

Options:
  --force, -f     Force run migrations even in production
  --help, -h      Show this help message

Environment Variables:
  DATABASE_URL    Complete PostgreSQL connection string
  DB_HOST         Database host (default: localhost)
  DB_PORT         Database port (default: 5432)
  DB_NAME         Database name (default: acacia_store)
  DB_USER         Database user (default: postgres)
  DB_PASSWORD     Database password
  NODE_ENV        Environment (development/production)

Examples:
  bun run src/scripts/migrate.ts
  bun run src/scripts/migrate.ts --force
  NODE_ENV=production bun run src/scripts/migrate.ts --force
`);
    process.exit(0);
  }

  // Safety check for production
  if (process.env.NODE_ENV === 'production' && !forceFlag) {
    console.warn('⚠️  Running migrations in production environment!');
    console.warn('   Use --force flag to confirm you want to proceed');
    console.warn('   Example: bun run src/scripts/migrate.ts --force');
    process.exit(1);
  }

  await runMigrations();
}

// Run if this file is executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });
}

export { runMigrations };
