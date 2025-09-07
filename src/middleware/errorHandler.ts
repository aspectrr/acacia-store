import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ApiError, ValidationError } from '../types/index.js';

// Error response format
interface ErrorResponse {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  path: string;
  method: string;
  requestId?: string;
  stack?: string;
}

// Database error patterns
const DB_ERROR_PATTERNS = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  CONNECTION_EXCEPTION: '08000',
  INVALID_TEXT_REPRESENTATION: '22P02',
};

// Extract user-friendly message from database error
function getDatabaseErrorMessage(error: any): string {
  const code = error.code;
  const message = error.message || '';
  const detail = error.detail || '';

  switch (code) {
    case DB_ERROR_PATTERNS.UNIQUE_VIOLATION:
      if (message.includes('email')) {
        return 'This email address is already registered.';
      }
      if (message.includes('username')) {
        return 'This username is already taken.';
      }
      if (message.includes('slug')) {
        return 'This name is already in use. Please choose a different name.';
      }
      return 'A record with this information already exists.';

    case DB_ERROR_PATTERNS.FOREIGN_KEY_VIOLATION:
      return 'Referenced resource does not exist.';

    case DB_ERROR_PATTERNS.NOT_NULL_VIOLATION:
      const field = error.column || 'field';
      return `${field.charAt(0).toUpperCase() + field.slice(1)} is required.`;

    case DB_ERROR_PATTERNS.CHECK_VIOLATION:
      return 'Data validation failed. Please check your input.';

    case DB_ERROR_PATTERNS.CONNECTION_EXCEPTION:
      return 'Database connection error. Please try again later.';

    case DB_ERROR_PATTERNS.INVALID_TEXT_REPRESENTATION:
      return 'Invalid data format provided.';

    default:
      if (message.includes('timeout')) {
        return 'Request timed out. Please try again.';
      }
      return 'Database error occurred.';
  }
}

// Format Zod validation errors
function formatZodError(error: ZodError): ValidationError {
  const fields: Record<string, string[]> = {};

  error.errors.forEach((err) => {
    const path = err.path.join('.');
    const field = path || 'root';

    if (!fields[field]) {
      fields[field] = [];
    }

    fields[field].push(err.message);
  });

  return {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed. Please check your input.',
    details: { issues: error.errors },
    fields,
    timestamp: new Date().toISOString(),
    path: '', // Will be set by error handler
    method: '', // Will be set by error handler
  };
}

// Generate request ID for tracking
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Log error with appropriate level
function logError(error: any, context: Context, requestId: string) {
  const logData = {
    requestId,
    timestamp: new Date().toISOString(),
    method: context.req.method,
    path: context.req.path,
    userAgent: context.req.header('user-agent'),
    ip: context.req.header('x-forwarded-for') || context.req.header('x-real-ip') || 'unknown',
    user: context.get('user')?.id || 'anonymous',
    error: {
      name: error.name,
      message: error.message,
      code: error.code || 'UNKNOWN',
      status: error.status || 500,
    },
  };

  if (error.status >= 500) {
    console.error('❌ Server Error:', JSON.stringify(logData, null, 2));
    if (process.env.NODE_ENV === 'development') {
      console.error('Stack trace:', error.stack);
    }
  } else if (error.status >= 400) {
    console.warn('⚠️  Client Error:', JSON.stringify(logData, null, 2));
  } else {
    console.info('ℹ️  Request Error:', JSON.stringify(logData, null, 2));
  }
}

// Main error handler middleware
export const errorHandler = (error: Error, c: Context): Response => {
  const requestId = generateRequestId();
  const isDevelopment = process.env.NODE_ENV === 'development';

  let errorResponse: ErrorResponse = {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred.',
    timestamp: new Date().toISOString(),
    path: c.req.path,
    method: c.req.method,
    requestId,
  };

  let statusCode = 500;

  try {
    // HTTP Exception from Hono
    if (error instanceof HTTPException) {
      statusCode = error.status;
      errorResponse = {
        ...errorResponse,
        code: getHttpErrorCode(error.status),
        message: error.message,
      };
    }
    // Zod Validation Error
    else if (error instanceof ZodError) {
      statusCode = 400;
      const validationError = formatZodError(error);
      errorResponse = {
        ...errorResponse,
        ...validationError,
        path: c.req.path,
        method: c.req.method,
        requestId,
      };
    }
    // Database Errors
    else if (error.name === 'PostgresError' || error.code) {
      statusCode = 400;
      errorResponse = {
        ...errorResponse,
        code: 'DATABASE_ERROR',
        message: getDatabaseErrorMessage(error),
      };

      // Some database errors should be 500
      if (error.code === DB_ERROR_PATTERNS.CONNECTION_EXCEPTION) {
        statusCode = 503;
        errorResponse.code = 'SERVICE_UNAVAILABLE';
      }
    }
    // JWT Errors
    else if (error.name === 'JsonWebTokenError') {
      statusCode = 401;
      errorResponse = {
        ...errorResponse,
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token.',
      };
    }
    else if (error.name === 'TokenExpiredError') {
      statusCode = 401;
      errorResponse = {
        ...errorResponse,
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired.',
      };
    }
    // Multer/Upload Errors
    else if (error.code === 'LIMIT_FILE_SIZE') {
      statusCode = 413;
      errorResponse = {
        ...errorResponse,
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds the maximum limit.',
      };
    }
    else if (error.code === 'LIMIT_FILE_COUNT') {
      statusCode = 400;
      errorResponse = {
        ...errorResponse,
        code: 'TOO_MANY_FILES',
        message: 'Too many files uploaded.',
      };
    }
    // Rate Limit Errors
    else if (error.message.includes('rate limit')) {
      statusCode = 429;
      errorResponse = {
        ...errorResponse,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      };
    }
    // Timeout Errors
    else if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      statusCode = 408;
      errorResponse = {
        ...errorResponse,
        code: 'REQUEST_TIMEOUT',
        message: 'Request timed out. Please try again.',
      };
    }
    // Generic Error
    else {
      statusCode = 500;
      errorResponse = {
        ...errorResponse,
        code: 'INTERNAL_SERVER_ERROR',
        message: isDevelopment ? error.message : 'An unexpected error occurred.',
      };
    }

    // Add stack trace in development
    if (isDevelopment && statusCode >= 500) {
      errorResponse.stack = error.stack;
    }

    // Add error details in development
    if (isDevelopment) {
      errorResponse.details = {
        name: error.name,
        originalMessage: error.message,
        code: error.code,
        ...errorResponse.details,
      };
    }

    // Log the error
    logError(error, c, requestId);

    return c.json(errorResponse, statusCode);

  } catch (handlerError) {
    // If error handler itself fails
    console.error('❌ Error handler failed:', handlerError);

    return c.json({
      code: 'CRITICAL_ERROR',
      message: 'Critical error in error handling.',
      timestamp: new Date().toISOString(),
      path: c.req.path,
      method: c.req.method,
      requestId,
    }, 500);
  }
};

// Get error code from HTTP status
function getHttpErrorCode(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 405: return 'METHOD_NOT_ALLOWED';
    case 409: return 'CONFLICT';
    case 413: return 'PAYLOAD_TOO_LARGE';
    case 422: return 'UNPROCESSABLE_ENTITY';
    case 429: return 'TOO_MANY_REQUESTS';
    case 500: return 'INTERNAL_SERVER_ERROR';
    case 502: return 'BAD_GATEWAY';
    case 503: return 'SERVICE_UNAVAILABLE';
    case 504: return 'GATEWAY_TIMEOUT';
    default: return 'HTTP_ERROR';
  }
}

// Helper function to create HTTP exceptions
export const createError = (status: number, message: string, code?: string, details?: any): HTTPException => {
  const error = new HTTPException(status, { message });
  if (code) {
    (error as any).code = code;
  }
  if (details) {
    (error as any).details = details;
  }
  return error;
};

// Common error creators
export const badRequest = (message: string = 'Bad Request', details?: any) =>
  createError(400, message, 'BAD_REQUEST', details);

export const unauthorized = (message: string = 'Unauthorized') =>
  createError(401, message, 'UNAUTHORIZED');

export const forbidden = (message: string = 'Forbidden') =>
  createError(403, message, 'FORBIDDEN');

export const notFound = (message: string = 'Not Found', resource?: string) =>
  createError(404, message, 'NOT_FOUND', resource ? { resource } : undefined);

export const conflict = (message: string = 'Conflict') =>
  createError(409, message, 'CONFLICT');

export const unprocessableEntity = (message: string = 'Unprocessable Entity', details?: any) =>
  createError(422, message, 'UNPROCESSABLE_ENTITY', details);

export const tooManyRequests = (message: string = 'Too Many Requests') =>
  createError(429, message, 'TOO_MANY_REQUESTS');

export const internalServerError = (message: string = 'Internal Server Error') =>
  createError(500, message, 'INTERNAL_SERVER_ERROR');

export const serviceUnavailable = (message: string = 'Service Unavailable') =>
  createError(503, message, 'SERVICE_UNAVAILABLE');
