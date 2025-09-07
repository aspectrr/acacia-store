# 🌿 Acacia Extension Store

A modern, scalable marketplace for serverless function and React component extensions. Built with TypeScript, Hono, Drizzle ORM, and PostgreSQL.

## ✨ Features

- **🔐 Authentication & Authorization**: JWT-based auth with role-based access control (User, Developer, Admin)
- **🧩 Extension Management**: Create, publish, and manage extensions with versioning
- **📦 Installation System**: Install and manage extensions with configuration options
- **⭐ Review System**: Rate and review extensions with moderation capabilities
- **📊 Analytics Dashboard**: Track downloads, ratings, and usage statistics
- **🔑 API Key Management**: Programmatic access via API keys with permission scoping
- **📁 File Upload**: Support for images, packages, and documents with processing
- **🛡️ Security**: Rate limiting, input validation, and secure file handling
- **👨‍💼 Admin Panel**: Comprehensive admin tools for user and content management

## 🏗️ Architecture

Each extension consists of:
- **React Components**: UI components with typed props
- **Serverless Functions**: Backend logic with API endpoints
- **Database Migrations**: Schema definitions and data management
- **Manifest**: Extension metadata and configuration

## 🚀 Quick Start

### Prerequisites

- **Bun** (latest version) - [Install Bun](https://bun.sh/docs/installation)
- **PostgreSQL** (14+) - [Install PostgreSQL](https://www.postgresql.org/download/)
- **Git** - [Install Git](https://git-scm.com/downloads)

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd acacia-store
```

2. **Install dependencies**
```bash
bun install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your database credentials and configuration
```

4. **Create PostgreSQL database**
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE acacia_store;

# Create user (optional)
CREATE USER acacia_user WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE acacia_store TO acacia_user;
```

5. **Generate and run database migrations**
```bash
# Generate migration files
bun run db:generate

# Run migrations
bun run db:migrate
```

6. **Seed the database with sample data**
```bash
bun run db:seed
```

7. **Start the development server**
```bash
bun run dev
```

The server will start at `http://localhost:3000`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `JWT_SECRET` | JWT signing secret | `change-this-in-production` |
| `MAX_FILE_SIZE` | Maximum upload file size (bytes) | `50000000` (50MB) |
| `UPLOAD_DIR` | File upload directory | `./uploads` |
| `ALLOWED_ORIGINS` | CORS allowed origins | `http://localhost:3000` |

See `.env.example` for complete configuration options.

### Database Configuration

The application uses Drizzle ORM with PostgreSQL. Database configuration can be set via:

1. **Connection String**: Set `DATABASE_URL`
2. **Individual Parameters**: Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

## 📚 API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication

Most endpoints require authentication via JWT token:

```bash
# Login to get token
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@acacia.dev", "password": "admin123"}'

# Use token in subsequent requests
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/api/v1/extensions
```

### Key Endpoints

#### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/auth/me` - Get current user profile
- `POST /api/v1/auth/refresh` - Refresh JWT token

#### Extensions
- `GET /api/v1/extensions` - List extensions (with search/filtering)
- `POST /api/v1/extensions` - Create extension (developers only)
- `GET /api/v1/extensions/:id` - Get extension details
- `PUT /api/v1/extensions/:id` - Update extension
- `DELETE /api/v1/extensions/:id` - Delete extension
- `POST /api/v1/extensions/:id/versions` - Publish new version

#### Installations
- `GET /api/v1/installations` - List user's installations
- `POST /api/v1/installations` - Install extension
- `PUT /api/v1/installations/:id` - Update installation config
- `DELETE /api/v1/installations/:id` - Uninstall extension
- `POST /api/v1/installations/:id/execute` - Execute extension function

#### Reviews
- `GET /api/v1/extensions/:id/reviews` - List extension reviews
- `POST /api/v1/extensions/:id/reviews` - Create review
- `PUT /api/v1/reviews/:id` - Update review
- `DELETE /api/v1/reviews/:id` - Delete review

#### File Uploads
- `POST /api/v1/uploads/images` - Upload images (icons, banners, screenshots)
- `POST /api/v1/uploads/packages` - Upload extension packages
- `POST /api/v1/uploads/documents` - Upload documentation files

#### Admin (Admin only)
- `GET /api/v1/admin/stats` - System statistics
- `GET /api/v1/admin/users` - List all users
- `PUT /api/v1/admin/users/:id` - Update user (role, status)
- `GET /api/v1/admin/extensions` - List all extensions
- `PUT /api/v1/admin/extensions/:id` - Update extension (status, featured)

### API Documentation
Visit `http://localhost:3000/api/docs` for interactive API documentation.

## 👥 Sample Accounts

After running the seed script, you can use these test accounts:

| Role | Email | Password | Description |
|------|--------|----------|-------------|
| Admin | `admin@acacia.dev` | `admin123` | System administrator |
| Developer | `john@developer.com` | `developer123` | Extension developer |
| Developer | `alice@coder.io` | `developer123` | Extension developer |
| User | `bob@user.com` | `user123` | Regular user |
| User | `test@example.com` | `test123` | Test account |

## 🛠️ Development

### Available Scripts

```bash
# Development
bun run dev          # Start development server with hot reload
bun run build        # Build for production
bun run start        # Start production server

# Database
bun run db:generate  # Generate migration files
bun run db:migrate   # Run pending migrations
bun run db:seed      # Seed database with sample data

# Utilities
bun run type-check   # Run TypeScript type checking
```

### Project Structure

```
acacia-store/
├── src/
│   ├── db/
│   │   ├── connection.ts    # Database connection setup
│   │   └── schema.ts        # Drizzle schema definitions
│   ├── middleware/
│   │   ├── auth.ts          # Authentication middleware
│   │   ├── errorHandler.ts  # Global error handling
│   │   ├── rateLimit.ts     # Rate limiting
│   │   └── validation.ts    # Request validation
│   ├── routes/
│   │   ├── auth.ts          # Authentication routes
│   │   ├── extensions.ts    # Extension management
│   │   ├── installations.ts # Installation management
│   │   ├── reviews.ts       # Review system
│   │   ├── uploads.ts       # File upload handling
│   │   ├── users.ts         # User management
│   │   └── admin.ts         # Admin panel
│   ├── scripts/
│   │   ├── migrate.ts       # Database migration script
│   │   └── seed.ts          # Database seeding script
│   ├── types/
│   │   └── index.ts         # TypeScript type definitions
│   └── index.ts             # Main application entry point
├── drizzle/                 # Generated migration files
├── uploads/                 # File upload directory
├── extensions/              # Extension storage directory
├── .env                     # Environment configuration
├── drizzle.config.ts        # Drizzle ORM configuration
└── package.json             # Project dependencies
```

### Creating Extensions

Extensions follow this structure:

```typescript
// Extension Manifest
{
  name: "my-extension",
  version: "1.0.0",
  description: "My awesome extension",
  author: "developer@example.com",
  license: "MIT",
  extensionConfig: {
    category: "productivity",
    tags: ["automation", "productivity"],
    permissions: ["read", "write"],
    endpoints: [
      {
        path: "/api/my-endpoint",
        method: "POST",
        handler: "handleRequest",
        description: "Process data"
      }
    ],
    components: [
      {
        name: "MyComponent",
        file: "components/MyComponent.tsx",
        props: {
          title: { type: "string", required: true },
          data: { type: "object", required: false }
        }
      }
    ],
    database: {
      tables: [...],
      migrations: { up: "...", down: "..." }
    }
  }
}
```

### Adding New Features

1. **Database Changes**: Update `src/db/schema.ts` and generate migrations
2. **API Routes**: Add routes in appropriate files under `src/routes/`
3. **Middleware**: Add reusable middleware in `src/middleware/`
4. **Types**: Update TypeScript types in `src/types/index.ts`
5. **Validation**: Add Zod schemas for request validation

## 🧪 Testing

```bash
# Run tests (when implemented)
bun test

# Run specific test file
bun test src/routes/auth.test.ts

# Run with coverage
bun test --coverage
```

## 🚀 Deployment

### Using Docker

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .
COPY --from=builder /app/bun.lockb .
RUN bun install --production
EXPOSE 3000
CMD ["bun", "start"]
```

### Environment Setup

For production deployment:

1. Set `NODE_ENV=production`
2. Use a secure `JWT_SECRET`
3. Configure proper database credentials
4. Set up file storage (local or cloud)
5. Configure CORS origins
6. Set up monitoring and logging

### Database Migration

```bash
# Production migration
NODE_ENV=production bun run db:migrate --force
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Use Drizzle ORM for database operations
- Implement proper error handling
- Add input validation for all endpoints
- Write clear, self-documenting code
- Update documentation for new features

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failed**
- Verify PostgreSQL is running
- Check database credentials in `.env`
- Ensure database exists

**Migration Errors**
- Check database permissions
- Verify schema changes are valid
- Run migrations with `--force` flag if needed

**File Upload Issues**
- Check upload directory permissions
- Verify file size limits
- Ensure proper MIME type handling

**Authentication Problems**
- Verify JWT secret configuration
- Check token expiration settings
- Ensure proper header format

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Hono](https://hono.dev/) - Fast web framework
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- [PostgreSQL](https://www.postgresql.org/) - Database system

---

## 🎯 Roadmap

- [ ] WebSocket support for real-time updates
- [ ] Extension sandboxing and security improvements
- [ ] Marketplace UI/frontend
- [ ] Extension analytics and insights
- [ ] Payment integration for paid extensions
- [ ] Extension dependency management
- [ ] Multi-tenancy support
- [ ] GraphQL API
- [ ] Extension testing framework
- [ ] CI/CD pipeline integration

For questions or support, please open an issue in the GitHub repository.