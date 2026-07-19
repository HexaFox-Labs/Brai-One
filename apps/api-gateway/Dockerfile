FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/nats/package.json packages/nats/package.json
COPY packages/runtime/package.json packages/runtime/package.json

RUN pnpm install --frozen-lockfile --filter @brai/api-gateway...

FROM dependencies AS build

COPY tsconfig.base.json ./
COPY apps/api-gateway apps/api-gateway
COPY packages/contracts packages/contracts
COPY packages/nats packages/nats
COPY packages/runtime packages/runtime

RUN pnpm --filter @brai/contracts build \
  && pnpm --filter @brai/nats build \
  && pnpm --filter @brai/runtime build \
  && pnpm --filter @brai/api-gateway build

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/nats/package.json packages/nats/package.json
COPY packages/runtime/package.json packages/runtime/package.json

RUN pnpm install --prod --frozen-lockfile --filter @brai/api-gateway...

FROM node:22.22.3-alpine3.23@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runtime

ENV NODE_ENV=production

WORKDIR /workspace

COPY --from=production-dependencies --chown=node:node /workspace/node_modules node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/api-gateway/node_modules apps/api-gateway/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/packages/contracts/node_modules packages/contracts/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/packages/nats/node_modules packages/nats/node_modules
COPY --from=production-dependencies --chown=node:node /workspace/packages/runtime/node_modules packages/runtime/node_modules
COPY --from=build --chown=node:node /workspace/apps/api-gateway/package.json apps/api-gateway/package.json
COPY --from=build --chown=node:node /workspace/apps/api-gateway/dist apps/api-gateway/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/nats/package.json packages/nats/package.json
COPY --from=build --chown=node:node /workspace/packages/nats/dist packages/nats/dist
COPY --from=build --chown=node:node /workspace/packages/runtime/package.json packages/runtime/package.json
COPY --from=build --chown=node:node /workspace/packages/runtime/dist packages/runtime/dist

USER node

EXPOSE 3201

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3201/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/api-gateway/dist/main.js"]
