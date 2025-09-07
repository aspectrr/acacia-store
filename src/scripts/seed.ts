import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { db, testConnection, closeConnection } from "../db/connection.js";
import {
  users,
  extensions,
  extensionVersions,
  extensionInstallations,
  extensionReviews,
  extensionCategories,
  apiKeys,
} from "../db/schema.js";
import { eq } from "drizzle-orm";

// Load environment variables
config();

const BCRYPT_SALT_ROUNDS = 12;

// Sample data
const sampleUsers = [
  {
    email: "admin@acacia.dev",
    username: "admin",
    displayName: "System Administrator",
    password: "admin123",
    role: "admin" as const,
    bio: "System administrator for Acacia Extension Store",
    isVerified: true,
    isActive: true,
  },
  {
    email: "john@developer.com",
    username: "johndoe",
    displayName: "John Doe",
    password: "developer123",
    role: "developer" as const,
    bio: "Full-stack developer passionate about building extensions",
    website: "https://johndoe.dev",
    github: "johndoe",
    twitter: "johndoe_dev",
    isVerified: true,
    isActive: true,
  },
  {
    email: "alice@coder.io",
    username: "alicesmith",
    displayName: "Alice Smith",
    password: "developer123",
    role: "developer" as const,
    bio: "Frontend developer and UI/UX enthusiast",
    website: "https://alice.codes",
    github: "alicesmith",
    isVerified: true,
    isActive: true,
  },
  {
    email: "bob@user.com",
    username: "bobuser",
    displayName: "Bob Wilson",
    password: "user123",
    role: "user" as const,
    bio: "Extension enthusiast and beta tester",
    isVerified: false,
    isActive: true,
  },
  {
    email: "test@example.com",
    username: "testuser",
    displayName: "Test User",
    password: "test123",
    role: "user" as const,
    bio: "Test account for development purposes",
    isVerified: false,
    isActive: true,
  },
];

const sampleCategories = [
  {
    name: "Productivity",
    slug: "productivity",
    description: "Extensions to boost your productivity and workflow",
    icon: "⚡",
    color: "#3B82F6",
    sortOrder: 1,
  },
  {
    name: "E-commerce",
    slug: "ecommerce",
    description: "Extensions for online stores and commerce platforms",
    icon: "🛒",
    color: "#10B981",
    sortOrder: 2,
  },
  {
    name: "Analytics",
    slug: "analytics",
    description: "Data analysis and reporting extensions",
    icon: "📊",
    color: "#8B5CF6",
    sortOrder: 3,
  },
  {
    name: "Communication",
    slug: "communication",
    description: "Chat, messaging, and communication tools",
    icon: "💬",
    color: "#F59E0B",
    sortOrder: 4,
  },
  {
    name: "Utilities",
    slug: "utilities",
    description: "General utility extensions and tools",
    icon: "🔧",
    color: "#6B7280",
    sortOrder: 5,
  },
];

// Sample extensions data
const sampleExtensions = [
  {
    name: "task-manager",
    displayName: "Smart Task Manager",
    description: "Advanced task management with AI-powered prioritization",
    longDescription:
      "A comprehensive task management extension that uses AI to help prioritize your tasks, set deadlines, and track progress. Features include automated task categorization, smart notifications, and integration with popular productivity tools.",
    category: "Productivity",
    tags: ["tasks", "productivity", "ai", "management"],
    homepage: "https://taskmanager.dev",
    repository: "https://github.com/johndoe/task-manager",
    documentation: "https://docs.taskmanager.dev",
    license: "MIT",
    keywords: ["task", "management", "productivity", "ai"],
    status: "published" as const,
    isPublic: true,
    isFeatured: true,
  },
  {
    name: "analytics-dashboard",
    displayName: "Analytics Dashboard Pro",
    description: "Professional analytics dashboard with real-time metrics",
    longDescription:
      "Create beautiful, interactive dashboards with real-time data visualization. Supports multiple data sources, custom widgets, and automated reporting.",
    category: "Analytics",
    tags: ["analytics", "dashboard", "visualization", "metrics"],
    homepage: "https://analyticspro.dev",
    repository: "https://github.com/alicesmith/analytics-dashboard",
    license: "Apache-2.0",
    keywords: ["analytics", "dashboard", "visualization"],
    status: "published" as const,
    isPublic: true,
    isFeatured: true,
  },
  {
    name: "chat-widget",
    displayName: "Live Chat Widget",
    description: "Embeddable chat widget for customer support",
    longDescription:
      "Easy to integrate live chat widget that provides real-time customer support. Features include file sharing, emoji support, and integration with popular CRM systems.",
    category: "Communication",
    tags: ["chat", "support", "widget", "customer"],
    homepage: "https://chatwidget.dev",
    repository: "https://github.com/johndoe/chat-widget",
    license: "MIT",
    keywords: ["chat", "support", "widget"],
    status: "published" as const,
    isPublic: true,
    isFeatured: false,
  },
  {
    name: "payment-gateway",
    displayName: "Universal Payment Gateway",
    description: "Accept payments from multiple providers",
    longDescription:
      "Unified payment processing extension that supports multiple payment providers including Stripe, PayPal, and Square. Features include subscription management, refund processing, and detailed transaction reporting.",
    category: "E-commerce",
    tags: ["payments", "ecommerce", "stripe", "paypal"],
    homepage: "https://paymentgateway.dev",
    repository: "https://github.com/alicesmith/payment-gateway",
    license: "Commercial",
    keywords: ["payment", "gateway", "ecommerce"],
    status: "published" as const,
    isPublic: true,
    isFeatured: false,
  },
  {
    name: "backup-utility",
    displayName: "Smart Backup Utility",
    description: "Automated backup solution with cloud storage",
    longDescription:
      "Intelligent backup system that automatically backs up your data to multiple cloud providers. Features include incremental backups, encryption, and automated restore capabilities.",
    category: "Utilities",
    tags: ["backup", "cloud", "storage", "automation"],
    homepage: "https://backuputility.dev",
    license: "GPL-3.0",
    keywords: ["backup", "utility", "cloud"],
    status: "draft" as const,
    isPublic: false,
    isFeatured: false,
  },
];

// Sample extension versions
const sampleVersions = [
  {
    version: "1.2.0",
    changelog:
      "Added AI-powered task prioritization, improved UI, fixed minor bugs",
    isPrerelease: false,
    isDeprecated: false,
  },
  {
    version: "1.1.0",
    changelog: "Added task categories, improved performance, bug fixes",
    isPrerelease: false,
    isDeprecated: false,
  },
  {
    version: "2.0.1",
    changelog:
      "Added real-time data updates, new widget types, performance improvements",
    isPrerelease: false,
    isDeprecated: false,
  },
  {
    version: "1.0.3",
    changelog: "Added emoji support, file sharing, improved mobile experience",
    isPrerelease: false,
    isDeprecated: false,
  },
  {
    version: "3.1.0",
    changelog:
      "Added Square integration, improved refund processing, bug fixes",
    isPrerelease: false,
    isDeprecated: false,
  },
];

// Sample reviews
const sampleReviews = [
  {
    rating: 5,
    title: "Excellent task management!",
    review:
      "This extension has completely transformed how I manage my daily tasks. The AI prioritization is spot-on and has helped me be much more productive.",
    isVerified: true,
  },
  {
    rating: 4,
    title: "Great analytics tool",
    review:
      "Really powerful analytics dashboard. The visualizations are beautiful and the real-time updates work perfectly. Could use a few more chart types.",
    isVerified: true,
  },
  {
    rating: 5,
    title: "Perfect for customer support",
    review:
      "Easy to integrate and our customers love it. The file sharing feature is particularly useful.",
    isVerified: true,
  },
  {
    rating: 4,
    title: "Solid payment solution",
    review:
      "Works well with multiple payment providers. Setup was straightforward and it handles our transaction volume without issues.",
    isVerified: false,
  },
  {
    rating: 3,
    title: "Good but has room for improvement",
    review:
      "The basic functionality works well, but I'd like to see more customization options and better documentation.",
    isVerified: false,
  },
];

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

async function seedUsers() {
  console.log("👥 Seeding users...");

  const createdUsers = [];

  for (const userData of sampleUsers) {
    try {
      // Check if user already exists
      const existingUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, userData.email))
        .limit(1);

      if (existingUser.length > 0) {
        console.log(
          `   ⏭️  User ${userData.username} already exists, skipping...`,
        );
        continue;
      }

      const passwordHash = await hashPassword(userData.password);

      const newUsers = await db
        .insert(users)
        .values({
          email: userData.email,
          username: userData.username,
          displayName: userData.displayName,
          passwordHash,
          role: userData.role,
          bio: userData.bio,
          website: userData.website,
          github: userData.github,
          twitter: userData.twitter,
          isVerified: userData.isVerified,
          isActive: userData.isActive,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: users.id,
          username: users.username,
          role: users.role,
        });

      createdUsers.push(newUsers[0]);
      console.log(
        `   ✅ Created user: ${userData.username} (${userData.role})`,
      );
    } catch (error) {
      console.error(`   ❌ Failed to create user ${userData.username}:`, error);
    }
  }

  console.log(`   📊 Created ${createdUsers.length} users`);
  return createdUsers;
}

async function seedCategories() {
  console.log("📂 Seeding categories...");

  const createdCategories = [];

  for (const categoryData of sampleCategories) {
    try {
      // Check if category already exists
      const existingCategory = await db
        .select({ id: extensionCategories.id })
        .from(extensionCategories)
        .where(eq(extensionCategories.slug, categoryData.slug))
        .limit(1);

      if (existingCategory.length > 0) {
        console.log(
          `   ⏭️  Category ${categoryData.name} already exists, skipping...`,
        );
        continue;
      }

      const newCategories = await db
        .insert(extensionCategories)
        .values({
          name: categoryData.name,
          slug: categoryData.slug,
          description: categoryData.description,
          icon: categoryData.icon,
          color: categoryData.color,
          sortOrder: categoryData.sortOrder,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: extensionCategories.id,
          name: extensionCategories.name,
        });

      createdCategories.push(newCategories[0]);
      console.log(`   ✅ Created category: ${categoryData.name}`);
    } catch (error) {
      console.error(
        `   ❌ Failed to create category ${categoryData.name}:`,
        error,
      );
    }
  }

  console.log(`   📊 Created ${createdCategories.length} categories`);
  return createdCategories;
}

async function seedExtensions() {
  console.log("🧩 Seeding extensions...");

  // Get users for extension authors
  const allUsers = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.role, "developer"));

  if (allUsers.length === 0) {
    console.warn("   ⚠️  No developer users found, skipping extensions...");
    return [];
  }

  const createdExtensions = [];

  for (let i = 0; i < sampleExtensions.length; i++) {
    const extensionData = sampleExtensions[i];
    const author = allUsers[i % allUsers.length]; // Cycle through authors

    try {
      // Check if extension already exists
      const existingExtension = await db
        .select({ id: extensions.id })
        .from(extensions)
        .where(eq(extensions.name, extensionData?.name))
        .limit(1);

      if (existingExtension.length > 0) {
        console.log(
          `   ⏭️  Extension ${extensionData?.name} already exists, skipping...`,
        );
        continue;
      }

      const slug = extensionData?.name
        ?.toLowerCase()
        ?.replace(/[^a-z0-9-_]/g, "-");

      const newExtensions = await db
        .insert(extensions)
        .values({
          name: extensionData?.name,
          slug,
          displayName: extensionData?.displayName,
          description: extensionData?.description,
          longDescription: extensionData?.longDescription,
          authorId: author?.id,
          category: extensionData?.category,
          tags: extensionData?.tags,
          homepage: extensionData?.homepage,
          repository: extensionData?.repository,
          documentation: extensionData?.documentation,
          license: extensionData?.license,
          keywords: extensionData?.keywords,
          status: extensionData?.status,
          isPublic: extensionData?.isPublic,
          isFeatured: extensionData?.isFeatured,
          downloadCount: Math.floor(Math.random() * 1000) + 50, // Random download count
          rating: Math.floor(Math.random() * 200) + 300, // Random rating (3.0-5.0 * 100)
          ratingCount: Math.floor(Math.random() * 50) + 10,
          lastPublishedAt:
            extensionData?.status === "published" ? new Date() : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: extensions.id,
          name: extensions.name,
          authorId: extensions.authorId,
        });

      createdExtensions.push(newExtensions[0]);
      console.log(
        `   ✅ Created extension: ${extensionData?.name} (by ${author?.username})`,
      );
    } catch (error) {
      console.error(
        `   ❌ Failed to create extension ${extensionData?.name}:`,
        error,
      );
    }
  }

  console.log(`   📊 Created ${createdExtensions.length} extensions`);
  return createdExtensions;
}

async function seedExtensionVersions(createdExtensions: any[]) {
  console.log("🏷️  Seeding extension versions...");

  const createdVersions = [];

  for (
    let i = 0;
    i < createdExtensions.length && i < sampleVersions.length;
    i++
  ) {
    const extension = createdExtensions[i];
    const versionData = sampleVersions[i];

    try {
      const newVersions = await db
        .insert(extensionVersions)
        .values({
          extensionId: extension.id,
          version: versionData?.version,
          changelog: versionData?.changelog,
          componentCode:
            "// Sample React component\nconst Component = () => <div>Hello World</div>;",
          serverlessCode:
            '// Sample serverless function\nexport const handler = async (event) => ({ statusCode: 200, body: "OK" });',
          migrationCode:
            "-- Sample migration\nCREATE TABLE sample_data (id SERIAL PRIMARY KEY, name TEXT);",
          packageJson: {
            name: extension.name,
            version: versionData?.version,
            description: "Sample extension package",
            main: "index.js",
          },
          manifest: {
            name: extension.name,
            version: versionData?.version,
            description: "Sample extension",
            author: "Sample Author",
            license: "MIT",
            extensionConfig: {
              category: "productivity",
              tags: ["sample"],
              permissions: ["read", "write"],
              endpoints: [],
              components: [],
            },
          },
          files: [
            {
              path: "index.js",
              content: 'console.log("Hello from extension!");',
              type: "serverless",
              encoding: "utf8",
            },
          ],
          isPrerelease: versionData?.isPrerelease,
          isDeprecated: versionData?.isDeprecated,
          downloadCount: Math.floor(Math.random() * 100) + 10,
          publishedAt: new Date(),
          createdAt: new Date(),
        })
        .returning({
          id: extensionVersions.id,
          extensionId: extensionVersions.extensionId,
          version: extensionVersions.version,
        });

      createdVersions.push(newVersions[0]);
      console.log(
        `   ✅ Created version: ${versionData?.version} for ${extension.name}`,
      );
    } catch (error) {
      console.error(
        `   ❌ Failed to create version for ${extension.name}:`,
        error,
      );
    }
  }

  console.log(`   📊 Created ${createdVersions.length} versions`);
  return createdVersions;
}

async function seedInstallationsAndReviews(
  createdExtensions: any[],
  createdVersions: any[],
) {
  console.log("📦 Seeding installations and reviews...");

  // Get regular users
  const regularUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.role, "user"));

  if (regularUsers.length === 0) {
    console.warn(
      "   ⚠️  No regular users found, skipping installations and reviews...",
    );
    return;
  }

  let installationCount = 0;
  let reviewCount = 0;

  // Create some installations and reviews
  for (let i = 0; i < Math.min(createdExtensions.length, 10); i++) {
    const extension = createdExtensions[i];
    const version = createdVersions.find((v) => v.extensionId === extension.id);
    const user = regularUsers[i % regularUsers.length];

    if (!version) continue;

    try {
      // Create installation
      await db.insert(extensionInstallations).values({
        userId: user.id,
        extensionId: extension.id,
        versionId: version.id,
        status: "installed",
        config: { theme: "default", enabled: true },
        environmentVariables: {},
        installedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      installationCount++;
      console.log(
        `   ✅ Created installation: ${extension.name} for ${user?.username}`,
      );

      // Create review (50% chance)
      if (Math.random() > 0.5 && reviewCount < sampleReviews.length) {
        const reviewData = sampleReviews[reviewCount % sampleReviews.length];

        await db.insert(extensionReviews).values({
          extensionId: extension.id,
          versionId: version.id,
          userId: user?.id,
          rating: reviewData?.rating,
          title: reviewData?.title,
          review: reviewData?.review,
          isVerified: reviewData?.isVerified,
          helpfulCount: Math.floor(Math.random() * 20),
          reportedCount: 0,
          isHidden: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        reviewCount++;
        console.log(
          `   ✅ Created review: ${reviewData?.rating}⭐ for ${extension.name}`,
        );
      }
    } catch (error) {
      console.error(`   ❌ Failed to create installation/review:`, error);
    }
  }

  console.log(
    `   📊 Created ${installationCount} installations and ${reviewCount} reviews`,
  );
}

async function seedApiKeys() {
  console.log("🔑 Seeding API keys...");

  // Get developer users
  const developers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.role, "developer"))
    .limit(2);

  if (developers.length === 0) {
    console.warn("   ⚠️  No developers found, skipping API keys...");
    return;
  }

  let apiKeyCount = 0;

  for (const developer of developers) {
    try {
      const apiKey = `ak_dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const keyHash = await bcrypt.hash(apiKey, BCRYPT_SALT_ROUNDS);
      const keyPreview = `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;

      await db.insert(apiKeys).values({
        userId: developer.id,
        name: `Development API Key`,
        keyHash,
        keyPreview,
        permissions: [
          "extensions:read",
          "extensions:write",
          "versions:publish",
        ],
        isActive: true,
        createdAt: new Date(),
      });

      apiKeyCount++;
      console.log(
        `   ✅ Created API key for ${developer.username}: ${keyPreview}`,
      );
    } catch (error) {
      console.error(
        `   ❌ Failed to create API key for ${developer.username}:`,
        error,
      );
    }
  }

  console.log(`   📊 Created ${apiKeyCount} API keys`);
}

async function runSeed() {
  console.log("🌱 Starting database seed...");
  console.log(`📋 Environment: ${process.env.NODE_ENV || "development"}`);

  try {
    // Test database connection
    console.log("🔄 Testing database connection...");
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error("Failed to connect to database");
    }
    console.log("✅ Database connection successful");

    // Run seed operations in order
    await seedUsers();
    await seedCategories();
    const createdExtensions = await seedExtensions();
    const createdVersions = await seedExtensionVersions(createdExtensions);
    await seedInstallationsAndReviews(createdExtensions, createdVersions);
    await seedApiKeys();

    console.log("\n🎉 Database seeding completed successfully!");
    console.log("\n📋 Sample accounts created:");
    console.log("   Admin: admin@acacia.dev / admin123");
    console.log("   Developer: john@developer.com / developer123");
    console.log("   Developer: alice@coder.io / developer123");
    console.log("   User: bob@user.com / user123");
    console.log("   User: test@example.com / test123");
    console.log("\n🚀 You can now test the API with these accounts!");
  } catch (error) {
    console.error("\n❌ Seeding failed:", error);

    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }

    process.exit(1);
  } finally {
    await closeConnection();
  }
}

// Handle script execution
async function main() {
  const args = process.argv.slice(2);
  const forceFlag = args.includes("--force") || args.includes("-f");
  const helpFlag = args.includes("--help") || args.includes("-h");

  if (helpFlag) {
    console.log(`
📖 Database Seed Script

Usage: bun run src/scripts/seed.ts [options]

Options:
  --force, -f     Force seed even in production
  --help, -h      Show this help message

This script creates sample data including:
  • Users (admin, developers, regular users)
  • Extension categories
  • Extensions with versions
  • Installations and reviews
  • API keys

Note: This script is idempotent - it won't create duplicates if run multiple times.
`);
    process.exit(0);
  }

  // Safety check for production
  if (process.env.NODE_ENV === "production" && !forceFlag) {
    console.warn("⚠️  Attempting to seed production database!");
    console.warn("   Use --force flag to confirm you want to proceed");
    console.warn("   Example: bun run src/scripts/seed.ts --force");
    process.exit(1);
  }

  await runSeed();
}

// Run if this file is executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Seed script failed:", error);
    process.exit(1);
  });
}

export { runSeed };
