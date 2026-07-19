# Принять разделённые Graphify и SocratiCode для codebase intelligence

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: архитектура, agent-workflow, tooling

## Контекст

Агентам Brai New нужен постоянно актуальный способ ориентироваться в
монорепозитории без повторного широкого обхода файлов и без ручного запуска
индексаторов. Structural relationships между кодовыми сущностями и semantic
retrieval текущих фрагментов, документации и OpenSpec требуют разных
представлений данных и разных operational controls.

Сергей выбрал режим «установить и забыть»: оба слоя должны переживать restart,
catch-up и обычные сбои без участия пользователя. Публичным остаётся только
штатный Graphify viewer через protected HTTPS; vector database, embedding
runtime и MCP bind only to loopback.

## Решение

Graphify принят как первый, code-only structural layer. Он строит локальный
AST-граф из исходников и конфигурации, а агенты начинают нетривиальное
исследование с `query`, `path` или `explain`. Его штатный HTML viewer
публикуется на `codegraph.brai.one`; самописная замена viewer запрещена без
явного согласия Сергея. Browser asset Graphify закреплён локально, поэтому
viewer не требует внешнего CDN.

SocratiCode принят как второй semantic/context layer. После structural map он
возвращает current code fragments, dependency information и selected context
artifacts: docs, OpenSpec, Memory Bank, agent rules и infrastructure. Эти
документы не включаются в Graphify graph.

Оба слоя обслуживаются отдельными systemd services и независимым health timer.
Health failure одного слоя не блокирует агента: он продолжает через другой
здоровый слой, а service восстанавливается в фоне. Релизы расположены под
`/srv/opt/` и обновляются только через проверяемую promotion/rollback процедуру.

## Рассмотренные альтернативы

- Только SocratiCode: semantic search полезен, но не заменяет компактный
  structural graph и path-oriented navigation Graphify.
- Только Graphify: граф не является semantic/document retrieval и не должен
  раздуваться Markdown/OpenSpec nodes.
- CodeGraph как третий слой: дублирует функции двух выбранных инструментов и
  добавляет новый lifecycle, watcher и maintenance surface без доказанной
  выгоды.
- Самописный web-интерфейс: отвергнут. Он меняет ожидаемый результат внешнего
  инструмента и не был согласован пользователем.

## Последствия

- Плюс: агент получает последовательность «структура → смысловой фрагмент →
  targeted read», уменьшая широкий file search и token cost.
- Плюс: Graphify graph не загрязняется тысячами документационных nodes, а
  SocratiCode всё равно видит documentation context.
- Минус: поддерживаются два локальных индекса и их lifecycle, поэтому нужны
  state records, systemd restart policy и health timer.
- Риск: initial local embeddings могут занять заметное время; checkpointed
  SocratiCode indexing продолжает работу после restart и не требует ручного
  перезапуска.

## Проверка

- `brai-graphify-watch.service`, `brai-graphify-view.service`,
  `brai-graphify-mcp.service`, `brai-socraticode.service` и health timer
  enabled/active.
- Graphify `graph.json` содержит code-only nodes, `query/path/explain` работают,
  а output changes не запускают recursive rebuild.
- SocratiCode reports a completed index, active watcher, indexed context
  artifacts и successful semantic retrieval.
- Isolated Chrome DevTools подтверждает Caddy-authenticated desktop/mobile
  access к `https://codegraph.brai.one/graph.html` без console/network errors.

## Ссылки

- [OpenSpec capability](../../openspec/specs/codebase-intelligence-autopilot/spec.md)
- [Операционный справочник](../reference/codebase-intelligence.md)
- [Graphify/SocratiCode source](../../infrastructure/code-intelligence/)

## Заменяет

Нет.

## Заменено

Нет.
