import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection.js';
import { extensions, extensionVersions, users, extensionInstallations } from '../db/schema.js';
import { eq, desc, asc, like, and, or, inArray, count, sql } from 'drizzle-orm';
import { authMiddleware, optionalAuthMiddleware, getCurrentUser, requireOwnershipOrAdmin } from '../middleware/auth.js';
import { validationMiddleware, getValidatedBody, getValidatedQuery, getValidatedParam } from '../middleware/validation.js';
import { uploadRateLimit } from '../middleware/rateLimit.js';
import type {
  Extension,
  ExtensionWithAuthor,
  ExtensionVersion,
  CreateExtensionRequest,
  UpdateExtensionRequest,
  PublishVersionRequest,
  SearchExtensionsQuery,
  PaginatedResponse
} from '../types/index.js';

const extensionRoutes = new Hono();

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Helper function to get extension owner ID
const getExtensionOwner = async (c: any): Promise<string> => {
  const { id } = c.req.param();

  const result = await db
    .select({ authorId: extensions.authorId })
    .from(extensions)
    .where(eq(extensions.id, id))
    .limit(1);

  const extension = result[0];
  if (!extension) {
    throw new HTTPException(404, { message: 'Extension not found' });
  }

  return extension.authorId;
};

// GET / - List extensions with search and filtering
extensionRoutes.get('/',
  optionalAuthMiddleware,
  validationMiddleware.searchExtensions,
  async (c) => {
    try {
      const query = getValidatedQuery<SearchExtensionsQuery>(c) || {};
      const {
        query: searchQuery,
        category,
        tags,
        author,
        status = 'published',
        featured,
        sortBy = 'updated',
        sortOrder = 'desc',
        page = 1,
        limit = 20
      } = query;

      const currentUser = getCurrentUser(c);
      const offset = (page - 1) * limit;

      // Build where conditions
      const conditions = [];

      // Only show published extensions to non-owners
      if (!currentUser || currentUser.role !== 'admin') {
        conditions.push(eq(extensions.status, 'published'));
        conditions.push(eq(extensions.isPublic, true));
      } else if (status) {
        conditions.push(eq(extensions.status, status as any));
      }

      // Search query
      if (searchQuery) {
        conditions.push(
          or(
            like(extensions.name, `%${searchQuery}%`),
            like(extensions.displayName, `%${searchQuery}%`),
            like(extensions.description, `%${searchQuery}%`)
          )
        );
      }

      // Category filter
      if (category) {
        conditions.push(eq(extensions.category, category));
      }

      // Tags filter
      if (tags && tags.length > 0) {
        const tagArray = Array.isArray(tags) ? tags : [tags];
        conditions.push(
          sql`${extensions.tags} && ${JSON.stringify(tagArray)}`
        );
      }

      // Author filter
      if (author) {
        const authorResult = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, author))
          .limit(1);

        if (authorResult[0]) {
          conditions.push(eq(extensions.authorId, authorResult[0].id));
        }
      }

      // Featured filter
      if (featured !== undefined) {
        conditions.push(eq(extensions.isFeatured, featured));
      }

      // Build sort order
      let orderBy;
      const isDesc = sortOrder === 'desc';

      switch (sortBy) {
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
        case 'updated':
        default:
          orderBy = isDesc ? desc(extensions.updatedAt) : asc(extensions.updatedAt);
          break;
      }

      // Get total count
      const totalResult = await db
        .select({ count: count() })
        .from(extensions)
        .leftJoin(users, eq(extensions.authorId, users.id))
        .where(and(...conditions));

      const total = totalResult[0]?.count || 0;

      // Get extensions
      const results = await db
        .select({
          id: extensions.id,
          name: extensions.name,
          slug: extensions.slug,
          displayName: extensions.displayName,
          description: extensions.description,
          longDescription: extensions.longDescription,
          authorId: extensions.authorId,
          category: extensions.category,
          tags: extensions.tags,
          icon: extensions.icon,
          banner: extensions.banner,
          screenshots: extensions.screenshots,
          homepage: extensions.homepage,
          repository: extensions.repository,
          documentation: extensions.documentation,
          license: extensions.license,
          keywords: extensions.keywords,
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
            avatar: users.avatar,
          },
        })
        .from(extensions)
        .leftJoin(users, eq(extensions.authorId, users.id))
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      const response: PaginatedResponse<ExtensionWithAuthor> = {
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

// POST / - Create new extension
extensionRoutes.post('/',
  authMiddleware,
  validationMiddleware.createExtension,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = getValidatedBody<CreateExtensionRequest>(c);
      if (!body) {
        throw new HTTPException(400, { message: 'Invalid request body' });
      }

      const slug = generateSlug(body.name);

      // Check if slug already exists
      const existingExtension = await db
        .select({ id: extensions.id })
        .from(extensions)
        .where(eq(extensions.slug, slug))
        .limit(1);

      if (existingExtension.length > 0) {
        throw new HTTPException(409, {
          message: 'An extension with this name already exists.',
        });
      }

      // Create extension
      const newExtension = await db
        .insert(extensions)
        .values({
          name: body.name,
          slug,
          displayName: body.displayName || body.name,
          description: body.description,
          longDescription: body.longDescription,
          authorId: user.id,
          category: body.category,
          tags: body.tags || [],
          homepage: body.homepage,
          repository: body.repository,
          documentation: body.documentation,
          license: body.license || 'MIT',
          keywords: body.keywords || [],
          status: 'draft',
          isPublic: false,
          isFeatured: false,
          downloadCount: 0,
          rating: 0,
          ratingCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const extension = newExtension[0];
      if (!extension) {
        throw new HTTPException(500, { message: 'Failed to create extension' });
      }

      return c.json({
        message: 'Extension created successfully!',
        extension,
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Create extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to create extension.',
      });
    }
  }
);

// GET /:id - Get extension by ID
extensionRoutes.get('/:id',
  optionalAuthMiddleware,
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const currentUser = getCurrentUser(c);

      const result = await db
        .select({
          id: extensions.id,
          name: extensions.name,
          slug: extensions.slug,
          displayName: extensions.displayName,
          description: extensions.description,
          longDescription: extensions.longDescription,
          authorId: extensions.authorId,
          category: extensions.category,
          tags: extensions.tags,
          icon: extensions.icon,
          banner: extensions.banner,
          screenshots: extensions.screenshots,
          homepage: extensions.homepage,
          repository: extensions.repository,
          documentation: extensions.documentation,
          license: extensions.license,
          keywords: extensions.keywords,
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
            avatar: users.avatar,
          },
        })
        .from(extensions)
        .leftJoin(users, eq(extensions.authorId, users.id))
        .where(eq(extensions.id, id))
        .limit(1);

      const extension = result[0];
      if (!extension) {
        throw new HTTPException(404, {
          message: 'Extension not found.',
        });
      }

      // Check visibility permissions
      const canView = extension.isPublic ||
                     extension.status === 'published' ||
                     currentUser?.id === extension.authorId ||
                     currentUser?.role === 'admin';

      if (!canView) {
        throw new HTTPException(403, {
          message: 'Access denied. Extension is not public.',
        });
      }

      // Get installation status for current user
      let installationStatus = null;
      if (currentUser) {
        const installationResult = await db
          .select({
            status: extensionInstallations.status,
            installedAt: extensionInstallations.installedAt
          })
          .from(extensionInstallations)
          .where(
            and(
              eq(extensionInstallations.userId, currentUser.id),
              eq(extensionInstallations.extensionId, id)
            )
          )
          .limit(1);

        installationStatus = installationResult[0] || null;
      }

      return c.json({
        extension,
        installationStatus,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Get extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve extension.',
      });
    }
  }
);

// PUT /:id - Update extension
extensionRoutes.put('/:id',
  authMiddleware,
  validationMiddleware.updateExtension,
  requireOwnershipOrAdmin(getExtensionOwner),
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = getValidatedBody<UpdateExtensionRequest>(c);
      if (!body) {
        throw new HTTPException(400, { message: 'Invalid request body' });
      }

      const updateData: any = {
        ...body,
        updatedAt: new Date(),
      };

      // If status is being changed to published, set lastPublishedAt
      if (body.status === 'published') {
        updateData.lastPublishedAt = new Date();
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

// DELETE /:id - Delete extension
extensionRoutes.delete('/:id',
  authMiddleware,
  validationMiddleware.withId,
  requireOwnershipOrAdmin(getExtensionOwner),
  async (c) => {
    try {
      const { id } = c.req.param();

      const deletedExtension = await db
        .delete(extensions)
        .where(eq(extensions.id, id))
        .returning();

      const extension = deletedExtension[0];
      if (!extension) {
        throw new HTTPException(404, {
          message: 'Extension not found.',
        });
      }

      return c.json({
        message: 'Extension deleted successfully!',
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Delete extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to delete extension.',
      });
    }
  }
);

// GET /:id/versions - Get extension versions
extensionRoutes.get('/:id/versions',
  optionalAuthMiddleware,
  validationMiddleware.withId,
  async (c) => {
    try {
      const { id } = c.req.param();
      const currentUser = getCurrentUser(c);

      // Check if extension exists and user can view it
      const extensionResult = await db
        .select({
          id: extensions.id,
          authorId: extensions.authorId,
          isPublic: extensions.isPublic,
          status: extensions.status,
        })
        .from(extensions)
        .where(eq(extensions.id, id))
        .limit(1);

      const extension = extensionResult[0];
      if (!extension) {
        throw new HTTPException(404, { message: 'Extension not found' });
      }

      const canView = extension.isPublic ||
                     extension.status === 'published' ||
                     currentUser?.id === extension.authorId ||
                     currentUser?.role === 'admin';

      if (!canView) {
        throw new HTTPException(403, {
          message: 'Access denied.',
        });
      }

      const versions = await db
        .select({
          id: extensionVersions.id,
          version: extensionVersions.version,
          changelog: extensionVersions.changelog,
          isPrerelease: extensionVersions.isPrerelease,
          isDeprecated: extensionVersions.isDeprecated,
          downloadCount: extensionVersions.downloadCount,
          publishedAt: extensionVersions.publishedAt,
          createdAt: extensionVersions.createdAt,
        })
        .from(extensionVersions)
        .where(eq(extensionVersions.extensionId, id))
        .orderBy(desc(extensionVersions.createdAt));

      return c.json({ versions });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Get extension versions error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve extension versions.',
      });
    }
  }
);

// POST /:id/versions - Publish new version
extensionRoutes.post('/:id/versions',
  authMiddleware,
  uploadRateLimit,
  requireOwnershipOrAdmin(getExtensionOwner),
  async (c) => {
    try {
      const { id } = c.req.param();
      const user = getCurrentUser(c);

      // For now, we'll accept JSON body. In a real implementation,
      // this would handle file uploads and extract extension files
      const body = await c.req.json();
      const { version, changelog, files, manifest, isPrerelease = false } = body;

      if (!version || !files || !manifest) {
        throw new HTTPException(400, {
          message: 'Version, files, and manifest are required.',
        });
      }

      // Check if version already exists
      const existingVersion = await db
        .select({ id: extensionVersions.id })
        .from(extensionVersions)
        .where(
          and(
            eq(extensionVersions.extensionId, id),
            eq(extensionVersions.version, version)
          )
        )
        .limit(1);

      if (existingVersion.length > 0) {
        throw new HTTPException(409, {
          message: 'This version already exists.',
        });
      }

      // Create new version
      const newVersion = await db
        .insert(extensionVersions)
        .values({
          extensionId: id,
          version,
          changelog,
          files,
          manifest,
          isPrerelease,
          isDeprecated: false,
          downloadCount: 0,
          publishedAt: new Date(),
          createdAt: new Date(),
        })
        .returning();

      const createdVersion = newVersion[0];
      if (!createdVersion) {
        throw new HTTPException(500, { message: 'Failed to create version' });
      }

      return c.json({
        message: 'Version published successfully!',
        version: createdVersion,
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Publish version error:', error);
      throw new HTTPException(500, {
        message: 'Failed to publish version.',
      });
    }
  }
);

// GET /:id/versions/:version - Get specific version
extensionRoutes.get('/:id/versions/:version',
  optionalAuthMiddleware,
  async (c) => {
    try {
      const { id, version } = c.req.param();
      const currentUser = getCurrentUser(c);

      // Check extension permissions first
      const extensionResult = await db
        .select({
          id: extensions.id,
          authorId: extensions.authorId,
          isPublic: extensions.isPublic,
          status: extensions.status,
        })
        .from(extensions)
        .where(eq(extensions.id, id))
        .limit(1);

      const extension = extensionResult[0];
      if (!extension) {
        throw new HTTPException(404, { message: 'Extension not found' });
      }

      const canView = extension.isPublic ||
                     extension.status === 'published' ||
                     currentUser?.id === extension.authorId ||
                     currentUser?.role === 'admin';

      if (!canView) {
        throw new HTTPException(403, { message: 'Access denied' });
      }

      // Get specific version
      const versionResult = await db
        .select()
        .from(extensionVersions)
        .where(
          and(
            eq(extensionVersions.extensionId, id),
            eq(extensionVersions.version, version)
          )
        )
        .limit(1);

      const extensionVersion = versionResult[0];
      if (!extensionVersion) {
        throw new HTTPException(404, {
          message: 'Version not found.',
        });
      }

      return c.json({ version: extensionVersion });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Get extension version error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve extension version.',
      });
    }
  }
);

export default extensionRoutes;
