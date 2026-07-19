<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# SocratiCode

**Категория:** [Рабочая среда агента](../by-category/developer-experience.md)  
**Статус:** installed  
**Версия:** 1.8.16  
**Тип:** semantic-code-search  
**Область:** host-and-project

**Теги:** codebase, semantic-search, embeddings, mcp

## Если коротко

Локальный semantic index, context artifacts и dependency graph для Brai New.

## Что это такое

SocratiCode — это локальный MCP-слой семантического поиска по исходникам и выбранным context artifacts. Он создаёт embeddings через локальный runtime, хранит vectors в Qdrant и дополнительно строит dependency graph, поэтому агент получает не только совпадение строки, но и релевантный фрагмент с контекстом.

## Зачем это нужно Brai

Graphify хорошо отвечает на вопрос о структуре, но не предназначен для полнотекстовой документации и точных актуальных фрагментов. SocratiCode закрывает этот второй шаг: он хранит docs/OpenSpec/Memory Bank как явные artifacts и позволяет retrieve после того, как структурный слой сузил область поиска.

## Почему мы выбрали именно этот инструмент

Нужен уже принятый в предыдущем проекте semantic layer, который не дублирует Graphify, а дополняет его current snippets и documentation context.

## Как он работает в нашем контуре

Проектный supervisor продолжает checkpointed index после restart, затем индексирует context artifacts, rebuilds dependency graph и держит SocratiCode watcher. Он использует local-only Qdrant/Ollama, а health timer контролирует liveness и freshness, не открывая новых inbound ports.

## Что он даёт

- semantic code and context-artifact search
- persistent incremental index и filesystem watcher
- dependency graph, impact и flow MCP tools

## Практические сценарии

- получить актуальный implementation fragment по natural-language вопросу
- найти OpenSpec или Memory Bank context после Graphify discovery
- проверить impact и dependency graph перед refactor

## Как мы это используем

Persistent supervisor завершает/обновляет index, context artifacts и dependency graph; agents проверяют status перед semantic search и затем используют MCP tools.

## Где находится

Runtime `/srv/opt/socraticode`; supervisor и source units в `infrastructure/code-intelligence`; local Qdrant/Ollama остаются loopback-only.

## Ограничения

Semantic search не заменяет structural graph, не публикуется через public port и зависит от работоспособности local embedding runtime; поиск запрещён до полного initial index.

## Типичные ошибки

- делать search до `codebase_status` completed
- включать Qdrant или Ollama в публичный ingress
- использовать SocratiCode вместо Graphify для первого structural map

## Связанные инструменты

- [Graphify](./graphify.md) — Локальный структурный граф кода и штатный интерактивный viewer для Brai New.
- [Docker Compose](./docker-compose.md) — Описывает локальный и production-like runtime Brai New как набор сервисов.
- [Node.js](./nodejs.md) — Среда, в которой запускаются приложения, сервисы, workers и инструменты Brai New.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**1.8.16**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `systemctl status brai-socraticode.service`
- SocratiCode `codebase_status` reports completed index and active watcher
- SocratiCode `codebase_search` returns a current project fragment

## Источники и дальнейшее чтение

- [SocratiCode supervisor](../../../infrastructure/code-intelligence/socraticode-supervisor.mjs)
- [Context artifact manifest](../../../.socraticodecontextartifacts.json)

[← Вернуться к каталогу стека](../README.md)
