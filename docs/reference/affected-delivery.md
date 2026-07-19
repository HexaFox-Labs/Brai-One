# Affected delivery и Git Flow

**Статус:** active
**Источник поведения:** `infrastructure/delivery/`, GitHub Actions и
`openspec/specs/gitflow-affected-delivery/spec.md`

## Назначение

Delivery-механизм Brai New не копирует исходный код, `node_modules`, Gradle
кэши или outputs сборки на сервер. GitHub Actions проверяет изменение, собирает
только затронутые OCI-образы и передаёт на сервер только их неизменяемые
`sha256`-дижесты. Неизменённые сервисы остаются запущенными на уже проверенных
образах.

Это устраняет причину многогигабайтных legacy-preview: окружение состоит из
общих слоёв образов, небольшого root-private manifest и ограниченных данных
своего слота, а не из копии checkout для каждой ветки.

GitHub Actions хранит build cache отдельно для каждого OCI-образа и только для
ускорения следующей сборки. Это не checkout и не копия окружения на сервере:
если GitHub удалит cache по своей политике, работающие Dev/preview не меняются,
а следующая сборка просто будет холодной.

## Ветки и продвижение

| Ветка / событие                                               | Результат                                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature/*`, `fix/*`, `hotfix/*` от `dev`                     | Точный affected CI. Runtime-изменение после зелёной сборки получает либо обновляет preview этой ветки.                                                         |
| `docs/*` или изменение только в классифицированных документах | Уменьшенные проверки; образ, контейнер и preview не создаются.                                                                                                 |
| Pull request в `dev`                                          | Открывается только из основного репозитория. Внешние fork PR не выполняют проектный код и не получают preview.                                                 |
| merge в `dev`                                                 | Обновляются только затронутые образы и сервисы `d-brai-*`; после healthcheck создаётся свежий data-only snapshot.                                              |
| `release/*`                                                   | Замороженный кандидат. Если есть runtime-diff, он занимает обычный preview-слот с приоритетом над обычной очередью. Постоянного stage-окружения нет.           |
| `main`                                                        | Только история production. Сам push ничего в production не выкатывает. Production — отдельная явно подтверждённая protected promotion из проверенного release. |

Runtime preview показывается только после успешного affected CI и успешного
health-gated развёртывания. Новый коммит той же ветки обновляет тот же slot;
несколько агентов, работающих в одной ветке, никогда не получают отдельные
preview на каждый commit. Неудачная проверка или обновление не меняет уже
зелёный manifest и работающий preview.

Для runtime PR Сергей принимает именно опубликованную revision. После этого
включается нативный GitHub auto-merge: GitHub сам дождётся всех обязательных
checks и откажется от merge, если появился новый commit или check снова стал
красным. Для документации принятие и preview не требуются: включается только
auto-merge после reduced check.

## Как определяется затронутый объём

`infrastructure/delivery/catalog.json` связывает Nx-проекты, Dockerfile,
runtime-зависимости и специальные классы путей. `tools/ci/delivery-impact.mjs`
получает точные base/head SHA и использует `nx show projects --affected`.

- Изменение web затронет web image и его нужные проверки; NATS, Factory и
  Access не пересобираются.
- Shared contract, lockfile, CI, delivery catalog, миграции и неизвестный путь
  не считаются документацией. Они выбирают консервативную control/runtime
  политику.
- Документационный класс проходит только format/link/policy checks и не
  публикует OCI images.

## Dev и preview runtime

| Окружение     | Контейнеры                                    | URL                                     | Локальные порты                      |
| ------------- | --------------------------------------------- | --------------------------------------- | ------------------------------------ |
| Dev           | `d-brai-*`                                    | `dev.brai.one` после отдельного cutover | web `3400`, Gateway `3500`           |
| Preview `pNN` | `pNN-brai-*`                                  | `preview-NN.brai.one`                   | web `3410 + NN`, Gateway `3510 + NN` |
| Production    | `prod-brai-*` / отдельный production contract | production URL                          | только loopback за Caddy             |

Ни один application port не публикуется наружу: Caddy остаётся единственной
внешней точкой на 80/443. Preview и dev защищены единым Caddy Basic Auth;
OIDC delivery endpoint не принимает Basic Auth и проверяет краткоживущий
GitHub token до разбора запроса.

Сначала controller рассматривает `p01`, затем `p02` и так далее — никакой
случайности. Запущено максимум пять preview одновременно, хотя DNS содержит
20 имён. Если свободной безопасной ёмкости нет, release кандидат идёт первым,
а внутри одного приоритета порядок FIFO. Ветку не резервируют заранее:
slot нужен только после первого зелёного runtime commit. Закрытие PR или 72
часа runtime-неактивности останавливают только `pNN-brai-*`, очищают данные
этого слота и возвращают slot в порядок выбора.

## Данные preview и лимиты

Слот — это постоянная логическая identity, а не 20 работающих PostgreSQL.
При первом запуске slot получает отдельные Docker volumes, isolated networks и
data-only dump актуального здорового dev. Dump включает только
`brai_factory` и `brai_access`; файловые объекты, вложения, логи и caches не
попадают в него. При освобождении slot volumes удаляются, а его identity
остаётся свободной для следующей ветки.

| Ограничение                    | Значение | Поведение                                                               |
| ------------------------------ | -------: | ----------------------------------------------------------------------- |
| Целевой размер dev snapshot    |  100 MiB | предупреждение с 80 MiB                                                 |
| Максимальный snapshot          |  200 MiB | новый snapshot отклоняется; preview не получают неконтролируемые данные |
| Preview slot (DB + NATS state) |  250 MiB | health-gated обновление откатывается/не активируется при превышении     |
| Docker logs slot               |   10 MiB | `json-file` rotation `1 MiB × 1` на контейнер                           |
| Host reserve                   |   25 GiB | новый preview ставится в очередь, здоровые окружения не удаляются       |
| Initial active previews        |        5 | повышать только после измеренного load test                             |

Образы используют общие content-addressed Docker layers. Controller удерживает
только активные digests и две здоровые rollback-версии, а cleanup никогда не
выполняет global Docker prune.

## Первый запуск и управление

1. Deploy controller устанавливается root-командой
   `sudo infrastructure/delivery/install-host-controller.sh`.
2. Он создаёт `/srv/opt/brai-delivery`, root-private state, systemd units,
   Caddy preview routes и loopback-only listener `127.0.0.1:3490`.
3. Repository variable `BRAI_DELIVERY_ENDPOINT` указывает на
   `https://preview-01.brai.one/__brai-delivery`.
4. Первое защищённое GitHub Actions `bootstrap_dev` на `dev` публикует полный
   digest set, разворачивает `d-brai-*`, ждёт healthchecks и делает snapshot.
5. Только после успешной synthetic dev проверки проводится отдельный,
   owner-approved cutover `dev.brai.one`. Legacy traffic до этого не меняется.

Все OCI-образы и маленький delivery manifest хранятся в одном GHCR package
`ghcr.io/hexafox-labs/brai-one`. У каждого image-build свой неизменяемый tag
только на время публикации; environment manifest передаёт исключительно
`sha256`-дижест. Так GHCR и Docker могут переиспользовать одинаковые слои между
сервисами, а package не размножается на семь почти одинаковых namespace.

У package есть OCI label `org.opencontainers.image.source`, связывающий его с
публичным исходным репозиторием. GitHub не предоставляет поддерживаемый Actions
API для смены package visibility: после первого успешного publish владелец один
раз открывает Package settings для `brai-one` и выбирает **Public**. Это
необратимое действие GitHub, поэтому workflow его не имитирует и не хранит на
сервере личный GitHub token. До этой однократной настройки controller безопасно
отклонит pull до изменения работающего Dev/preview.

Проверки службы:

```bash
systemctl status brai-delivery.service brai-delivery-sweep.timer
curl --fail http://127.0.0.1:3490/healthz
sudo journalctl -u brai-delivery.service --since '15 min ago'
GH_TOKEN="$(gh auth token)" node tools/github/verify-delivery-policy.mjs \
  HexaFox-Labs/Brai-One
```

## Безопасность

- Нет `pull_request_target`, `issue_comment` или workflow, который checkout'ит
  code fork и получает delivery credential.
- Default workflow token read-only; image build получает только нужные
  `packages: write`, attestation и OIDC permissions.
- Host проверяет issuer, audience, signature, repository, visibility,
  workflow filename, event/ref и строгую JSON-схему запроса.
- CI не передаёт host path, shell command, tag, URL контейнера или имя volume.
  Все такие значения controller выводит из фиксированного catalog и prefix.

## Ограничения до cutover

Preview routes и controller можно безопасно установить параллельно с legacy
runtime. `dev.brai.one` и production нельзя переключать «по факту наличия
кода»: для каждого требуется отдельное health evidence и явное решение
владельца, потому что это меняет live traffic.
