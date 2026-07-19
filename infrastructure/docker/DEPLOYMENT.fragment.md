<!-- BEGIN BRAI FACTORY FOUNDATION -->

## pnpm 11

**Описание:** закреплённый package manager для нового package-based monorepo Brai Factory.

**Для чего используется:** один workspace lockfile, catalog версий, контролируемые dependency build scripts и запуск Nx/Lerna workflow проекта `/srv/projects/brai-new`.

**Как используется:** команда `pnpm` доступна через `/home/mark/.local/bin/pnpm`; стабильная ссылка `/srv/opt/pnpm` указывает на версионированную установку. В проекте `pnpm ci` выполняет clean frozen install, lint, strict typecheck, unit и Testcontainers integration tests, production builds, Playwright desktop/mobile и `docker compose config`.

**Откуда брать / где находится:** `/srv/opt/pnpm-11.13.1`, `/srv/opt/pnpm`, `/home/mark/.local/bin/pnpm`; project store/cache — `/srv/projects/brai-new/.pnpm-store`.

**Текущий статус / источник истины:** установлен 2026-07-16; версия `11.13.1`; project package manager закреплён в `/srv/projects/brai-new/package.json`, workspace settings — в `/srv/projects/brai-new/pnpm-workspace.yaml`.

## mcporter для изолированного Chrome DevTools QA

**Описание:** CLI-клиент MCP для запуска отдельной изолированной Chrome DevTools-сессии при проверке защищённых production URL.

**Для чего используется:** desktop/mobile QA опубликованного `factory.brai.one` через настоящий HTTPS и Caddy Basic Auth без подключения к личному Chrome-профилю. Project overlay добавляет `factory.brai.one` в разрешённые адреса Caddy-auth bridge.

**Как используется:** команда `mcporter` доступна через `/home/mark/.local/bin/mcporter`; стабильная ссылка `/srv/opt/mcporter` указывает на версионированную установку. Project configuration, installer и инструкция находятся в `/srv/projects/brai-new/infrastructure/chrome-devtools`; временный MCP daemon после QA останавливается.

**Откуда брать / где находится:** `/srv/opt/mcporter-0.9.0`, `/srv/opt/mcporter`, `/home/mark/.local/bin/mcporter`; project overlay — `/srv/projects/brai-new/infrastructure/chrome-devtools`.

**Текущий статус / источник истины:** установлен 2026-07-17; версия `0.9.0`; overlay установлен для `factory.brai.one` и используется только в изолированном browser profile.

## Brai Factory microservice foundation

**Описание:** новый независимый микросервисный каркас Brai для общего списка Activity. Старый `/srv/projects/brai` не изменяется и использовался только как источник UI/design assets.

**Для чего используется:** `brai-web` раздаёт static Next.js UI, `brai-api-gateway` переводит same-origin HTTP в NATS request/reply, `brai-factory` владеет Activity и приватной схемой Supabase `brai_factory`, `brai-nats` обеспечивает единственную межсервисную шину с включённым JetStream без streams.

**Как используется:** runtime управляется из `/srv/projects/brai-new/compose.yml`. Штатные команды: `sudo docker compose up -d brai-nats brai-factory brai-api-gateway brai-web`, `sudo docker compose ps`, `sudo docker compose logs --tail=100 <service>`, `sudo docker compose restart <service>`, `sudo docker compose down`. Web и Gateway доступны хосту только на `127.0.0.1:3200` и `127.0.0.1:3201`; NATS и Factory не публикуют host ports. Production env создаётся идемпотентно командой `sudo /srv/projects/brai-new/infrastructure/docker/provision-production-env.sh`. После Supabase/pg_net install, upgrade или создания новых database roles выполняется `sudo /srv/projects/brai-new/infrastructure/supabase/apply-runtime-role-hardening.sh`, затем one-off `brai-factory-admin node dist/provision-runtime-role.js` и `node dist/audit-runtime-role.js`. Access migrations запускаются только one-off образом `brai-access-admin` с `/etc/brai-new/access-migrations.env`; access runtime login не включается до установки runtime/controller и backup-wrapper.

**Откуда брать / где находится:** source of truth `/srv/projects/brai-new`; protected runtime configuration `/etc/brai-new` (`0700`, env files `0600`, включая root-owned `/etc/brai-new/access-migrations.env`); Compose networks `brai-edge`, internal `brai-bus` и existing external `brai-supabase`; persistent volume `brai-nats-data`; database migration packages `/srv/projects/brai-new/infrastructure/supabase` и `/srv/projects/brai-new/services/brai-access/migrations`; installed backup drop-in `/etc/systemd/system/brai-db-telegram-backup.service.d/brai-factory.conf`; Caddy candidate `/srv/projects/brai-new/infrastructure/caddy/factory.caddy`, atomic helper `/srv/projects/brai-new/infrastructure/caddy/manage-route.mjs`. Unified Basic Auth credentials остаются только в `/home/mark/.server-secrets/caddy-basic-auth-admin.txt`.

**Текущий статус / источник истины:** установлен 2026-07-16, опубликован 2026-07-17. Контейнеры `brai-web`, `brai-api-gateway`, `brai-nats`, `brai-factory` работают как non-root с `restart: unless-stopped`, read-only filesystem где применимо, `no-new-privileges`, `cap_drop=ALL`, healthchecks и Docker log rotation `50m × 3`; все healthy. Локальные images: `brai-web:0.0.1`, `brai-api-gateway:0.0.1`, `brai-nats:0.0.1`, `brai-factory:0.0.1`, one-off `brai-factory-admin:0.0.1`. Factory migrations `0001` и `0002` применены 2026-07-17. Строгий runtime-role audit после повторного PUBLIC/pg_net hardening проходит: `brai_factory_runtime` имеет `CONNECTION LIMIT 10`, server defaults `statement_timeout=4s`, `lock_timeout=2s`, `idle_in_transaction_session_timeout=5s`, только `CONNECT`, `USAGE` своей схемы и `SELECT/INSERT` своей таблицы, без `TEMPORARY`, `public`, `net`, `UPDATE`, migration table или `auth`. Hardening сохраняет только прежние общие права существующих non-Brai ролей и не расширяет новые роли при повторном запуске. Bootstrap access migration `0001_initial.sql` применена 2026-07-17 с checksum `80e273d8115a9efac693cfc99d6c227a715b3b572068d9c9882bef64c3c45455`; повторный runner применил `0` migrations. Приватная схема `brai_access` содержит восемь foundation tables и `0` domain rows. Роль `brai_access_runtime` остаётся `NOLOGIN`, без memberships, с `CONNECTION LIMIT 10`, timeout defaults `4s/2s/5s` и только exact least-privilege ACL своей схемы; access runtime/container/listener отсутствуют. Текущий nightly backup drop-in включает `brai_factory`, но ещё не `brai_access`; это допустимо только для пустого bootstrap-контура. Запись access-данных и запуск runtime запрещены до атомарной установки checked-in backup-wrapper/drop-in и успешной backup-проверки обеих схем. Readiness Gateway подтверждает активный NATS round-trip и меняется `200 → 503 → 200` при stop/start брокера. Реальная Activity пережила restart NATS/Factory. Полный `pnpm ci` проходит: 9 full-stack Testcontainers и 8 Playwright desktop/mobile сценариев; те же 8 сценариев отдельно проходят против production static Nginx на `127.0.0.1:3200`. Backup schema list включает `brai_factory` через отдельный systemd drop-in. `factory.brai.one` опубликован через marker-managed Caddy route: HTTP постоянно перенаправляется на HTTPS, TLS-сертификат работает, весь сайт защищён unified Basic Auth, а `Authorization` удаляется перед upstream. QA выполнен через изолированный Chrome DevTools на реальном HTTPS URL в desktop и mobile viewport: интерфейс и API загрузились без console errors и failed network requests, горизонтального переполнения на mobile нет. Контрольная Activity создана через опубликованный UI, появилась первой и сохранилась после reload. Обнаруженный во время QA `404` для `favicon.ico` исправлен переносом approved brand asset и повторной сборкой `brai-web`.

## Brai New ADR automatic publication

**Описание:** host-level автоматическая сборка и публикация статического ADR-каталога `adr.brai.one`; это не контейнер и не микросервис.

**Для чего используется:** после изменения принятого ADR в `/srv/projects/brai-new/docs/decisions/` или `.log4brains.yml` проверяет ADR/docs/OpenSpec, собирает тёмный static Log4brains output и атомарно меняет active ADR release. Минутный timer страхует пропущенное file event; ошибка оставляет прежний сайт активным.

**Как используется:** units `brai-adr-autopublish.path` и `brai-adr-autopublish.timer` включаются командой `sudo bash /srv/projects/brai-new/infrastructure/adr/install-auto-publish.sh`. Состояние: `systemctl status brai-adr-autopublish.path brai-adr-autopublish.timer`; журнал: `journalctl -u brai-adr-autopublish.service --since today`. Ручная диагностическая сверка: `pnpm run adr:auto-publish`.

**Откуда брать / где находится:** source automation — `/srv/projects/brai-new/infrastructure/adr`; root-owned unit files — `/etc/systemd/system/brai-adr-autopublish.{service,path,timer}`; static release root — `/srv/projects/brai-envs/prod/adr-brai-new`; source of truth ADR — `/srv/projects/brai-new/docs/decisions/`.

**Текущий статус / источник истины:** установлен и initial release успешно опубликован 2026-07-19 от `mark` с записью только в ADR release root; service не получает Docker, Caddy, NATS, Supabase или application secrets. Публичный маршрут остаётся существующим HTTPS+Basic Auth Caddy route и не требует reload при atomic смене `current`.
<!-- END BRAI FACTORY FOUNDATION -->
