# Принять docflow как единый workflow документации и спецификаций

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-18
- Tags: documentation, openspec, adr, agent-workflow, governance

## Контекст

Brai New должен поддерживать подробную reader-facing документацию, нормативные
OpenSpec-спецификации и ADR, но работа не всегда проходит через OpenSpec Change.
Часть будущих задач будет приходить из task database, а небольшие изменения
могут выполняться напрямую. При этом агент не должен каждый раз загружать весь
контекст или запускать тяжёлые проверки, а незакрытый governance не должен
теряться из-за различий между агентами и средами.

## Решение

Ввести `docflow` как единый проектный workflow для любого изменения. Он состоит
из компактного skill-адаптера и project-local детерминированного runner-а
`tools/docs/docflow.mjs`.

- `docflow` принимает OpenSpec Change, task-database context или прямой
  task-context без требования к пользователю вводить внутренние команды.
- Runner автоматически выбирает глубину `quick`, `normal` или `full`, сохраняет
  baseline/evidence и выполняет только соответствующие быстрые проверки.
- Reader-facing docs являются источником текущего состояния, OpenSpec —
  нормативного будущего поведения, ADR — rationale; дублирование не создаётся.
- OpenSpec обновляется только при изменении обязательного поведения или
  контракта. В остальных случаях фиксируется явная причина `not-required`.
- ADR-impact всегда получает явный результат: новый ADR, обновление,
  supersession или `not-required` с причиной.
- Финализация работает fail-closed для `pending-governance`, `blocked`,
  `spec-drift`, конфликтов, отсутствующих доказательств и непройденных
  обязательных проверок.
- Полный CI, merge и application deploy остаются отдельными действиями и не
  запускаются на каждую правку. Исключение с явного согласия Сергея: проверенный
  source принятого ADR автоматически публикуется как статический `adr.brai.one`
  через отдельный least-privilege host service; это не разрешает другие deploy.

Task database, worktree orchestration и runtime разрешения конфликтов в это
решение не входят; они должны подключить тот же context envelope позже.

## Рассмотренные альтернативы

- **Требовать OpenSpec Change для каждой задачи:** отклонено, потому что часть
  работы будет маршрутизироваться через task database или быть тривиальной.
- **Оставить правила только в большом skill или `AGENTS.md`:** отклонено,
  потому что это перегружает постоянно читаемый контекст и не даёт общего
  enforcement для агентов вне Codex.
- **Запускать полный CI после каждой правки:** отклонено из-за задержки и
  отсутствия пропорциональности для быстрых изменений.
- **Создавать ADR автоматически по любому изменению:** отклонено, потому что
  ADR фиксирует крупные долговечные решения, а не каждую реализацию.

## Последствия

- Плюс: один короткий вход работает для разных источников задач и агентов.
- Плюс: текущая документация, нормативные specs и rationale имеют явные
  границы и проверяемый результат.
- Плюс: обычные изменения проходят быстро, а неопределённость приводит к
  ограниченному углублению проверки.
- Минус: task-context обязан передать достаточный manifest и evidence, иначе
  задача останется открытой.
- Минус: будущая task database должна реализовать адаптер и связи родительской
  задачи, подзадач и conflict-resolution tasks отдельно.

## Проверка

- `node --test tools/docs/docflow.test.mjs`
- `pnpm run docflow -- classify --context <context.json> --json`
- `pnpm run docflow -- preflight --context <context.json> --json`
- `pnpm run docflow -- finalize --context <context.json> --run-id <id> --json`
- `pnpm run docs:check`
- `pnpm run adr:check`
- `openspec validate --all --strict`

## Ссылки

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/documentation-methodology.md`](../documentation-methodology.md)
- [`tools/docs/docflow.mjs`](../../tools/docs/docflow.mjs)
- [`openspec/specs/documentation-governance/spec.md`](../../openspec/specs/documentation-governance/spec.md)
- [`openspec/specs/agent-workflow/spec.md`](../../openspec/specs/agent-workflow/spec.md)
- [`openspec/changes/archive/2026-07-18-docflow-governance/proposal.md`](../../openspec/changes/archive/2026-07-18-docflow-governance/proposal.md)

## Заменяет

Нет.

## Заменено

Нет.
