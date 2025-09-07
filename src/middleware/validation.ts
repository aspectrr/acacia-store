import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { z, ZodSchema, ZodError } from "zod";

// Validation targets
export type ValidationTarget = "body" | "query" | "param" | "header";

// Validation configuration
interface ValidationConfig {
  body?: ZodSchema;
  query?: ZodSchema;
  param?: ZodSchema;
  header?: ZodSchema;
  stripUnknown?: boolean;
  abortEarly?: boolean;
}

// Validation result
interface ValidationResult<T = any> {
  success: boolean;
  data?: T;
  errors?: ZodError;
}

// Parse and validate request body
async function validateBody(
  c: Context,
  schema: ZodSchema,
): Promise<ValidationResult> {
  try {
    const contentType = c.req.header("content-type") || "";

    let body: any;

    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.formData();
      body = Object.fromEntries(formData.entries());
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      body = await c.req.text();
    }

    const result = schema.safeParse(body);

    return {
      success: result.success,
      data: result.success ? result.data : undefined,
      errors: result.success ? undefined : result.error,
    };
  } catch (error) {
    throw new HTTPException(400, {
      message: "Invalid request body format",
    });
  }
}

// Validate query parameters
function validateQuery(c: Context, schema: ZodSchema): ValidationResult {
  const query = c.req.query();
  const queryObject: Record<string, any> = {};

  // Convert query parameters to appropriate types
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;

    // Try to parse numbers
    if (!isNaN(Number(value)) && value !== "") {
      queryObject[key] = Number(value);
    }
    // Try to parse booleans
    else if (value === "true" || value === "false") {
      queryObject[key] = value === "true";
    }
    // Parse arrays (comma-separated values)
    else if (value.includes(",")) {
      queryObject[key] = value.split(",").map((v) => v.trim());
    }
    // Keep as string
    else {
      queryObject[key] = value;
    }
  }

  const result = schema.safeParse(queryObject);

  return {
    success: result.success,
    data: result.success ? result.data : undefined,
    errors: result.success ? undefined : result.error,
  };
}

// Validate path parameters
function validateParam(c: Context, schema: ZodSchema): ValidationResult {
  // Get all path parameters
  const params: Record<string, any> = {};

  // Hono doesn't provide a direct way to get all params, so we'll construct from known patterns
  const path = c.req.path;
  const segments = path.split("/");

  // Common parameter patterns
  const paramPatterns = [
    {
      name: "id",
      pattern:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    },
    { name: "slug", pattern: /^[a-z0-9-_]+$/i },
    { name: "version", pattern: /^\d+\.\d+\.\d+/ },
  ];

  // Extract known parameters
  segments.forEach((segment, index) => {
    paramPatterns.forEach(({ name, pattern }) => {
      if (pattern.test(segment)) {
        params[name] = segment;
      }
    });
  });

  // Also try to get from context if available
  try {
    const contextParam = c.req.param();
    Object.assign(params, contextParam);
  } catch (error) {
    // Ignore if param() method fails
  }

  const result = schema.safeParse(params);

  return {
    success: result.success,
    data: result.success ? result.data : undefined,
    errors: result.success ? undefined : result.error,
  };
}

// Validate headers
function validateHeader(c: Context, schema: ZodSchema): ValidationResult {
  const headers: Record<string, string> = {};

  // Get common headers
  const headerNames = [
    "authorization",
    "content-type",
    "user-agent",
    "accept",
    "x-api-key",
    "x-requested-with",
    "x-forwarded-for",
  ];

  headerNames.forEach((name) => {
    const value = c.req.header(name);
    if (value) {
      headers[name.replace(/-/g, "_")] = value;
    }
  });

  const result = schema.safeParse(headers);

  return {
    success: result.success,
    data: result.success ? result.data : undefined,
    errors: result.success ? undefined : result.error,
  };
}

// Format validation errors
function formatValidationErrors(errors: ZodError[]): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  errors.forEach((error) => {
    error.errors.forEach((err) => {
      const path = err.path.length > 0 ? err.path.join(".") : "root";

      if (!formatted[path]) {
        formatted[path] = [];
      }

      formatted[path].push(err.message);
    });
  });

  return formatted;
}

// Main validation middleware factory
export function validate(config: ValidationConfig) {
  return async (c: Context, next: Next) => {
    const validationErrors: ZodError[] = [];
    const validatedData: Record<string, any> = {};

    try {
      // Validate body
      if (config.body) {
        const result = await validateBody(c, config.body);
        if (!result.success && result.errors) {
          validationErrors.push(result.errors);
        } else if (result.data) {
          validatedData.body = result.data;
        }
      }

      // Validate query parameters
      if (config.query) {
        const result = validateQuery(c, config.query);
        if (!result.success && result.errors) {
          validationErrors.push(result.errors);
        } else if (result.data) {
          validatedData.query = result.data;
        }
      }

      // Validate path parameters
      if (config.param) {
        const result = validateParam(c, config.param);
        if (!result.success && result.errors) {
          validationErrors.push(result.errors);
        } else if (result.data) {
          validatedData.param = result.data;
        }
      }

      // Validate headers
      if (config.header) {
        const result = validateHeader(c, config.header);
        if (!result.success && result.errors) {
          validationErrors.push(result.errors);
        } else if (result.data) {
          validatedData.header = result.data;
        }
      }

      // If there are validation errors, throw exception
      if (validationErrors.length > 0) {
        const formattedErrors = formatValidationErrors(validationErrors);

        throw new HTTPException(400, {
          message: "Validation failed",
        });
      }

      // Add validated data to context
      c.set("validatedData", validatedData);

      await next();
    } catch (error) {
      if (validationErrors.length > 0) {
        // Create a comprehensive validation error
        const allErrors = validationErrors.reduce(
          (acc, err) => {
            acc.errors.push(...err.errors);
            return acc;
          },
          { errors: [] as any[] },
        );

        const zodError = new ZodError(allErrors.errors);
        throw zodError;
      }

      throw error;
    }
  };
}

// Shorthand validation functions
export const validateBody = (schema: ZodSchema) => validate({ body: schema });
export const validateQuery = (schema: ZodSchema) => validate({ query: schema });
export const validateParam = (schema: ZodSchema) => validate({ param: schema });
export const validateHeader = (schema: ZodSchema) =>
  validate({ header: schema });

// Common parameter schemas
export const commonParams = {
  id: z.object({
    id: z.string().uuid("Invalid ID format"),
  }),

  slug: z.object({
    slug: z
      .string()
      .min(1, "Slug is required")
      .regex(/^[a-zA-Z0-9-_]+$/, "Invalid slug format"),
  }),

  version: z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+/, "Invalid version format"),
  }),

  pagination: z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(20),
  }),
};

// Common query schemas
export const commonQueries = {
  pagination: z.object({
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),

  search: z.object({
    q: z.string().min(1).max(100).optional(),
    query: z.string().min(1).max(100).optional(),
  }),

  filters: z.object({
    status: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).or(z.string()).optional(),
    author: z.string().optional(),
    featured: z.boolean().optional(),
  }),
};

// Common header schemas
export const commonHeaders = {
  auth: z.object({
    authorization: z
      .string()
      .startsWith("Bearer ", "Invalid authorization header format"),
  }),

  apiKey: z.object({
    x_api_key: z.string().min(1, "API key is required"),
  }),

  contentType: z.object({
    content_type: z
      .string()
      .includes("application/json", "Content-Type must be application/json"),
  }),
};

// Helper to get validated data from context
export function getValidatedData<T = any>(
  c: Context,
  target?: ValidationTarget,
): T | undefined {
  const validatedData = c.get("validatedData") as
    | Record<string, any>
    | undefined;

  if (!validatedData) {
    return undefined;
  }

  if (target) {
    return validatedData[target] as T;
  }

  return validatedData as T;
}

// Helper to get validated body
export function getValidatedBody<T = any>(c: Context): T | undefined {
  return getValidatedData<T>(c, "body");
}

// Helper to get validated query
export function getValidatedQuery<T = any>(c: Context): T | undefined {
  return getValidatedData<T>(c, "query");
}

// Helper to get validated params
export function getValidatedParam<T = any>(c: Context): T | undefined {
  return getValidatedData<T>(c, "param");
}

// Helper to get validated headers
export function getValidatedHeader<T = any>(c: Context): T | undefined {
  return getValidatedData<T>(c, "header");
}

// Create validation middleware with common patterns
export const validationMiddleware = {
  // User registration
  register: validate({
    body: z.object({
      email: z.string().email("Invalid email address"),
      username: z
        .string()
        .min(3)
        .max(50)
        .regex(/^[a-zA-Z0-9_-]+$/, "Invalid username format"),
      password: z.string().min(8, "Password must be at least 8 characters"),
      displayName: z.string().max(100).optional(),
    }),
  }),

  // User login
  login: validate({
    body: z.object({
      email: z.string().email("Invalid email address"),
      password: z.string().min(1, "Password is required"),
    }),
  }),

  // Extension creation
  createExtension: validate({
    body: z.object({
      name: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-zA-Z0-9_-]+$/, "Invalid extension name"),
      displayName: z.string().max(150).optional(),
      description: z.string().max(500).optional(),
      longDescription: z.string().max(5000).optional(),
      category: z.string().max(50).optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      homepage: z.string().url().optional(),
      repository: z.string().url().optional(),
      documentation: z.string().url().optional(),
      license: z.string().max(50).optional(),
      keywords: z.array(z.string().max(30)).max(20).optional(),
    }),
  }),

  // Extension update
  updateExtension: validate({
    param: commonParams.id,
    body: z.object({
      displayName: z.string().max(150).optional(),
      description: z.string().max(500).optional(),
      longDescription: z.string().max(5000).optional(),
      category: z.string().max(50).optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      homepage: z.string().url().optional(),
      repository: z.string().url().optional(),
      documentation: z.string().url().optional(),
      license: z.string().max(50).optional(),
      keywords: z.array(z.string().max(30)).max(20).optional(),
      status: z
        .enum(["draft", "published", "deprecated", "suspended"])
        .optional(),
      isPublic: z.boolean().optional(),
    }),
  }),

  // Extension search
  searchExtensions: validate({
    query: z.object({
      query: z.string().max(100).optional(),
      category: z.string().max(50).optional(),
      tags: z.array(z.string()).or(z.string()).optional(),
      author: z.string().max(50).optional(),
      status: z
        .enum(["draft", "published", "deprecated", "suspended"])
        .optional(),
      featured: z.boolean().optional(),
      sortBy: z
        .enum(["name", "downloads", "rating", "updated", "created"])
        .optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  }),

  // Install extension
  installExtension: validate({
    body: z.object({
      extensionId: z.string().uuid("Invalid extension ID"),
      version: z.string().optional(),
      config: z.any().optional(),
      environmentVariables: z.record(z.string(), z.string()).optional(),
    }),
  }),

  // Create review
  createReview: validate({
    param: commonParams.id,
    body: z.object({
      rating: z.number().int().min(1).max(5),
      title: z.string().max(200).optional(),
      review: z.string().max(2000).optional(),
      versionId: z.string().uuid().optional(),
    }),
  }),

  // Common ID parameter
  withId: validate({
    param: commonParams.id,
  }),

  // Common pagination
  withPagination: validate({
    query: commonQueries.pagination,
  }),
};
