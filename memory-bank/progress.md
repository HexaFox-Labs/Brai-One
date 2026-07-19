# Progress

Дата последнего обновления: `2026-07-19` (UTC)

## Каталог инструментов и mini-landing pages

- [x] Создан OpenSpec Change `tooling-catalog-and-stack-pages` с proposal,
      design, capability spec и tasks.
- [x] Добавлен канонический `tools/stack/catalog.json` с 36 инструментами,
      фиксированной taxonomy и обязательными человеческими/source полями.
- [x] Реализован детерминированный generator/checker в
      `tools/stack/catalog.mjs`; добавлены `stack:generate` и `stack:check`.
- [x] Сгенерированы individual pages, category indexes, `catalog.md` и
      machine-readable `docs/stack/catalog.json`; RTK зарегистрирован как
      `developer-experience`, версия `0.42.4`.
- [x] `stack:check`, focused catalog tests и `docs:check` проходят; stack check
      подключён к CI.
- [x] Завершены quality/governance checks, docflow finalize и ADR
      `20260719-adopt-canonical-tool-catalog`; Change архивирован как
      `openspec/changes/archive/2026-07-19-tooling-catalog-and-stack-pages/`.
- [ ] Отдельным следующим Change подключить `docs/stack/catalog.json` к web
      stack route; текущая работа UI сайта не меняла.

## Расширение страниц инструментов

- [x] Создан OpenSpec Change `expand-tooling-catalog-pages` для устранения
      недостатка информации на первоначальных страницах.
- [x] В manifest добавлены подробные narrative blocks для всех 36 инструментов:
      rationale, local operating model, capabilities, scenarios, common
      mistakes и related tools.
- [x] Генератор теперь выпускает страницы с подробными разделами, lifecycle,
      verification и дальнейшим чтением; JSON сохраняет те же структурированные
      данные для будущего сайта.
- [x] Validator и focused tests проверяют полноту описания и ссылки между
      инструментами; regenerated output содержит 46 синхронизированных файлов.
- [x] Завершены final docflow, quality/governance checks и архивирование Change
      в `openspec/changes/archive/2026-07-19-expand-tooling-catalog-pages/`.

## Полные объяснения и автоматическая регистрация tooling

- [x] Создан OpenSpec Change `rich-tool-explanations-and-install-flow` после
      уточнения Сергея о недостаточно содержательных страницах.
- [x] Для всех 36 инструментов добавлены `whatItIsDetailed` и
      `whyNeededDetailed`: минимум два предложения и 180 символов каждое.
- [x] Главные разделы generated pages теперь используют эти тексты, а не
      короткие индексные `whatItIs`/`purpose` строки.
- [x] `AGENTS.md`, how-to и commands reference закрепляют автоматический
      post-install/post-update/post-remove workflow агента; пользователь не
      запускает stack-команды отдельно.
- [x] Завершены checks, docflow finalize и архивирование Change в
      `openspec/changes/archive/2026-07-19-rich-tool-explanations-and-install-flow/`.

## Подключение RTK

- [x] Проверен глобальный RTK `0.42.4` в `/srv/opt/rtk/bin/rtk` и отсутствие
      project-specific integration в старом `/srv/projects/brai`.
- [x] Добавлены `RTK.md`, ссылка `@RTK.md` в `AGENTS.md` и записи в
      `docs/stack/tooling-and-quality.md` и `docs/reference/commands.md`.
- [x] Пройдены RTK dry-run, Prettier/docs checks и `docflow finalize`; durable
      OpenSpec Change и ADR не создавались, так как меняется только агентское
      tooling-подключение.

## Compact code-quality standard

- [x] Создан OpenSpec Change `compact-code-quality-standard` с proposal,
      design, delta spec и tasks.
- [x] Добавлены `.editorconfig`, `.prettierrc.json`, `.prettierignore`,
      `format`/`format:check` и CI format gate.
- [x] Выполнен механический Prettier baseline для активных hand-written files;
      generated skills, caches и архивы исключены.
- [x] Добавлены компактное правило в `AGENTS.md`,
      `docs/reference/code-style.md` и portable router
      `tools/agent/brai-code-standard.md`; read-only `.codex/skills` не менялся.
- [x] Создана и синхронизирована permanent spec
      `openspec/specs/code-quality/spec.md`.
- [x] `format:check`, lint, typecheck, все Nx tests, docs/ADR checks и strict
      OpenSpec validation проходят.
- [x] `docflow finalize` завершён, ADR отмечен как `not-required`, Change
      архивирован в `openspec/changes/archive/2026-07-19-compact-code-quality-standard/`;
      полный CI остаётся с известным baseline blocker
      `trace.getSpan is not a function` в Next.js `/_global-error`.

## Аудит архитектурной документации

- [x] Проверены фактические границы микросервисов по Compose, Caddy, NATS ACL,
      Supabase migrations, service README, contracts и архивному Factory design.
- [x] Добавлен канонический справочник `docs/reference/microservice-topology.md`
      с контейнерами, сетями, портами, Activity subjects, data ownership и
      статусами реализации.
- [x] Исправлена общая схема: `/api/*` маршрутизируется Caddy в Gateway; web
      не выполняет прямой service-to-service HTTP-вызов.
- [x] Созданы ADR о NATS/service-owned микросервисной архитектуре, Node/pnpm/Nx
      monorepo, server-selected access profiles и immutable artifact delivery.
- [x] Нормативные Factory/access OpenSpec оставлены без изменений: audit не
      менял обязательное поведение и не обнаружил spec-drift.

## ADR integration и cutover

- [x] Создан и завершён OpenSpec Change `integrate-adr-log4brains` с delta specs,
      design, tasks и `docs-impact.md`; требование пользователя о чистом
      каталоге без переноса старых данных зафиксировано явно.
- [x] В `/srv/projects/brai-new` установлен pinned Log4brains `1.1.0`,
      `.log4brains.yml`, template, bootstrap ADR, homepage и команды
      `adr:list`, `adr:preview`, `adr:build`, `adr:check`, `adr:publish`.
- [x] Добавлены документационный governance skill-адаптер, AGENTS/OpenSpec
      правила, ADR/docs checks, publisher и Caddy cutover/rollback helpers.
- [x] Сайт Brai New собран и опубликован в
      `/srv/projects/brai-envs/prod/adr-brai-new/current`; старый
      `/srv/projects/brai-envs/prod/adr` не изменён и оставлен rollback-root.
- [x] `adr.brai.one` переключён 2026-07-18; authenticated HTTP/HTTPS smoke и
      изолированный Chrome DevTools snapshot подтвердили 2 ADR, homepage,
      search и bootstrap route.
- [x] Delta specs синхронизированы в постоянные
      `openspec/specs/adr-knowledge-base/`, `adr-publication/`,
      `documentation-governance/` и `agent-workflow/`; Change архивирован.
- [ ] Закрыть baseline failure `@brai/web:build` (`trace.getSpan is not a
function` на Next.js `/_global-error`) отдельной задачей; он не блокирует
      ADR publication, но не позволяет считать весь `pnpm run ci` зелёным.

## Автоматическая ADR-публикация и тёмная тема

- [x] Создан OpenSpec Change `automate-adr-publication`: source manifest,
      fail-closed checks и atomic static promotion без нового микросервиса,
      контейнера или public port.
- [x] Установлены `brai-adr-autopublish.path` и timer; service работает от
      `mark`, пишет только в ADR release root и использует лишь disposable
      Log4brains/Next build cache.
- [x] Первичный release от 2026-07-19 содержит 7 ADR и 10 тёмных HTML-страниц;
      Caddy reload не потребовался.
- [x] Production QA `https://adr.brai.one/` через isolated Chrome DevTools:
      Basic Auth, source ADR, тёмный фон при light browser preference, console
      без ошибок и mobile viewport `390×844` без горизонтального overflow.
- [x] Исправлен timezone-сдвиг date-only ADR: Log4brains `23:59:59Z`
      нормализуется в `12:00:00Z`, `adr:check` отвергает future/invalid date,
      а опубликованная страница снова показывает `Jul 19, 2026`.
- [x] Change `automate-adr-publication` finalised и архивирован как
      `openspec/changes/archive/2026-07-19-automate-adr-publication/`;
      `openspec validate --all --strict` проходит.

## Состояние фундамента

- [x] Создан pnpm/Nx TypeScript-монорепозиторий Brai New.
- [x] Зафиксирован первый Factory vertical slice: Activity через web, Gateway,
      NATS и service-owned Supabase schema.
- [x] Зафиксированы нормативные контракты `brai-factory` и `agent-access` в
      `openspec/specs/`.
- [x] Добавлены runtime, NATS, contracts, agent-access, routing и user-project
      database packages.
- [x] Добавлены сервисы `brai-access` и `brai-factory`, web/Gateway,
      инфраструктурные и policy/integration проверки.
- [x] Установлена базовая Memory Bank в `memory-bank/`.
- [x] Зафиксирован обязательный Diátaxis-стандарт для документации и
      OpenSpec-спецификаций в `docs/documentation-methodology.md`.
- [x] Создана расширяемая структура `docs/`: входной индекс, стек, архитектура,
      tutorials, how-to, reference, ADR и шаблоны.
- [x] Установлена официальная OpenSpec CLI `1.6.0` в `/srv/opt/node-v22.22.3`,
      а для `brai-new` сгенерирована Codex-интеграция профиля `core`.
- [x] Зафиксирован и заархивирован autonomous OpenSpec workflow:
      естественно-языковые задачи маршрутизируются агентом без ручного запуска
      `/opsx:*`; постоянная норма находится в `openspec/specs/agent-workflow/`.

## Проверки и уровень уверенности

Установка OpenSpec добавляет глобальный helper tool и интеграционные файлы
Codex; бизнес-код и нормативные specs не менялись. Факты для первоначального
заполнения сверены с текущими файлами:

- `README.md`;
- `AGENTS.md`;
- `package.json`, workspace/package manifests и `compose.yml`;
- `openspec/specs/brai-factory/spec.md`;
- `openspec/specs/agent-access/spec.md`;
- `docs/agent-access-architecture.md` и
  `docs/permissions-and-isolation.md`;
- `nx.json`, `lerna.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  `compose.yml` и README инфраструктурных компонентов.

Каталог документации начинается с [`docs/README.md`](../docs/README.md), а
каталог стека — с [`docs/stack/README.md`](../docs/stack/README.md).

Полный `NODE_ENV=test pnpm run ci` завершился успешно вне sandbox: access
policy, lint, typecheck, build, unit/integration и web E2E прошли; Playwright
подтвердил 8 desktop/mobile сценариев. Первый sandbox-запуск CI получил
`ERR_ACCESS_DENIED` только на loopback E2E, после чего полный запуск в
разрешённом режиме прошёл.

OpenSpec checks после установки: `openspec validate --specs` — 2 passed,
`openspec doctor` — root ok, `openspec status` — active changes отсутствуют.

Проверка autonomous workflow change: после архивации
`openspec validate --all --strict` — 3 specs passed, Prettier для новых правил
и артефактов — без ошибок.

Документационные smoke-проверки пройдены: проверено 37 Markdown-файлов,
все локальные ссылки существуют, Prettier завершился успешно, merge markers и
live-format credential patterns не найдены.

## Следующий этап

Change `agent-autonomous-workflow` архивирован в
`openspec/changes/archive/2026-07-18-agent-autonomous-workflow/`, а его
требования перенесены в постоянную `openspec/specs/agent-workflow/spec.md`.
Следующую функциональную работу агент должен сам оформить по autonomous
OpenSpec workflow, если она меняет архитектурный контракт или границы доступа.

## Проектирование универсального task/governance workflow

- [x] Зафиксировано, что рабочая задача может использовать OpenSpec Change или
      task database; Change не обязателен для DB-only маршрута.
- [x] Уточнено, что DB-маршрут может обновлять нормативную OpenSpec без Change,
      если задача содержит достаточный контекст, evidence и результаты проверок.
- [x] Зафиксировано масштабирование артефактов по маршруту: DB-задача не
      получает полный пакет Change, если её сложность этого не требует.
- [x] Определён scope реализации: `docflow`, project-local runner и адаптеры
      OpenSpec/task-context; task database, её API и orchestration не входят в
      текущую реализацию.
- [x] Зафиксирована рекурсивная иерархия задач: от атомарной задачи одного
      агента до многоуровневого дерева с субагентами.
- [x] Уточнено, что иерархия в будущей task-системе описывает владение и
      координацию; её схема и API не входят в текущий проект skill-а.
- [x] Зафиксировано, что главный агент владеет родительской веткой и принимает
      коммиты подзадач через безопасную изоляцию/последовательную интеграцию;
      чужие изменения нельзя затирать.
- [x] Зафиксирован конфликтный workflow: конфликт становится отдельной
      связанной task database-задачей, регистрируется обнаружившим агентом,
      разрешается агентом более высокого уровня и блокирует родителя до закрытия.
- [x] Зафиксировано независимое завершение дочерних задач: конфликт блокирует
      родителя и оставляет открытой отдельную conflict-задачу, а промежуточные
      агенты координируют собственные поддеревья и эскалируют нерешённое выше.
- [x] Зафиксировано, что documentation-governance не зависит от источника
      задачи и запускается также для docs-only и других проектных артефактов.
- [x] Зафиксировано, что автоматическая синхронизация документации является
      стандартным поведением skill-а, а не только отчётом о найденных пробелах.
- [x] Уточнено разделение источников: документация описывает, как система
      устроена сейчас; OpenSpec — как она должна себя вести; ADR — почему.
- [x] Зафиксирован промежуточный статус `pending-governance`: код можно
      сохранить после реализации, но задача не закрывается до решения
      документационных вопросов.
- [x] Зафиксировано правило `spec-drift`: код не переписывает OpenSpec
      автоматически; расхождение решается агентом более высокого уровня.
- [x] Зафиксирован принцип единственного канонического источника для каждого
      типа информации; остальные документы ссылаются на него и не дублируют
      нормативное или rationale-содержание.
- [x] Зафиксировано различие статусов `planned`, `implemented`, `tested`,
      `installed` и `production-verified`; статусы повышаются только по
      соответствующему evidence.
- [x] Зафиксировано переиспользование ADR: существующее решение обновляется,
      заменённое связывается через `supersedes`, независимое получает новый ADR,
      дубликаты запрещены.
- [x] Зафиксировано, что финальный отчёт всегда содержит результат ADR, включая
      явное обоснование случая «ADR не нужен».
- [ ] Спроектировать task database contract, безопасную интеграцию коммитов и
      автоматические governance hooks после завершения полного анализа.
- [x] Выбрано короткое имя будущего универсального skill-а: `docflow`.
- [x] Зафиксирован компактный контракт результата `docflow`: маршрут,
      источники, действия, проверки, блокеры, статус и evidence-ссылки без
      вывода больших документов в контекст.
- [x] Зафиксировано автоматическое создание рабочего task-контекста для
      прямой команды без Change или task database; для quick-задач допускается
      временный run-контекст.
- [x] Зафиксирована ступенчатая загрузка Memory Bank: компактное ядро всегда,
      тематические файлы и точные источники — только по маршруту задачи;
      activeContext/progress не превращаются в постоянный журнал истории.

## Реализация `docflow-governance`

- [x] Создан OpenSpec Change `docflow-governance` с proposal, design, двумя
      delta specs, tasks и `docs-impact.md`.
- [x] Реализован project-local `tools/docs/docflow.mjs` с контекстом для
      OpenSpec, task database и direct route, классификацией `quick`/`normal`/
      `full`, baseline/evidence, cache и fail-closed finalize.
- [x] Добавлен набор из 9 focused Node tests для маршрутов и блокирующих
      статусов `spec-drift`, `pending-governance` и `conflict`.
- [x] Установлен короткий shared skill `/home/mark/.codex/skills/docflow/`;
      старый `documentation-governance` оставлен compatibility alias.
- [x] `AGENTS.md`, `openspec/config.yaml`, Memory Bank README и методология
      переведены на compact kernel + progressive disclosure.
- [x] Permanent specs синхронизированы, создан ADR
      `docs/decisions/20260718-adopt-docflow-governance.md`, индекс ADR обновлён.
- [x] Пройдены `node --test tools/docs/docflow.test.mjs`, `node --check`,
      `pnpm run docs:check`, `pnpm run adr:check` и
      `openspec validate --all --strict`.
- [x] Архивировать `docflow-governance` после финального `docflow finalize`;
      task database, worktree orchestration и conflict runtime остаются scope
      отдельной будущей разработки.

## Известные ограничения памяти

- Memory Bank — вспомогательное резюме и может устареть.
- Нормативные требования нельзя заменять копированием в эти файлы.
- Перед выводами о runtime, безопасности или deployment нужно читать точные
  спецификации, код, тесты и operator documentation.
