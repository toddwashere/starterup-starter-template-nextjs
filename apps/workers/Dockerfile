# syntax=docker/dockerfile:1
#
# Multi-stage build for the @apps/workers long-lived Node process.
# Uses the Turborepo "prune" pattern so only @apps/workers and its
# workspace dependencies are pulled into the image.
#
# NOTE: This Dockerfile is exercised/verified end-to-end in Task 10
# (docker-compose worker service). Build context must be the repo root.

# ---------------------------------------------------------------------------
# Stage 1: prune the monorepo down to @apps/workers + its dependencies.
# ---------------------------------------------------------------------------
FROM node:24.16.0-slim AS pruner
WORKDIR /app
RUN corepack enable
COPY . .
RUN npx --yes turbo@^2 prune @apps/workers --docker

# ---------------------------------------------------------------------------
# Stage 2: install deps and generate the Prisma client.
#
# The worker runs from TypeScript source via tsx (the `start` script), because
# the workspace packages export their `./src/*.ts` source rather than compiled
# output. So there is no tsc build step here — only dependency install and
# Prisma client generation.
# ---------------------------------------------------------------------------
FROM node:24.16.0-slim AS builder
WORKDIR /app
RUN corepack enable

# Install dependencies using only the pruned lockfile + package manifests so
# this layer is cached unless a manifest changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Copy the pruned source.
COPY --from=pruner /app/out/full/ .

# Generate the Prisma client from the schema. No DB connection is made, but
# prisma.config.ts resolves env("DATABASE_URL") while loading, so pass a
# placeholder to satisfy config loading. Run prisma directly to avoid the
# package's dotenv-based db:generate script (which expects a repo-root .env).
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    pnpm --filter @workspace/database exec prisma generate

# ---------------------------------------------------------------------------
# Stage 3: runtime image (carries node_modules + source + generated client).
# ---------------------------------------------------------------------------
FROM node:24.16.0-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=builder /app/ .

# Health endpoint port (overridable at runtime).
EXPOSE 4300

# Runs `tsx src/index.ts` (see the start script).
CMD ["pnpm", "--filter", "@apps/workers", "start"]
