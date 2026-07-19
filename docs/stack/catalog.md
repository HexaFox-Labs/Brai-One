<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Каталог инструментов Brai New

Здесь собраны отдельные страницы инструментов, сгруппированные по назначению.
Каждая страница написана для человека: объясняет, что это за инструмент,
зачем он нужен Brai и как проверить, что он работает.

## Runtime и сборка

Базовые среды, package manager и task graph, на которых собирается Brai New.

- [Lerna](tools/lerna.md) — Workspace/release-обвязка поверх общего package-based монорепозитория.
- [Node.js](tools/nodejs.md) — Среда, в которой запускаются приложения, сервисы, workers и инструменты Brai New.
- [Nx](tools/nx.md) — Task graph и cache runner для сборки, тестов и проверок монорепозитория.
- [pnpm](tools/pnpm.md) — Package manager, который устанавливает зависимости и запускает workspace-команды.
- [tsx](tools/tsx.md) — Запускает TypeScript CLI и миграционные скрипты прямо в Node.js.
- [TypeScript](tools/typescript.md) — Строгий язык и компилятор, который описывает контракты Brai New до запуска.

## Прикладной стек

Фреймворки и библиотеки, из которых состоят web, Gateway и messaging boundaries.

- [clsx / tailwind-merge / class-variance-authority](tools/class-names-tools.md) — Малые утилиты для class names и вариантов UI-компонентов.
- [Fastify](tools/fastify.md) — Единственный HTTP edge для Gateway Brai New.
- [Geist](tools/geist.md) — Шрифтовые assets для типографики Brai New.
- [JOSE](tools/jose.md) — Работа с JWT и подписанными структурами на Gateway boundary.
- [lucide-react](tools/lucide-react.md) — Единый набор SVG-иконок для web-интерфейса.
- [NATS](tools/nats.md) — Приватная шина request/reply между Gateway и сервисами Brai New.
- [Next.js](tools/nextjs.md) — Web-фреймворк, который собирает пользовательский интерфейс Brai New.
- [Pino](tools/pino.md) — Структурированные логи для приложений и сервисов.
- [Radix UI](tools/radix-ui.md) — Accessible primitives для интерактивных web-компонентов.
- [React](tools/react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Tailwind CSS](tools/tailwind-css.md) — Utility-first слой стилей для интерфейса Brai New.
- [Zod](tools/zod.md) — Runtime-проверка входных данных и контрактов на HTTP/NATS границах.

## Инфраструктура

Компоненты, которые запускают, защищают и обслуживают runtime Brai New.

- [Caddy](tools/caddy.md) — Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.
- [Docker Compose](tools/docker-compose.md) — Описывает локальный и production-like runtime Brai New как набор сервисов.
- [Nginx](tools/nginx.md) — Непривилегированный static server внутри web runtime image.
- [Supabase / PostgreSQL](tools/supabase-postgresql.md) — Database platform, в которой сервисы владеют своими схемами и ролями.

## Работа с данными

Клиенты и хранилища, через которые сервисы владеют своими данными.

- [pg](tools/postgres-client.md) — Node.js PostgreSQL client для сервисов-владельцев данных и миграций.

## Качество

Проверки, форматирование и тестовые инструменты, удерживающие проект в рабочем состоянии.

- [ESLint](tools/eslint.md) — Проверяет исходный код на ошибки и поддерживаемость.
- [jsdom](tools/jsdom.md) — Browser-like DOM environment для Vitest component tests.
- [Playwright](tools/playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.
- [Prettier](tools/prettier.md) — Автоматически приводит Markdown, JSON и исходники к одному формату.
- [Testing Library](tools/testing-library.md) — Тестирует UI через поведение пользователя и DOM assertions.
- [Vitest](tools/vitest.md) — Быстрый runner unit и integration тестов.

## Документация

Инструменты, которые помогают фиксировать требования, решения и рабочий контекст.

- [Log4brains](tools/log4brains.md) — Собирает ADR в searchable static catalog для архитектурных решений.
- [Memory Bank](tools/memory-bank.md) — Короткий проверяемый handoff-контекст для агентов проекта.
- [OpenSpec](tools/openspec.md) — Хранит нормативные требования, сценарии и durable планы изменений.

## Рабочая среда агента

Инструменты, которые делают повседневную инженерную работу агента быстрее и понятнее.

- [RTK](tools/rtk.md) — Сокращает шумный shell output, чтобы агент видел главное и тратил меньше контекста.

## Браузер и визуальная проверка

Изолированные браузерные и diagramming-инструменты для проверки опубликованного результата.

- [agent-browser](tools/agent-browser.md) — Быстрый браузерный просмотр и простые действия без DevTools-level диагностики.
- [Chrome DevTools MCP](tools/chrome-devtools.md) — Основной инструмент глубокой QA-проверки опубликованных защищённых URL.
- [Kroki](tools/kroki.md) — Локально рендерит текстовые диаграммы в SVG и другие форматы.

[← Вернуться к обзорному стеку](README.md)
