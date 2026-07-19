# Brai New ADR

Это чистый каталог архитектурных решений Brai New. Его канонический источник —
`docs/decisions/` в текущем проекте; записи и сгенерированные страницы старого
проекта сюда не переносились.

Ключевые архитектурные решения: [NATS и service-owned data](20260719-adopt-nats-service-owned-architecture.md),
[Node/pnpm/Nx monorepo](20260719-adopt-node-pnpm-nx-monorepo.md),
[trusted access profiles](20260719-adopt-server-selected-agent-access.md) и
[immutable delivery](20260719-adopt-immutable-artifact-delivery.md), а также
[canonical tool catalog](20260719-adopt-canonical-tool-catalog.md) и
[layered codebase intelligence](20260719-adopt-layered-codebase-intelligence.md).

## Как читать каталог

- ADR фиксирует устойчивое архитектурное решение, его контекст, альтернативы,
  последствия и проверку.
- OpenSpec описывает нормативный контракт изменения и исполняемый план работ.
- Reader-facing документация объясняет систему и способы работы с ней.
- Memory Bank сохраняет рабочий контекст агентов и не заменяет исходные
  спецификации.

## Управление документацией

При каждом durable-изменении агент оценивает влияние на ADR, OpenSpec,
reader-facing docs и Memory Bank. Если отдельный ADR не нужен, причина
фиксируется явно. Если изменение пришло без OpenSpec Change, агент сначала
делает backfill-классификацию и только затем завершает проверку.

Локальные инструкции и команды находятся в `docs/decisions/README.md`,
методология — в `docs/documentation-methodology.md`, а текущие нормативные
workflow-правила — в `openspec/config.yaml` исходного репозитория.

## Публикация

Сайт строится из `docs/decisions/` локальным Log4brains 1.1.0 в тёмной теме
Brai и автоматически публикуется на защищённом `https://adr.brai.one/` только
после ADR/docs/OpenSpec checks. Старый статический root сохранён отдельно для
rollback и не является источником этого каталога.
