# syntax=docker/dockerfile:1.7

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

RUN corepack enable \
  && corepack prepare pnpm@11.13.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile --filter @brai/web...

COPY apps/web apps/web

RUN pnpm --filter @brai/web build

FROM nginx:1.29.1-alpine@sha256:42a516af16b852e33b7682d5ef8acbd5d13fe08fecadc7ed98605ba5e3b26ab8 AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf \
  && chown -R nginx:nginx /var/cache/nginx /var/run /usr/share/nginx/html

COPY --chown=nginx:nginx --chmod=0444 apps/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /workspace/apps/web/out /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/health/live | grep -q '"status":"ok"' || exit 1

CMD ["nginx", "-g", "daemon off;"]
