# Brai Factory foundation

## Why

Brai пересоздаётся как микросервисная система, где HTTP edge отделён от доменных сервисов, а единственным транспортом между сервисами является NATS. Первый вертикальный срез должен подтвердить этот подход на простой сущности Activity и подготовить повторяемую основу для будущих сервисов и workers.

## What changes

- Создаётся package-based monorepo на Node.js 22, pnpm, Nx и Lerna.
- Добавляются static Next.js web, Fastify API Gateway, NATS и headless `brai-factory`.
- В существующем Supabase создаётся приватная schema `brai_factory`.
- Публикуется защищённый endpoint `factory.brai.one`.
- Добавляются общие contracts/runtime/NATS packages, CI-команда и генератор сервисов.

## Boundaries

- В первой версии Activity поддерживает только create и list.
- Нет Git, Nx Cloud, SSR, application auth, CRUD, статусов, SSE/WebSocket и отдельных Dev/Preview окружений.
- Старый `/srv/projects/brai` остаётся read-only источником UI foundation и brand assets.

