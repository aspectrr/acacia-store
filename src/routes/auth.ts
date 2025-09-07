import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { validationMiddleware, getValidatedBody } from '../middleware/validation.js';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import type { CreateUserRequest, LoginRequest, AuthResponse, User } from '../types/index.js';

const auth = new Hono();

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12');

// Helper function to generate JWT token
function generateToken(user: User): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Helper function to create auth response
function createAuthResponse(user: User): AuthResponse {
  const token = generateToken(user);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      avatar: user.avatar,
      bio: user.bio,
      website: user.website,
      github: user.github,
      twitter: user.twitter,
      isVerified: user.isVerified,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    token,
    expiresIn: JWT_EXPIRES_IN,
  };
}

// POST /register - Register a new user
auth.post('/register',
  authRateLimit,
  validationMiddleware.register,
  async (c) => {
    try {
      const body = getValidatedBody<CreateUserRequest>(c);
      if (!body) {
        throw new HTTPException(400, { message: 'Invalid request body' });
      }

      const { email, username, password, displayName } = body;

      // Check if user already exists
      const existingUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (existingUser.length > 0) {
        throw new HTTPException(409, {
          message: 'A user with this email address already exists.',
        });
      }

      // Check if username is taken
      const existingUsername = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username.toLowerCase()))
        .limit(1);

      if (existingUsername.length > 0) {
        throw new HTTPException(409, {
          message: 'This username is already taken.',
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

      // Create user
      const newUser = await db
        .insert(users)
        .values({
          email: email.toLowerCase(),
          username: username.toLowerCase(),
          displayName: displayName || username,
          passwordHash,
          role: 'user',
          isActive: true,
          isVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          avatar: users.avatar,
          bio: users.bio,
          website: users.website,
          github: users.github,
          twitter: users.twitter,
          isVerified: users.isVerified,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });

      const user = newUser[0];
      if (!user) {
        throw new HTTPException(500, {
          message: 'Failed to create user account.',
        });
      }

      const authResponse = createAuthResponse(user);

      return c.json({
        message: 'Account created successfully!',
        ...authResponse,
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Registration error:', error);
      throw new HTTPException(500, {
        message: 'Failed to create account. Please try again.',
      });
    }
  }
);

// POST /login - Authenticate user
auth.post('/login',
  authRateLimit,
  validationMiddleware.login,
  async (c) => {
    try {
      const body = getValidatedBody<LoginRequest>(c);
      if (!body) {
        throw new HTTPException(400, { message: 'Invalid request body' });
      }

      const { email, password } = body;

      // Find user by email
      const userResult = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          passwordHash: users.passwordHash,
          role: users.role,
          avatar: users.avatar,
          bio: users.bio,
          website: users.website,
          github: users.github,
          twitter: users.twitter,
          isVerified: users.isVerified,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      const user = userResult[0];
      if (!user) {
        throw new HTTPException(401, {
          message: 'Invalid email or password.',
        });
      }

      // Check if user account is active
      if (!user.isActive) {
        throw new HTTPException(403, {
          message: 'Your account has been deactivated. Please contact support.',
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        throw new HTTPException(401, {
          message: 'Invalid email or password.',
        });
      }

      // Update last login timestamp
      await db
        .update(users)
        .set({
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      // Remove password hash from user object
      const { passwordHash, ...userWithoutPassword } = user;
      const userWithLastLogin = {
        ...userWithoutPassword,
        lastLoginAt: new Date(),
      };

      const authResponse = createAuthResponse(userWithLastLogin);

      return c.json({
        message: 'Login successful!',
        ...authResponse,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Login error:', error);
      throw new HTTPException(500, {
        message: 'Failed to authenticate. Please try again.',
      });
    }
  }
);

// GET /me - Get current user profile
auth.get('/me',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, {
          message: 'Authentication required.',
        });
      }

      // Get fresh user data from database
      const userResult = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          avatar: users.avatar,
          bio: users.bio,
          website: users.website,
          github: users.github,
          twitter: users.twitter,
          isVerified: users.isVerified,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const currentUser = userResult[0];
      if (!currentUser) {
        throw new HTTPException(404, {
          message: 'User not found.',
        });
      }

      return c.json({
        user: currentUser,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Get profile error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve user profile.',
      });
    }
  }
);

// POST /refresh - Refresh JWT token
auth.post('/refresh',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, {
          message: 'Authentication required.',
        });
      }

      // Get fresh user data from database
      const userResult = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          avatar: users.avatar,
          bio: users.bio,
          website: users.website,
          github: users.github,
          twitter: users.twitter,
          isVerified: users.isVerified,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const currentUser = userResult[0];
      if (!currentUser || !currentUser.isActive) {
        throw new HTTPException(401, {
          message: 'User account not found or inactive.',
        });
      }

      const authResponse = createAuthResponse(currentUser);

      return c.json({
        message: 'Token refreshed successfully!',
        ...authResponse,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Token refresh error:', error);
      throw new HTTPException(500, {
        message: 'Failed to refresh token.',
      });
    }
  }
);

// POST /logout - Logout user (mainly for logging purposes)
auth.post('/logout',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);

      // In a JWT-based system, logout is mainly client-side
      // We can log the logout event for analytics
      console.log(`User ${user?.username} (${user?.id}) logged out`);

      return c.json({
        message: 'Logged out successfully!',
      });

    } catch (error) {
      console.error('Logout error:', error);

      // Even if there's an error, we should return success for logout
      return c.json({
        message: 'Logged out successfully!',
      });
    }
  }
);

// GET /verify-email/:token - Verify email address (placeholder for future implementation)
auth.get('/verify-email/:token', async (c) => {
  const token = c.req.param('token');

  // TODO: Implement email verification logic
  // This would typically involve:
  // 1. Validate the verification token
  // 2. Update user's isVerified status
  // 3. Return success/error response

  return c.json({
    message: 'Email verification is not yet implemented.',
    token,
  }, 501);
});

// POST /forgot-password - Request password reset (placeholder for future implementation)
auth.post('/forgot-password', async (c) => {
  // TODO: Implement password reset logic
  // This would typically involve:
  // 1. Validate email address
  // 2. Generate reset token
  // 3. Send reset email
  // 4. Store reset token in database

  return c.json({
    message: 'Password reset is not yet implemented.',
  }, 501);
});

// POST /reset-password - Reset password with token (placeholder for future implementation)
auth.post('/reset-password', async (c) => {
  // TODO: Implement password reset logic
  // This would typically involve:
  // 1. Validate reset token
  // 2. Hash new password
  // 3. Update user password
  // 4. Invalidate reset token

  return c.json({
    message: 'Password reset is not yet implemented.',
  }, 501);
});

export default auth;
