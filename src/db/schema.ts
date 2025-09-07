import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  integer,
  varchar,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const extensionStatusEnum = pgEnum("extension_status", [
  "draft",
  "published",
  "deprecated",
  "suspended",
]);
export const installationStatusEnum = pgEnum("installation_status", [
  "pending",
  "installed",
  "failed",
  "uninstalled",
]);
export const userRoleEnum = pgEnum("user_role", ["user", "developer", "admin"]);

// Users table
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    username: varchar("username", { length: 50 }).notNull().unique(),
    displayName: varchar("display_name", { length: 100 }),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").default("user").notNull(),
    avatar: text("avatar"),
    bio: text("bio"),
    website: text("website"),
    github: varchar("github", { length: 100 }),
    twitter: varchar("twitter", { length: 100 }),
    isVerified: boolean("is_verified").default(false),
    isActive: boolean("is_active").default(true),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    usernameIdx: index("users_username_idx").on(table.username),
  }),
);

// Extensions table
export const extensions = pgTable(
  "extensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    displayName: varchar("display_name", { length: 150 }),
    description: text("description"),
    longDescription: text("long_description"),
    authorId: uuid("author_id")
      .references(() => users.id)
      .notNull(),
    category: varchar("category", { length: 50 }),
    tags: jsonb("tags").$type<string[]>(),
    icon: text("icon"),
    banner: text("banner"),
    screenshots: jsonb("screenshots").$type<string[]>(),
    homepage: text("homepage"),
    repository: text("repository"),
    documentation: text("documentation"),
    license: varchar("license", { length: 50 }),
    keywords: jsonb("keywords").$type<string[]>(),
    status: extensionStatusEnum("status").default("draft").notNull(),
    isPublic: boolean("is_public").default(false),
    isFeatured: boolean("is_featured").default(false),
    downloadCount: integer("download_count").default(0),
    rating: integer("rating").default(0), // Average rating * 100 (for precision)
    ratingCount: integer("rating_count").default(0),
    lastPublishedAt: timestamp("last_published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("extensions_slug_idx").on(table.slug),
    authorIdx: index("extensions_author_idx").on(table.authorId),
    categoryIdx: index("extensions_category_idx").on(table.category),
    statusIdx: index("extensions_status_idx").on(table.status),
  }),
);

// Extension versions table
export const extensionVersions = pgTable(
  "extension_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    extensionId: uuid("extension_id")
      .references(() => extensions.id, { onDelete: "cascade" })
      .notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    changelog: text("changelog"),

    // Component definition
    componentCode: text("component_code"), // React component source code
    componentProps: jsonb("component_props"), // Props interface definition
    componentDependencies: jsonb("component_dependencies").$type<
      Record<string, string>
    >(),

    // Serverless function definition
    serverlessCode: text("serverless_code"), // Serverless function source code
    serverlessDependencies: jsonb("serverless_dependencies").$type<
      Record<string, string>
    >(),
    serverlessConfig: jsonb("serverless_config"), // Runtime config, environment variables, etc.

    // Database migration
    migrationCode: text("migration_code"), // SQL migration file content
    migrationUp: text("migration_up"), // Up migration commands
    migrationDown: text("migration_down"), // Down migration commands
    dbSchema: jsonb("db_schema"), // Schema definition for the extension's data

    // Package metadata
    packageJson: jsonb("package_json"), // Complete package.json
    manifest: jsonb("manifest"), // Extension manifest with metadata

    // Files and assets
    files: jsonb("files").$type<
      {
        path: string;
        content: string;
        type: "component" | "serverless" | "migration" | "asset" | "config";
        encoding?: "utf8" | "base64";
      }[]
    >(),

    // Security and validation
    checksum: text("checksum"), // SHA-256 hash of the package
    signature: text("signature"), // Digital signature

    // Installation requirements
    minNodeVersion: varchar("min_node_version", { length: 20 }),
    maxNodeVersion: varchar("max_node_version", { length: 20 }),
    requiredExtensions: jsonb("required_extensions").$type<
      {
        name: string;
        version: string;
        optional?: boolean;
      }[]
    >(),

    // Size and performance metrics
    packageSize: integer("package_size"),
    bundleSize: integer("bundle_size"),

    isPrerelease: boolean("is_prerelease").default(false),
    isDeprecated: boolean("is_deprecated").default(false),
    downloadCount: integer("download_count").default(0),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    extensionVersionIdx: uniqueIndex(
      "extension_versions_extension_version_idx",
    ).on(table.extensionId, table.version),
    extensionIdx: index("extension_versions_extension_idx").on(
      table.extensionId,
    ),
    versionIdx: index("extension_versions_version_idx").on(table.version),
  }),
);

// Extension installations table
export const extensionInstallations = pgTable(
  "extension_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    extensionId: uuid("extension_id")
      .references(() => extensions.id, { onDelete: "cascade" })
      .notNull(),
    versionId: uuid("version_id")
      .references(() => extensionVersions.id)
      .notNull(),
    status: installationStatusEnum("status").default("pending").notNull(),

    // Installation configuration
    config: jsonb("config"), // User-specific configuration
    environmentVariables: jsonb("environment_variables").$type<
      Record<string, string>
    >(),

    // Installation tracking
    installedAt: timestamp("installed_at"),
    lastUsedAt: timestamp("last_used_at"),
    uninstalledAt: timestamp("uninstalled_at"),

    // Error tracking
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userExtensionIdx: uniqueIndex("installations_user_extension_idx").on(
      table.userId,
      table.extensionId,
    ),
    userIdx: index("installations_user_idx").on(table.userId),
    extensionIdx: index("installations_extension_idx").on(table.extensionId),
    statusIdx: index("installations_status_idx").on(table.status),
  }),
);

// Extension categories table
export const extensionCategories = pgTable(
  "extension_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 50 }).notNull().unique(),
    slug: varchar("slug", { length: 50 }).notNull().unique(),
    description: text("description"),
    icon: text("icon"),
    color: varchar("color", { length: 7 }), // Hex color
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("categories_slug_idx").on(table.slug),
    nameIdx: index("categories_name_idx").on(table.name),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  extensions: many(extensions),
  installations: many(extensionInstallations),
  reviews: many(extensionReviews),
  apiKeys: many(apiKeys),
}));

export const extensionsRelations = relations(extensions, ({ one, many }) => ({
  author: one(users, {
    fields: [extensions.authorId],
    references: [users.id],
  }),
  versions: many(extensionVersions),
  installations: many(extensionInstallations),
  reviews: many(extensionReviews),
}));

export const extensionVersionsRelations = relations(
  extensionVersions,
  ({ one, many }) => ({
    extension: one(extensions, {
      fields: [extensionVersions.extensionId],
      references: [extensions.id],
    }),
    installations: many(extensionInstallations),
  }),
);

export const extensionInstallationsRelations = relations(
  extensionInstallations,
  ({ one }) => ({
    user: one(users, {
      fields: [extensionInstallations.userId],
      references: [users.id],
    }),
    extension: one(extensions, {
      fields: [extensionInstallations.extensionId],
      references: [extensions.id],
    }),
    version: one(extensionVersions, {
      fields: [extensionInstallations.versionId],
      references: [extensionVersions.id],
    }),
  }),
);
