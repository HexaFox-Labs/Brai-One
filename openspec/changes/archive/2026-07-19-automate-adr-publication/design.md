# Design: автоматическая публикация ADR

## Контекст

Существующий `tools/docs/publish-adr.mjs` уже собирает Log4brains в `/tmp` и
передаёт output в `infrastructure/adr/publish-static.mjs`. Последний staging-ит
release за пределами checkout и атомарно меняет
`/srv/projects/brai-envs/prod/adr-brai-new/current`. Caddy уже читает этот
стабильный путь; ему не нужны reload или новый listener при смене release.

## Trigger и исполнение

`brai-adr-autopublish.path` следит за `docs/decisions/` и `.log4brains.yml`.
Он запускает одноразовый `brai-adr-autopublish.service` после закрытия записи.
Дополнительный `brai-adr-autopublish.timer` запускает тот же сервис раз в
минуту после boot, чтобы восстановиться после пропущенного inotify-события или
недоступности watcher во время изменения.

Сервис запускается как `mark`, а не root. Root владеет только systemd units и
решением об их запуске. Сервис может читать checkout и писать только в
выделенный ADR release root; он не получает Docker socket, Caddy config,
Supabase, NATS или application secrets.

## Pipeline

1. `auto-publish.mjs` вычисляет SHA-256 manifest из ADR source, Log4brains
   config, lockfile и publisher tooling.
2. Если manifest совпадает с успешной публикацией и `current/index.html`
   существует, сервис выходит без сборки.
3. Последовательно запускаются `adr:check`, `docs:check` и
   `openspec validate --all --strict`.
4. Только после успешных проверок вызывается существующий publisher с unique
   release id, содержащим UTC timestamp и префикс manifest hash.
5. После сборки `apply-adr-theme.mjs` копирует проверяемый `theme.css` в release
   и подключает его ко всем статическим HTML. Override Material UI оформляет
   сайт в тёмной палитре Brai независимо от light-theme output Log4brains.
6. `normalize-adr-dates.mjs` меняет date-only `publicationDate`, который
   Log4brains ошибочно задаёт в `23:59:59Z`, на `12:00:00Z`. Полдень UTC не
   пересекает календарную границу в поддерживаемых часовых поясах браузера.
7. После успешной atomic promotion рядом с release root записывается manifest
   состояния. При любой ошибке manifest не обновляется, а старый `current`
   остаётся без изменений.

## Отказы и наблюдаемость

- Journal systemd содержит результат, точную failed проверку и release id, но
  не содержит credentials.
- Повторная попытка после исправления source срабатывает path watcher-ом или
  не позже следующего timer tick.
- Повторный запуск без входных изменений не создаёт новый release.
- Никакая ошибка сборки не вызывает Caddy reload и не заменяет рабочий сайт.

## Рассмотренные альтернативы

- **Отдельный `brai-adr` контейнер:** отклонён: статической документации не
  нужны NATS, database, health API или постоянный runtime.
- **Только GitHub CI:** отклонён для текущего режима без обязательного Git;
  локальный watcher даёт немедленное обновление, а CI может использовать тот
  же publisher позже.
- **Публикация без checks:** отклонена: на сайт мог бы попасть неполный ADR,
  битая ссылка или несогласованный OpenSpec Change.
- **Root service, собирающий из checkout:** отклонён: root не должен выполнять
  renderer над изменяемым developer-owned source.
