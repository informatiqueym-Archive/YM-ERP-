FROM node:20-alpine AS builder
RUN apk add --no-cache openssl sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/prisma ./prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma/
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/views ./views/
COPY --from=builder /app/assets ./assets/
COPY --from=builder /app/prisma-check.js ./prisma-check.js
RUN mkdir -p /app/data /app/uploads
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:/app/data/prod.db
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx prisma generate && node prisma-check.js && node dist/server.cjs"]
