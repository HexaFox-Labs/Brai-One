## Why

`adr.brai.one` сейчас обслуживает Log4brains из старого проекта, тогда как
Brai New уже имеет собственную структуру документации, OpenSpec и отдельный
workflow агентов. Новому проекту нужен собственный воспроизводимый ADR-контур,
который не зависит от старого checkout и автоматически учитывается при
изменениях архитектуры.

Старые ADR-записи, старый сгенерированный сайт и прочие данные старого проекта
в этот change не переносятся и не удаляются. Новый каталог начинает новую
историю решений Brai New.

## What Changes

- Добавить закреплённый project-local Log4brains 1.1.0 в pnpm-проект.
- Использовать текущий каталог `docs/decisions` как канонический источник ADR
  Brai New, сохранив существующее решение этого проекта.
- Добавить команды для списка, локального preview, сборки и проверки ADR.
- Добавить новый bootstrap ADR о принятии Log4brains в Brai New; записи из
  `/srv/projects/brai/docs/adr` не копировать.
- Установить Codex skill-адаптер `documentation-governance` в общую среду
  агента и закрепить универсальные repository rules/scripts, которые учитывают
  ADR вместе с OpenSpec, docs и Memory Bank независимо от точки запуска.
- Добавить детерминированную проверку ADR и правила для случаев, когда
  изменение пришло без OpenSpec Change.
- Собрать новый статический ADR-сайт и передать `adr.brai.one` под владение
  Brai New, сохранив старый статический каталог нетронутым для rollback.
- Сохранить единую Caddy Basic Auth, HTTPS и отсутствие прямого application
  port.
- Обновить reader-facing документацию, Memory Bank и `/home/mark/DEPLOYMENT.md`.

## Capabilities

### New Capabilities

- `adr-knowledge-base`: собственный каталог ADR Brai New, Log4brains и команды
  работы с ним.
- `adr-publication`: воспроизводимая сборка, публикация и безопасное владение
  `adr.brai.one`.
- `documentation-governance`: автоматическая проверка и синхронизация ADR,
  OpenSpec и reader-facing документации.

### Modified Capabilities

- `agent-workflow`: добавить обязательную ADR-проверку для durable changes и
  backfill-путь, если изменение уже сделано без Change.

## Impact

- Root `package.json` и `pnpm-lock.yaml` получат pinned devDependency и ADR
  scripts.
- `.log4brains.yml`, `docs/decisions/`, `tools/docs/` и документационный
  governance-адаптер получат новые файлы.
- OpenSpec получит новые capabilities и ADR-aware workflow requirement.
- Host static release path и Caddy route для `adr.brai.one` будут переключены
  на Brai New; DNS не меняется.
- Старый checkout `/srv/projects/brai` и его ADR-данные не изменяются.
