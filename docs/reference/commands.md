# Команды проекта

**Статус:** `active`

Команды выполняются из `/srv/projects/brai-new`, если не указано иное. Тестовые
команды используют `NODE_ENV=test`.

## Компактный вывод команд

RTK установлен глобально и подключён к Codex через [`RTK.md`](../../RTK.md):

```bash
rtk git status
rtk pnpm test
rtk docker ps
```

Для точного исходного вывода используй `RTK_DISABLED=1` или `rtk proxy <cmd>`.

## Ежедневная проверка

```bash
pnpm run ci
```

Состав CI: access policy, lint, typecheck, tests и build через Nx. Для
отдельной проверки можно использовать:

```bash
pnpm run format:check
pnpm run format
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run preflight:access
```

`preflight:access` — host-aware проверка ожидаемого владельца `mark`; она не
исправляет права и может быть неприменима на обычном CI runner.

## ADR и документация

```bash
pnpm run adr:list
pnpm run adr:check
pnpm run adr:preview
pnpm run adr:build
pnpm run adr:auto-publish
pnpm run docs:check
```

`adr:list` и `adr:preview` работают с источниками из `docs/decisions/`.
`adr:build` создаёт статический Log4brains-site в `dist/adr` или в каталоге,
переданном через `--out`; output сразу получает проверяемую тёмную тему Brai.
`adr:check` также не пропускает ADR с будущей или несуществующей календарной
датой; publication normalizes date-only timestamp, чтобы дата не смещалась в
часовом поясе читателя.
На production принятые ADR публикует systemd path/timer автоматически;
`adr:auto-publish` — ручная диагностическая сверка того же fail-closed
pipeline, а не обязательный шаг автора ADR. `docs:check` проверяет локальные
Markdown-ссылки, merge markers и форматирование поддерживаемых документов.

## Каталог инструментов

Канонический каталог находится в
[`tools/stack/catalog.json`](../../tools/stack/catalog.json). После установки,
обновления или удаления инструмента агент автоматически добавляет/изменяет
запись и пересобирает производные страницы в той же задаче. Пользователю не
нужно отдельно запускать stack-команды:

```bash
pnpm run stack:generate
pnpm run stack:check
```

`stack:generate` и `stack:check` — внутренние шаги агентского workflow.
Генерация создаёт отдельную страницу инструмента, индекс категории и
`docs/stack/catalog.json` для будущего сайта; проверка контролирует подробные
поля «что это»/«зачем нужно», локальные источники и отсутствие ручного
расхождения generated-файлов. Практический маршрут описан в
[`how-to/manage-stack-tool.md`](../how-to/manage-stack-tool.md).

## Governance для агентов

Агент запускает governance сам; пользователю не нужно вводить эти команды.
`docflow` принимает контекст OpenSpec Change, task database или прямой задачи и
возвращает компактный JSON-результат:

```bash
pnpm run docflow -- preflight --context <context.json> --json
pnpm run docflow -- finalize --context <context.json> --run-id <run-id> --json
```

Контекст может содержать `source`, `taskId`, `parentTaskId`, `changeId`,
`intent`, `files`, `surfaces`, `status`, `evidence`, `docs`, `spec` и `adr`.
`docflow` сам выбирает маршрут `quick`, `normal` или `full`; task database он
не создаёт и не вызывает.

## Workspace и генератор

```bash
pnpm install
pnpm generate:service --name=activity-worker --kind=worker --database=false
# Для database-owning service: --kind=service --database=true
```

После генерации замени имя на нужное и проверь boundary, package scripts,
тесты, NATS subjects и database ownership. Практическая последовательность находится в
[`how-to/add-service.md`](../how-to/add-service.md).

## Локальный Compose

```bash
pnpm run compose:config
docker compose up -d --build brai-web brai-api-gateway brai-nats brai-factory brai-access
docker compose ps
docker compose down
```

`compose.yml` — local/manual model. Он не должен использоваться production CI/CD
на host. Конфигурация и миграции описаны в
[`infrastructure/docker/README.md`](../../infrastructure/docker/README.md).

## Web

```bash
pnpm --dir apps/web dev
pnpm --dir apps/web lint
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm --dir apps/web e2e
```

Для E2E уже работающего runtime передай
`BRAI_WEB_E2E_BASE_URL=http://127.0.0.1:3200`.

## Проверка после инфраструктурного изменения

Не подставляй секреты в репозиторные `.env`-файлы. Перед host/deployment
операцией прочитай соответствующий README в `infrastructure/`; после изменения
установленного tooling обнови `/home/mark/DEPLOYMENT.md`.
