# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
  && corepack prepare pnpm@11.15.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/storage/package.json packages/storage/package.json

RUN --mount=type=cache,id=picloud-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm fetch --frozen-lockfile --trust-lockfile \
    --fetch-retries 5 \
    --fetch-retry-maxtimeout 120000 \
    --fetch-timeout 600000 \
    --network-concurrency 4 \
    --store-dir /pnpm/store

COPY . .

RUN --mount=type=cache,id=picloud-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --frozen-lockfile --offline --trust-lockfile \
    --store-dir /pnpm/store \
  && pnpm --filter @picloud/api build

EXPOSE 4000

CMD ["pnpm", "--filter", "@picloud/api", "start"]
