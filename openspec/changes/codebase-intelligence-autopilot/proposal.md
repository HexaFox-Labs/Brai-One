## Why

Агенты Brai New повторно обходят код, спецификации и документацию, а знания о
структуре репозитория зависят от живого интерактивного процесса. Нужен
установленный и самовосстанавливающийся локальный слой codebase intelligence,
который остаётся актуальным после перезапуска и доступен агентам без ручного
управления.

## What Changes

- Установить и зарегистрировать Graphify и SocratiCode как host-level tooling.
- Ввести постоянную индексацию Brai New: Graphify поддерживает атомарный граф,
  SocratiCode — semantic index, context artifacts и dependency graph.
- Добавить managed supervisor, health timer, safe rebuild/retry и проверяемый
  статус, не открывающие новые inbound-порты напрямую.
- Включить Graphify-first и SocratiCode-second workflow для Codex.
- Опубликовать Graphify MCP/graph view на защищённом HTTPS subdomain
  `codegraph.brai.one` за unified Caddy Basic Auth.
- Добавить controlled upgrade/rollback contract, operator documentation,
  tooling catalog и host deployment registry.

## Capabilities

### New Capabilities

- `codebase-intelligence-autopilot`: Постоянно актуальные, локальные и
  self-healing Graphify/SocratiCode indices, workflow и protected graph route.

### Modified Capabilities

- `agent-access`: Host-level code intelligence services получают ровно
  ограниченный доступ к checkout, собственному state и loopback endpoint.
- `tooling-catalog`: Новые installed tools и их detailed stack records
  регистрируются и проверяются в том же change.

## Impact

Затрагиваются host tooling под `/srv/opt`, проектные конфигурации и scripts,
Codex hooks/инструкции, systemd services/timers, Caddy managed routes,
`/home/mark/DEPLOYMENT.md`, catalog stack и reader-facing operator docs.
