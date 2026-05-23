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
FROM node:22-slim AS pruner
WORKDIR /app
RUN corepack enable
COPY . .
RUN npx --yes turbo@^2 prune @apps/workers --docker

# ---------------------------------------------------------------------------
# Stage 2: install deps, generate the Prisma client, and build.
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable

# Install dependencies using only the pruned lockfile + package manifests so
# this layer is cached unless a manifest changes.
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# Copy the pruned source and build.
COPY --from=pruner /app/out/full/ .

# Generate the Prisma client from the schema (no DB connection required).
# Run prisma directly to avoid the package's dotenv-based db:generate script,
# which expects a repo-root .env file that does not exist in the image.
RUN pnpm --filter @workspace/database exec prisma generate

# Compile @apps/workers (tsc -> dist).
RUN pnpm --filter @apps/workers build

# ---------------------------------------------------------------------------
# Stage 3: lightweight runtime image.
# ---------------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=builder /app/ .

# Health endpoint port (overridable at runtime).
EXPOSE 4300

CMD ["pnpm", "--filter", "@apps/workers", "start"]
