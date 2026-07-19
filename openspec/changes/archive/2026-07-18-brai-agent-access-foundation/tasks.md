# Tasks

## Decisions and permanent guardrails

- [x] Проанализировать permission- и DB-инциденты старого Brai.
- [x] Зафиксировать два статических профиля без AI в access decision path.
- [x] Зафиксировать одну persistent environment на пользователя и отсутствие per-task clones.
- [x] Зафиксировать non-reserving quota и SQLite/user-contained Postgres policy.
- [x] Добавить постоянные agent access invariants в корневой `AGENTS.md`.
- [x] Добавить исполняемый audit owner/mode/special-file invariants checkout.
- [x] Добавить migration и audit connection/time limits для core service role.
- [x] Обновить service generator, чтобы новые DB-роли создавались bounded и least-privilege.
- [x] Проверить на текущем единственном ext4-диске, что один sparse XFS pool и
      per-user project quota не резервируют логический размер/лимит заранее.

## Access control and launch

- [x] Создать service-owned access store для admin-controlled `developer_mode`, `access_generation` и immutable run profile.
- [x] Реализовать admin-only state transition, generation bump и capture всех живых runtimes пользователя.
- [x] Реализовать подписанный внутренний launch contract и fail-closed выбор одного из двух статических profiles.
- [x] Добавить developer launcher parity test: UID/GID `mark`, checkout RW и действующий sudo contract.
- [x] Расширить launch contract точной привязкой к project, environment,
      runtime host и неизменяемому job/command digest.
- [x] Заменить opaque lifecycle evidence на typed OS/cgroup identity и receipts.
- [x] Подключить transition к runtime controller и подтверждать empty process
      tree до активации нового profile.
- [x] Подключить access service к NATS/API с server-side auth/membership и
      запретом profile/identity fields во входной команде.
- [x] Подключить реальный developer executor как transient systemd unit
      `User=mark`, `Group=mark`, fresh groups, umask `0077`, checkout RW и sudo.

## User environment

- [x] Установить один bounded sparse XFS pool-файл на текущем диске,
      `prjquota` mount и boot-safe systemd units без предвыделения логического
      размера.
- [x] Реализовать долговечную атомарную reservation identity/XFS slot/path до любых host mutations и безопасный crash/retry.
- [x] Реализовать bounded host ID pool contract, строгий parser/audit,
      fail-closed install template и runtime/provisioning preflight.
- [x] Установить exact `brai-sandbox-map` whole-pool reservation на runtime
      host и acceptance-проверить отсутствие NSS/systemd/passwd/group/subid
      collisions.
- [x] Установить и acceptance-проверить создание одной user environment с user namespace, private network и единственным user data mount.
- [x] Подготовить fail-closed templates/preflight для Docker-compatible rootless nested runtime без host socket и mutable data вне quota root.
- [x] Установить rootless runtime и проверить nested build/volume/image workload на реальном quota pool.
- [x] Реализовать domain model и атомарный registry contract для generated subdomains и проверенных custom domains.
- [x] Добавить явные storage quota/pool errors и low-space admission guard.

## User databases

- [x] Добавить patched SQLite project template, WAL/busy timeout/checkpoint и safe backup/restore.
- [x] Проверить user-run Postgres container с quota-bound `PGDATA`, private network и restore test.

## Acceptance and rollout

- [x] Проверить cross-user filesystem/process/network/credential denial.
- [x] Проверить parallel agents одного пользователя, nested builds и quota exhaustion.
- [x] Проверить переключения normal → developer → normal без сохранения старых процессов или credentials.
- [x] Установить runtime/storage services и одновременно обновить `/home/mark/DEPLOYMENT.md`.
- [x] Выполнить полный unit/integration/acceptance прогон и финальный self-review
      (delegated review не использовался: текущие workspace rules запрещают
      subagents без явного запроса пользователя).
- [x] Синхронизировать итоговую спецификацию в `openspec/specs/agent-access/spec.md`
      и архивировать завершённый change.

## Explicit non-goals of this change

- GitHub repository, CI/CD activation и production deployment.
- Второй sandbox runtime host и multi-host sharding.
- Managed Postgres/Supabase для пользовательских проектов.
- Production ingress/Caddy/DNS controller для пользовательских доменов.
