# Brai New project agent rules

Этот файл — короткое project-local ядро поверх глобальных workspace rules.
Пользователь даёт задачи естественным языком; внутренние CLI и slash-команды
агент выполняет сам и не требует их от пользователя.

## Автоматическая регистрация installed tooling

После любой фактической установки, обновления или удаления инструмента, который
используется Brai или агентским workflow, агент MUST в той же задаче:

1. установить факт источника, версии, места, назначения и проверки инструмента;
2. обновить `/home/mark/DEPLOYMENT.md` для host-level изменения и соответствующий
   package/config source для project-level изменения;
3. добавить или изменить запись в `tools/stack/catalog.json`, включая категорию,
   развёрнутые объяснения `whatItIsDetailed` и `whyNeededDetailed` минимум в
   двух предложениях каждое, а также usage, limitations и verification;
4. автоматически сгенерировать страницы стека, JSON и category indexes и
   выполнить stack/docs checks до отчёта о завершении.

Команды `stack:generate` и `stack:check` являются внутренними механизмами
агента. Пользователь не должен отдельно просить их запускать или вручную
заполнять страницы после установки. Если назначение, версия или источник не
подтверждены, агент обязан сообщить об этом и не выдавать установку как
полностью зарегистрированную в стеке.

## Контекст

В начале задачи прочитай `memory-bank/README.md`, затем компактные
`activeContext.md` и `progress.md`. По маршруту задачи догрузи только нужные
тематические Memory Bank-файлы, OpenSpec, документацию, код, тесты и конфигурацию.
Перед изменением reader-facing docs или технических specs прочитай
`docs/documentation-methodology.md`.

## Центральные правила docflow

- Используй skill `docflow` на preflight и finalize. Если skill недоступен,
  запускай project-local `pnpm run docflow -- ...`.
- Governance применяется к любому изменению кода, конфигурации, docs, OpenSpec,
  ADR, Memory Bank или deployment-описаний.
- OpenSpec отвечает «как должно быть», reader-facing документация — «как
  устроено сейчас», ADR — «почему так решили».
- Change и task database — независимые рабочие маршруты. Change не создаётся
  только ради идентификатора задачи; DB-only работа сохраняет те же governance
  требования.
- `docflow` выбирает `quick`, `normal` или `full`; неопределённость углубляет
  audit, но сама не создаёт ADR и не меняет OpenSpec.
- Агент автоматически синхронизирует затронутые документы, не выдумывает
  rationale и не подгоняет OpenSpec под код. Расхождение фиксируется как
  `spec-drift`.
- Финальный отчёт обязан содержать route, evidence, проверки и результат ADR
  (`created`, `updated`, `superseded` или `not-required` с причиной). Без
  доказательства задача остаётся открытой (`pending-governance`/`blocked`).
- Полный CI не запускается на каждую правку; тяжёлые проверки выполняются по
  `full`/CI/release-маршруту. Проверенный source принятого ADR автоматически
  публикуется на `adr.brai.one` отдельным least-privilege host publisher; это
  исключение не разрешает другие deploy.

## Стандарт исходного кода

При изменении исходников, тестов или code configuration агент MUST следовать
краткому [`docs/reference/code-style.md`](docs/reference/code-style.md), а
нормативные требования брать из
[`openspec/specs/code-quality/spec.md`](openspec/specs/code-quality/spec.md).
Подробный style guide не загружается для задач, не связанных с кодом.

- Используй repository Prettier для форматирования и ESLint для корректности.
- Публичные или contract-facing exports документируй TSDoc только там, где
  нужны поведение, ограничения, ошибки, deprecation или пример.
- Комментарии объясняют `why`, инварианты и security-ограничения, а не
  повторяют очевидный код.
- `eslint-disable` должен иметь узкий scope и причину; старый код не
  комментируй; deferred work помечай `TODO(<task-or-issue>): <action>`.
- Перед завершением запусти `pnpm run format:check`, релевантные lint/typecheck
  и тесты; результат укажи в evidence.

## OpenSpec и источники истины

- Агент не заменяет выбранный внешний инструмент, его штатный пользовательский
  интерфейс или ожидаемый результат самописной альтернативой без явного
  согласия Сергея. При блокировке штатного пути агент фиксирует причину,
  безопасные варианты и ожидает решения пользователя.

OpenSpec Change используется, когда выбран этот рабочий маршрут; тогда агент
сам создаёт/продолжает `proposal.md`, delta specs, `design.md` и `tasks.md`,
синхронизирует permanent specs и архивирует Change только после проверки.
Planning-only Change остаётся активным. В DB-only маршруте Change может
отсутствовать, а нормативная OpenSpec может обновляться из task context с
evidence.

При расхождении приоритет такой: пользовательские и workspace rules, этот
файл, постоянные OpenSpec specs, код/конфигурация/тесты, Memory Bank, архив.
`proposal.md`, `design.md` и generated skills не ослабляют нормы проекта.

Для access-boundary изменений всегда синхронизируй
`openspec/specs/agent-access/spec.md` и matching work context. Не меняй профиль
доступа по выбору пользователя, prompt или модели.

Автоматический workflow не даёт разрешения на merge, deploy, production-релиз
или внешние сообщения. Для них нужна явная команда пользователя. Исключение:
Сергей явно разрешил установленному ADR publisher продвигать только валидный
статический release `adr.brai.one` после его checks.

## Отчёт

После durable работы сообщи выбранный источник задачи, route, изменённые
артефакты, checks, evidence, ADR-решение, статус завершения и ограничения.
Для quick-работы явно укажи, что durable OpenSpec Change не создавался.

@RTK.md

## Codebase intelligence

For non-trivial codebase discovery, agents MUST ask Graphify for a structural
map before broad raw file search, then use SocratiCode to retrieve current
semantic fragments, context artifacts or dependency data. If either local layer
is marked degraded in `/srv/opt/graphify/state/brai-new/status.json`, agents
MUST continue through the healthy layer and MUST NOT stop implementation.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
