import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection.js';
import { users, extensions, extensionInstallations, apiKeys } from '../db/schema.js';
import { eq, desc, and, count } from 'drizzle-orm';
import { authMiddleware, getCurrentUser, requireOwnershipOrAdmin } from '../middleware/auth.js';
import { validationMiddleware, getValidatedBody, getValidatedQuery } from '../middleware/validation.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type {
  User,
  CreateApiKeyRequest,
  ApiKey,
  PaginatedResponse
} from '../types/index.js';

const userRoutes = new Hono();

// Helper function to get user owner (for API keys, etc.)
const getUserOwner = async (c: any): Promise<string> => {
  const user = getCurrentUser(c);
  if (!user) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  return user.id;
};

// GET /:username - Get public user profile
userRoutes.get('/:username', async (c) => {
  try {
    const username = c.req.param('username');

    const userResult = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatar: users.avatar,
        bio: users.bio,
        website: users.website,
        github: users.github,
        twitter: users.twitter,
        isVerified: users.isVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(
        eq(users.username, username.toLowerCase()),
        eq(users.isActive, true)
      ))
      .limit(1);

    const user = userResult[0];
    if (!user) {
      throw new HTTPException(404, {
        message: 'User not found.',
      });
    }

    // Get user's public extensions
    const extensionsResult = await db
      .select({
        id: extensions.id,
        name: extensions.name,
        displayName: extensions.displayName,
        description: extensions.description,
        icon: extensions.icon,
        category: extensions.category,
        tags: extensions.tags,
        downloadCount: extensions.downloadCount,
        rating: extensions.rating,
        ratingCount: extensions.ratingCount,
        lastPublishedAt: extensions.lastPublishedAt,
        createdAt: extensions.createdAt,
      })
      .from(extensions)
      .where(and(
        eq(extensions.authorId, user.id),
        eq(extensions.status, 'published'),
        eq(extensions.isPublic, true)
      ))
      .orderBy(desc(extensions.downloadCount))
      .limit(10);

    return c.json({
      user,
      extensions: extensionsResult,
      stats: {
        totalExtensions: extensionsResult.length,
        totalDownloads: extensionsResult.reduce((sum, ext) => sum + ext.downloadCount, 0),
      },
    });

  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error('Get user profile error:', error);
    throw new HTTPException(500, {
      message: 'Failed to retrieve user profile.',
    });
  }
});

// PUT /me - Update current user's profile
userRoutes.put('/me',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = await c.req.json();
      const {
        displayName,
        bio,
        website,
        github,
        twitter,
        avatar
      } = body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (displayName !== undefined) {
        if (displayName.length > 100) {
          throw new HTTPException(400, {
            message: 'Display name must be less than 100 characters.',
          });
        }
        updateData.displayName = displayName;
      }

      if (bio !== undefined) {
        if (bio.length > 500) {
          throw new HTTPException(400, {
            message: 'Bio must be less than 500 characters.',
          });
        }
        updateData.bio = bio;
      }

      if (website !== undefined) {
        if (website && !isValidUrl(website)) {
          throw new HTTPException(400, {
            message: 'Invalid website URL.',
          });
        }
        updateData.website = website;
      }

      if (github !== undefined) {
        if (github && (github.length > 100 || !/^[a-zA-Z0-9-_]+$/.test(github))) {
          throw new HTTPException(400, {
            message: 'Invalid GitHub username.',
          });
        }
        updateData.github = github;
      }

      if (twitter !== undefined) {
        if (twitter && (twitter.length > 100 || !/^[a-zA-Z0-9_]+$/.test(twitter))) {
          throw new HTTPException(400, {
            message: 'Invalid Twitter username.',
          });
        }
        updateData.twitter = twitter;
      }

      if (avatar !== undefined) {
        if (avatar && !isValidUrl(avatar)) {
          throw new HTTPException(400, {
            message: 'Invalid avatar URL.',
          });
        }
        updateData.avatar = avatar;
      }

      const updatedUser = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, user.id))
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

      const updatedUserData = updatedUser[0];
      if (!updatedUserData) {
        throw new HTTPException(404, {
          message: 'User not found.',
        });
      }

      return c.json({
        message: 'Profile updated successfully!',
        user: updatedUserData,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Update profile error:', error);
      throw new HTTPException(500, {
        message: 'Failed to update profile.',
      });
    }
  }
);

// GET /me/extensions - Get current user's extensions
userRoutes.get('/me/extensions',
  authMiddleware,
  validationMiddleware.withPagination,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const query = getValidatedQuery(c) || {};
      const { page = 1, limit = 20 } = query;
      const offset = (page - 1) * limit;

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(extensions)
        .where(eq(extensions.authorId, user.id));

      const total = totalResult[0]?.count || 0;

      // Get user's extensions
      const results = await db
        .select()
        .from(extensions)
        .where(eq(extensions.authorId, user.id))
        .orderBy(desc(extensions.updatedAt))
        .limit(limit)
        .offset(offset);

      const response: PaginatedResponse<any> = {
        data: results,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };

      return c.json(response);

    } catch (error) {
      console.error('Get user extensions error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve extensions.',
      });
    }
  }
);

// GET /me/installations - Get current user's installations
userRoutes.get('/me/installations',
  authMiddleware,
  validationMiddleware.withPagination,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const query = getValidatedQuery(c) || {};
      const { page = 1, limit = 20 } = query;
      const offset = (page - 1) * limit;

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(extensionInstallations)
        .where(eq(extensionInstallations.userId, user.id));

      const total = totalResult[0]?.count || 0;

      // Get installations with extension details
      const results = await db
        .select({
          id: extensionInstallations.id,
          status: extensionInstallations.status,
          installedAt: extensionInstallations.installedAt,
          lastUsedAt: extensionInstallations.lastUsedAt,
          createdAt: extensionInstallations.createdAt,
          extension: {
            id: extensions.id,
            name: extensions.name,
            displayName: extensions.displayName,
            description: extensions.description,
            icon: extensions.icon,
            category: extensions.category,
          },
        })
        .from(extensionInstallations)
        .leftJoin(extensions, eq(extensionInstallations.extensionId, extensions.id))
        .where(eq(extensionInstallations.userId, user.id))
        .orderBy(desc(extensionInstallations.createdAt))
        .limit(limit)
        .offset(offset);

      const response: PaginatedResponse<any> = {
        data: results,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      };

      return c.json(response);

    } catch (error) {
      console.error('Get user installations error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve installations.',
      });
    }
  }
);

// GET /me/api-keys - Get current user's API keys
userRoutes.get('/me/api-keys',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const keys = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPreview: apiKeys.keyPreview,
          permissions: apiKeys.permissions,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          isActive: apiKeys.isActive,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, user.id))
        .orderBy(desc(apiKeys.createdAt));

      return c.json({ apiKeys: keys });

    } catch (error) {
      console.error('Get API keys error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve API keys.',
      });
    }
  }
);

// POST /me/api-keys - Create new API key
userRoutes.post('/me/api-keys',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = await c.req.json();
      const { name, permissions, expiresAt } = body;

      if (!name || name.length < 1 || name.length > 100) {
        throw new HTTPException(400, {
          message: 'API key name must be between 1 and 100 characters.',
        });
      }

      if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
        throw new HTTPException(400, {
          message: 'At least one permission is required.',
        });
      }

      // Generate API key
      const apiKey = `ak_${uuidv4().replace(/-/g, '')}`;
      const keyHash = await bcrypt.hash(apiKey, 12);
      const keyPreview = `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`;

      const newApiKey = await db
        .insert(apiKeys)
        .values({
          userId: user.id,
          name,
          keyHash,
          keyPreview,
          permissions,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          isActive: true,
          createdAt: new Date(),
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPreview: apiKeys.keyPreview,
          permissions: apiKeys.permissions,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        });

      const createdKey = newApiKey[0];
      if (!createdKey) {
        throw new HTTPException(500, { message: 'Failed to create API key' });
      }

      return c.json({
        message: 'API key created successfully!',
        apiKey: {
          ...createdKey,
          key: apiKey, // Only returned once during creation
        },
        warning: 'Store this API key securely. You will not be able to see it again.',
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Create API key error:', error);
      throw new HTTPException(500, {
        message: 'Failed to create API key.',
      });
    }
  }
);

// DELETE /me/api-keys/:id - Delete API key
userRoutes.delete('/me/api-keys/:id',
  authMiddleware,
  validationMiddleware.withId,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const { id } = c.req.param();

      const deletedKey = await db
        .delete(apiKeys)
        .where(and(
          eq(apiKeys.id, id),
          eq(apiKeys.userId, user.id)
        ))
        .returning();

      const apiKey = deletedKey[0];
      if (!apiKey) {
        throw new HTTPException(404, {
          message: 'API key not found.',
        });
      }

      return c.json({
        message: 'API key deleted successfully!',
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Delete API key error:', error);
      throw new HTTPException(500, {
        message: 'Failed to delete API key.',
      });
    }
  }
);

// Helper function to validate URLs
function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

export default userRoutes;
