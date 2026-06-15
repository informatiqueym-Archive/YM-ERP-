# ── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Install all dependencies including devDependencies (needed for build)
COPY package*.json ./
RUN npm ci

# Generate Prisma client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy all source files and build
COPY . .
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma schema and generated client from builder
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma/

# Copy built server output
COPY --from=builder /app/dist ./dist/

# Copy runtime assets that are NOT compiled into dist
COPY --from=builder /app/views ./views/
COPY --from=builder /app/prisma-check.js ./prisma-check.js

# Create persistent directories for database and file uploads
RUN mkdir -p /app/data /app/uploads

# Default environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/data/prod.db

EXPOSE 3000

# Run DB setup then start the server
CMD ["sh", "-c", "node prisma-check.js && node dist/server.cjs"]
