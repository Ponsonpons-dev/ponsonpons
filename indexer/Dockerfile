FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 42069
# Shell form so the platform-injected PORT is honored (Railway etc.).
#
# Each deployment indexes into its own schema (Railway injects a unique
# RAILWAY_DEPLOYMENT_ID) rather than a fixed one. A redeploy therefore builds
# its tables alongside the running instance instead of replacing them, and
# `/ready` stays 503 until its historical sync finishes, so a platform health
# check keeps serving the old instance until the new one is actually caught
# up. DATABASE_SCHEMA remains the fallback for local and non-Railway runs.
CMD npx ponder start --port ${PORT:-8080} \
  --schema ${RAILWAY_DEPLOYMENT_ID:-${DATABASE_SCHEMA:-pop}} \
  --views-schema ${VIEWS_SCHEMA:-pop_live}
