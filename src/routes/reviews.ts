import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection.js';
import { extensionReviews, extensions, users, extensionVersions } from '../db/schema.js';
import { eq, desc, and, count, avg, sql } from 'drizzle-orm';
import { authMiddleware, optionalAuthMiddleware, getCurrentUser, requireOwnershipOrAdmin } from '../middleware/auth.js';
import { validationMiddleware, getValidatedBody, getValidatedQuery } from '../middleware/validation.js';
import type {
  ExtensionReview,
  CreateReviewRequest,
  PaginatedResponse
} from '../types/index.js';

const reviewRoutes = new Hono();

// Helper function to get review owner
const getReviewOwner = async (c: any): Promise<string> => {
  const { id } = c.req.param();

  const result = await db
    .select({ userId: extensionReviews.userId })
    .from(extensionReviews)
    .where(eq(extensionReviews.id, id))
    .limit(1);

  const review = result[0];
  if (!review) {
    throw new HTTPException(404, { message: 'Review not found' });
  }

  return review.userId;
};

// Helper function to update extension rating
async function updateExtensionRating(extensionId: string) {
  try {
    // Calculate average rating
    const ratingResult = await db
      .select({
        avgRating: avg(extensionReviews.rating),
        count: count(extensionReviews.id),
      })
      .from(extensionReviews)
      .where(and(
        eq(extensionReviews.extensionId, extensionId),
        eq(extensionReviews.isHidden, false)
      ));

    const stats = ratingResult[0];
    const averageRating = Math.round((stats.avgRating || 0) * 100); // Store as integer (rating * 100)
    const ratingCount = stats.count || 0;

    // Update extension
    await db
      .update(extensions)
      .set({
        rating: averageRating,
        ratingCount: ratingCount,
        updatedAt: new Date(),
      })
      .where(eq(extensions.id, extensionId));

  } catch (error) {
    console.error('Failed to update extension rating:', error);
  }
}

// GET /extensions/:extensionId/reviews - List reviews for an extension
reviewRoutes.get('/extensions/:extensionId/reviews',
  optionalAuthMiddleware,
  validationMiddleware.withPagination,
  async (c) => {
    try {
      const extensionId = c.req.param('extensionId');
      const currentUser = getCurrentUser(c);

      // Check if extension exists
      const extensionResult = await db
        .select({
          id: extensions.id,
          isPublic: extensions.isPublic,
          status: extensions.status,
        })
        .from(extensions)
        .where(eq(extensions.id, extensionId))
        .limit(1);

      const extension = extensionResult[0];
      if (!extension) {
        throw new HTTPException(404, {
          message: 'Extension not found.',
        });
      }

      if (!extension.isPublic && extension.status !== 'published') {
        throw new HTTPException(403, {
          message: 'Reviews are not available for this extension.',
        });
      }

      const query = getValidatedQuery(c) || {};
      const { page = 1, limit = 20, sort = 'created', order = 'desc' } = query;
      const offset = (page - 1) * limit;

      // Build order clause
      let orderBy;
      const isDesc = order === 'desc';

      switch (sort) {
        case 'rating':
          orderBy = isDesc ? desc(extensionReviews.rating) : extensionReviews.rating;
          break;
        case 'helpful':
          orderBy = isDesc ? desc(extensionReviews.helpfulCount) : extensionReviews.helpfulCount;
          break;
        case 'updated':
          orderBy = isDesc ? desc(extensionReviews.updatedAt) : extensionReviews.updatedAt;
          break;
        case 'created':
        default:
          orderBy = isDesc ? desc(extensionReviews.createdAt) : extensionReviews.createdAt;
          break;
      }

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(extensionReviews)
        .where(and(
          eq(extensionReviews.extensionId, extensionId),
          eq(extensionReviews.isHidden, false)
        ));

      const total = totalResult[0]?.count || 0;

      // Get reviews with user details
      const results = await db
        .select({
          id: extensionReviews.id,
          extensionId: extensionReviews.extensionId,
          versionId: extensionReviews.versionId,
          userId: extensionReviews.userId,
          rating: extensionReviews.rating,
          title: extensionReviews.title,
          review: extensionReviews.review,
          isVerified: extensionReviews.isVerified,
          helpfulCount: extensionReviews.helpfulCount,
          reportedCount: extensionReviews.reportedCount,
          createdAt: extensionReviews.createdAt,
          updatedAt: extensionReviews.updatedAt,
          // User info
          user: {
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            avatar: users.avatar,
            isVerified: users.isVerified,
          },
          // Version info if available
          version: {
            id: extensionVersions.id,
            version: extensionVersions.version,
          },
        })
        .from(extensionReviews)
        .leftJoin(users, eq(extensionReviews.userId, users.id))
        .leftJoin(extensionVersions, eq(extensionReviews.versionId, extensionVersions.id))
        .where(and(
          eq(extensionReviews.extensionId, extensionId),
          eq(extensionReviews.isHidden, false)
        ))
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
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('List reviews error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve reviews.',
      });
    }
  }
);

// POST /extensions/:extensionId/reviews - Create a new review
reviewRoutes.post('/extensions/:extensionId/reviews',
  authMiddleware,
  validationMiddleware.createReview,
  async (c) => {
    try {
      const extensionId = c.req.param('extensionId');
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = getValidatedBody<CreateReviewRequest>(c);
      if (!body) {
        throw new HTTPException(400, { message: 'Invalid request body' });
      }

      const { rating, title, review, versionId } = body;

      // Check if extension exists and is public
      const extensionResult = await db
        .select({
          id: extensions.id,
          isPublic: extensions.isPublic,
          status: extensions.status,
          authorId: extensions.authorId,
        })
        .from(extensions)
        .where(eq(extensions.id, extensionId))
        .limit(1);

      const extension = extensionResult[0];
      if (!extension) {
        throw new HTTPException(404, {
          message: 'Extension not found.',
        });
      }

      if (!extension.isPublic || extension.status !== 'published') {
        throw new HTTPException(403, {
          message: 'Cannot review this extension.',
        });
      }

      // Prevent authors from reviewing their own extensions
      if (extension.authorId === user.id) {
        throw new HTTPException(403, {
          message: 'You cannot review your own extension.',
        });
      }

      // Check if user already reviewed this extension
      const existingReview = await db
        .select({ id: extensionReviews.id })
        .from(extensionReviews)
        .where(and(
          eq(extensionReviews.extensionId, extensionId),
          eq(extensionReviews.userId, user.id)
        ))
        .limit(1);

      if (existingReview.length > 0) {
        throw new HTTPException(409, {
          message: 'You have already reviewed this extension.',
        });
      }

      // Validate version if provided
      if (versionId) {
        const versionResult = await db
          .select({ id: extensionVersions.id })
          .from(extensionVersions)
          .where(and(
            eq(extensionVersions.id, versionId),
            eq(extensionVersions.extensionId, extensionId)
          ))
          .limit(1);

        if (versionResult.length === 0) {
          throw new HTTPException(404, {
            message: 'Specified version not found.',
          });
        }
      }

      // Create review
      const newReview = await db
        .insert(extensionReviews)
        .values({
          extensionId,
          versionId: versionId || null,
          userId: user.id,
          rating,
          title: title || null,
          review: review || null,
          isVerified: false, // TODO: Set based on verified installation
          helpfulCount: 0,
          reportedCount: 0,
          isHidden: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const createdReview = newReview[0];
      if (!createdReview) {
        throw new HTTPException(500, { message: 'Failed to create review' });
      }

      // Update extension rating
      await updateExtensionRating(extensionId);

      return c.json({
        message: 'Review created successfully!',
        review: createdReview,
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Create review error:', error);
      throw new HTTPException(500, {
        message: 'Failed to create review.',
      });
    }
  }
);

// GET /reviews/:id - Get specific review
reviewRoutes.get('/reviews/:id',
  optionalAuthMiddleware,
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();

      const result = await db
        .select({
          id: extensionReviews.id,
          extensionId: extensionReviews.extensionId,
          versionId: extensionReviews.versionId,
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
            avatar: users.avatar,
            isVerified: users.isVerified,
          },
          // Extension info
          extension: {
            id: extensions.id,
            name: extensions.name,
            displayName: extensions.displayName,
          },
          // Version info if available
          version: {
            id: extensionVersions.id,
            version: extensionVersions.version,
          },
        })
        .from(extensionReviews)
        .leftJoin(users, eq(extensionReviews.userId, users.id))
        .leftJoin(extensions, eq(extensionReviews.extensionId, extensions.id))
        .leftJoin(extensionVersions, eq(extensionReviews.versionId, extensionVersions.id))
        .where(eq(extensionReviews.id, id))
        .limit(1);

      const review = result[0];
      if (!review) {
        throw new HTTPException(404, {
          message: 'Review not found.',
        });
      }

      if (review.isHidden) {
        const currentUser = getCurrentUser(c);
        const canView = currentUser?.id === review.userId || currentUser?.role === 'admin';

        if (!canView) {
          throw new HTTPException(404, {
            message: 'Review not found.',
          });
        }
      }

      return c.json({ review });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Get review error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve review.',
      });
    }
  }
);

// PUT /reviews/:id - Update review
reviewRoutes.put('/reviews/:id',
  authMiddleware,
  validationMiddleware.withId,
  requireOwnershipOrAdmin(getReviewOwner),
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req.json();
      const { rating, title, review } = body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (rating !== undefined) {
        if (rating < 1 || rating > 5) {
          throw new HTTPException(400, {
            message: 'Rating must be between 1 and 5.',
          });
        }
        updateData.rating = rating;
      }

      if (title !== undefined) {
        if (title && title.length > 200) {
          throw new HTTPException(400, {
            message: 'Title must be less than 200 characters.',
          });
        }
        updateData.title = title;
      }

      if (review !== undefined) {
        if (review && review.length > 2000) {
          throw new HTTPException(400, {
            message: 'Review must be less than 2000 characters.',
          });
        }
        updateData.review = review;
      }

      const updatedReview = await db
        .update(extensionReviews)
        .set(updateData)
        .where(eq(extensionReviews.id, id))
        .returning();

      const reviewData = updatedReview[0];
      if (!reviewData) {
        throw new HTTPException(404, {
          message: 'Review not found.',
        });
      }

      // Update extension rating if rating was changed
      if (rating !== undefined) {
        await updateExtensionRating(reviewData.extensionId);
      }

      return c.json({
        message: 'Review updated successfully!',
        review: reviewData,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Update review error:', error);
      throw new HTTPException(500, {
        message: 'Failed to update review.',
      });
    }
  }
);

// DELETE /reviews/:id - Delete review
reviewRoutes.delete('/reviews/:id',
  authMiddleware,
  validationMiddleware.withId,
  requireOwnershipOrAdmin(getReviewOwner),
  async (c) => {
    try {
      const { id } = c.req.param();

      const deletedReview = await db
        .delete(extensionReviews)
        .where(eq(extensionReviews.id, id))
        .returning({
          extensionId: extensionReviews.extensionId,
        });

      const review = deletedReview[0];
      if (!review) {
        throw new HTTPException(404, {
          message: 'Review not found.',
        });
      }

      // Update extension rating
      await updateExtensionRating(review.extensionId);

      return c.json({
        message: 'Review deleted successfully!',
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Delete review error:', error);
      throw new HTTPException(500, {
        message: 'Failed to delete review.',
      });
    }
  }
);

// POST /reviews/:id/helpful - Mark review as helpful
reviewRoutes.post('/reviews/:id/helpful',
  authMiddleware,
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      // TODO: In a real implementation, you'd track which users marked which reviews as helpful
      // For now, just increment the helpful count

      const updatedReview = await db
        .update(extensionReviews)
        .set({
          helpfulCount: sql`${extensionReviews.helpfulCount} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(extensionReviews.id, id),
          eq(extensionReviews.isHidden, false)
        ))
        .returning();

      const review = updatedReview[0];
      if (!review) {
        throw new HTTPException(404, {
          message: 'Review not found.',
        });
      }

      return c.json({
        message: 'Review marked as helpful!',
        helpfulCount: review.helpfulCount,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Mark helpful error:', error);
      throw new HTTPException(500, {
        message: 'Failed to mark review as helpful.',
      });
    }
  }
);

// POST /reviews/:id/report - Report a review
reviewRoutes.post('/reviews/:id/report',
  authMiddleware,
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = await c.req.json();
      const { reason } = body;

      if (!reason || reason.length < 10 || reason.length > 500) {
        throw new HTTPException(400, {
          message: 'Report reason must be between 10 and 500 characters.',
        });
      }

      // TODO: In a real implementation, you'd track reports and potentially auto-hide reviews
      // For now, just increment the reported count

      const updatedReview = await db
        .update(extensionReviews)
        .set({
          reportedCount: sql`${extensionReviews.reportedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(extensionReviews.id, id))
        .returning();

      const review = updatedReview[0];
      if (!review) {
        throw new HTTPException(404, {
          message: 'Review not found.',
        });
      }

      return c.json({
        message: 'Review reported successfully. Thank you for helping maintain our community standards.',
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Report review error:', error);
      throw new HTTPException(500, {
        message: 'Failed to report review.',
      });
    }
  }
);

export default reviewRoutes;
