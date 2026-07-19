# Active Context

Дата последнего обновления: `2026-07-19` (UTC)

## Git Flow и affected delivery

Активен OpenSpec Change `gitflow-affected-delivery`. Реализован и установлен
host controller `/srv/opt/brai-delivery`: systemd units
`brai-delivery.service` и `brai-delivery-sweep.timer` активны, listener
`127.0.0.1:3490` проходит health check, а Caddy обслуживает
`preview-01`–`preview-20.brai.one` через TLS и unified Basic Auth. Legacy
`dev.brai.one` и production traffic не переключались.

Delivery использует Nx affected catalog, digest-pinned shared OCI layers и
root-private manifests/slot state вместо копий checkout. Controller выбирает
lowest free `p01`–`p20`, запускает не более пяти preview, поддерживает
release-priority FIFO, 72-hour cleanup, data-only dev snapshots и limits
100/200/250 MiB (target snapshot/hard snapshot/slot). Container identities:
`d-brai-*`, `pNN-brai-*`, `prod-brai-*`.

GitHub repository `HexaFox-Labs/Brai-One` публичен, Actions default token
read-only, `BRAI_DELIVERY_ENDPOINT` указывает на OIDC controller route, а
production environment требует reviewer `HexaFox-Labs` и ограничен
`release/*`. Внешние forks не выполняют trusted project code и не получают
preview. Первая bootstrap-dev delivery и owner-approved cutover `dev.brai.one`
остаются следующими operational gates; Change нельзя архивировать до них.

Web build baseline устранён explicit peer `@opentelemetry/api@1.9.0`: полный
production build проходит. Full CI прошёл format/docs/stack/policy/lint/
typecheck/build/unit/integration; sandboxed Playwright был заблокирован на
localhost, но тот же desktop/mobile web E2E прошёл вне command sandbox.

## Каталог инструментов и страниц стека

По прямому запросу Сергея завершён и архивирован OpenSpec Change
`tooling-catalog-and-stack-pages`
(`openspec/changes/archive/2026-07-19-tooling-catalog-and-stack-pages/`).
Канонический manifest находится в
`tools/stack/catalog.json`; `tools/stack/catalog.mjs` генерирует подробную
mini-landing page каждого инструмента, категории, обзор
`docs/stack/catalog.md` и JSON `docs/stack/catalog.json` для будущего сайта.
В manifest перенесены 36 текущих инструментов Brai New, включая фактически
проверенный RTK `0.42.4` из `/srv/opt/rtk/bin/rtk`. Команды
`pnpm run stack:generate` и `pnpm run stack:check` добавлены в workflow, а CI
проверяет generated parity. В рамках отдельного Change
`expand-tooling-catalog-pages` страницы получили operational sections, а в
текущем Change `rich-tool-explanations-and-install-flow` для всех 36 записей
добавлены полноценные многофразные `whatItIsDetailed` и
`whyNeededDetailed`. Validator отклоняет короткие объяснения, а `AGENTS.md`
теперь требует от агента автоматически регистрировать tooling, генерировать
страницы и запускать checks после установки/обновления/удаления без отдельной
команды от пользователя. UI сайта пока не менялся; следующим отдельным этапом
можно подключить web-ready JSON к стековому route.

## Подключение RTK

RTK `0.42.4` подключён к проекту через корневой [`RTK.md`](../RTK.md) и
ссылку `@RTK.md` в `AGENTS.md`. Бинарник остаётся общим установленным
инструментом в `/srv/opt/rtk/bin/rtk`; проект не содержит собственной копии.
Проверены `rtk --version`, `rtk init --codex --dry-run` и документационные
ссылки. Для этой интеграции OpenSpec Change и ADR не требуются.

## Compact code-quality standard

По прямому запросу Сергея выполняется OpenSpec Change
`compact-code-quality-standard`. Добавлены `.editorconfig`, явная
`.prettierrc.json` с 80-column baseline, `format`/`format:check`, format gate в
`tools/ci/run.mjs`, компактное code-task ядро в `AGENTS.md`,
`docs/reference/code-style.md`, portable router
`tools/agent/brai-code-standard.md` и нормативная
`openspec/specs/code-quality/spec.md`. Generated OpenSpec skills и архивы
исключены из Prettier baseline; project `.codex/skills` read-only, поэтому
новый Codex skill-файл в него не добавлялся.

Механический baseline-форматтер нормализовал активные hand-written files;
runtime behavior не менялся. `format:check`, lint, typecheck, все Nx tests,
`docs:check`, `adr:check` и `openspec validate --all --strict` проходят. Полный
`NODE_ENV=test pnpm run ci` проходит новый format/docs/policy/lint/typecheck и
останавливается на известном baseline `@brai/web:build`:
`trace.getSpan is not a function` при prerendering `/_global-error`.
`docflow finalize` завершён; Change архивирован в
`openspec/changes/archive/2026-07-19-compact-code-quality-standard/`.

## Backfill архитектурной документации

По прямому запросу Сергея выполнен полный audit документации фактического
фундамента Brai New. Добавлен канонический справочник
`docs/reference/microservice-topology.md`: Caddy path routing, контейнеры,
Docker networks, special loopback NATS endpoint runtime host, versioned
Activity subjects, data ownership и статусы реализации. Схема в
`docs/explanation/system-overview.md` исправлена: браузерский `/api/*` идёт
через Caddy в Gateway, а не от `brai-web` прямым межсервисным HTTP-вызовом.

Созданы ADR от `2026-07-19` для четырёх ранее принятых долгоживущих решений:
NATS/service-owned microservice architecture, server-selected agent access и
immutable artifact delivery, а также Node 22/pnpm/Nx monorepo. Нормативные
OpenSpec не менялись: audit не изменил обязательное поведение, а существующие
`brai-factory` и `agent-access` specs уже покрывают соответствующие контракты.
Обновлены индексы docs/ADR, Memory Bank и operator README Compose.
Новые ADR существуют в source catalog `docs/decisions/`. Архивированный Change
`2026-07-19-automate-adr-publication` перевёл `adr.brai.one` на автоматическую
fail-closed публикацию после checks: systemd watcher/timer запускает renderer
от `mark`, сохраняет прежний release при ошибке и добавляет тёмную тему Brai в
static output. Units установлены; initial release с 7 ADR опубликован 2026-07-19
и production QA desktop/mobile через isolated Chrome DevTools пройден.

Повторный реальный source event автоматически выпустил release
`autopublish-20260719044346605-1d8ddc6b9429`; latest release содержит 7 ADR и
10 HTML-страниц с тёмной темой. Change завершён и архивирован после final
docflow; общий strict validation проходит.

Timezone-дефект Log4brains исправлен 2026-07-19: renderer превращал date-only
`2026-07-19` в `23:59:59Z`, поэтому браузер восточнее UTC показывал 20 июля.
Publication нормализует это значение в полдень UTC, а `adr:check` отвергает
несуществующие и будущие даты. Release
`autopublish-20260719050109742-1e0a606bf719` опубликован; isolated Chrome
DevTools подтвердил на реальном URL `Jul 19, 2026` без console errors.

## ADR / Log4brains integration

В рамках завершённого OpenSpec Change `integrate-adr-log4brains` Brai New получил
чистый ADR-каталог в `docs/decisions/` и pinned `log4brains: 1.1.0`. Записи из
`/srv/projects/brai/docs/adr` не переносились. Добавлены `adr:*`/`docs:check`
scripts, deterministic governance checks, canonical shared Codex skill
`/home/mark/.codex/skills/docflow/SKILL.md` и legacy alias
`/home/mark/.codex/skills/documentation-governance/SKILL.md`, repository rules
для ADR impact и atomic static publisher.

2026-07-18 `adr.brai.one` переключён на
`/srv/projects/brai-envs/prod/adr-brai-new/current` под существующей unified
Caddy Basic Auth. На дату публикации финальный site содержал 2 Brai New ADR, homepage и search
index; старый `/srv/projects/brai-envs/prod/adr` сохранён отдельно и проверен
по неизменному index hash. HTTP smoke: unauthenticated `401`, authenticated
`200`, HTTP redirect `308`, bootstrap ADR `200`. Isolated Chrome DevTools
проверил homepage и bootstrap ADR; console чистая для самой страницы, а
загрузки Google Fonts с Authorization header блокируются самим test harness.

Mechanical checks: `pnpm run adr:check`, `pnpm run docs:check`,
`openspec validate --all --strict`, ADR static build/publish и access-policy
tests проходят. Change архивирован в
`openspec/changes/archive/2026-07-18-integrate-adr-log4brains/`; active changes
отсутствуют. Полный `pnpm run ci` дошёл до `@brai/web:build`, но остановился
на существующем Next.js `trace.getSpan is not a function` при prerendering
`/_global-error`; это отдельный baseline blocker, не ADR-код.

## Текущий фокус

Зафиксирован единый стандарт создания документации и OpenSpec-спецификаций для
людей и агентов. Стандарт основан на Diátaxis, но сохраняет нормативный синтаксис
OpenSpec и явно разделяет requirements, design rationale, исполняемые tasks и
reader-facing материалы. Поверх этого стандарта создана рабочая структура
`docs/` с индексом, каталогом стека, архитектурными объяснениями, how-to,
tutorials, reference, ADR и шаблонами.

## Установленное OpenSpec tooling

2026-07-18 установлена официальная глобальная CLI
`@fission-ai/openspec` версии `1.6.0` в `/srv/opt/node-v22.22.3` и
инициализирована Codex-интеграция для `/srv/projects/brai-new`. Проект получил
`openspec/config.yaml`, шесть project-local OpenSpec skills и шесть глобальных
Codex-команд `opsx-*`; нормативные спецификации и архивы не изменялись.

2026-07-18 добавлено и заархивировано обязательное project-local правило
автономного OpenSpec-маршрута:
агент принимает естественно-языковую задачу, сам выбирает/создаёт OpenSpec
Change, запускает CLI, выполняет проверки и архивирует завершённую работу.
Пользователь не обязан вводить `/opsx:*` или `openspec ...`; policy находится в
`AGENTS.md`, а передаваемый OpenSpec context — в `openspec/config.yaml`.
В текущем Change добавлен project-local `docflow` runner для OpenSpec Change,
task-database context и прямых задач; сама task database по-прежнему остаётся
отдельной будущей системой.

## Принятые решения

- Использована стандартная шестифайловая модель Memory Bank: brief, product,
  patterns, tech, active context и progress.
- Добавлен `memory-bank/README.md` с порядком чтения, приоритетом источников и
  правилами обновления.
- `AGENTS.md` остаётся обязательным входом для агента; OpenSpec и код остаются
  источниками нормативной и поведенческой истины.
- Активный контекст хранится отдельно от устойчивых фактов, чтобы не смешивать
  текущую задачу с архитектурой проекта.
- Добавлен `docs/documentation-methodology.md` с картой типов документации,
  соответствием OpenSpec-артефактов, обязательным процессом исследования,
  шаблонами и критериями завершения.
- `AGENTS.md` требует читать этот стандарт перед созданием или существенным
  изменением документации и спецификаций.
- Корневой README содержит входную ссылку, а устойчивый паттерн кратко
  зафиксирован в `systemPatterns.md`.
- `docs/README.md` стал входной картой материалов; `docs/stack/` содержит
  индекс текущих runtime, application, infrastructure и quality tools.

## Реализованная модель documentation-governance

Согласованная модель реализована в Change `docflow-governance`: короткий skill
маршрутизирует работу, а project-local runner выполняет детерминированную
классификацию, baseline/evidence и fail-closed финализацию. Task database,
worktree orchestration и conflict runtime намеренно не входят в этот Change.

- Документация отвечает на вопрос «как система устроена сейчас»: её компоненты,
  потоки, конфигурация, эксплуатация и текущие связи.
- OpenSpec отвечает на вопрос «как система должна себя вести»: обязательное
  будущее поведение, контракты, ограничения и инварианты. Это нормативное ядро,
  а не подробное описание реализации.
- ADR отвечает на вопрос «почему выбрано именно такое решение»: контекст,
  альтернативы, компромиссы и последствия крупных решений.
- Skill должен быть коротким диспетчером с progressive disclosure, а не
  энциклопедией. `AGENTS.md` содержит только центральные принципы и ссылку на
  skill по имени; подробности загружаются из релевантных project-local
  источников.
- Реализована ступенчатая загрузка Memory Bank: после `README.md` всегда
  читаются компактные `activeContext.md` и `progress.md`, а продуктовые,
  архитектурные и runtime-файлы подключаются по маршруту задачи.
- `activeContext` должен содержать только текущую работу, решения, блокеры и
  handoff, а `progress` — актуальные этапы, результаты и незавершённые пункты.
  История отдельных работ не должна постоянно загружаться в контекст и может
  оставаться в Change, task database или архиве.
- Governance имеет быстрый, обычный и полный маршруты. Полный CI и тяжёлые
  проверки не запускаются для каждой правки; результаты целевых проверок
  кэшируются, а полный маршрут запускается только по существенным триггерам.
- Skill работает в фазах preflight и finalize, а не как постоянный watcher.
  Классификация и финализация выполняются независимо от того, пришла задача из
  OpenSpec Change или task database.
- Автоматическая синхронизация является стандартом: агент сам обновляет
  затронутую документацию. OpenSpec меняется только при изменении нормативного
  поведения; ADR — только при крупном решении; отсутствие достаточного
  обоснования не заполняется догадкой, а оставляет задачу открытой до уточнения.
- Любая задача, меняющая код, конфигурацию, документацию, OpenSpec, ADR,
  Memory Bank или deployment-описания, проходит governance. Docs-only задача
  использует быстрый audit-маршрут.
- Завершение работает fail-closed: без доказательства синхронизации нужных
  источников и прохождения релевантных проверок задача не закрывается.
- Если кодовая работа завершена, но документационный вопрос ещё не решён,
  задача может перейти в `pending-governance`: реализация сохраняется, но задача
  и её родитель не закрываются до решения и синхронизации источников.
- При расхождении кода с OpenSpec спецификация не переписывается автоматически
  под фактическую реализацию. Код, тесты и runtime фиксируют actual state, а
  OpenSpec остаётся требованием; расхождение регистрируется как `spec-drift`, и
  агент более высокого уровня выбирает исправление кода либо осознанное
  изменение нормативного поведения.
- Для каждого типа информации выбирается один канонический источник: OpenSpec
  для нормативного, reader-facing docs для текущего устройства, ADR для
  rationale. Остальные страницы не дублируют содержание, а дают аудитории
  нужный контекст и ссылки на канонический раздел.
- Документация и governance различают состояния `planned`, `implemented`,
  `tested`, `installed` и `production-verified`. Агент не повышает статус по
  предположению: отсутствие соответствующего evidence оставляет состояние
  неполным и при необходимости блокирует закрытие задачи.
- Перед созданием ADR агент ищет существующее решение: при сохранении решения
  обновляет текущий ADR, при замене связывает новый через `supersedes`, а новый
  независимый ADR создаёт только для отдельного крупного решения. Дубликаты не
  создаются.
- Финальный governance-отчёт всегда явно фиксирует результат ADR: создан,
  обновлён, связан через `supersedes` или не нужен с кратким обоснованием.
- Канонический универсальный skill называется `docflow`. Имя отражает полный
  цикл audit, sync и finalize; `documentation-governance` сохранён только как
  короткий compatibility alias.
- Результат `docflow` должен быть компактным и структурированным: маршрут
  (`quick`, `normal`, `full`), затронутые источники, действия, проверки,
  блокеры, итоговый статус и ссылки на evidence. Большие тексты документов в
  результат не копируются.
- Прямая команда без существующего Change или task database получает
  автоматический рабочий task-контекст. Для обычной/большой работы создаётся
  task database-запись, для OpenSpec-маршрута добавляется связь с Change, а для
  мелкой quick-задачи допускается временный run-контекст без постоянного
  документа. Change не создаётся только ради идентификации.
- Публикация `adr.brai.one` исключена из общего deploy-правила: Сергей явно
  разрешил installed least-privilege publisher автоматически продвигать только
  валидный статический ADR release после checks; это не распространяется на
  application deployment.
- Маршрут определяется автоматически по task-контексту, изменённым областям,
  затронутым файлам и другим детерминированным сигналам. Неопределённость
  повышает глубину проверки максимум на один уровень, но сама по себе не
  создаёт ADR или меняет OpenSpec.
- Для доказательства изменений `docflow` фиксирует baseline на preflight и
  сравнивает фактическое состояние на finalize: использует diff, когда он
  доступен, и контрольные хеши/manifest в окружениях без пригодного Git.
  Отчёт агента без такого evidence недостаточен.
- Обычная проверка должна занимать секунды и выполняться только на preflight и
  finalize. Тяжёлые проверки запускаются лишь для `full`-маршрута или CI/release,
  а неизменившиеся входы используют кэш.

## Проектируемый универсальный governance и task workflow

Ниже зафиксирована согласованная модель будущей рабочей среды. Это контракт
для последующей реализации task database и orchestration; текущий `docflow`
принимает их generic context, но не реализует саму инфраструктуру.

Граница текущего обсуждения: task database, task API, worktree orchestration и
merge-механика не разрабатываются сейчас. Ниже остаются только краткие заметки
для отдельной будущей задачи; текущий governance runner уже работает с обоими
маршрутами через единый context envelope.

- Рабочий процесс может идти по двум независимым маршрутам: через OpenSpec
  Change или через задачу в task database. Наличие Change не является
  обязательным условием для работы governance.
- Task database хранит состояние работы, иерархию, связи агентов, коммиты,
  блокеры и конфликты. Она не заменяет нормативные OpenSpec, ADR или reader-facing
  документацию.
- Задача может быть атомарной и выполняться одним агентом либо иметь дерево
  дочерних задач любой нужной глубины, включая несколько уровней. Разбиение и
  подключение субагентов определяется сложностью задачи, а не обязательным
  шаблоном.
- В будущей task-системе иерархия задач отвечает прежде всего за владение и
  координацию; точная модель зависимостей и конфликтов будет спроектирована
  отдельной задачей.
- Для большой задачи главный агент владеет родительской веткой и интеграцией.
  Субагенты не должны одновременно писать в один физический checkout и не
  получают обязательные постоянные отдельные ветки; их результаты передаются
  главному агенту коммитами через безопасную изоляцию или последовательное
  применение.
- Перезапись чужих изменений запрещена. Текстовый или смысловой конфликт
  регистрируется как отдельная дочерняя task database-задача типа
  `conflict-resolution`, связанная с родителем, подзадачами, коммитами и файлами.
  Агент, обнаруживший конфликт, только регистрирует его; решение принимает
  агент более высокого уровня. Открытый конфликт блокирует завершение родителя.
- Если конфликт приводит к долговременному архитектурному решению, результат
  дополнительно отражается в ADR, OpenSpec или подробной документации по их
  собственным правилам. Запись конфликта в базе не является заменой этих
  источников истины.
- DB-only работа не обязана автоматически создавать OpenSpec Change. Change
  создаётся или связывается только когда он нужен самому OpenSpec-процессу;
  требования governance, документации и проверки применяются в обоих маршрутах.
- В DB-маршруте нормативная OpenSpec-спецификация может обновляться без Change:
  task database становится рабочим контекстом, а `docflow` требует от него
  достаточные решение, evidence и проверки. Обязателен процесс и доказательство,
  а не конкретная форма Change.
- DB-маршрут не копирует полный пакет Change для каждой работы: `quick` требует
  краткую фиксацию и проверку, `normal` — описание изменённого поведения,
  документацию и evidence, `full` — нормативные требования, ADR при
  необходимости, подробную документацию и расширенные проверки.
- Scope текущей реализации: `docflow` и его project-local governance runner с
  адаптерами OpenSpec и универсального task-контекста реализованы. Сама task
  database, её API, worktree orchestration и merge/conflict runtime остаются
  отдельной будущей системой; текущая реализация принимает их context и
  возвращает компактный governance result.
- Documentation-governance запускается для любой задачи, меняющей проектные
  артефакты: код, конфигурацию, документацию, OpenSpec, ADR, Memory Bank или
  deployment-описания. Входом может быть Change или task database; docs-only
  задачи проходят тот же audit по быстрому маршруту.
- Родительская задача закрывается только после разрешения дочерних задач и
  конфликтов, синхронизации затронутых источников документации, прохождения
  релевантных быстрых/полных проверок и наличия доказательства результата.
  Если доказательства нет, задача остаётся открытой.
- Дочерняя задача может быть закрыта независимо от родителя после выполнения
  собственных требований. При конфликте она не переоткрывается автоматически:
  родитель получает блокирующее состояние, а отдельная `conflict-resolution`
  задача остаётся открытой.
- В многоуровневом дереве каждый промежуточный агент координирует своё
  поддерево, принимает решения по его конфликтам и эскалирует нерешённые
  вопросы агенту более высокого уровня.
- Публикация документации на внешнем ADR-сайте является отдельным deploy-шагом
  и не входит автоматически в завершение локальной задачи.

## Результат реализации `docflow-governance`

- Добавлены `tools/docs/docflow.mjs` и `tools/docs/docflow.test.mjs`, скрипт
  `pnpm run docflow`, компактный skill `docflow` и legacy alias.
- `AGENTS.md`, `openspec/config.yaml`, `memory-bank/README.md` и методология
  описывают единый dual-route workflow с progressive disclosure.
- Permanent OpenSpec specs синхронизированы, создан ADR
  `20260718-adopt-docflow-governance.md`, а Change получил `docs-impact.md`.
- Change завершён и архивирован в
  `openspec/changes/archive/2026-07-18-docflow-governance/` после full-route
  `docflow finalize`.
- Быстрый маршрут не запускает полный CI; full route запускает статические
  проверки и только явно запрошенный CI. Публикация ADR остаётся отдельной.

## Что проверено при заполнении

- Существующей директории Memory Bank до установки не было.
- Архитектурные границы сверены с `README.md`, `AGENTS.md`,
  `openspec/specs/agent-access/spec.md` и
  `openspec/specs/brai-factory/spec.md`.
- Версии runtime, package manager и основные команды сверены с root и package
  manifests.
- Проверены существование внутренних ссылок, форматирование новых Markdown-файлов
  через Prettier и отсутствие merge markers.
- Методология сверена с официальными материалами Diátaxis и с фактической
  структурой завершённых OpenSpec changes проекта.
- Перед созданием структуры исследованы корневые манифесты, 17 package.json,
  README компонентов, Compose/NATS-конфигурация и нормативные спецификации.
- `NODE_ENV=test pnpm run ci` успешно завершился вне sandbox после отдельной
  sandbox-ошибки Playwright `ERR_ACCESS_DENIED` на loopback; все 8 web E2E
  сценариев прошли в desktop/mobile профилях.
- `openspec validate --all --strict` подтвердил permanent specs и Change
  `docflow-governance`; после архивирования active Changes отсутствуют.
- `node --test tools/docs/docflow.test.mjs` подтвердил 9 сценариев, включая
  Change, DB-only, direct, docs-only, `spec-drift`, `pending-governance` и
  `conflict`; `node --check tools/docs/docflow.mjs` прошёл.
- `pnpm run docs:check` проверил 78 Markdown-файлов, `pnpm run adr:check`
  подтвердил 3 ADR, строгая OpenSpec-валидация прошла.

## Следующие шаги

1. Для следующей задачи прочитать `memory-bank/README.md`, затем
   `activeContext.md` и `progress.md`; тематические файлы подключать по
   маршруту.
2. Перед созданием документации или OpenSpec читать
   `docs/documentation-methodology.md` и сначала определять аудиторию, источник
   истины и тип Diátaxis.
3. При изменении версии или состава стека сначала обновить manifest/lockfile,
   затем соответствующий документ в `docs/stack/`.
4. После изменения архитектуры/границ доступа обновить устойчивые документы и
   соответствующие OpenSpec-источники по правилам проекта.
5. Для новых durable задач запускать `docflow` preflight/finalize через
   агентский skill или project-local fallback, не требуя от Сергея ручных
   workflow-команд.
6. После обновления глобальной OpenSpec CLI запускать `openspec update` в
   проекте, чтобы пересобрать Codex skills и команды из текущего профиля.
7. Перед handoff запускать релевантные targeted checks; полный `pnpm run ci`
   выполнять только по full/CI/release-маршруту и записывать результат в
   `progress.md`.

## Блокеры и открытые вопросы

Текущий `docflow-governance` не имеет governance-блокеров после статических
проверок. Полный CI по-прежнему имеет отдельный baseline blocker
`trace.getSpan is not a function` на Next.js `/_global-error`; он не относится
к этому Change и не скрывается в документации.
