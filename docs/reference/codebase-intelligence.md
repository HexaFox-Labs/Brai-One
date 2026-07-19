# Codebase intelligence: Graphify и SocratiCode

**Статус:** active  
**Источник поведения:** [`openspec/specs/codebase-intelligence-autopilot/spec.md`](../../openspec/specs/codebase-intelligence-autopilot/spec.md) и [`AGENTS.md`](../../AGENTS.md)

## Назначение и границы

Brai New использует две локальные, дополняющие друг друга системы. Graphify
даёт structural map исходного кода, а SocratiCode — semantic retrieval текущих
фрагментов и выбранных context artifacts. Обычному пользователю и агенту не
нужно запускать индексаторы или watcher вручную: systemd обслуживает их в
фоне, а health timer проверяет liveness и freshness.

Graphify намеренно индексирует только code/configuration surface. В
`graphify-out/` не попадают `docs/`, `openspec/`, `memory-bank/`, `.codex/` и
Markdown, поэтому размер графа отражает AST-узлы и связи кода, а не объём
документации. Документация, OpenSpec и Memory Bank объявлены явными
SocratiCode context artifacts и доступны там семантически.

## Как агенты используют слои

1. Для нетривиального codebase discovery агент сначала спрашивает Graphify:
   `query`, `path` или `explain` возвращают ограниченный структурный subgraph.
2. Затем SocratiCode выдаёт актуальные semantic fragments, dependency data или
   context artifact, относящиеся к уже суженной области.
3. После этого агент читает конкретные исходники. Если один слой degraded,
   второй остаётся рабочим; реализация не останавливается из-за одного
   индексатора.

Это не runtime dependency приложения Brai и не access-control механизм.
Ни Graphify, ни SocratiCode не получают публичный application port.

## Фоновая эксплуатация

| Слой | Unit / state | Нормальное поведение |
| --- | --- | --- |
| Graphify update | `brai-graphify-watch.service` | Debounced code changes запускают штатный AST-only `graphify update`; собственный `graphify-out/` исключён из наблюдения. |
| Standard viewer | `brai-graphify-render.path`, `brai-graphify-view.service` | После нового `graph.json` Graphify сам генерирует стандартный `graph.html`; pinned официальный vis-network отдаётся локально. |
| Graphify MCP | `brai-graphify-mcp.service` | Служит только на `127.0.0.1:3212`; Caddy публикует `/mcp` на protected domain. |
| SocratiCode | `brai-socraticode.service` | Resumes checkpointed initial index, затем обновляет индекс, context artifacts, dependency graph и watcher. |
| Recovery | `brai-code-intelligence-health.timer` | Каждые пять минут проверяет units и свежесть state; stale или inactive сервис перезапускается. |

Все services запускаются после host restart через systemd. Local Qdrant/Ollama
и Graphify MCP bind only to loopback; public entrypoint один — Caddy на
`https://codegraph.brai.one`, защищённый общей Caddy Basic Auth.

## Viewer

`https://codegraph.brai.one/` перенаправляет на созданный Graphify
`graph.html`. Это штатный exploration viewer Graphify, а не обзорная
архитектурная диаграмма: на крупном монорепозитории он показывает плотную
сетевую структуру и полезен для search/zoom/filter внутри инструмента. Он не
подменяется самописным UI. Внешний CDN не используется: единственный browser
asset viewer закреплён локально под `/srv/opt/graphify/vendor/` и копируется в
игнорируемый output при рендеринге.

## Диагностика и проверка

Эти команды нужны только при диагностике; routine operation не требует их от
пользователя:

```bash
systemctl status brai-graphify-watch.service brai-graphify-view.service brai-graphify-mcp.service
systemctl status brai-socraticode.service brai-code-intelligence-health.timer
cat /srv/opt/graphify/state/brai-new/status.json
cat /srv/opt/graphify/state/brai-new/socraticode-status.json
```

Для SocratiCode сначала проверяется `codebase_status`: semantic search
выполняется только после завершённого initial index. Для Graphify достаточно
проверить существование `graphify-out/graph.json`, status `ready` и штатный
`graphify query` из корня проекта. Published viewer проверяется только на
реальном HTTPS URL с Caddy Basic Auth через isolated Chrome DevTools.

## Обновление и rollback

Релизы Graphify и SocratiCode закреплены под `/srv/opt/`; services используют
стабильные пути. Перед обновлением новый release проходит CLI/smoke acceptance,
после чего services и health contract проверяются повторно. При неуспехе
стабильная ссылка возвращается на ранее проверенный release; индекс и текущий
Graphify output не удаляются автоматически.

Установка, перемещение, обновление или удаление этих tools обязательно
обновляет этот документ, `/home/mark/DEPLOYMENT.md`,
`tools/stack/catalog.json`, generated stack pages, OpenSpec и ADR при изменении
долговременного решения.
