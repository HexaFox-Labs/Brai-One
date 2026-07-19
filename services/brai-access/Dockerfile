FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@11.13.1 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/agent-access/package.json packages/agent-access/package.json
COPY packages/nats/package.json packages/nats/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY services/brai-access/package.json services/brai-access/package.json

RUN pnpm install --frozen-lockfile --filter @brai/brai-access...

COPY packages/contracts packages/contracts
COPY packages/agent-access packages/agent-access
COPY packages/nats packages/nats
COPY packages/runtime packages/runtime
COPY services/brai-access services/brai-access

RUN pnpm --filter @brai/contracts build \
  && pnpm --filter @brai/runtime build \
  && pnpm --filter @brai/agent-access build \
  && pnpm --filter @brai/nats build \
  && pnpm --filter @brai/brai-access build \
  && pnpm --filter @brai/brai-access deploy \
    --prod \
    --legacy \
    /opt/brai-access

FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build --chown=node:node /opt/brai-access ./

USER node

HEALTHCHECK --interval=30s --timeout=8s --start-period=15s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

CMD ["node", "dist/main.js"]
