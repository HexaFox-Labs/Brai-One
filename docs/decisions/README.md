# Architecture Decision Records

ADR фиксируют решения, которые переживают одну задачу: выбор подхода,
границы системы, инфраструктурный механизм или долговременное правило.

## Индекс

- [ADR-0001: структура документации](0001-documentation-structure.md)
- [Принять Log4brains для ADR Brai New](20260718-adopt-log4brains-for-brai-new.md)
- [Принять docflow как единый workflow документации и спецификаций](20260718-adopt-docflow-governance.md)
- [Принять NATS-центричную микросервисную архитектуру с service-owned данными](20260719-adopt-nats-service-owned-architecture.md)
- [Принять Node 22, pnpm workspaces и Nx как основу Brai New monorepo](20260719-adopt-node-pnpm-nx-monorepo.md)
- [Принять server-selected профили доступа и постоянные изолированные среды](20260719-adopt-server-selected-agent-access.md)
- [Принять immutable artifact delivery вне live checkout](20260719-adopt-immutable-artifact-delivery.md)
- [Принять canonical catalog как источник страниц стека](20260719-adopt-canonical-tool-catalog.md)
- [Принять разделённые Graphify и SocratiCode для codebase intelligence](20260719-adopt-layered-codebase-intelligence.md)

Log4brains строит сайт из этой папки. Локальные команды проекта:

- `pnpm run adr:list` — список записей;
- `pnpm run adr:preview` — локальный preview;
- `pnpm run adr:build` — статическая сборка;
- `pnpm run adr:check` — проверка метаданных и совместимости с Log4brains.

Принятые изменения здесь автоматически проверяются и публикуются на
`adr.brai.one` systemd watcher-ом; static output всегда получает тёмную тему
Brai. Ручная команда `pnpm run adr:auto-publish` нужна только для диагностики.

## Правила ADR

- один ADR отвечает за одно решение;
- решение пишется в прошедшем/настоящем времени, а не как список пожеланий;
- обязательно указать статус, deciders, дату, контекст, принятое решение,
  последствия, альтернативы, проверку и ссылки;
- ADR не заменяет OpenSpec, если решение меняет нормативный контракт;
- после отмены старый ADR не переписывается: создаётся новый ADR с явной
  ссылкой на заменяемый.

Шаблон: [`../templates/adr.md`](../templates/adr.md).
