# Принять server-selected профили доступа и постоянные изолированные среды

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: architecture, security, access, sandbox, runtime

## Контекст

Обычный пользовательский агент должен работать с проектами и файлами, но не
может получать host root, core credentials, Caddy или host container socket.
Одновременно доверенный разработчик должен иметь тот же обычный checkout и
sudo-контракт, что Codex Desktop. Право нельзя выбирать из prompt, модели,
tool call или project-level UI: это позволило бы агенту повысить собственный
уровень доступа.

## Решение

Выбор производит только trusted server code из global server-side
`developer_mode` до запуска runtime. Существуют ровно два профиля:
`user-sandbox` и `developer`.

- `user-sandbox` получает одну persistent OS-isolated environment на владельца:
  отдельный identity slot, quota-backed storage root, rootless engine и private
  network. Агенты и проекты одного пользователя работают в одном trust domain.
- `developer` запускается как host user `mark` в checkout с тем же sudo
  контрактом, что Codex Desktop. Это доверенный режим, а не sandbox.
- Launch contract серверно подписан, короткоживущ и привязан к run, user,
  project, environment, host, generation, profile и command digest.
- Изменение профиля или membership увеличивает generation, завершает старые
  process trees и создаёт новую среду прав; live process никогда не получает
  повышение или понижение in-place.

## Рассмотренные альтернативы

- **Позволить агенту или project admin выбрать profile:** отклонено, потому что
  это создаёт путь эскалации до host developer/sudo access.
- **Одна среда на каждый agent run или проект:** отклонено: это увеличивает
  lifecycle, дисковые копии и permission drift без лучшей границы владельца.
- **Выдать user sandbox host Docker socket:** отклонено, потому что socket
  эквивалентен host-root boundary.
- **Менять права работающего процесса:** отклонено: невозможно надёжно
  отозвать уже унаследованные descriptors, credentials и дочерние процессы.

## Последствия

- Плюс: профиль и OS identity задаёт только проверяемая server-side цепочка.
- Плюс: нормальная работа пользователей изолирована от Brai source, host
  sockets, Caddy, core NATS/Supabase и secrets.
- Плюс: quota, identity slot и storage root резервируются до host provisioning
  и не переиспользуются после частичной ошибки без подтверждённого teardown.
- Минус: v1 ограничен одним runtime host и 2047 persistent user slots; для
  multi-host требуется отдельный immutable host assignment и migration.
- Минус: developer mode намеренно доверяет пользователю `mark`; он не является
  защитой от злонамеренного root.

## Проверка

- `openspec/specs/agent-access/spec.md` определяет обязательные scenarios.
- `infrastructure/agent-runtime/` содержит host tooling и focused tests для
  allocation, receipts, cgroups, storage и launcher.
- `docs/agent-access-architecture.md` фиксирует технические границы, а
  `docs/permissions-and-isolation.md` — объяснение и evidence состояний.
- Gateway и contracts reject untrusted profile, generation, identity и command
  digest fields на browser-facing access routes.

## Ссылки

- [`openspec/specs/agent-access/spec.md`](../../openspec/specs/agent-access/spec.md)
- [`openspec/changes/archive/2026-07-18-brai-agent-access-foundation/design.md`](../../openspec/changes/archive/2026-07-18-brai-agent-access-foundation/design.md)
- [`docs/agent-access-architecture.md`](../agent-access-architecture.md)
- [`docs/permissions-and-isolation.md`](../permissions-and-isolation.md)
- [`infrastructure/agent-runtime/README.md`](../../infrastructure/agent-runtime/README.md)

## Заменяет

Нет.

## Заменено

Нет.
