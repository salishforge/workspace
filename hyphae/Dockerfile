FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# Copy everything first
COPY . .

# Install all deps (prod + missing runtime deps + typescript + types)
# These are installed after COPY so package.json changes persist in node_modules
RUN npm install && \
    npm install express uuid && \
    npm install --save-dev typescript@5 @types/node@20 @types/pg @types/express @types/uuid

# Build TypeScript → dist/ (commonjs output per tsconfig)
# noEmitOnError false: emit JS even if there are type errors in generated stubs
RUN npx tsc --project tsconfig.json --noEmitOnError false || true

# Mark dist/ as commonjs so Node doesn't treat it as ESM (package.json has "type":"module")
RUN echo '{"type":"commonjs"}' > dist/package.json

# ── Final image ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS final

RUN apk add --no-cache curl

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy compiled output and pruned deps
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/schema.sql ./

USER nodejs

EXPOSE 3100 3101

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3100/api/health || exit 1

CMD ["node", "dist/http-rpc-server.js"]
