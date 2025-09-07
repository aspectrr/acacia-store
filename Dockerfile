# Multi-stage Docker build for Acacia Extension Store
# Stage 1: Builder
FROM oven/bun:1-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for better caching
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile --production=false

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Generate Drizzle migrations (if needed)
RUN bun run db:generate || echo "No new migrations to generate"

# Stage 2: Production
FROM oven/bun:1-alpine AS production

# Install system dependencies for production
RUN apk add --no-cache \
    postgresql-client \
    curl \
    && rm -rf /var/cache/apk/*

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S acacia -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./

# Install only production dependencies
RUN bun install --frozen-lockfile --production=true && \
    bun pm cache rm

# Copy built application from builder stage
COPY --from=builder --chown=acacia:nodejs /app/dist ./dist
COPY --from=builder --chown=acacia:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=acacia:nodejs /app/src ./src

# Copy configuration files
COPY --chown=acacia:nodejs drizzle.config.ts ./

# Create necessary directories with proper permissions
RUN mkdir -p uploads/images uploads/packages uploads/documents uploads/temp extensions && \
    chown -R acacia:nodejs uploads extensions

# Create logs directory
RUN mkdir -p logs && chown -R acacia:nodejs logs

# Switch to non-root user
USER acacia

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Labels for better container management
LABEL maintainer="Acacia Extension Store" \
    version="1.0.0" \
    description="Extension marketplace server for serverless functions and React components"

# Start the application
CMD ["bun", "run", "start"]
