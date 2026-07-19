# Публикация ADR Brai New

**Статус:** `active`

Этот каталог содержит воспроизводимую сборку и публикацию Log4brains. Источник
записей — [`docs/decisions/`](../../docs/decisions/README.md); старые записи из
`/srv/projects/brai/docs/adr` сюда не копируются.

## Локальная проверка

Из корня `brai-new` агент выполняет:

```bash
pnpm run adr:check
pnpm run adr:list
pnpm run adr:build -- --out /tmp/brai-new-adr-build
```

`adr:build` создаёт только статический output. В репозиторий не добавляются
`.log4brains/out`, `dist/adr` или `node_modules`.

Каждая сборка добавляет `brai-adr-theme.css` и подключает его ко всем HTML
страницам output. Это принудительная тёмная тема Brai, а не настройка браузера
и не отдельное приложение.

`Date`/`Дата` ADR — календарная дата в UTC (`YYYY-MM-DD`), не timestamp.
`adr:check` отклоняет будущую или несуществующую дату, а build normalizes
Log4brains `23:59:59Z` в полдень UTC. Поэтому браузер не покажет решение
следующим календарным днём из-за своего часового пояса.

## Host publication

Новый site публикуется атомарно в:

```text
/srv/projects/brai-envs/prod/adr-brai-new/current
```

Publisher сначала собирает новый output во временный каталог, затем создаёт
новый release и переключает `current`. Предыдущий `current` сохраняется под
`releases/previous-*`. Старый root остаётся отдельно:

```text
/srv/projects/brai-envs/prod/adr
```

Его нельзя удалять или копировать в новый ADR-каталог.

## Автоматическая публикация

Root-owned units `brai-adr-autopublish.path` и
`brai-adr-autopublish.timer` запускают одноразовый service после закрытия
записи в `docs/decisions/` или `.log4brains.yml`; timer повторяет сверку раз в
минуту на случай пропущенного события. Renderer работает от пользователя
`mark`, проверяет ADR, документацию и OpenSpec, и пишет только в static release
root. Он не имеет Docker, Caddy, NATS, Supabase или application secrets.

Перед созданием release service сравнивает SHA-256 manifest source с последней
успешной публикацией. Поэтому неизменённый source не создаёт лишний release, а
ошибка проверки или сборки оставляет предыдущий `current` работающим.

Установка на хосте выполняется один раз явной административной командой:

```bash
sudo bash /srv/projects/brai-new/infrastructure/adr/install-auto-publish.sh
systemctl status brai-adr-autopublish.path brai-adr-autopublish.timer
journalctl -u brai-adr-autopublish.service --since today
```

После установки новый принятый ADR появляется на `adr.brai.one` автоматически;
ручной `pnpm run adr:publish` остаётся только диагностической/восстановительной
операцией.

## Домен

`adr.brai.one` остаётся canonical technical hostname. Caddy должен:

- обслуживать HTTPS и HTTP→HTTPS redirect;
- применять unified Basic Auth;
- читать только новый `adr-brai-new/current`;
- не открывать новый внешний application port.

`pnpm run adr:cutover` выполняется только как разрешённая host-операция после
проверки нового `index.html`. Скрипт создаёт backup Caddyfile, валидирует
конфигурацию внутри контейнера Caddy и выполняет reload. При ошибке он
восстанавливает предыдущую конфигурацию.

## Rollback

Если authenticated smoke-check не проходит, новый root не считается активным.
Оператор возвращает Caddy route на сохранённый legacy root, валидирует и
перезагружает Caddy. Legacy static output не изменяется во время переноса.

Публикация не меняет DNS: `adr.brai.one` уже указывает на текущий сервер.
