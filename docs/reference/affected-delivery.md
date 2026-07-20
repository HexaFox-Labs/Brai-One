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
| merge в `dev`                                                 | Runtime: только нужные `d-brai-*`; exact Preview digests переиспользуются, иначе — affected build. Non-runtime: только новый точный manifest без рестарта.     |
| `release/*`                                                   | Замороженный кандидат. Runtime-diff получает приоритетный preview; отсутствие runtime-diff переносит точный Dev manifest без сборки. Постоянного stage нет.    |
| `main`                                                        | Только история production. Сам push ничего в production не выкатывает. Production — отдельная явно подтверждённая protected promotion из проверенного release. |

Runtime preview становится зелёным и пригодным к принятию только после
успешного affected CI, health-gated развёртывания и сохранения точного
неизменяемого manifest в GHCR. Если эта финальная публикация не удалась после
здорового deploy, уже активированный preview сохраняется для диагностики, но
delivery check остаётся красным: GitHub не даст принять, слить или продвинуть
revision без сохранённого точного manifest. Новый коммит той же ветки обновляет
тот же slot; несколько агентов, работающих в одной ветке, никогда не получают
отдельные preview на каждый commit. Неудачная проверка или обновление не меняет
уже зелёный manifest и работающий preview.

Для runtime PR Сергей принимает именно опубликованную revision. Агент запускает
owner-only workflow для номера PR; workflow повторно читает PR из GitHub,
controller подтверждает точную branch/revision, после чего workflow выставляет
обязательный commit status `runtime-acceptance` и включает нативный GitHub
auto-merge (squash). GitHub сам дождётся всех обязательных checks и не сольёт
PR, если появился новый commit или check снова стал красным. Ручной merge не
обходит этот status. Для документации принятие и preview не требуются:
delivery сам выставляет status «Preview не требуется», а docs-workflow включает
auto-merge после reduced check.

GitHub создаёт для squash-merge новый SHA, поэтому Dev manifest закономерно
записывает SHA merge-коммита. Это не означает повторную сборку: workflow по
GitHub API находит PR, который ввёл этот merge-коммит, проверяет точный
Preview manifest исходной ревизии и переносит из него только нужные OCI
digests. Если связь или manifest отсутствует, pipeline не угадывает и
безопасно выполняет обычную affected-сборку.

Даже non-runtime merge получает неизменяемый Dev manifest со своим новым SHA:
семь уже проверенных digest переносятся из `dev-current`, но controller не
вызывается, контейнеры не перезапускаются и images не строятся. При первом push
новой `release/*` GitHub передаёт нулевой previous SHA; workflow заменяет его
точным `origin/dev`, поэтому создание release branch не превращается в полную
сборку.

Для Dev источником affected-base служит не ненадёжный `event.before`, а revision
фактически опубликованного `dev-current`. Если несколько merge пришли быстро и
GitHub заменил промежуточный pending run, следующий run охватит весь диапазон от
последнего доставленного Dev до своего head и не потеряет runtime-изменение.
Release всегда сравнивается со своим frozen Dev merge-base.

Manifest хранится как минимальный `scratch`-образ только с `/manifest.json`, без
команды запуска. Workflow читает его через временный контейнер с явно заданной
инертной командой, не запускает контейнер и удаляет его сразу после `docker cp`.

Для runtime delivery разрешён только squash-merge. Это сохраняет одну
однозначную связь «merge-коммит → PR → Preview revision»; смена merge-метода
блокируется policy check до следующего развёртывания.

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
попадают в него. Он также исключает ledger миграций и неизменяемую
миграционно-владельческую policy `brai_access.allocation_policies`: чистый
preview создаёт её своей проверенной миграцией до восстановления рабочих
данных. При освобождении slot volumes удаляются, а его identity остаётся
свободной для следующей ветки.

| Ограничение                    | Значение | Поведение                                                               |
| ------------------------------ | -------: | ----------------------------------------------------------------------- |
| Целевой размер dev snapshot    |  100 MiB | предупреждение с 80 MiB                                                 |
| Максимальный snapshot          |  200 MiB | новый snapshot отклоняется; preview не получают неконтролируемые данные |
| Preview slot (DB + NATS state) |  250 MiB | health-gated обновление откатывается/не активируется при превышении     |
| Docker logs slot               |   10 MiB | `json-file` rotation `1 MiB × 1` на контейнер                           |
| Host reserve                   |   20 GiB | новый preview ставится в очередь, здоровые окружения не удаляются       |
| Initial active previews        |        5 | повышать только после измеренного load test                             |

Образы используют общие content-addressed Docker layers. Controller удерживает
только активные digests и две здоровые rollback-версии, а cleanup никогда не
выполняет global Docker prune. При первоначальном лимите в пять Preview их
суммарный жёсткий writable-бюджет составляет не более 1.37 GiB. Поэтому резерв
20 GiB сохраняет отдельный запас для Dev и production, не требуя удаления
legacy-окружений ради запуска первого свободного слота.

## Первый запуск и управление

1. Deploy controller устанавливается root-командой
   `sudo infrastructure/delivery/install-host-controller.sh`.
2. Он создаёт `/srv/opt/brai-delivery`, root-private state, systemd units,
   Caddy preview routes и loopback-only listener `127.0.0.1:3490`. При
   повторной установке после cutover installer сохраняет уже управляемый
   `dev.brai.one` block, а не заменяет его preview-only маршрутом.
3. Repository variable `BRAI_DELIVERY_ENDPOINT` указывает на
   `https://preview-01.brai.one/__brai-delivery`.
4. Первое защищённое GitHub Actions `bootstrap_dev` на `dev` публикует полный
   digest set, разворачивает `d-brai-*`, применяет Factory baseline и до
   создания login-ролей отзывает у isolated PostgreSQL стандартные права
   `TEMPORARY` и schema `public`. Затем controller применяет one-time Access
   foundation и только после этого least-privilege Access роли; пароль и audit
   migration-роли завершаются до её миграций. Затем controller ждёт healthchecks
   и делает snapshot.
   Повтор после прерванного первого запуска принимает только уже существующую
   Access foundation и всё равно повторяет bounded role/bootstrap/audit цепочку;
   любая другая ошибка остаётся fail-closed.
5. Только после успешной synthetic dev проверки проводится отдельный,
   owner-approved cutover `dev.brai.one`. Legacy traffic до этого не меняется.

Все OCI-образы и маленький delivery manifest хранятся в одном GHCR package
`ghcr.io/hexafox-labs/brai-one`. У каждого image-build свой неизменяемый tag
только на время публикации; environment manifest передаёт исключительно
`sha256`-дижест. Так GHCR и Docker могут переиспользовать одинаковые слои между
сервисами, а package не размножается на семь почти одинаковых namespace.

У package есть OCI label `org.opencontainers.image.source`, связывающий его с
публичным исходным репозиторием. Публикация идёт `GITHUB_TOKEN` этого
репозитория, поэтому GHCR наследует его public visibility и server может
анонимно получить digest без личного GitHub token. Если visibility когда-либо
сменят на private, controller безопасно отклонит pull до изменения работающего
Dev/preview.

Все runtime-контейнеры сохраняют read-only root filesystem, `cap_drop: ALL` и
`no-new-privileges`. Единственное узкое исключение — PostgreSQL получает
`CHOWN`, `DAC_READ_SEARCH`, `FOWNER`, `SETGID`, `SETUID` только для поиска и
первичной инициализации собственного named volume с правами `0700`, а также
перехода к пользователю `postgres`; оно не даёт доступа к host filesystem,
Docker socket или сети host.

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
- Cleanup и owner acceptance используют только документированные GitHub Actions
  OIDC claims; cleanup ограничен активностью `closed`, а acceptance — owner-only
  dispatch с защищённой `dev`, а не несуществующим JWT-полем из event payload.
- CI не передаёт host path, shell command, tag, URL контейнера или имя volume.
  Все такие значения controller выводит из фиксированного catalog и prefix.

## Production promotion и откат

Production workflow запускается только с `release/*` через Environment
`production`. Без параметра он продвигает SHA release branch; для проверенного
отката оператор передаёт полный SHA ранее сохранённого Dev manifest. Явный
rollback не читает feature Preview, поэтому случайно продвинуть неслитую ветку
нельзя.
Оба пути требуют того же environment approval, принимают только семь
`ghcr.io/hexafox-labs/brai-one@sha256:…` ссылок и отправляют host лишь строгий
manifest версии `brai.production-host.v3`. Образы при откате не
пересобираются. Host хранит `current` и `previous`, переключает `current` только
после healthchecks и при неудаче автоматически возвращает предыдущие runtime
images.

## Ограничения до cutover

Preview routes и controller можно безопасно установить параллельно с legacy
runtime. `dev.brai.one` и production нельзя переключать «по факту наличия
кода»: для каждого требуется отдельное health evidence и явное решение
владельца, потому что это меняет live traffic.
