import { z } from 'zod';

// Base types from database schema
export type UserRole = 'user' | 'developer' | 'admin';
export type ExtensionStatus = 'draft' | 'published' | 'deprecated' | 'suspended';
export type InstallationStatus = 'pending' | 'installed' | 'failed' | 'uninstalled';

// User types
export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  role: UserRole;
  avatar?: string;
  bio?: string;
  website?: string;
  github?: string;
  twitter?: string;
  isVerified: boolean;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserRequest {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: Omit<User, 'passwordHash'>;
  token: string;
  expiresIn: string;
}

// Extension types
export interface Extension {
  id: string;
  name: string;
  slug: string;
  displayName?: string;
  description?: string;
  longDescription?: string;
  authorId: string;
  category?: string;
  tags?: string[];
  icon?: string;
  banner?: string;
  screenshots?: string[];
  homepage?: string;
  repository?: string;
  documentation?: string;
  license?: string;
  keywords?: string[];
  status: ExtensionStatus;
  isPublic: boolean;
  isFeatured: boolean;
  downloadCount: number;
  rating: number;
  ratingCount: number;
  lastPublishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtensionWithAuthor extends Extension {
  author: Pick<User, 'id' | 'username' | 'displayName' | 'avatar'>;
}

export interface ExtensionVersion {
  id: string;
  extensionId: string;
  version: string;
  changelog?: string;
  componentCode?: string;
  componentProps?: any;
  componentDependencies?: Record<string, string>;
  serverlessCode?: string;
  serverlessDependencies?: Record<string, string>;
  serverlessConfig?: any;
  migrationCode?: string;
  migrationUp?: string;
  migrationDown?: string;
  dbSchema?: any;
  packageJson?: any;
  manifest?: ExtensionManifest;
  files?: ExtensionFile[];
  checksum?: string;
  signature?: string;
  minNodeVersion?: string;
  maxNodeVersion?: string;
  requiredExtensions?: RequiredExtension[];
  packageSize?: number;
  bundleSize?: number;
  isPrerelease: boolean;
  isDeprecated: boolean;
  downloadCount: number;
  publishedAt?: Date;
  createdAt: Date;
}

export interface ExtensionFile {
  path: string;
  content: string;
  type: 'component' | 'serverless' | 'migration' | 'asset' | 'config';
  encoding?: 'utf8' | 'base64';
}

export interface RequiredExtension {
  name: string;
  version: string;
  optional?: boolean;
}

export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  author: string | { name: string; email?: string; url?: string };
  license: string;
  keywords: string[];
  homepage?: string;
  repository?: string | { type: string; url: string };
  bugs?: string | { url: string; email?: string };
  main?: string;
  exports?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: {
    node?: string;
    npm?: string;
  };
  os?: string[];
  cpu?: string[];
  extensionConfig: {
    category: string;
    tags: string[];
    permissions: string[];
    endpoints: EndpointConfig[];
    components: ComponentConfig[];
    database?: DatabaseConfig;
  };
}

export interface EndpointConfig {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  handler: string;
  description?: string;
  parameters?: ParameterConfig[];
  responses?: ResponseConfig[];
}

export interface ComponentConfig {
  name: string;
  file: string;
  props?: Record<string, PropConfig>;
  description?: string;
}

export interface PropConfig {
  type: string;
  required?: boolean;
  default?: any;
  description?: string;
}

export interface ParameterConfig {
  name: string;
  type: 'query' | 'path' | 'body' | 'header';
  dataType: string;
  required?: boolean;
  description?: string;
}

export interface ResponseConfig {
  status: number;
  description: string;
  schema?: any;
}

export interface DatabaseConfig {
  tables: TableConfig[];
  migrations: {
    up: string;
    down: string;
  };
}

export interface TableConfig {
  name: string;
  columns: ColumnConfig[];
  indexes?: IndexConfig[];
}

export interface ColumnConfig {
  name: string;
  type: string;
  nullable?: boolean;
  default?: any;
  unique?: boolean;
  primaryKey?: boolean;
}

export interface IndexConfig {
  name: string;
  columns: string[];
  unique?: boolean;
}

// Installation types
export interface ExtensionInstallation {
  id: string;
  userId: string;
  extensionId: string;
  versionId: string;
  status: InstallationStatus;
  config?: any;
  environmentVariables?: Record<string, string>;
  installedAt?: Date;
  lastUsedAt?: Date;
  uninstalledAt?: Date;
  errorMessage?: string;
  errorDetails?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstallExtensionRequest {
  extensionId: string;
  version?: string;
  config?: any;
  environmentVariables?: Record<string, string>;
}

// Review types
export interface ExtensionReview {
  id: string;
  extensionId: string;
  versionId?: string;
  userId: string;
  rating: number;
  title?: string;
  review?: string;
  isVerified: boolean;
  helpfulCount: number;
  reportedCount: number;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReviewRequest {
  rating: number;
  title?: string;
  review?: string;
  versionId?: string;
}

// API Request/Response types
export interface CreateExtensionRequest {
  name: string;
  displayName?: string;
  description?: string;
  longDescription?: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  repository?: string;
  documentation?: string;
  license?: string;
  keywords?: string[];
}

export interface UpdateExtensionRequest extends Partial<CreateExtensionRequest> {
  status?: ExtensionStatus;
  isPublic?: boolean;
  icon?: string;
  banner?: string;
  screenshots?: string[];
}

export interface PublishVersionRequest {
  version: string;
  changelog?: string;
  files: ExtensionFile[];
  manifest: ExtensionManifest;
  isPrerelease?: boolean;
}

export interface SearchExtensionsQuery {
  query?: string;
  category?: string;
  tags?: string[];
  author?: string;
  status?: ExtensionStatus;
  featured?: boolean;
  sortBy?: 'name' | 'downloads' | 'rating' | 'updated' | 'created';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// API Key types
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPreview: string;
  permissions: string[];
  lastUsedAt?: Date;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateApiKeyRequest {
  name: string;
  permissions: string[];
  expiresAt?: Date;
}

// Configuration types
export interface ServerConfig {
  port: number;
  host: string;
  nodeEnv: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  maxFileSize: number;
  uploadDir: string;
  extensionsDir: string;
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  bcryptSaltRounds: number;
  extensionTimeout: number;
  maxExtensionSize: number;
}

// Error types
export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  path: string;
  method: string;
}

export interface ValidationError extends ApiError {
  code: 'VALIDATION_ERROR';
  fields: Record<string, string[]>;
}

export interface AuthenticationError extends ApiError {
  code: 'AUTHENTICATION_ERROR';
}

export interface AuthorizationError extends ApiError {
  code: 'AUTHORIZATION_ERROR';
}

export interface NotFoundError extends ApiError {
  code: 'NOT_FOUND';
  resource: string;
}

// Zod validation schemas
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username must be less than 50 characters').regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().max(100, 'Display name must be less than 100 characters').optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const createExtensionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters').regex(/^[a-zA-Z0-9_-]+$/, 'Name can only contain letters, numbers, underscores, and hyphens'),
  displayName: z.string().max(150, 'Display name must be less than 150 characters').optional(),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  longDescription: z.string().max(5000, 'Long description must be less than 5000 characters').optional(),
  category: z.string().max(50, 'Category must be less than 50 characters').optional(),
  tags: z.array(z.string().max(30, 'Tag must be less than 30 characters')).max(10, 'Maximum 10 tags allowed').optional(),
  homepage: z.string().url('Invalid homepage URL').optional(),
  repository: z.string().url('Invalid repository URL').optional(),
  documentation: z.string().url('Invalid documentation URL').optional(),
  license: z.string().max(50, 'License must be less than 50 characters').optional(),
  keywords: z.array(z.string().max(30, 'Keyword must be less than 30 characters')).max(20, 'Maximum 20 keywords allowed').optional(),
});

export const updateExtensionSchema = createExtensionSchema.partial().extend({
  status: z.enum(['draft', 'published', 'deprecated', 'suspended']).optional(),
  isPublic: z.boolean().optional(),
});

export const publishVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/, 'Invalid semantic version'),
  changelog: z.string().max(2000, 'Changelog must be less than 2000 characters').optional(),
  files: z.array(z.object({
    path: z.string().min(1, 'File path is required'),
    content: z.string().min(1, 'File content is required'),
    type: z.enum(['component', 'serverless', 'migration', 'asset', 'config']),
    encoding: z.enum(['utf8', 'base64']).optional(),
  })).min(1, 'At least one file is required'),
  manifest: z.any(), // Complex validation for manifest
  isPrerelease: z.boolean().optional(),
});

export const installExtensionSchema = z.object({
  extensionId: z.string().uuid('Invalid extension ID'),
  version: z.string().optional(),
  config: z.any().optional(),
  environmentVariables: z.record(z.string(), z.string()).optional(),
});

export const createReviewSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  title: z.string().max(200, 'Title must be less than 200 characters').optional(),
  review: z.string().max(2000, 'Review must be less than 2000 characters').optional(),
  versionId: z.string().uuid('Invalid version ID').optional(),
});

export const searchExtensionsSchema = z.object({
  query: z.string().max(100, 'Query must be less than 100 characters').optional(),
  category: z.string().max(50, 'Category must be less than 50 characters').optional(),
  tags: z.array(z.string().max(30, 'Tag must be less than 30 characters')).max(10, 'Maximum 10 tags allowed').optional(),
  author: z.string().max(50, 'Author must be less than 50 characters').optional(),
  status: z.enum(['draft', 'published', 'deprecated', 'suspended']).optional(),
  featured: z.boolean().optional(),
  sortBy: z.enum(['name', 'downloads', 'rating', 'updated', 'created']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1, 'Page must be at least 1').optional(),
  limit: z.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit must be at most 100').optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
  expiresAt: z.date().optional(),
});
