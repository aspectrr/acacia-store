import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware, getCurrentUser } from '../middleware/auth.js';
import { uploadRateLimit } from '../middleware/rateLimit.js';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import crypto from 'crypto';

const uploadRoutes = new Hono();

// Configuration
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '50000000'); // 50MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB for images
const MAX_PACKAGE_SIZE = parseInt(process.env.MAX_EXTENSION_SIZE || '10000000'); // 10MB for packages

// Allowed file types
const ALLOWED_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ALLOWED_PACKAGE_TYPES = ['.zip', '.tar.gz', '.tgz'];
const ALLOWED_DOCUMENT_TYPES = ['.md', '.txt', '.json'];

// Ensure upload directories exist
const uploadDirs = {
  images: join(UPLOAD_DIR, 'images'),
  packages: join(UPLOAD_DIR, 'packages'),
  documents: join(UPLOAD_DIR, 'documents'),
  temp: join(UPLOAD_DIR, 'temp'),
};

Object.values(uploadDirs).forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Helper function to generate unique filename
function generateFilename(originalName: string, prefix = ''): string {
  const ext = extname(originalName).toLowerCase();
  const name = basename(originalName, ext);
  const uuid = uuidv4().replace(/-/g, '');
  const timestamp = Date.now();
  return `${prefix}${timestamp}_${uuid}${ext}`;
}

// Helper function to calculate file hash
function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Helper function to validate file type
function validateFileType(filename: string, allowedTypes: string[]): boolean {
  const ext = extname(filename).toLowerCase();
  return allowedTypes.includes(ext);
}

// Helper function to process image
async function processImage(
  buffer: Buffer,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp';
  } = {}
): Promise<Buffer> {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    quality = 85,
    format = 'jpeg'
  } = options;

  let processor = sharp(buffer);

  // Get original dimensions
  const metadata = await processor.metadata();

  // Resize if necessary
  if (metadata.width && metadata.height) {
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      processor = processor.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
  }

  // Convert format and optimize
  switch (format) {
    case 'jpeg':
      processor = processor.jpeg({ quality, mozjpeg: true });
      break;
    case 'png':
      processor = processor.png({ quality, compressionLevel: 9 });
      break;
    case 'webp':
      processor = processor.webp({ quality });
      break;
  }

  return processor.toBuffer();
}

// Helper function to save file
async function saveFile(buffer: Buffer, filename: string, directory: string): Promise<string> {
  const filepath = join(directory, filename);

  return new Promise((resolve, reject) => {
    const writeStream = createWriteStream(filepath);

    writeStream.on('error', reject);
    writeStream.on('finish', () => resolve(filepath));

    writeStream.write(buffer);
    writeStream.end();
  });
}

// Helper function to delete file
function deleteFile(filepath: string): void {
  try {
    if (existsSync(filepath)) {
      unlinkSync(filepath);
    }
  } catch (error) {
    console.error('Failed to delete file:', filepath, error);
  }
}

// POST /images - Upload image file (icons, banners, screenshots)
uploadRoutes.post('/images',
  authMiddleware,
  uploadRateLimit,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = await c.req.parseBody();
      const file = body.file as File;
      const type = body.type as string; // 'icon', 'banner', 'screenshot'

      if (!file) {
        throw new HTTPException(400, {
          message: 'No file provided.',
        });
      }

      if (file.size > MAX_IMAGE_SIZE) {
        throw new HTTPException(413, {
          message: `File size too large. Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB.`,
        });
      }

      if (!validateFileType(file.name, ALLOWED_IMAGE_TYPES)) {
        throw new HTTPException(400, {
          message: `Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
        });
      }

      // Convert file to buffer
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = calculateFileHash(buffer);

      // Process image based on type
      let processedBuffer: Buffer;
      let filename: string;

      switch (type) {
        case 'icon':
          processedBuffer = await processImage(buffer, {
            maxWidth: 512,
            maxHeight: 512,
            quality: 90,
            format: 'png'
          });
          filename = generateFilename(file.name, 'icon_');
          filename = filename.replace(/\.[^/.]+$/, '.png'); // Force PNG
          break;

        case 'banner':
          processedBuffer = await processImage(buffer, {
            maxWidth: 1920,
            maxHeight: 480,
            quality: 85,
            format: 'jpeg'
          });
          filename = generateFilename(file.name, 'banner_');
          filename = filename.replace(/\.[^/.]+$/, '.jpg'); // Force JPEG
          break;

        case 'screenshot':
          processedBuffer = await processImage(buffer, {
            maxWidth: 1920,
            maxHeight: 1080,
            quality: 80,
            format: 'jpeg'
          });
          filename = generateFilename(file.name, 'screenshot_');
          filename = filename.replace(/\.[^/.]+$/, '.jpg'); // Force JPEG
          break;

        default:
          // Generic image processing
          processedBuffer = await processImage(buffer, {
            maxWidth: 1920,
            maxHeight: 1080,
            quality: 85,
            format: 'jpeg'
          });
          filename = generateFilename(file.name, 'image_');
          break;
      }

      // Save processed image
      const filepath = await saveFile(processedBuffer, filename, uploadDirs.images);
      const fileSize = statSync(filepath).size;

      // Generate public URL
      const url = `/uploads/images/${filename}`;

      return c.json({
        message: 'Image uploaded successfully!',
        file: {
          filename,
          originalName: file.name,
          type: type || 'image',
          size: fileSize,
          url,
          hash,
          uploadedBy: user.id,
          uploadedAt: new Date().toISOString(),
        },
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Image upload error:', error);
      throw new HTTPException(500, {
        message: 'Failed to upload image.',
      });
    }
  }
);

// POST /packages - Upload extension package
uploadRoutes.post('/packages',
  authMiddleware,
  uploadRateLimit,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = await c.req.parseBody();
      const file = body.file as File;
      const extensionId = body.extensionId as string;
      const version = body.version as string;

      if (!file) {
        throw new HTTPException(400, {
          message: 'No file provided.',
        });
      }

      if (file.size > MAX_PACKAGE_SIZE) {
        throw new HTTPException(413, {
          message: `Package size too large. Maximum size is ${MAX_PACKAGE_SIZE / 1024 / 1024}MB.`,
        });
      }

      if (!validateFileType(file.name, ALLOWED_PACKAGE_TYPES)) {
        throw new HTTPException(400, {
          message: `Invalid package type. Allowed types: ${ALLOWED_PACKAGE_TYPES.join(', ')}`,
        });
      }

      if (!extensionId || !version) {
        throw new HTTPException(400, {
          message: 'Extension ID and version are required.',
        });
      }

      // Convert file to buffer
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = calculateFileHash(buffer);

      // Generate filename with extension and version info
      const filename = `${extensionId}_${version}_${generateFilename(file.name, 'pkg_')}`;

      // Save package file
      const filepath = await saveFile(buffer, filename, uploadDirs.packages);
      const fileSize = statSync(filepath).size;

      // Generate public URL (packages might need authentication to access)
      const url = `/uploads/packages/${filename}`;

      return c.json({
        message: 'Package uploaded successfully!',
        file: {
          filename,
          originalName: file.name,
          type: 'package',
          size: fileSize,
          url,
          hash,
          extensionId,
          version,
          uploadedBy: user.id,
          uploadedAt: new Date().toISOString(),
        },
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Package upload error:', error);
      throw new HTTPException(500, {
        message: 'Failed to upload package.',
      });
    }
  }
);

// POST /documents - Upload document files (README, CHANGELOG, etc.)
uploadRoutes.post('/documents',
  authMiddleware,
  uploadRateLimit,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const body = await c.req.parseBody();
      const file = body.file as File;
      const type = body.type as string; // 'readme', 'changelog', 'license', etc.

      if (!file) {
        throw new HTTPException(400, {
          message: 'No file provided.',
        });
      }

      if (file.size > 1024 * 1024) { // 1MB limit for documents
        throw new HTTPException(413, {
          message: 'Document size too large. Maximum size is 1MB.',
        });
      }

      if (!validateFileType(file.name, ALLOWED_DOCUMENT_TYPES)) {
        throw new HTTPException(400, {
          message: `Invalid document type. Allowed types: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
        });
      }

      // Convert file to buffer
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = calculateFileHash(buffer);

      // Generate filename
      const prefix = type ? `${type}_` : 'doc_';
      const filename = generateFilename(file.name, prefix);

      // Save document
      const filepath = await saveFile(buffer, filename, uploadDirs.documents);
      const fileSize = statSync(filepath).size;

      // Generate public URL
      const url = `/uploads/documents/${filename}`;

      return c.json({
        message: 'Document uploaded successfully!',
        file: {
          filename,
          originalName: file.name,
          type: type || 'document',
          size: fileSize,
          url,
          hash,
          uploadedBy: user.id,
          uploadedAt: new Date().toISOString(),
        },
      }, 201);

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Document upload error:', error);
      throw new HTTPException(500, {
        message: 'Failed to upload document.',
      });
    }
  }
);

// DELETE /:type/:filename - Delete uploaded file
uploadRoutes.delete('/:type/:filename',
  authMiddleware,
  async (c) => {
    try {
      const user = getCurrentUser(c);
      if (!user) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }

      const type = c.req.param('type');
      const filename = c.req.param('filename');

      if (!type || !filename) {
        throw new HTTPException(400, {
          message: 'Type and filename are required.',
        });
      }

      // Validate type
      if (!uploadDirs[type as keyof typeof uploadDirs]) {
        throw new HTTPException(400, {
          message: 'Invalid file type.',
        });
      }

      const directory = uploadDirs[type as keyof typeof uploadDirs];
      const filepath = join(directory, filename);

      // Check if file exists
      if (!existsSync(filepath)) {
        throw new HTTPException(404, {
          message: 'File not found.',
        });
      }

      // TODO: In a real implementation, you'd check if the user owns this file
      // or has permission to delete it (e.g., admin role or file ownership)

      // Delete file
      deleteFile(filepath);

      return c.json({
        message: 'File deleted successfully!',
      });

    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      console.error('Delete file error:', error);
      throw new HTTPException(500, {
        message: 'Failed to delete file.',
      });
    }
  }
);

// GET /:type/:filename - Serve uploaded file (with authentication for packages)
uploadRoutes.get('/:type/:filename', async (c) => {
  try {
    const type = c.req.param('type');
    const filename = c.req.param('filename');

    if (!type || !filename) {
      throw new HTTPException(400, {
        message: 'Type and filename are required.',
      });
    }

    // Validate type
    if (!uploadDirs[type as keyof typeof uploadDirs]) {
      throw new HTTPException(400, {
        message: 'Invalid file type.',
      });
    }

    const directory = uploadDirs[type as keyof typeof uploadDirs];
    const filepath = join(directory, filename);

    // Check if file exists
    if (!existsSync(filepath)) {
      throw new HTTPException(404, {
        message: 'File not found.',
      });
    }

    // For packages, require authentication
    if (type === 'packages') {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new HTTPException(401, {
          message: 'Authentication required to access packages.',
        });
      }
      // TODO: Validate JWT token here
    }

    // Get file stats
    const stats = statSync(filepath);

    // Set appropriate headers
    const ext = extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';

    switch (ext) {
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.webp':
        contentType = 'image/webp';
        break;
      case '.zip':
        contentType = 'application/zip';
        break;
      case '.tar':
      case '.tgz':
        contentType = 'application/gzip';
        break;
      case '.json':
        contentType = 'application/json';
        break;
      case '.md':
        contentType = 'text/markdown';
        break;
      case '.txt':
        contentType = 'text/plain';
        break;
    }

    // Read and return file
    const fs = await import('fs/promises');
    const fileBuffer = await fs.readFile(filepath);

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'ETag': `"${stats.mtime.getTime()}"`,
      },
    });

  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error('Serve file error:', error);
    throw new HTTPException(500, {
      message: 'Failed to serve file.',
    });
  }
});

// GET /info/:type/:filename - Get file information
uploadRoutes.get('/info/:type/:filename', async (c) => {
  try {
    const type = c.req.param('type');
    const filename = c.req.param('filename');

    if (!type || !filename) {
      throw new HTTPException(400, {
        message: 'Type and filename are required.',
      });
    }

    // Validate type
    if (!uploadDirs[type as keyof typeof uploadDirs]) {
      throw new HTTPException(400, {
        message: 'Invalid file type.',
      });
    }

    const directory = uploadDirs[type as keyof typeof uploadDirs];
    const filepath = join(directory, filename);

    // Check if file exists
    if (!existsSync(filepath)) {
      throw new HTTPException(404, {
        message: 'File not found.',
      });
    }

    // Get file stats
    const stats = statSync(filepath);

    const fileInfo = {
      filename,
      type,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      extension: extname(filename).toLowerCase(),
      url: `/uploads/${type}/${filename}`,
    };

    return c.json({ file: fileInfo });

  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error('File info error:', error);
    throw new HTTPException(500, {
      message: 'Failed to get file information.',
    });
  }
});

export default uploadRoutes;
