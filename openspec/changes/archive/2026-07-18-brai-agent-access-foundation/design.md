# Design

## Trust model and fixed profiles

Источник решения — запись пользователя в server-side access store. Из браузера принимается только команда запуска; поле profile из HTTP/NATS payload запрещено. Backend в одной транзакции читает `developer_mode` и `access_generation`, создаёт run с неизменяемым snapshot и передаёт launcher только подписанный внутренний launch contract.

Существуют ровно два профиля:

- `user-sandbox`: весь agent process tree, SDK, shell, file tools, code execution, MCP, skills и дочерние процессы работают внутри OS-level sandbox пользователя;
- `developer`: процесс стартует на хосте как `mark`, рабочий каталог — `/srv/projects/brai-new`, права и повышение через sudo совпадают с Codex Desktop.

AI получает уже готовую среду и не знает механизма переключения. Launcher не анализирует текст задачи и не маршрутизирует отдельные файловые операции. Он только проверяет внутренний launch contract и стартует один из двух статических профилей.

Developer mode меняет только доверенный главный администратор платформы. Это глобальная настройка пользователя, а не право внутри отдельного проекта: профиль `developer` даёт `mark + sudo` на весь хост, поэтому project owner/admin не может его выдавать. Изменение увеличивает `access_generation`, завершает все живые runs пользователя во всех проектах и их process trees и отзывает их внутренние credentials. Существующий процесс никогда не повышается или понижается in-place.

## Normal user environment

На пользователя создаётся одна постоянная environment identity и один persistent data root. Любое число его агентов может работать параллельно внутри одного trust domain и видеть все проекты этого пользователя. Изоляция проектов друг от друга при необходимости создаётся самим пользователем вложенными контейнерами.

Sandbox видит только свой root filesystem и user data mount. В нём отсутствуют:

- `/srv/projects/brai-new` и другие host project paths;
- host `/`, `/etc/brai-new`, server secrets и model-provider master keys;
- host Docker/containerd/Podman sockets;
- Caddy config/API credentials;
- core NATS и Supabase credentials или сети.

Пользователь имеет root-подобные права только внутри своего user namespace.
Контейнеры запускает rootless engine, привязанный к allocation slot этого
пользователя. Engine работает как deterministic locked/no-login Linux
principal в отдельном systemd mount/network boundary; это не агент, broker или
участник выбора прав. Его socket виден только matching sandbox, а image store,
writable layers, volumes, build cache и temporary data находятся внутри user
data root. Root-owned engine binaries и immutable outer image общие; отдельного
полного образа, engine binary tree или Git clone на агента нет.

Публикация проекта не даёт sandbox доступ к Caddy. Обычный backend принимает hostname и внутренний port, проверяет владельца и подтверждение custom domain, сохраняет route, а ingress направляет запрос в приватную сеть нужной среды. Для platform subdomain hostname выдаёт сама Brai. Это детерминированный application flow без AI-решений.

Desired ingress state является короткой lease, а не бессрочной конфигурацией.
Custom domain входит в неё только после повторной проверки exact DNS proof; lease
никогда не переживает абсолютный `expires_at` исходного challenge. Старый TXT не
продлевает proof. После deadline продолжение требует удаления route и нового
challenge с новым случайным token. Это намеренно простой manual renewal до
появления отдельного ingress controller с безопасной ротацией nonce.
Atomic reservation в той же транзакции переводит ownership-lost routes и
custom routes с истёкшим proof в tombstone, а stale pending challenges — в
cancelled. История сохраняется, но старый пользователь или проект не может
навсегда занять hostname после потери права.

## Developer environment and project ownership

Codex Desktop продолжает работать от Linux-пользователя `mark`. Developer web-agents запускаются тем же UID/GID и используют тот же sudo-контракт. Весь обычный edit/build/test workflow в checkout выполняется без sudo, поэтому новые файлы принадлежат `mark:mark`.

Root нужен для системных путей и управления инфраструктурой, но весь agent process не запускается root. Сервисы Brai, ordinary-user runtime и системные provisioning jobs не пишут в `/srv/projects/brai-new`; единственный штатный writer checkout — `mark`. Способ будущей доставки через GitHub/CI/CD находится вне этого change.

`/srv/opt` содержит только установленный runtime/tooling и поэтому имеет
`root:root 0755`; доверенный sandbox image и его digest sidecar находятся
ниже этой root-owned chain. `mark` разрабатывает в `/srv/projects` и
устанавливает системные artifacts в `/srv/opt` только через обычный sudo.
Так image verifier может доказать, что пользовательский developer process не
подменил образ между проверкой и запуском.

Полный sudo по определению позволяет доверенному developer user намеренно обойти любой файловый invariant. Гарантия архитектуры покрывает штатный launcher, обычные команды и автоматическое обнаружение owner drift; developer mode не является защитой от злонамеренного root.

Параллельные developer agents разделяют один checkout. Это устраняет permission drift и дисковые копии, но не логические конфликты одновременного изменения одного файла. Такие конфликты решаются task scheduling/file-level coordination, а не Unix-правами.

## Host numeric identity pool

На одном runtime host политика v1 использует только фиксированный диапазон
`0x70000000..0x7FFDFFFF` (`1879048192..2147352575`). Он начинается сразу после
стандартного auto-pool `systemd-nspawn`, заканчивается перед foreign-image
range systemd и целиком ниже проблемной signed-32 границы. В нём 2047
непересекающихся диапазонов по 131072 ID: один slot на persistent user
environment, а не на агента, задачу, проект или контейнер. Параллельные агенты
одного пользователя работают внутри одного slot. В текущем access store
`allocation_slot` уникален глобально и `runtime_host_id` отсутствует, поэтому
foundation v1 честно ограничен одним sandbox runtime host и 2047 persistent
user environments на всю платформу. Multi-host scaling не входит в этот
change; до отдельной migration второй runtime host подключать нельзя.

Весь pool один раз и точно резервируется в `/etc/subuid` и `/etc/subgid` за
локальным locked/no-home/no-login principal `brai-sandbox-map`. Это не runtime
identity и не broker: запись только не даёт будущему shadow-utils `useradd`
выдать часть диапазона другому account. Поскольку `systemd-nspawn
--private-users=pick` координируется через NSS, а не `/etc/subuid`, Brai никогда
не использует `pick`, располагает pool вне фактически измеренного auto-range и
проверяет локально перечислимые NSS sources.

Install и каждый runtime/provisioning preflight заново проверяют точную
reservation, locked/no-login account, uint32/signed-32 bounds, фактические
systemd allocator boundaries и отсутствие пересечений во всех passwd, group,
subuid и subgid records. Повреждённая, дублированная, частичная или
пересекающаяся запись означает disabled user-sandbox; автоматического repair
или перехода в developer profile нет.

## Storage and quota

На единственном существующем ext4-разделе создаётся ровно один root-owned
ограниченный sparse-файл `/srv/brai-storage/user-data.xfs`. Он форматируется
как XFS и монтируется с `prjquota` в `/srv/brai-user-data`. Это один общий
filesystem pool на всех ordinary users, а не отдельный диск, файл, image,
checkout или mount на пользователя/агента. `truncate` задаёт логический
верхний предел роста pool, но не предвыделяет его размер: на внешнем ext4
занимаются только XFS metadata и реально записанные пользовательские blocks.

Каждый user data root внутри pool получает собственный XFS project ID и hard
byte/inode limits. Назначение лимита не выделяет blocks/inodes и не уменьшает
`df`; заняты только реально записанные данные. Сумма пользовательских лимитов
может превышать логический размер pool. Отдельный hard limit самого pool
ограничивает максимальный вклад ordinary-user data в заполнение текущего
системного диска.

В квоту входят workspace, home/state агента, nested-container writable layers/images/volumes/cache, SQLite `db/-wal/-shm`, user Postgres `PGDATA` и временные файлы на persistent mount. Immutable outer image layers и platform data в неё не входят.

Кроме per-user quota действует host admission gate по внешнему ext4 и
внутреннему XFS. Он запрещает новые управляемые launch/build/provision операции
при достижении low-space threshold. Уже работающую произвольную команду
ограничивают kernel project quota пользователя и конечный логический размер
общего XFS pool. `EDQUOT`, inode exhaustion и `ENOSPC` преобразуются там, где
их перехватывает platform runtime, в явные `storage_quota_exceeded` или
`storage_pool_full`, а не в permission incident; произвольная команда внутри
sandbox может получить kernel `EDQUOT`/`ENOSPC` напрямую. Удаление данных
освобождает фактически занятые blocks; несуществующей резервации освобождать
не требуется.

Отдельный root-owned `brai-users.slice` ограничивает суммарные RAM, swap, CPU и
число процессов всех обычных sandbox. Каждый sandbox имеет дополнительный
per-environment cap. Launcher допускает новый запуск только после свежего
измерения активного slice и совпадения с host-owned policy; фактической
race-safe границей остаётся kernel cgroup. Ресурсный admission не резервирует
диск и не принимает параметры от клиента или модели.

## Databases

Core Brai сохраняет service-owned schemas, отдельные least-privilege roles, checksum migrations и отдельные runtime/migration credentials. Runtime roles получают connection limits и server-side statement/lock/idle-transaction timeouts. Gateway, web, agents и пользовательские среды не получают core DB credentials.

Пользовательский default — SQLite-файл в user data root. Platform template использует исправленную SQLite не ниже 3.51.3/3.50.7, WAL только на локальном filesystem, `busy_timeout`, bounded transactions и корректный checkpoint. Live backup выполняется SQLite Backup API/`VACUUM INTO` либо после остановки writer, но не raw-copy одного `db` без `-wal`.

Если проекту нужен Postgres, пользователь запускает его вложенным rootless container. `PGDATA` находится внутри того же quota root, порт по умолчанию остаётся только во внутренней сети пользователя, а credentials принадлежат этому проекту. Такой Postgres не подключается к core Supabase network.

Managed Postgres не входит в этот change. Любая его будущая реализация обязана
оставаться вне core Supabase и оформляться отдельной спецификацией.

## Failure invariants and rollout

- Launch без доступной server-side membership или с устаревшим `access_generation` fail closed.
- Любой profile switch завершает старые process trees до выдачи нового contract.
- Создание user environment атомарно назначает identity, quota project ID, limits и ownership до первого запуска.
- Slot, numeric identity, XFS project ID и canonical path сначала долговечно
  резервируются в access DB, и только потом host меняет filesystem. Crash/retry
  сохраняет ту же reservation; повторное использование запрещено без отдельного
  подтверждённого teardown.
- Sandbox без quota, user namespace, private network или forbidden-mount audit не стартует.
- Sandbox без exact whole-host `brai-sandbox-map` subuid/subgid reservation или
  при passwd/group/subid/systemd-allocator collision не стартует.
- Sandbox без активного aggregate resource slice и свежего resource admission
  не стартует.
- Developer launcher без фактических UID/GID `mark` и ожидаемого checkout owner не стартует.
- Любой developer launch блокируется при foreign-owned source entries или
  world-writable source; любой user-sandbox launch блокируется при host runtime
  socket/core credential в profile или несовпадении измеренных границ.
