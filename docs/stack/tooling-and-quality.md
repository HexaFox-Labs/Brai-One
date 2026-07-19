# Инструменты разработки и качество

**Статус:** `active`

## Проверки

| Инструмент            | Версия   | Для чего                            | Где настроен                                                           |
| --------------------- | -------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Vitest                | `4.1.8`  | Unit и integration tests            | package scripts, `vitest.config.ts`                                    |
| Playwright            | `1.60.0` | Web E2E в desktop и mobile viewport | [`apps/web/playwright.config.ts`](../../apps/web/playwright.config.ts) |
| Testing Library DOM   | `10.4.1` | DOM assertions                      | [`apps/web/package.json`](../../apps/web/package.json)                 |
| Testing Library React | `16.3.2` | React component tests               | [`apps/web/package.json`](../../apps/web/package.json)                 |
| jsdom                 | `29.1.1` | Browser-like Vitest environment     | [`apps/web/package.json`](../../apps/web/package.json)                 |
| ESLint                | `9.39.4` | Lint                                | [`eslint.config.mjs`](../../eslint.config.mjs)                         |
| Prettier              | `3.9.5`  | Formatting                          | [`.prettierrc.json`](../../.prettierrc.json), package scripts          |
| Log4brains            | `1.1.0`  | ADR catalog and static site         | [`.log4brains.yml`](../../.log4brains.yml), `docs/decisions/`          |
| RTK                   | `0.42.4` | Compact shell-command output        | [`RTK.md`](../../RTK.md), global `/srv/opt/rtk/bin/rtk`                |

Playwright использует Chromium, desktop viewport `1280x900` и Pixel 7. Для
защищённого опубликованного URL это не заменяет обязательную проверку через
Chrome DevTools MCP, описанную в `AGENTS.md`.

## CI и policy

`pnpm run ci` запускает `tools/ci/run.mjs`, который сначала проверяет Prettier,
затем объединяет policy audit, lint, typecheck, tests и build через локальный
Nx task graph. Nx Cloud
отключён. Интеграционные тесты могут запускать короткоживущие Docker
контейнеры и обязаны использовать `NODE_ENV=test`.

`pnpm run preflight:access` — host-проверка checkout и пользователя `mark`.
Она не исправляет ownership или permissions. Рекурсивные `chmod`/`chown` не
являются штатным workflow.

`pnpm run docs:check` запускается перед остальными workspace-проверками в
`pnpm run ci` и проверяет ссылки, merge markers и форматирование поддерживаемого
документационного контура.

Для локальной проверки исходников используй `pnpm run format:check`; исправление
выполняет `pnpm run format`. Generated OpenSpec skills и архивные материалы
исключены из baseline через [`.prettierignore`](../../.prettierignore).

Для повседневных команд разработки используй `rtk` как префикс, например
`rtk git status`, `rtk pnpm test` или `rtk docker ps`. Если нужен полный или
точный вывод, запускай исходную команду с `RTK_DISABLED=1` либо используй
`rtk proxy <cmd>`.

## Документация как код

- Diátaxis разделяет учебник, процедуру, справочник и объяснение.
- ADR фиксирует долгоживущие архитектурные решения в `docs/decisions/` и
  публикуется Log4brains на защищённом `adr.brai.one`.
- OpenSpec фиксирует нормативные requirements и scenarios.
- Memory Bank хранит сжатый контекст для агентов.
- Markdown остаётся первичным форматом; каждый документ должен иметь
  владельца/источник и проверяемые ссылки.

Перед handoff документационного изменения нужно как минимум проверить:

```bash
pnpm exec prettier --check \
  docs/README.md \
  docs/architecture/*.md \
  docs/decisions/*.md \
  docs/explanation/*.md \
  docs/how-to/*.md \
  docs/reference/*.md \
  docs/stack/*.md \
  docs/templates/*.md \
  docs/tutorials/*.md
```

Проверка ADR выполняется отдельно:

```bash
pnpm run adr:check
```

Для существующего или изменённого документа добавь его в явный список; не
переформатируй большие исторические материалы только ради этого smoke-check.
