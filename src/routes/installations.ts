import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection.js';
import { extensionInstallations, extensions, extensionVersions, users } from '../db/schema.js';
import { eq, desc, and, count } from 'drizzle-orm';
import { authMiddleware, getCurrentUser, requireOwnershipOrAdmin } from '../middleware/auth.js';
import { validationMiddleware, getValidatedBody, getValidatedQuery } from '../middleware/validation.js';
import type {
  ExtensionInstallation,
  InstallExtensionRequest,
  PaginatedResponse
} from '../types/index.js';

const installationRoutes = new Hono();

// Helper function to get installation owner
const getInstallationOwner = async (c: any): Promise<string> => {
  const { id } = c.req.param();

  const result = await db
    .select({ userId: extensionInstallations.userId })
    .from(extensionInstallations)
    .where(eq(extensionInstallations.id, id))
    .limit(1);

  const installation = result[0];
  if (!installation) {
    throw new HTTPException(404, { message: 'Installation not found' });
  }

  return installation.userId;
};

// GET / - List user's installations
installationRoutes.get('/',
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
          userId: extensionInstallations.userId,
          extensionId: extensionInstallations.extensionId,
          versionId: extensionInstallations.versionId,
          status: extensionInstallations.status,
          config: extensionInstallations.config,
          environmentVariables: extensionInstallations.environmentVariables,
          installedAt: extensionInstallations.installedAt,
          lastUsedAt: extensionInstallations.lastUsedAt,
          uninstalledAt: extensionInstallations.uninstalledAt,
          errorMessage: extensionInstallations.errorMessage,
          errorDetails: extensionInstallations.errorDetails,
          createdAt: extensionInstallations.createdAt,
          updatedAt: extensionInstallations.updatedAt,
          // Extension details
          extension: {
            id: extensions.id,
            name: extensions.name,
            displayName: extensions.displayName,
            description: extensions.description,
            icon: extensions.icon,
            category: extensions.category,
            tags: extensions.tags,
          },
          // Version details
          version: {
            id: extensionVersions.id,
            version: extensionVersions.version,
            changelog: extensionVersions.changelog,
          },
        })
        .from(extensionInstallations)
        .leftJoin(extensions, eq(extensionInstallations.extensionId, extensions.id))
        .leftJoin(extensionVersions, eq(extensionInstallations.versionId, extensionVersions.id))
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
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('List installations error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve installations.',
      });
    }
  }
);

// POST / - Install an extension
installationRoutes.post('/',
  authMiddleware,
  validationMiddleware.installExtension,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = getValidatedBody<InstallExtensionRequest>(c);
      if (!body) {
        throw new HTTPException(400, { message: 'Invalid request body' });
      }

      const { extensionId, version, config, environmentVariables } = body;

      // Check if extension exists and is published
      const extensionResult = await db
        .select({
          id: extensions.id,
          name: extensions.name,
          status: extensions.status,
          isPublic: extensions.isPublic,
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

      if (extension.status !== 'published' || !extension.isPublic) {
        throw new HTTPException(403, {
          message: 'Extension is not available for installation.',
        });
      }

      // Find version to install
      let versionToInstall;
      if (version) {
        // Install specific version
        const versionResult = await db
          .select()
          .from(extensionVersions)
          .where(
            and(
              eq(extensionVersions.extensionId, extensionId),
              eq(extensionVersions.version, version)
            )
          )
          .limit(1);

        versionToInstall = versionResult[0];
        if (!versionToInstall) {
          throw new HTTPException(404, {
            message: 'Specified version not found.',
          });
        }
      } else {
        // Install latest version
        const latestVersionResult = await db
          .select()
          .from(extensionVersions)
          .where(
            and(
              eq(extensionVersions.extensionId, extensionId),
              eq(extensionVersions.isDeprecated, false)
            )
          )
          .orderBy(desc(extensionVersions.createdAt))
          .limit(1);

        versionToInstall = latestVersionResult[0];
        if (!versionToInstall) {
          throw new HTTPException(404, {
            message: 'No installable version found.',
          });
        }
      }

      // Check if already installed
      const existingInstallation = await db
        .select({ id: extensionInstallations.id })
        .from(extensionInstallations)
        .where(
          and(
            eq(extensionInstallations.userId, user.id),
            eq(extensionInstallations.extensionId, extensionId)
          )
        )
        .limit(1);

      if (existingInstallation.length > 0) {
        throw new HTTPException(409, {
          message: 'Extension is already installed.',
        });
      }

      // Create installation record
      const newInstallation = await db
        .insert(extensionInstallations)
        .values({
          userId: user.id,
          extensionId,
          versionId: versionToInstall.id,
          status: 'pending',
          config: config || {},
          environmentVariables: environmentVariables || {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const installation = newInstallation[0];
      if (!installation) {
        throw new HTTPException(500, { message: 'Failed to create installation' });
      }

      // TODO: In a real implementation, this would:
      // 1. Run the extension's migration scripts
      // 2. Set up the database schema
      // 3. Deploy serverless functions
      // 4. Validate component dependencies
      // 5. Update status to 'installed' or 'failed'

      // For now, we'll simulate successful installation
      await db
        .update(extensionInstallations)
        .set({
          status: 'installed',
          installedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(extensionInstallations.id, installation.id));

      // Update download count
      await db
        .update(extensions)
        .set({
          downloadCount: extensions.downloadCount + 1,
        })
        .where(eq(extensions.id, extensionId));

      await db
        .update(extensionVersions)
        .set({
          downloadCount: extensionVersions.downloadCount + 1,
        })
        .where(eq(extensionVersions.id, versionToInstall.id));

      return c.json({
        message: 'Extension installed successfully!',
        installation: {
          ...installation,
          status: 'installed',
          installedAt: new Date(),
        },
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Install extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to install extension.',
      });
    }
  }
);

// GET /:id - Get installation details
installationRoutes.get('/:id',
  authMiddleware,
  validationMiddleware.withId,
  requireOwnershipOrAdmin(getInstallationOwner),
  async (c) => {
    try {
      const { id } = c.req.param();

      const result = await db
        .select({
          id: extensionInstallations.id,
          userId: extensionInstallations.userId,
          extensionId: extensionInstallations.extensionId,
          versionId: extensionInstallations.versionId,
          status: extensionInstallations.status,
          config: extensionInstallations.config,
          environmentVariables: extensionInstallations.environmentVariables,
          installedAt: extensionInstallations.installedAt,
          lastUsedAt: extensionInstallations.lastUsedAt,
          uninstalledAt: extensionInstallations.uninstalledAt,
          errorMessage: extensionInstallations.errorMessage,
          errorDetails: extensionInstallations.errorDetails,
          createdAt: extensionInstallations.createdAt,
          updatedAt: extensionInstallations.updatedAt,
          // Extension details
          extension: {
            id: extensions.id,
            name: extensions.name,
            displayName: extensions.displayName,
            description: extensions.description,
            icon: extensions.icon,
            category: extensions.category,
            tags: extensions.tags,
            homepage: extensions.homepage,
            repository: extensions.repository,
            documentation: extensions.documentation,
          },
          // Version details
          version: {
            id: extensionVersions.id,
            version: extensionVersions.version,
            changelog: extensionVersions.changelog,
            manifest: extensionVersions.manifest,
          },
        })
        .from(extensionInstallations)
        .leftJoin(extensions, eq(extensionInstallations.extensionId, extensions.id))
        .leftJoin(extensionVersions, eq(extensionInstallations.versionId, extensionVersions.id))
        .where(eq(extensionInstallations.id, id))
        .limit(1);

      const installation = result[0];
      if (!installation) {
        throw new HTTPException(404, {
          message: 'Installation not found.',
        });
      }

      return c.json({ installation });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Get installation error:', error);
      throw new HTTPException(500, {
        message: 'Failed to retrieve installation.',
      });
    }
  }
);

// PUT /:id - Update installation configuration
installationRoutes.put('/:id',
  authMiddleware,
  validationMiddleware.withId,
  requireOwnershipOrAdmin(getInstallationOwner),
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req.json();
      const { config, environmentVariables } = body;

      const updateData: any = {
        updatedAt: new Date(),
      };

      if (config !== undefined) {
        updateData.config = config;
      }

      if (environmentVariables !== undefined) {
        updateData.environmentVariables = environmentVariables;
      }

      const updatedInstallation = await db
        .update(extensionInstallations)
        .set(updateData)
        .where(eq(extensionInstallations.id, id))
        .returning();

      const installation = updatedInstallation[0];
      if (!installation) {
        throw new HTTPException(404, {
          message: 'Installation not found.',
        });
      }

      return c.json({
        message: 'Installation updated successfully!',
        installation,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Update installation error:', error);
      throw new HTTPException(500, {
        message: 'Failed to update installation.',
      });
    }
  }
);

// DELETE /:id - Uninstall extension
installationRoutes.delete('/:id',
  authMiddleware,
  validationMiddleware.withId,
  requireOwnershipOrAdmin(getInstallationOwner),
  async (c) => {
    try {
      const { id } = c.req.param();

      // Get installation details first
      const installationResult = await db
        .select({
          id: extensionInstallations.id,
          status: extensionInstallations.status,
          extensionId: extensionInstallations.extensionId,
          versionId: extensionInstallations.versionId,
        })
        .from(extensionInstallations)
        .where(eq(extensionInstallations.id, id))
        .limit(1);

      const installation = installationResult[0];
      if (!installation) {
        throw new HTTPException(404, {
          message: 'Installation not found.',
        });
      }

      if (installation.status === 'uninstalled') {
        throw new HTTPException(400, {
          message: 'Extension is already uninstalled.',
        });
      }

      // TODO: In a real implementation, this would:
      // 1. Run down migrations to clean up database schema
      // 2. Remove serverless functions
      // 3. Clean up any created resources
      // 4. Archive user data if needed

      // Update installation status
      await db
        .update(extensionInstallations)
        .set({
          status: 'uninstalled',
          uninstalledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(extensionInstallations.id, id));

      return c.json({
        message: 'Extension uninstalled successfully!',
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Uninstall extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to uninstall extension.',
      });
    }
  }
);

// POST /:id/execute - Execute extension functionality
installationRoutes.post('/:id/execute',
  authMiddleware,
  requireOwnershipOrAdmin(getInstallationOwner),
  async (c) => {
    try {
      const { id } = c.req.param();
      const body = await c.req.json();
      const { action, parameters } = body;

      if (!action) {
        throw new HTTPException(400, {
          message: 'Action is required.',
        });
      }

      // Get installation with version details
      const installationResult = await db
        .select({
          id: extensionInstallations.id,
          status: extensionInstallations.status,
          config: extensionInstallations.config,
          environmentVariables: extensionInstallations.environmentVariables,
          // Version details for execution
          serverlessCode: extensionVersions.serverlessCode,
          serverlessConfig: extensionVersions.serverlessConfig,
          manifest: extensionVersions.manifest,
        })
        .from(extensionInstallations)
        .leftJoin(extensionVersions, eq(extensionInstallations.versionId, extensionVersions.id))
        .where(eq(extensionInstallations.id, id))
        .limit(1);

      const installation = installationResult[0];
      if (!installation) {
        throw new HTTPException(404, {
          message: 'Installation not found.',
        });
      }

      if (installation.status !== 'installed') {
        throw new HTTPException(400, {
          message: 'Extension is not installed or not ready.',
        });
      }

      // TODO: In a real implementation, this would:
      // 1. Validate the action against available endpoints
      // 2. Execute the serverless function with proper sandboxing
      // 3. Apply rate limiting and resource constraints
      // 4. Return the execution result

      // For now, return a mock response
      const result = {
        action,
        parameters,
        result: `Mock execution of ${action} completed successfully`,
        timestamp: new Date().toISOString(),
        executionTime: Math.random() * 1000, // Mock execution time
      };

      // Update last used timestamp
      await db
        .update(extensionInstallations)
        .set({
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(extensionInstallations.id, id));

      return c.json({
        message: 'Extension executed successfully!',
        execution: result,
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Execute extension error:', error);
      throw new HTTPException(500, {
        message: 'Failed to execute extension.',
      });
    }
  }
);

export default installationRoutes;
