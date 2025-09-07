import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection.js';
import { users, extensions, extensionReviews, extensionInstallations, apiKeys } from '../db/schema.js';
import { eq, desc, asc, count, and, or, like } from 'drizzle-orm';
import { authMiddleware, requireAdmin, getCurrentUser } from '../middleware/auth.js';
import { validationMiddleware, getValidatedQuery, getValidatedBody } from '../middleware/validation.js';
import type { PaginatedResponse, User, Extension } from '../types/index.js';

const adminRoutes = new Hono();

// Apply admin authentication to all routes
adminRoutes.use('*', authMiddleware, requireAdmin);

// GET /stats - Get system statistics
adminRoutes.get('/stats', async (c) => {
  try {
    // Get user statistics
    const userStats = await db
      .select({
        total: count(),
        active: count(users.isActive),
      })
      .from(users);

    const usersByRole = await db
      .select({
        role: users.role,
        count: count(),
      })
      .from(users)
      .where(eq(users.isActive, true))
      .groupBy(users.role);

    // Get extension statistics
    const extensionStats = await db
      .select({
        total: count(),
      })
      .from(extensions);

    const extensionsByStatus = await db
      .select({
        status: extensions.status,
        count: count(),
      })
      .from(extensions)
      .groupBy(extensions.status);

    // Get installation statistics
    const installationStats = await db
      .select({
        total: count(),
      })
      .from(extensionInstallations);

    const installationsByStatus = await db
      .select({
        status: extensionInstallations.status,
        count: count(),
      })
      .from(extensionInstallations)
      .groupBy(extensionInstallations.status);

    // Get review statistics
    const reviewStats = await db
      .select({
        total: count(),
        hidden: count(extensionReviews.isHidden),
      })
      .from(extensionReviews);

    // Get API key statistics
    const apiKeyStats = await db
      .select({
        total: count(),
        active: count(apiKeys.isActive),
      })
      .from(apiKeys);

    return c.json({
      timestamp: new Date().toISOString(),
      users: {
        total: userStats[0]?.total || 0,
        active: userStats[0]?.active || 0,
        byRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item.count;
          return acc;
        }, {} as Record<string, number>),
      },
      extensions: {
        total: extensionStats[0]?.total || 0,
        byStatus: extensionsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {} as Record<string, number>),
      },
      installations: {
        total: installationStats[0]?.total || 0,
        byStatus: installationsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {} as Record<string, number>),
      },
      reviews: {
        total: reviewStats[0]?.total || 0,
        hidden: reviewStats[0]?.hidden || 0,
      },
      apiKeys: {
        total: apiKeyStats[0]?.total || 0,
        active: apiKeyStats[0]?.active || 0,
      },
    });

  } catch (error) {
    console.error('Get admin stats error:', error);
    throw new HTTPException(500, {
      message: 'Failed to retrieve system statistics.',
    });
  }
});

// GET /users - List all users with admin details
adminRoutes.get('/users',
  validationMiddleware.withPagination,
  async (c) => {
    try {
      const query = getValidatedQuery(c) || {};
      const { page = 1, limit = 50, sort = 'created', order = 'desc' } = query;
      const offset = (page - 1) * limit;

      // Build order clause
      let orderBy;
      const isDesc = order === 'desc';

      switch (sort) {
        case 'email':
          orderBy = isDesc ? desc(users.email) : asc(users.email);
          break;
        case 'username':
          orderBy = isDesc ? desc(users.username) : asc(users.username);
          break;
        case 'role':
          orderBy = isDesc ? desc(users.role) : asc(users.role);
          break;
        case 'lastLogin':
          orderBy = isDesc ? desc(users.lastLoginAt) : asc(users.lastLoginAt);
          break;
        case 'created':
        default:
          orderBy = isDesc ? desc(users.createdAt) : asc(users.createdAt);
          break;
      }

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(users);

      const total = totalResult[0]?.count || 0;

      // Get users
      const results = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          avatar: users.avatar,
          isVerified: users.isVerified,
          isActive: users.isActive,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .orderBy(orderBy)
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
      console.error('List users error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve users.',
      });
    }
  }
);

// PUT /users/:id - Update user (admin actions)
adminRoutes.put('/users/:id',
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req.json();
      const { role, isActive, isVerified } = body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (role !== undefined) {
        if (!['user', 'developer', 'admin'].includes(role)) {
          throw new HTTPException(400, {
            message: 'Invalid role. Must be user, developer, or admin.',
          });
        }
        updateData.role = role;
      }

      if (isActive !== undefined) {
        updateData.isActive = Boolean(isActive);
      }

      if (isVerified !== undefined) {
        updateData.isVerified = Boolean(isVerified);
      }

      const updatedUser = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, id))
        .returning();

      const user = updatedUser[0];
      if (!user) {
        throw new HTTPException(404, {
          message: 'User not found.',
        });
      }

      return c.json({
        message: 'User updated successfully!',
        user,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Update user error:', error);
      throw new HTTPException(500, {
        message: 'Failed to update user.',
      });
    }
  }
);

// GET /extensions - List all extensions with admin details
adminRoutes.get('/extensions',
  validationMiddleware.withPagination,
  async (c) => {
    try {
      const query = getValidatedQuery(c) || {};
      const { page = 1, limit = 50, status, sort = 'updated', order = 'desc' } = query;
      const offset = (page - 1) * limit;

      // Build where conditions
      const conditions = [];
      if (status) {
        conditions.push(eq(extensions.status, status as any));
      }

      // Build order clause
      let orderBy;
      const isDesc = order === 'desc';

      switch (sort) {
        case 'name':
          orderBy = isDesc ? desc(extensions.name) : asc(extensions.name);
          break;
        case 'downloads':
          orderBy = isDesc ? desc(extensions.downloadCount) : asc(extensions.downloadCount);
          break;
        case 'rating':
          orderBy = isDesc ? desc(extensions.rating) : asc(extensions.rating);
          break;
        case 'created':
          orderBy = isDesc ? desc(extensions.createdAt) : asc(extensions.createdAt);
          break;
        case 'published':
          orderBy = isDesc ? desc(extensions.lastPublishedAt) : asc(extensions.lastPublishedAt);
          break;
        case 'updated':
        default:
          orderBy = isDesc ? desc(extensions.updatedAt) : asc(extensions.updatedAt);
          break;
      }

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(extensions)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const total = totalResult[0]?.count || 0;

      // Get extensions with author info
      const results = await db
        .select({
          id: extensions.id,
          name: extensions.name,
          slug: extensions.slug,
          displayName: extensions.displayName,
          description: extensions.description,
          authorId: extensions.authorId,
          category: extensions.category,
          status: extensions.status,
          isPublic: extensions.isPublic,
          isFeatured: extensions.isFeatured,
          downloadCount: extensions.downloadCount,
          rating: extensions.rating,
          ratingCount: extensions.ratingCount,
          lastPublishedAt: extensions.lastPublishedAt,
          createdAt: extensions.createdAt,
          updatedAt: extensions.updatedAt,
          // Author info
          author: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            email: users.email,
          },
        })
        .from(extensions)
        .leftJoin(users, eq(extensions.authorId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderBy)
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
      console.error('List extensions error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve extensions.',
      });
    }
  }
);

// PUT /extensions/:id - Update extension (admin actions)
adminRoutes.put('/extensions/:id',
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req.json();
      const { status, isFeatured, isPublic } = body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (status !== undefined) {
        if (!['draft', 'published', 'deprecated', 'suspended'].includes(status)) {
          throw new HTTPException(400, {
            message: 'Invalid status.',
          });
        }
        updateData.status = status;

        // Set published timestamp if changing to published
        if (status === 'published') {
          updateData.lastPublishedAt = new Date();
        }
      }

      if (isFeatured !== undefined) {
        updateData.isFeatured = Boolean(isFeatured);
      }

      if (isPublic !== undefined) {
        updateData.isPublic = Boolean(isPublic);
      }

      const updatedExtension = await db
        .update(extensions)
        .set(updateData)
        .where(eq(extensions.id, id))
        .returning();

      const extension = updatedExtension[0];
      if (!extension) {
        throw new HTTPException(404, {
          message: 'Extension not found.',
        });
      }

      return c.json({
        message: 'Extension updated successfully!',
        extension,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Update extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to update extension.',
      });
    }
  }
);

// GET /reviews - List all reviews with moderation details
adminRoutes.get('/reviews',
  validationMiddleware.withPagination,
  async (c) => {
    try {
      const query = getValidatedQuery(c) || {};
      const { page = 1, limit = 50, reported, hidden, sort = 'created', order = 'desc' } = query;
      const offset = (page - 1) * limit;

      // Build where conditions
      const conditions = [];
      if (reported === 'true') {
        conditions.push(eq(extensionReviews.reportedCount, 0)); // Greater than 0
      }
      if (hidden !== undefined) {
        conditions.push(eq(extensionReviews.isHidden, hidden === 'true'));
      }

      // Build order clause
      let orderBy;
      const isDesc = order === 'desc';

      switch (sort) {
        case 'rating':
          orderBy = isDesc ? desc(extensionReviews.rating) : asc(extensionReviews.rating);
          break;
        case 'helpful':
          orderBy = isDesc ? desc(extensionReviews.helpfulCount) : asc(extensionReviews.helpfulCount);
          break;
        case 'reported':
          orderBy = isDesc ? desc(extensionReviews.reportedCount) : asc(extensionReviews.reportedCount);
          break;
        case 'updated':
          orderBy = isDesc ? desc(extensionReviews.updatedAt) : asc(extensionReviews.updatedAt);
          break;
        case 'created':
        default:
          orderBy = isDesc ? desc(extensionReviews.createdAt) : asc(extensionReviews.createdAt);
          break;
      }

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(extensionReviews)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const total = totalResult[0]?.count || 0;

      // Get reviews with user and extension info
      const results = await db
        .select({
          id: extensionReviews.id,
          extensionId: extensionReviews.extensionId,
          userId: extensionReviews.userId,
          rating: extensionReviews.rating,
          title: extensionReviews.title,
          review: extensionReviews.review,
          isVerified: extensionReviews.isVerified,
          helpfulCount: extensionReviews.helpfulCount,
          reportedCount: extensionReviews.reportedCount,
          isHidden: extensionReviews.isHidden,
          createdAt: extensionReviews.createdAt,
          updatedAt: extensionReviews.updatedAt,
          // User info
          user: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            email: users.email,
          },
          // Extension info
          extension: {
            id: extensions.id,
            name: extensions.name,
            displayName: extensions.displayName,
          },
        })
        .from(extensionReviews)
        .leftJoin(users, eq(extensionReviews.userId, users.id))
        .leftJoin(extensions, eq(extensionReviews.extensionId, extensions.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderBy)
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
      console.error('List reviews error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve reviews.',
      });
    }
  }
);

// PUT /reviews/:id - Moderate review
adminRoutes.put('/reviews/:id',
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req.json();
      const { isHidden, moderationNote } = body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (isHidden !== undefined) {
        updateData.isHidden = Boolean(isHidden);
      }

      // TODO: Add moderation notes to schema
      if (moderationNote !== undefined) {
        // Store moderation note for future reference
        console.log(`Moderation note for review ${id}: ${moderationNote}`);
      }

      const updatedReview = await db
        .update(extensionReviews)
        .set(updateData)
        .where(eq(extensionReviews.id, id))
        .returning();

      const review = updatedReview[0];
      if (!review) {
        throw new HTTPException(404, {
          message: 'Review not found.',
        });
      }

      return c.json({
        message: 'Review updated successfully!',
        review,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Moderate review error:', error);
      throw new HTTPException(500, {
        message: 'Failed to moderate review.',
      });
    }
  }
);

// GET /logs - Get system logs (placeholder)
adminRoutes.get('/logs', async (c) => {
  try {
    // TODO: Implement proper log aggregation and filtering
    // This could read from log files, database, or external log service

    return c.json({
      message: 'Log aggregation not yet implemented.',
      logs: [],
      pagination: {
        page: 1,
        limit: 100,
        total: 0,
        pages: 0,
        hasNext: false,
        hasPrev: false,
      },
    });

  } catch (error) {
    console.error('Get logs error:', error);
    throw new HTTPException(500, {
      message: 'Failed to retrieve logs.',
    });
  }
});

// POST /maintenance - Trigger maintenance tasks
adminRoutes.post('/maintenance', async (c) => {
  try {
    const body = await c.req.json();
    const { task } = body;

    if (!task) {
      throw new HTTPException(400, {
        message: 'Maintenance task is required.',
      });
    }

    const results: any = {};

    switch (task) {
      case 'cleanup_files':
        // TODO: Implement file cleanup
        results.cleanupFiles = 'File cleanup not yet implemented';
        break;

      case 'update_statistics':
        // TODO: Implement statistics update
        results.updateStatistics = 'Statistics update not yet implemented';
        break;

      case 'rebuild_search_index':
        // TODO: Implement search index rebuild
        results.rebuildSearchIndex = 'Search index rebuild not yet implemented';
        break;

      default:
        throw new HTTPException(400, {
          message: `Unknown maintenance task: ${task}`,
        });
    }

    return c.json({
      message: 'Maintenance task completed!',
      task,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error('Maintenance task error:', error);
    throw new HTTPException(500, {
      message: 'Failed to execute maintenance task.',
    });
  }
});

export default adminRoutes;
