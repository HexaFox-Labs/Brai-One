# Caddy route

`factory.caddy` — источник истины для отдельно управляемого marker block `factory.brai.one`. Route опубликован 2026-07-17 и:

- постоянно перенаправляет HTTP на HTTPS;
- защищает web и `/api/*` существующим `brai_unified_basic_auth`, не копируя credentials или hash в проект;
- отключает ACME HTTP challenge и получает TLS-сертификат через доступный challenge;
- удаляет Basic Auth `Authorization` header перед передачей запроса в web или Gateway;
- направляет `/api/*` на `127.0.0.1:3201`, а остальные запросы — на `127.0.0.1:3200`.

Команды управления:

- Проверить: `node infrastructure/caddy/manage-route.mjs --check`
- Применить от root: `node infrastructure/caddy/manage-route.mjs --apply`
- Удалить от root: `node infrastructure/caddy/manage-route.mjs --remove`

Helper валидирует candidate config до reload и восстанавливает предыдущий Caddyfile при ошибке. После изменения route обязательна проверка реального HTTPS URL через изолированный Chrome DevTools с desktop и mobile viewport.

Последний production QA выполнен 2026-07-17: Basic Auth и TLS работают, HTTP перенаправляется на HTTPS, Activity создаётся и сохраняется после reload, console/network чистые. Обнаруженный `favicon.ico` 404 исправлен и проверен после пересборки `brai-web`. Инструменты изолированного browser QA и project allowlist overlay описаны в `infrastructure/chrome-devtools/README.md`.
