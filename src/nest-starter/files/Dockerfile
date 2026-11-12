# apps/api production image.
#   docker build -t api .
#   docker compose up --build
# Other apps: change the build target and CMD (e.g. `npm run build:worker`, dist/apps/worker/main).

# ── deps: every dependency, cached until package*.json changes ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ── build: compile apps/api, then drop dev dependencies ──
FROM deps AS build
COPY . .
RUN npm run build:api && npm prune --omit=dev

# ── runtime: compiled app + production node_modules, non-root ──
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/apps/api ./dist/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/api/main"]
