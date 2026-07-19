<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Graphify

**Категория:** [Рабочая среда агента](../by-category/developer-experience.md)  
**Статус:** installed  
**Версия:** 0.9.20  
**Тип:** code-graph  
**Область:** host-and-project

**Теги:** codebase, graph, mcp, agent-workflow

## Если коротко

Локальный структурный граф кода и штатный интерактивный viewer для Brai New.

## Что это такое

Graphify строит локальный AST-граф из исходного кода: узлы соответствуют файлам и символам, а рёбра отражают обнаруженные связи. Его CLI возвращает маленькие релевантные подграфы, а сгенерированный самим Graphify HTML остаётся штатным viewer, без самописной замены интерфейса.

## Зачем это нужно Brai

В Brai New structural вопрос — где находится ответственность и как две части кода связаны — должен решаться до широкого чтения файлов. Graphify сокращает этот первый обход, а SocratiCode затем отдаёт точные semantic fragments; такой порядок не смешивает граф структуры с индексом документов.

## Почему мы выбрали именно этот инструмент

Нужен локальный graph-first слой, который показывает structural relationships быстрее и компактнее полного поиска по checkout.

## Как он работает в нашем контуре

Отдельный systemd watcher отбрасывает собственный `graphify-out/` и запускает штатный AST-only `graphify update` только при изменении кода. Renderer использует Graphify `cluster-only` и локально закреплённый официальный vis-network asset, после чего protected Caddy route отдаёт стандартный `graph.html`.

## Что он даёт

- AST nodes и cross-file relationships
- scoped query, path и explain CLI retrieval
- MCP endpoint и protected штатный HTML viewer

## Практические сценарии

- перед изменением найти структурный subgraph по задаче
- проверить кратчайшую связь двух symbols или modules
- посмотреть текущий Graphify viewer на protected subdomain

## Как мы это используем

Фоновый service обновляет code-only graph; agents используют graphify query/path/explain, а штатный viewer опубликован на protected codegraph.brai.one.

## Где находится

Runtime `/srv/opt/graphify`; игнорируемый output `graphify-out/`; source units в `infrastructure/code-intelligence/systemd`.

## Ограничения

Graphify намеренно не индексирует docs/OpenSpec/Memory Bank в этом проекте и не заменяет SocratiCode semantic search; штатный viewer не является обзорной бизнес-диаграммой.

## Типичные ошибки

- принимать общий viewer за читабельную архитектурную диаграмму
- добавлять документацию в code graph вместо SocratiCode context artifacts
- обходить Graphify raw broad search при доступном healthy graph

## Связанные инструменты

- [SocratiCode](./socraticode.md) — Локальный semantic index, context artifacts и dependency graph для Brai New.
- [Chrome DevTools MCP](./chrome-devtools.md) — Основной инструмент глубокой QA-проверки опубликованных защищённых URL.
- [Caddy](./caddy.md) — Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**0.9.20**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `systemctl status brai-graphify-watch.service`
- `graphify query "<question>"` from the project root
- Authenticated HTTPS check of `https://codegraph.brai.one/graph.html`

## Источники и дальнейшее чтение

- [Graphify lifecycle source](../../../infrastructure/code-intelligence)
- [Project graph policy](../../../AGENTS.md)

[← Вернуться к каталогу стека](../README.md)
