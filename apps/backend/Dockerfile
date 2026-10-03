# Build from the repository root: docker build -f apps/backend/Dockerfile .
FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app
RUN npm install --global npm@10.9.9
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @jarvis/backend --include-workspace-root
COPY apps/backend/tsconfig.json apps/backend/tsconfig.json
COPY apps/backend/src apps/backend/src
RUN npm run build --workspace @jarvis/backend

FROM node:22.23.3-bookworm-slim AS production-dependencies
WORKDIR /app
RUN npm install --global npm@10.9.9
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @jarvis/backend --include-workspace-root=false

FROM node:22.23.3-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/backend ./apps/backend
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/backend/dist/index.js"]
