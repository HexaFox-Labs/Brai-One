FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS dependencies

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable \
  && corepack prepare pnpm@11.13.1 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY infrastructure/supabase/package.json infrastructure/supabase/package.json

RUN pnpm install --frozen-lockfile --filter @brai/supabase-migrations...

FROM dependencies AS build

COPY tsconfig.base.json ./
COPY infrastructure/supabase infrastructure/supabase

RUN pnpm --filter @brai/supabase-migrations build \
  && pnpm --filter @brai/supabase-migrations deploy \
    --prod \
    --legacy \
    /opt/brai-factory-admin

FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build --chown=node:node /opt/brai-factory-admin ./

USER node

CMD ["node", "dist/migrate.js"]
