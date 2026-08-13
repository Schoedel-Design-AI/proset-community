FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV CI=1

RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

ARG AIFORMS_PUBLIC_DOMAIN=proset.ai
ARG AIFORMS_PUBLIC_TURNSTILE_SITE_KEY=
ARG AIFORMS_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ARG AIFORMS_PUBLIC_FIREBASE_API_KEY=
ARG AIFORMS_PUBLIC_FIREBASE_AUTH_DOMAIN=
ARG AIFORMS_PUBLIC_FIREBASE_PROJECT_ID=
ARG AIFORMS_PUBLIC_FIREBASE_STORAGE_BUCKET=
ARG AIFORMS_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
ARG AIFORMS_PUBLIC_FIREBASE_APP_ID=
ARG APP_GIT_SHA=unknown
ARG APP_GIT_BRANCH=unknown
ARG APP_BUILD_TIME=
ENV AIFORMS_PUBLIC_DOMAIN=$AIFORMS_PUBLIC_DOMAIN
ENV AIFORMS_PUBLIC_TURNSTILE_SITE_KEY=$AIFORMS_PUBLIC_TURNSTILE_SITE_KEY
ENV AIFORMS_PUBLIC_STRIPE_PUBLISHABLE_KEY=$AIFORMS_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV AIFORMS_PUBLIC_FIREBASE_API_KEY=$AIFORMS_PUBLIC_FIREBASE_API_KEY
ENV AIFORMS_PUBLIC_FIREBASE_AUTH_DOMAIN=$AIFORMS_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV AIFORMS_PUBLIC_FIREBASE_PROJECT_ID=$AIFORMS_PUBLIC_FIREBASE_PROJECT_ID
ENV AIFORMS_PUBLIC_FIREBASE_STORAGE_BUCKET=$AIFORMS_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV AIFORMS_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$AIFORMS_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV AIFORMS_PUBLIC_FIREBASE_APP_ID=$AIFORMS_PUBLIC_FIREBASE_APP_ID
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_GIT_BRANCH=$APP_GIT_BRANCH
ENV APP_BUILD_TIME=$APP_BUILD_TIME

RUN node <<'EOF'
const { execSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');

const normalize = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (["unknown", "undefined", "null", "n/a", "none"].includes(lowered)) {
    return null;
  }
  return trimmed;
};

const git = (command) => {
  try {
    return normalize(execSync(command, { encoding: 'utf8' }));
  } catch {
    return null;
  }
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const gitSha = normalize(process.env.APP_GIT_SHA) || git('git rev-parse HEAD');
const branch = normalize(process.env.APP_GIT_BRANCH) || git('git rev-parse --abbrev-ref HEAD');
const builtAt = normalize(process.env.APP_BUILD_TIME) || new Date().toISOString();
const version = normalize(pkg.version);

writeFileSync('deployment-info.json', JSON.stringify({ gitSha, branch, builtAt, version }, null, 2));
EOF

RUN npm run web:build
RUN npm run server:build
WORKDIR /app
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000
ENV OBJECT_STORAGE_DIR=/app/.local/object-storage

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=builder /app/package*.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/server_dist ./server_dist
COPY --chown=node:node --from=builder /app/web-build ./web-build
COPY --chown=node:node --from=builder /app/deployment-info.json ./deployment-info.json
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/assets ./assets
COPY --chown=node:node --from=builder /app/server/templates ./server/templates
COPY --chown=node:node --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --chown=node:node --from=builder /app/shared ./shared
COPY --chown=node:node --from=builder /app/migrations ./migrations
COPY --chown=node:node --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --chown=node:node --from=builder /app/scripts/android-deployments.json ./scripts/android-deployments.json

RUN mkdir -p /app/audio-uploads /app/.local/object-storage \
  && chmod +x /app/docker-entrypoint.sh \
  && chown node:node /app/audio-uploads /app/.local/object-storage

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

USER node

CMD ["./docker-entrypoint.sh"]
