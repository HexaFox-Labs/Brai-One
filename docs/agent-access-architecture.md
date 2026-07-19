# Архитектура прав и изоляции Brai New

Этот документ подробно объясняет установленную архитектуру. Нормативные
requirements находятся в `openspec/specs/agent-access/spec.md`; исторические
материалы реализации находятся в
`openspec/changes/archive/2026-07-18-brai-agent-access-foundation/`.

## Scope, guarantee and terminology

### Requirement

Эта спецификация должна быть единственным нормативным контрактом прав для
агентов Brai New. Она распространяется на web-agents, Codex SDK/API runners,
дочерние процессы, shell/file/code tools, MCP, skills, пользовательские
контейнеры и базы данных. Она также фиксирует единственного штатного writer
исходников. GitHub, CI/CD, production deployment, multi-host sharding,
managed Postgres и production ingress не входят в этот change. Решение о
правах не должно зависеть от текста задачи, ответа модели или отдельного
«агента прав».

### Scenarios

- В системе существуют ровно два runtime-профиля: `user-sandbox` и
  `developer`. Третьего промежуточного профиля, автоматической эскалации и
  маршрутизации отдельных операций по разным Unix-пользователям нет.
- «Одна среда пользователя» означает один постоянный OS-isolation boundary,
  один persistent data root, одну quota и один host identity slot на
  пользователя; агенты, задачи, проекты и вложенные контейнеры отдельные slots
  не расходуют.
- «Проблема прав невозможна в штатном workflow» означает: процесс либо
  запускается сразу в правильной Unix-среде, либо launcher отказывает до
  старта с диагностируемой ошибкой. Рекурсивные `chmod`, `chown`, repair scripts
  и повторный запуск с более широкими правами не являются способом
  восстановления.
- Гарантия не утверждает, что доверенный `root` или пользователь `mark` с
  полным sudo физически не может намеренно изменить владельца, режим или
  конфигурацию хоста. Такое изменение должно обнаруживаться policy/preflight и
  блокировать следующий штатный launch.
- Обычный пользователь и его агенты являются одним trust domain внутри его
  среды. Эта спецификация изолирует пользователей друг от друга и от платформы,
  но не обещает взаимную недоверенную изоляцию двух агентов одного владельца.
- Любая будущая реализация, которая добавляет per-task checkout, общего
  filesystem writer с другим UID, host Docker socket, core database credential
  или AI/broker в access decision path, нарушает эту спецификацию.

## Deterministic profile selection

### Requirement

Только trusted backend должен выбирать неизменяемый runtime profile из
server-side `developer_mode` до запуска агента. Браузер, API-клиент, prompt,
tool call и модель не должны выбирать или повышать профиль.

### Scenarios

- Обычный пользователь всегда получает `user-sandbox`, даже если HTTP payload, prompt или tool input требует developer/root.
- Пользователь с включённым режимом разработчика получает `developer` и стартует как `mark` с тем же sudo-контрактом, что Codex Desktop.
- Отсутствующая membership, неизвестный profile или устаревший `access_generation` запрещает запуск.
- Только главный администратор платформы может переключить глобальный режим пользователя; project owner/admin этого сделать не может.
- Переключение режима завершает все живые process trees пользователя во всех проектах; следующий run создаётся заново.
- `developer_mode` является одним глобальным boolean пользователя, а не
  настройкой проекта. Активная server-side membership всё равно обязательна
  для запуска задачи в выбранном проекте.
- HTTP/NATS command не содержит доверенных полей `profile`, `developer_mode`,
  `actor`, `owner`, `access_generation` или OS identity. Если такие поля
  присутствуют в недоверенной команде, schema validation отклоняет её.
- Backend одной транзакцией блокирует и читает access state и membership,
  создаёт immutable run snapshot и только после commit выдаёт внутренний launch
  contract.
- Начальное `access_generation` равно 1; увеличение выше
  `Number.MAX_SAFE_INTEGER` запрещено и не должно оборачиваться или сбрасываться.
- Отсутствующая, `revoking` или `revoked` membership блокирует новый run.
  Project membership не может выдать host access и не заменяет
  platform-superadmin authorization для изменения developer mode.

## Access transitions and revocation

### Requirement

Смена developer mode и отзыв project membership должны быть fail-closed
state-machine transitions. Новый профиль или окончательный revoke нельзя
активировать, пока runtime controller не подтвердил завершение каждого точно
зафиксированного process tree.

### Scenarios

- Изменение `developer_mode` переводит user access state из `active` в
  `transitioning`, увеличивает `access_generation` ровно на один и атомарно
  сохраняет полный список живых runs пользователя во всех проектах.
- Пока state равен `transitioning`, новые launches запрещены; существующий
  процесс никогда не получает новые права in-place.
- Runtime termination receipt должен совпасть с сохранёнными run ID,
  generation и OS process-tree identity. Неполный, повторный, устаревший или
  относящийся к другому процессу receipt не завершает transition.
- Новый `active` state появляется только после подтверждения полного набора
  termination receipts и отзыва внутренних credentials старого поколения.
- Membership проходит `active -> revoking -> revoked`. Переход в `revoking`
  сразу блокирует новые launches и отмечает живые runs этого проекта как
  `termination_requested`; удалять membership row нельзя.
- Transition ledger сохраняет инициатора, старое и новое значение, generation,
  время и результат. Инициатором смены режима может быть только
  аутентифицированный platform superadmin.

## Signed launch contract

### Requirement

Launcher должен принимать только короткоживущий внутренний Ed25519-signed
contract с immutable snapshot пользователя, профиля, поколения и quota.
Недоверенный JSON или environment variable не должен становиться полномочием на
запуск.

### Scenarios

- Contract имеет schema version `brai.agent.launch.contract.v2`, уникальный
  UUIDv4 `run_id`, user ID, project ID, environment ID для `user-sandbox`,
  фиксированный runtime host ID, один из двух профилей, `access_generation`,
  quota, immutable job/command reference и SHA-256 digest, UTC
  `issued_at`/`expires_at`, trusted `key_id` и detached signature.
- Lifetime contract не превышает пяти минут. Expired/not-yet-valid contract,
  неизвестный key ID, неверная подпись, неожиданное поле, subject mismatch,
  stale generation или неверный profile запрещает launch.
- Подпись проверяется trusted public key из server configuration. Key,
  algorithm, profile или canonical bytes нельзя принимать из request payload.
- Межпроцессные provisioning, claim, started, exit и termination receipts имеют
  разные signature purposes и не взаимозаменяемы.
- Same-process trusted context создаётся только закрытым adapter и
  non-serializable brand. Plain JSON, JSON round-trip или скопированный symbol
  не создаёт trusted context.
- Replay не создаёт второй процесс: каждый receipt привязан к IDs,
  generation/purpose и потребляется одноразовым SQL compare-and-set.

## Run claim and process lifecycle

### Requirement

Проверка contract, durable claim run, создание process tree и регистрация его
точной OS identity должны образовывать один fail-closed launch protocol без
check-then-launch окна.

### Scenarios

- Run создаётся один раз в `pending` с immutable access/membership snapshot.
  Database trigger под lock повторно сверяет membership generation, текущий
  profile, access generation и quota.
- Verified claim переводит `pending -> starting` один раз и сохраняет точную
  runtime identity, достаточную для адресации всего process tree/cgroup.
- Started receipt переводит тот же run `starting -> running`; receipt другого
  run, user, generation или process identity отвергается.
- Exact exit и empty-cgroup evidence переводит `starting/running` в
  `succeeded` или `failed`. Истечение timeout само по себе не доказывает, что
  процесс умер, и не меняет run в terminal state.
- При отзыве доступа run переходит в `termination_requested`; terminal
  `terminated` разрешён только после `cancelled_before_start` либо
  `process_tree_killed` receipt, совпавшего с сохранённой identity.
- Неизвестный, повторный, частичный или устаревший receipt не расширяет права,
  не освобождает transition и не запускает best-effort cleanup от имени root.

## Ordinary user isolation

### Requirement

Обычный пользователь должен иметь одну постоянную OS-isolated среду для всех
своих агентов и проектов без доступа к исходникам Brai, host root и
инфраструктурным credentials. Среда должна использовать user namespace,
private network и единственный writable persistent user-data mount.

### Scenarios

- Два пользователя не могут прочитать, изменить, смонтировать или перечислить данные друг друга.
- User sandbox не видит Brai checkout, host root, host runtime socket, Caddy config, core networks или platform credentials.
- Root внутри sandbox не является host root и не может управлять host containers.
- Много агентов одного пользователя разделяют его persistent data без отдельных Git clones или полных копий базового image.
- Все ordinary-user process trees находятся под общим kernel-enforced resource
  slice; отсутствие измеренного host-owned aggregate cap запрещает запуск.
- Environment создаётся один раз и сохраняет identity/data root между задачами,
  перезапусками агентов и перезагрузками runtime. Один агент не получает
  отдельный checkout среды и не копирует весь base image.
- Immutable outer OS image может быть общим для всех пользователей и
  подключается read-only. Все mutable workspace, home, agent state, caches,
  temporary files и container layers находятся только под persistent data
  root пользователя.
- Sandbox не получает bind mounts хостового `/`, `/srv/projects`,
  `/etc/brai-new`, `/home/mark`, server secrets, provider master keys,
  `/var/run/docker.sock`, containerd/Podman sockets или Caddy state.
- Sandbox не подключается к core NATS, Supabase и management networks.
  Разрешённый outbound internet и входящий project traffic проходят через
  отдельно заданную network policy, а не через host network mode.
- Launcher проверяет user namespace mapping, private network, immutable image,
  единственный user-data mount, quota и cgroup policy перед стартом. Отсутствие
  любого доказательства означает отказ; fallback в `developer` запрещён.
- Environment identity не является отдельным host login account. Пользователь
  не получает SSH/login на runtime host и не может использовать выделенный
  numeric range через произвольный host process.

## Persistent environment provisioning

### Requirement

Provisioning должен сначала долговечно и атомарно зарезервировать identity,
path и quota identifiers в access database, а затем изменять хост. Успешной
среда считается только после exact measured provisioning receipt.

### Scenarios

- Одна транзакция под cross-user allocation fence выбирает минимальный
  свободный slot и сохраняет environment ID/name, UID/GID range, subordinate
  IDs, XFS project ID, canonical storage path, mount point, configured byte и
  inode limits.
- Host provisioner не выбирает значения самостоятельно и не сканирует
  filesystem в поиске «подходящего» свободного каталога.
- Crash после database commit, но до host mutation сохраняет ту же reservation.
  Retry увеличивает `provision_generation`, инвалидирует старые receipts и
  повторяет provisioning с теми же identifiers.
- Receipt содержит environment/user IDs, generation, image path и SHA-256,
  mount device, реальный XFS project ID, project inheritance flag, quota
  enforcement flag и фактические byte/inode hard limits.
- Compare-and-set переводит текущую запись в `ready` только при полном совпадении
  receipt с reservation, активным access generation и configured quota.
- `provisioning`, `ready` и `failed` reservations участвуют в uniqueness
  constraints. Foundation v1 не удаляет, не очищает и не переиспользует slot;
  будущий teardown обязан сначала доказать удаление host state отдельным
  переходом.
- До состояния `ready` ordinary-user launch недоступен.

## Developer parity and ownership

### Requirement

Developer web-agent и Codex Desktop должны выполнять project writes одним
canonical host principal `mark:mark`. Developer launcher должен воспроизводить
реальные UID, primary GID, fresh supplementary groups, home, shell environment
и sudo contract пользователя `mark`, а не только подменять числовой UID.

### Scenarios

- Созданный каждым из двух каналов source file доступен другому без `chmod`, `chown` или group repair.
- Agent process работает как `mark`; sudo используется только при необходимости системного изменения, а не для всего build/edit workflow.
- Сервисы, runtime и provisioning jobs не пишут build outputs или metadata в
  live checkout.
- Foreign-owned, world-writable или special source entry блокирует developer
  launch с точным diagnostic.
- Developer process стартует с рабочим каталогом `/srv/projects/brai-new`,
  вызывает эквивалент `initgroups(mark)` и проходит preflight writable checkout
  и действующего `sudo -n` contract.
- Checkout root должен быть `mark:mark` mode `0700`; весь разрешённый tree,
  включая `.git`, проверяется на exact owner, policy-compatible mode, effective
  read/write, special files и symlink escape.
- Executor устанавливает umask `0077` до preflight и сохраняет его для всех
  дочерних процессов. Sudo audit должен доказать явный `NOPASSWD: ALL`, а не
  только доступ к отдельной helper-команде.
- Весь edit/build/test workflow выполняется без sudo; поэтому новые source,
  cache и generated files, которым разрешено находиться в checkout, получают
  владельца `mark:mark`.
- Для системного изменения developer agent вызывает обычный sudo пользователя
  `mark`. Специального root-broker, service account или второго filesystem
  writer в этом пути нет.
- Параллельные developer agents используют один checkout. Логические конфликты
  одновременного редактирования должны решаться scheduling/coordination; их
  нельзя «решать» созданием checkout с другим владельцем.
- Developer profile не наследует user-sandbox quota или mount restrictions и
  по определению обладает возможностями `mark + sudo` на хосте. Выдавать его
  разрешено только доверенному пользователю через platform-superadmin flag.
- Executor не запускает весь agent process как root и не устанавливает
  `NoNewPrivileges=yes`, поскольку это сломало бы штатный setuid-переход sudo.
- Если actual UID/GID/groups, checkout owner/mode или sudo contract расходятся
  с ожидаемыми, developer launch должен завершиться до запуска агента.

## Non-reserving quota

### Requirement

Per-user XFS project hard quota внутри одного общего bounded sparse XFS pool
на текущем ext4-диске должна ограничивать фактическое использование, не
резервируя blocks/inodes и не вычитая лимит из свободного объёма заранее.
Сумма пользовательских лимитов может превышать логический размер pool.

### Scenarios

- Создание пользователя с лимитом не меняет физически занятые blocks.
- Workspace, nested-container data, SQLite и Postgres `PGDATA` суммируются в одном лимите пользователя.
- Достижение byte/inode limit возвращает `storage_quota_exceeded`; заполнение общего пула возвращает `storage_pool_full`.
- Один общий backing file имеет фиксированный логический hard ceiling и тем
  самым ограничивает максимальный дополнительный расход системного диска
  ordinary-user данными. Low-space gate отдельно запрещает новые
  platform-mediated тяжёлые операции.
- Foundation default равен 5 GiB и 500000 inodes, но это только persisted hard
  limit, а не reservation. Например, сто пользователей с лимитом 5 GiB не
  занимают 500 GiB до фактической записи данных.
- В квоту входят workspace, home/state агента, build caches, temporary files,
  rootless-container images, writable layers, volumes, SQLite database/WAL/SHM,
  backups и user Postgres `PGDATA`.
- Общий immutable sandbox image и platform-owned data не относятся к quota
  конкретного пользователя.
- Data root имеет XFS project ID и project-inheritance flag; kernel quota
  enforcement и фактические hard limits должны точно совпадать с access store.
  Одной записи лимита в PostgreSQL недостаточно.
- Foundation v1 не предоставляет live quota-update API. Изменение лимита в
  будущем должно сначала атомарно применить и измерить новый XFS hard limit и
  лишь затем разрешить новый launch state; прямое изменение database value
  запрещено.
- Best-effort low-space admission требует не менее 10% свободного user-data
  filesystem для новых управляемых launch/build/provision operations. Gate не
  является reservation и не обещает зарезервировать этот объём работающему
  произвольному процессу.
- `EDQUOT`, inode exhaustion и `ENOSPC`, перехваченные platform runtime,
  преобразуются в разные стабильные error codes. Произвольная команда внутри
  sandbox может получить исходный kernel error напрямую.
- Удаление фактических данных немедленно освобождает соответствующие blocks;
  освобождать «выделенный лимит» не требуется, потому что такой резервации нет.

## Aggregate and per-environment resources

### Requirement

Обычные среды должны иметь kernel-enforced cgroup limits одновременно на
уровне всей фабрики и отдельного пользователя. Client/model не должен задавать
host resource policy.

### Scenarios

- Все `user-sandbox` process trees входят в отдельный root-owned
  `brai-users.slice` с aggregate CPU, memory, swap и process/task limits.
- Каждая environment получает дополнительный per-environment cap; множество
  агентов одного пользователя делит этот cap.
- Перед новым launch launcher измеряет активный slice и сверяет его с
  host-owned policy. Отсутствующий, изменённый или более широкий active slice
  блокирует launch.
- Admission snapshot помогает отклонять заведомо невозможный запуск, но
  race-safe enforcement выполняет kernel cgroup, а не счётчик в приложении.
- Resource limit не создаёт filesystem quota reservation и не меняет профиль
  доступа.

## User containers and domains

### Requirement

Пользователь должен запускать свои контейнеры и публиковать принадлежащие ему
проекты без получения host runtime, Caddy, DNS или platform credentials.

### Scenarios

- Контейнеры пользователя используют только rootless engine его allocation
  slot; engine не является агентом или broker и не принимает решений о
  профиле.
- Platform ingress принимает только route на среду аутентифицированного владельца и проверенный hostname/port.
- User sandbox не получает host Docker socket, Caddy API/config или DNS provider credentials.
- Custom-domain desired state имеет короткий `valid_until`, повторно проверяет
  DNS proof и не может пережить абсолютный срок исходного challenge; старый TXT
  не продлевает владение.
- Ownership-lost и proof-expired записи не входят в ingress и атомарно перестают
  резервировать hostname при следующей legitimate reservation; новый текущий
  владелец может создать свежий route/challenge.
- Provisioning сначала атомарно резервирует неизменяемые slot/UID/GID/subids/XFS
  project/path в access DB. Crash до receipt не освобождает и не передаёт их
  другому пользователю.
- Rootless engine является host-процессом под отдельным deterministic
  locked/no-login principal `brai-eng-<base36-slot>` и systemd-private mount
  namespace. Это только Linux identity для kernel enforcement; он ничего не
  маршрутизирует и не повышает права.
- Его data root, image store, writable layers, build cache, named volumes,
  logs, exec state и temporary files находятся под `/data` и учитываются одной
  quota пользователя.
- Engine probe подтверждает rootless mode, точный установленный binary set,
  data-root `/data/docker`, owner/mode socket и отсутствие host socket.
  Mutable tag, privileged container, host network или data path вне quota root
  блокирует workload.
- Вложенные проекты одного пользователя могут изолироваться друг от друга
  собственными rootless networks/containers, но остаются внутри общего outer
  user trust boundary и resource cap.
- Для platform-generated hostname backend сам выдаёт имя в разрешённой зоне и
  сохраняет точное соответствие authenticated owner, project, environment и
  internal port. Пользователь не передаёт произвольный upstream host/path/socket.
- Generated hostname детерминированно имеет форму
  `project-<32 hex SHA-256>.brightos.world`; вся зона `brightos.world`
  зарезервирована platform-generated routes. Пользовательский custom-domain
  input не может занять platform/technical subdomain.
- Custom hostname становится active только после exact DNS proof с новым
  случайным token. Public desired state содержит только
  `valid_until + hostname -> {environment_id, port}` и не содержит credentials.
- Wildcard, IP address, special-use hostname и internal port вне диапазона
  `1024..65535` отклоняются до создания challenge/route.
- Custom challenge живёт 30 минут по умолчанию и не более 24 часов. DNS
  ownership receipt должен быть не старше 60 секунд в момент activation.
- Desired-state lease равна пяти минутам по умолчанию и допускается только в
  диапазоне 30 секунд–15 минут. Ingress удаляет route после `valid_until`, если
  не получил более новую валидную запись.
- Route history сохраняется как tombstone/cancelled state, но lost ownership,
  expired proof и stale challenge перестают занимать hostname атомарно с новой
  legitimate reservation.
- Ingress controller разрешает `environment_id` только через собственный
  trusted inventory и направляет трафик в private environment network; domain
  model не принимает IP/hostname хоста назначения от пользователя.

## Host numeric identity pool

### Requirement

Обычные user environments должны получать host UID/GID только из одного
детерминированного bounded pool, который не конфликтует с системными
allocators и полностью зарезервирован до первого запуска.

### Scenarios

- Policy v1 фиксирует pool `0x70000000..0x7FFDFFFF`, 131072 ID на environment,
  slots `0..2046`; slot расходует persistent user environment, а не агент.
- Slot детерминированно задаёт environment label `brai-u-<base36 slot>`,
  outer UID/GID start, 131072-ID range, image UID/GID offset 1000, inner
  subordinate offset/range 65536, XFS project ID `10000 + slot` и canonical
  path под `/srv/brai-user-data`.
- Pool не пересекает измеренный automatic `systemd-nspawn` range, systemd
  foreign-image range или IDs `>=2^31`.
- `/etc/subuid` и `/etc/subgid` содержат ровно по одной whole-pool записи
  `brai-sandbox-map:1879048192:268304384`; principal локальный, locked,
  без home/login и не используется как runtime user.
- Install и каждый runtime/provisioning preflight fail closed при missing,
  malformed, duplicate, partial или overlapping passwd/group/subuid/subgid
  record, unsupported NSS source либо allocator collision.
- `PrivateUsers=pick` не используется. Future shadow-utils `useradd` видит
  whole-pool reservation занятой; ручная/high-UID коллизия обнаруживается до
  запуска.
- Access store v1 имеет глобальный `UNIQUE(allocation_slot)` без
  `runtime_host_id`, поэтому текущий предел всей платформы — 2047 user
  environments на одном sandbox runtime host.
- Reservation 2048-й persistent environment обязана завершиться явной
  capacity error до host mutation. Добавление второго host само по себе не
  добавляет slots, пока access schema и contracts не поддерживают host binding.
- Ёмкость свыше 2047 требует отдельной future migration с immutable host
  assignment, composite slot uniqueness и host-bound receipt/launch; она не
  считается реализованной и не заменяется расширением pool v1.

## Database boundaries

### Requirement

Пользовательские project databases не должны увеличивать blast radius core
Supabase Brai. SQLite должен быть безопасным default внутри user data root;
Postgres пользователя должен оставаться opt-in rootless workload внутри той же
изоляции.

### Scenarios

- Новый пользователь или SQLite project не создаёт core Supabase schema, role, connection или secret.
- SQLite database и все journal/temp files принадлежат user data root и учитываются quota.
- User-run Postgres хранит `PGDATA` в user data root и не подключён к core Supabase network.
- Core service runtime role не имеет admin attributes, `TEMP`, foreign schema, `pg_net`, unlimited connections или migration privileges.
- Platform SQLite wrapper требует Node 22.22.3+ и patched SQLite 3.51.3+,
  отклоняет path escape, symlink alias и известные network/userspace
  filesystems, небезопасные для WAL.
- SQLite database создаётся private mode `0600`; включены foreign keys, WAL,
  `synchronous=NORMAL`, `trusted_schema=OFF`, busy timeout 5 секунд,
  autocheckpoint 1000 pages и bounded transactions.
- Transaction duration limit равен пяти секундам по умолчанию и не может быть
  больше 30 секунд. Nested и asynchronous transaction callbacks отклоняются;
  превышение лимита приводит к rollback.
- Live SQLite backup использует Backup API либо guarded `VACUUM INTO`, проверяет
  результат через `PRAGMA quick_check`, flush и atomic rename. Копирование
  одного live `.sqlite` без `-wal/-shm` запрещено.
- User Postgres запускается только через проверенный rootless engine, без
  published host port, в private internal network, без capabilities, с
  read-only container root и non-root final process.
- Postgres image задаётся immutable digest. `PGDATA`, temporary files, dumps и
  credentials file `0600` находятся под user root; password не попадает в
  Compose, arguments, repository или core secret store.
- До production-разрешения user Postgres workload должен пройти реальный
  backup/restore acceptance на quota-backed storage.
- Managed Postgres не входит в этот change. Schema-per-user, пользовательские
  roles или user DDL в core Supabase запрещены независимо от будущего решения.

## Core database ownership

### Requirement

Каждый core service, владеющий данными, должен иметь собственную Supabase
schema, checksum migration ledger и отдельные migration/runtime credentials.
Gateway, web, models и пользовательские среды не должны получать database
credentials.

### Scenarios

- `brai_access` хранит project memberships, allocation policy, user
  environments, user access states, transitions, agent runs и captured
  transition runs; migration ledger принадлежит этой же service boundary.
- Migration role выполняет только service-owned transactional migrations.
  Runtime role не может создавать/изменять schema, роли, extensions или
  migration ledger.
- `brai_access_runtime` изначально создаётся `NOLOGIN`, `NOINHERIT`, с
  connection limit 10, фиксированным search path и короткими
  timeouts: statement 4 секунды, lock 2 секунды, idle transaction 5 секунд.
- Runtime login разрешается только отдельной protected provisioning-командой,
  которая перед commit повторно проверяет отсутствие memberships, admin
  attributes, `TEMP`, public/foreign schema access, callable routines и лишних
  table grants.
- Access migration runner использует отдельный secret URL, advisory lock и
  checksum ledger. Factory migration runner не читает и не применяет файлы
  `brai_access`.
- Любое расширение database privileges требует отдельно reviewed change;
  automatic migration не должна незаметно добавлять `GRANT`, destructive DDL
  или destructive DML.

## Physical sandbox runtime contract

### Requirement

`user-sandbox` можно активировать только на одном общем bounded sparse
XFS-файле существующего ext4-раздела, смонтированном с `prjquota`, с полностью
установленным host ID reservation, проверенным immutable image, private
networking и kernel resource boundaries. Source templates и unit tests сами
по себе не являются активацией.

### Scenarios

- Backing file ровно один:
  `/srv/brai-storage/user-data.xfs`; mount point —
  `/srv/brai-user-data`. Он root-owned, mode `0600`, не расположен внутри
  собственного mount и подключается loop device через boot-safe systemd
  units с `prjquota`.
- Backing file создаётся sparse (`truncate`), а не через полное `fallocate`:
  логический размер — hard ceiling общего pool, не reservation. Нельзя
  создавать file/image/filesystem на пользователя, агента, задачу или проект.
- Install preflight вычисляет допустимый логический размер по свободному месту
  текущего ext4 и установленному system reserve floor. Runtime preflight
  измеряет одновременно внешний ext4 и внутренний XFS; при low-space новый
  launch/provision fail closed.
- Перед первым provisioning установлены exact whole-pool записи
  `/etc/subuid`/`/etc/subgid`, а principal/passwd/group/shadow/NSS/systemd
  allocator audit проходит без предупреждений.
- Shared outer image является root-owned, non-writable, digest-pinned и
  read-only. Helper открывает image и digest sidecar с `O_NOFOLLOW`, проверяет
  owner/mode/SHA через открытый descriptor и передаёт тот же descriptor в
  `systemd-nspawn`; повторное открытие path между verify и mount запрещено.
- Вся path chain доверенного image, включая `/srv/opt`, root-owned и не
  доступна для записи `mark`; установленные artifacts меняются только через
  sudo. Разработка остаётся в `/srv/projects`, а не в `/srv/opt`.
- Environment получает ровно один writable bind `/data`, fixed user-namespace
  mapping, private veth/network и firewall policy, запрещающую host services,
  core Docker networks и cross-user traffic.
- Host provisioner создаёт `/data/tmp` и `/data/var-tmp` после включения XFS
  project inheritance, но до первого `systemd-nspawn`; это устраняет bootstrap
  cycle и гарантирует, что temporary paths сразу входят в hard quota.
- Для каждого provisioned slot существует ровно один locked/no-login
  `brai-eng-<base36-slot>` с UID=GID=`outer_start + 1000` и точной subordinate
  записью `outer_start + 65536:65536`. Account не получает shell, home, SSH или
  интерактивный login.
- RootlessKit, dockerd, containerd, runc, fuse-overlayfs и slirp4netns
  устанавливаются один раз из digest-pinned sandbox image в root-owned
  `/srv/opt/brai-user-engine`; отдельной копии binary tree на пользователя нет.
- Engine systemd unit использует private mount namespace, bind только
  соответствующего quota root в `/data`, `ProtectSystem=strict` и явные
  `InaccessiblePaths` для `/srv/projects`, host homes, Caddy, runtime
  credentials и host container sockets.
- Socket находится в `/run/brai-user-engines/<environment>/docker.sock`,
  принадлежит точному slot UID/GID и bind-mounted только в соответствующий
  nspawn sandbox как `/run/user/1000/docker.sock`.
- Engine unit использует `Type=simple`; состояние active не является
  готовностью. `ExecStartPost` требует успешный `_ping` и `docker info`,
  rootless security option и `DockerRootDir=/data/docker`.
- Dedicated AppArmor profile применяется только к установленному RootlessKit
  path. `kernel.apparmor_restrict_unprivileged_userns=1` не отключается и
  permissive/unconfined profile запрещён.
- Engine cgroup разрешает только virtual DNS slirp `10.0.2.3/32` и запрещает
  RFC1918, link-local, host public IP и весь IPv6. Реальная acceptance должна
  доказать одновременно public egress и невозможность соединиться с host/private
  endpoints из пользовательского контейнера.
- Provisioning receipt хранит digest образа на момент создания environment как
  неизменяемый baseline. Это не означает отдельную копию образа пользователя:
  перед каждым launch verifier заново проверяет текущий общий canonical image.
  Его замена разрешена только при остановленных runtime intake и всех
  `brai-user-sandbox@` units, выполняется атомарно и не меняет `/data`,
  allocation или quota пользователя.
- Host Docker/containerd/Podman socket никогда не монтируется. Sandbox не
  запускается privileged и не получает host network.
- Runtime host хранит root-owned policy; client, user и model не могут
  подставить image digest, mount facts, quota facts, UID range, cgroup limits
  или network facts.
- Любое расхождение preflight отключает `user-sandbox`. Автоматический repair,
  запуск «как получится» или fallback в `developer` запрещены.

## Source tree ownership policy

### Requirement

Checkout Brai New должен иметь одного штатного Unix writer — `mark`.
Runtime, deployment, migrations и ordinary-user agents не должны создавать
файлы в live source tree.

### Scenarios

- Developer runtime policy рекурсивно проверяет owner, modes, symlink targets
  и special files в checkout и завершает preflight точной диагностикой при
  drift.
- World-writable source, foreign-owned entry, socket/device/FIFO, symlink
  escape, host runtime socket, committed secret или core credential блокирует
  developer launch.
- Рекурсивные `chmod -R`, `chown -R`, permission repair helpers и sudoers
  exceptions не считаются исправлением и запрещены как часть штатного workflow.
- Per-task Git clones/worktrees, отдельные caches с другим Unix owner и
  runtime/deploy-generated source metadata не допускаются.
- Старые scripts, preview ownership schemes, SQLite owner repairs, shared
  writers и sudoers rules из `/srv/projects/brai` не переносятся в Brai New.
- Runtime и system provisioning не создают artifacts root-процессом внутри
  `/srv/projects/brai-new`.

### Legacy evidence

- Read-only audit от 2026-07-17 нашёл 103 permission/boundary-кандидата среди
  259 legacy Activities; все 103 были закрыты, но сама repair-модель продолжала
  воспроизводить drift.
- В текущем на момент аудита Inbox было 34 таких кандидата среди 113 operations:
  22 `New` и 12 `Done`.
- Повторяющиеся причины: разные Unix writers одного checkout, per-task
  worktrees/caches, sandbox-команды против host-only paths, shared
  deploy/runtime source writes и разные identities для SQLite/WAL/backup.
- Полный evidence snapshot и mapping старых причин на новые controls находится
  в [архиве change](../openspec/changes/archive/2026-07-18-brai-agent-access-foundation/legacy-audit.md).

## Stable errors and audit evidence

### Requirement

Отказ доступа должен возвращать стабильный machine-readable code и оставлять
достаточный audit trail, не превращаясь в задачу на ручной ремонт прав.

### Scenarios

- Access errors различают missing membership, invalid state/profile, subject
  mismatch, stale/exhausted generation, transition in progress, incomplete
  runtime termination, invalid/expired/unknown-key/bad-signature contract,
  user quota exhaustion и shared pool exhaustion.
- Admin transition audit содержит authenticated initiator и не принимает actor
  из request body.
- Run, membership, environment, allocation и transition history не удаляются
  для сокрытия ошибки или освобождения identifier.
- Provisioning/launch receipts хранят typed measured facts и cryptographic
  binding, а не произвольную строку «проверено».
- Metrics/alerts должны разделять configuration/preflight denial,
  `storage_quota_exceeded`, `storage_pool_full`, resource admission и
  application exit. Их нельзя группировать как общий `permission denied`.

## Acceptance requirements

### Requirement

Ни один runtime profile не считается production-ready,
пока не пройдены проверки на реальном host boundary, а не только unit tests.

### Scenarios

- Ordinary sandbox acceptance доказывает denial чтения/записи/list/mount,
  process signaling, network connection и credential access между двумя
  пользователями и между sandbox и host/core services.
- Проверяется параллельная работа многих агентов одного пользователя, nested
  image build, volumes, SQLite WAL/backup, optional Postgres backup/restore,
  byte/inode quota exhaustion и shared-pool low-space behavior.
- Проверяется normal -> developer -> normal: старые process trees и credentials
  каждого поколения отсутствуют до активации следующего profile.
- Developer acceptance сравнивает web executor и Codex Desktop по UID/GID,
  `initgroups`, umask, checkout RW/ownership и effective sudo.
- Отсутствие любого acceptance evidence сохраняет соответствующую capability
  disabled; исключение по усмотрению агента не допускается.

## Activation and rollout truth

### Requirement

Документация и интерфейс должны отличать реализованный контракт,
bootstrap-only production state и физически активированную capability.
Нельзя называть фабрику запущенной, если установлен только source scaffold.

### Status snapshot — 2026-07-18

| Компонент                     | Фактическое состояние                                                                                                                                                    | Проверенное свойство                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Access contracts/store/runner | Access service, NATS adapter, signed contracts, immutable run snapshots, generation transitions и typed OS/cgroup receipts установлены и запущены                        | Недоверенная команда не выбирает profile/identity; stale generation и неверный receipt fail closed     |
| Developer web execution       | Transient systemd executor запускает процесс как `mark:mark`, с fresh groups, umask `0077`, checkout RW и действующим `sudo -n`                                          | Прямая и gated acceptance подтвердили parity с Codex Desktop и пустое process tree после termination   |
| User sandbox host             | Один sparse XFS/prjquota pool на существующем диске, immutable nspawn image, exact ID pool, aggregate/per-user cgroups, firewall и per-slot rootless engines установлены | Два пользователя изолированы по FS/PID/network; Brai source, credentials и host sockets недоступны     |
| Storage quota                 | Per-user XFS hard byte/inode limit, общий finite pool и low-space admission активны                                                                                      | Лимит ничего не резервирует; acceptance подтвердила `EDQUOT`, удаление данных и восстановление записи  |
| User containers               | Один rootless engine на persistent user slot; socket доступен только matching sandbox, mutable Docker state под той же quota                                             | Реальный build прошёл; host bind и host/private network denied, public egress разрешён                 |
| User databases                | SQLite default и optional Postgres внутри user root                                                                                                                      | SQLite и Postgres backup/restore прошли на quota-backed storage; core Supabase credentials отсутствуют |
| Profile switch                | Runtime controller завершает captured process trees до активации нового generation                                                                                       | Полный normal → developer → normal NATS/access/runtime E2E прошёл                                      |

### Completion evidence

- Ordinary runtime acceptance от 2026-07-18 прошла для `brai-u-0` и
  `brai-u-1`: cross-user FS/PID/network denial, source/credential/socket denial,
  measured veth+nft drops, parallel agents, bounded quota exhaustion/recovery,
  rootless container build с host-bind rejection, SQLite и Postgres
  backup/restore.
- Developer acceptance прошла напрямую и через signed gated launch: UID/GID
  `1000:1000`, cwd `/srv/projects/brai-new`, umask `0077`, fresh supplementary
  groups, checkout RW, `sudo -n`, удержание до release и empty process tree
  после termination.
- Полный access/runtime E2E прошёл через реальные NATS и access store: два
  normal launches, developer enable generation 6, developer launch, disable
  generation 7.
- Repository lint, typecheck, build, unit и integration tests прошли.
  Playwright E2E прошли 8/8 вне Codex command sandbox; sandboxed запуск Chrome
  ожидаемо получил локальный `ERR_ACCESS_DENIED` до выполнения application
  assertions.
- GitHub repository, CI/CD activation, production ingress controller,
  managed user Postgres и multi-host sharding остаются явными non-goals и не
  являются незавершёнными компонентами этой access foundation.
