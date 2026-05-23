# Postgres 16 (Debian bookworm) bundling the pgmq and pg_cron extensions
# for local development of the worker-queue feature.
#
# - pg_cron: installed from the PGDG apt repo (already configured in the
#   official postgres:16 image).
# - pgmq: built from source at a pinned release tag via PGXS.
#
# See README.md for build notes, why shared_preload_libraries is required,
# and the verified extension versions.
FROM postgres:16

# Pinned pgmq release tag. The extension's pg_extension.extversion derives
# from default_version in pgmq.control (1.11.1 for this tag).
ARG PGMQ_VERSION=v1.11.1

# 1. Install pg_cron from PGDG apt (no build needed).
# 2. Install build deps, clone + build pgmq via PGXS, then remove build deps
#    to keep the image lean. Everything is one RUN so the build deps never
#    persist in a layer.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        postgresql-16-cron \
        ca-certificates \
        git \
        build-essential \
        postgresql-server-dev-16; \
    git clone --depth 1 --branch "${PGMQ_VERSION}" https://github.com/pgmq/pgmq.git /tmp/pgmq; \
    make -C /tmp/pgmq/pgmq-extension; \
    make -C /tmp/pgmq/pgmq-extension install; \
    rm -rf /tmp/pgmq; \
    apt-get purge -y --auto-remove git build-essential postgresql-server-dev-16; \
    rm -rf /var/lib/apt/lists/*

# pg_cron must be loaded via shared_preload_libraries, and its background
# worker only connects to cron.database_name. We append these settings to the
# sample conf the official entrypoint copies into PGDATA on first init.
# This also means CREATE EXTENSION pg_cron can only run in starter_dev.
RUN set -eux; \
    { \
        echo ""; \
        echo "# --- worker-queue: pg_cron settings (see docker/postgres/README.md) ---"; \
        echo "shared_preload_libraries = 'pg_cron'"; \
        echo "cron.database_name = 'starter_dev'"; \
    } >> /usr/share/postgresql/postgresql.conf.sample
