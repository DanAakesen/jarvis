FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app
RUN npm install --global npm@10.9.9
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/vault-mirror/package.json apps/vault-mirror/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace @jarvis/vault-mirror --include-workspace-root
COPY packages/contracts/src packages/contracts/src
COPY apps/vault-mirror/tsconfig.json apps/vault-mirror/tsconfig.json
COPY apps/vault-mirror/src apps/vault-mirror/src
RUN npm run build:vault-mirror

FROM node:22.23.3-bookworm-slim AS production-dependencies
WORKDIR /app
RUN npm install --global npm@10.9.9
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/vault-mirror/package.json apps/vault-mirror/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace @jarvis/vault-mirror --include-workspace-root=false

FROM node:22.23.3-bookworm-slim AS obsidian-cli
WORKDIR /app
RUN npm install --global npm@10.9.9
COPY apps/vault-mirror/tools/package.json apps/vault-mirror/tools/package-lock.json apps/vault-mirror/tools/
RUN npm ci --prefix apps/vault-mirror/tools --omit=dev && npm cache clean --force

FROM node:22.23.3-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PATH="/app/apps/vault-mirror/tools/node_modules/.bin:${PATH}"
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/vault-mirror ./apps/vault-mirror
COPY --from=build /app/apps/vault-mirror/dist ./apps/vault-mirror/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/src ./packages/contracts/src
COPY --from=obsidian-cli /app/apps/vault-mirror/tools/node_modules ./apps/vault-mirror/tools/node_modules
USER node
CMD ["node", "apps/vault-mirror/dist/main.js"]
