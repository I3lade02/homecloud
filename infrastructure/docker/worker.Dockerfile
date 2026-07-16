FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@11.13.0 --activate

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile \
  && pnpm --filter @picloud/worker build

CMD ["pnpm", "--filter", "@picloud/worker", "start"]
