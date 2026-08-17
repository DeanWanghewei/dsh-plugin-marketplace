# dshm registry server — built from repository sources.
# Build context is the repo root:
#   docker build -f deploy/server/Dockerfile -t dshm-server:VERSION .
#
# Stage 1 compiles the workspace with pnpm (pnpm version comes from the
# packageManager field via corepack); stage 2 keeps only the server's built
# output plus its five runtime dependencies on a stock node:22-alpine.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dshm/server... build
# Runtime manifest without workspace dependencies: npm refuses the
# workspace:* protocol, and @dshm/core is already bundled into lib/main.js.
RUN node -e "\
  const fs = require('fs');\
  const pkg = JSON.parse(fs.readFileSync('packages/server/package.json', 'utf8'));\
  const dependencies = { ...pkg.dependencies };\
  delete dependencies['@dshm/core'];\
  const minimal = { name: pkg.name, version: pkg.version, type: pkg.type, private: true, bin: pkg.bin, dependencies };\
  fs.mkdirSync('/deploy', { recursive: true });\
  fs.writeFileSync('/deploy/package.json', JSON.stringify(minimal, null, 2));\
  "

FROM node:22-alpine
WORKDIR /app
COPY --from=build /deploy/package.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com
COPY --from=build /repo/packages/server/lib ./lib
COPY packages/cli/registry/default/registry.yaml /seed/registry.yaml

ENV DSHM_DB_URL=/data/registry.db
VOLUME /data
EXPOSE 8790
ENTRYPOINT ["node", "lib/main.js"]
CMD ["serve", "--port", "8790", "--name", "ali"]
