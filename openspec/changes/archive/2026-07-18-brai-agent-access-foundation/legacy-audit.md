# Legacy Brai permission and database incident audit

## Scope and evidence

Аудит выполнен 2026-07-17 только на чтение по трём источникам старого Brai:

1. production `activities` через штатный
   `list-operation-activities.sh --local --status all --limit 500 --json`;
2. production `inbox` прямым `SELECT` от runtime service user с условиями
   `record_type_id = 2`, `preliminary_section = 'operation'` и
   `deleted_at_utc IS NULL`;
3. deploy, migration и permission-repair код в `/srv/projects/brai`.

Секреты, DSN и содержимое env-файлов не выводились. Старый проект и его БД не
изменялись.

Для воспроизводимого первичного среза использован широкий case-insensitive
поиск по title/reason/description: `permission`, `EACCES`, `EPERM`, `chmod`,
`chown`, `ownership`, `writable`, `read-only`, `sandbox`, `sudo`, `nobody`,
`group-write`, `SQLite access/backup` и русские формы `права`, `доступ`,
`владелец`. Это список кандидатов для анализа, а не утверждение, что каждое
совпадение имеет одну и ту же первопричину.

## Result snapshot

| Источник | Все operation-записи | Кандидаты про права/границы | New | Done |
| --- | ---: | ---: | ---: | ---: |
| Legacy `activities` | 259 | 103 | 0 | 103 |
| Current `inbox` | 113 | 34 | 22 | 12 |

Таким образом, переносить старую модель «создать ещё один repair/helper/sudoers
exception» нельзя: даже после закрытия 103 legacy записей в новом Inbox уже
накопились 22 открытые записи того же класса.

## Repeated root causes

- Один и тот же checkout, Git metadata, ignored files, caches и generated
  outputs создавались `mark`, `root`, `nobody`, deploy и runtime users. После
  каждого исправления следующий writer снова создавал несовместимого владельца.
- Task worktrees и per-task caches размножали места возникновения drift:
  `.git/worktrees/*`, Vite/Next/Gradle/Capacitor caches, OpenSpec, landing и
  Playwright output.
- Sandbox пытался использовать host-only операции: Git metadata вне writable
  root, bind/listen/process creation, localhost DB, Gradle/npm homes и live
  deploy paths. Ошибка границы маскировалась под файловые права и лечилась
  escalation.
- Preview/deploy/runtime identities совместно изменяли OTA, source, SQLite,
  backups, env и registry paths. Frozen preview scripts расходились с live
  sudoers и ownership contract.
- SQLite runtime и maintenance выполнялись разными Unix identities; backup,
  WAL и deploy reset не имели одного quota/ownership boundary. Supabase/Supavisor
  инциденты дополнялись неограниченными или дрейфующими runtime-настройками.
- Репозиторий содержал рекурсивный permission repair
  `scripts/brai-task-repair-permissions.sh`. Он устранял результат drift, но не
  удалял второго writer и потому не мог сделать проблему невозможной.

## Controls carried into Brai New

| Legacy failure class | Permanent control |
| --- | --- |
| Несколько Unix writers в checkout | Единственный штатный writer `mark`; developer web runtime имеет ровно тот же UID/GID/sudo contract. Каждый developer launch блокируется рекурсивным owner/mode preflight при drift. |
| Per-task worktrees и caches | Нет clone/worktree на задачу. Developer agents используют общий checkout; normal agents — одну persistent environment пользователя. |
| Escalation как ремонт | Ровно два server-selected launch profiles. Старый процесс завершается при смене generation; профиль нельзя выбрать из payload. |
| Runtime/deploy пишет в source | Runtime и provisioning не имеют штатного пути записи в checkout; готовые системные artifacts устанавливаются root-owned вне `/srv/projects`. Будущий delivery flow не должен генерировать файлы в live checkout. |
| Shared Docker socket и root-owned layers | Normal environment не видит host socket; nested runtime rootless, а все mutable layers/cache/volumes лежат в одном user quota root. |
| SQLite/backup owner drift | SQLite, WAL, backup и user Postgres принадлежат одной user environment и одной non-reserving byte/inode quota. |
| Core DB role drift | Schema-per-service, NOLOGIN migration role, bounded runtime LOGIN role, connection/time limits и исполняемый DB audit. |
| Повторный `chmod -R`/`chown -R` | Такие repair-команды не входят в штатный workflow; provisioning считается успешным только после exact allocation/preflight receipt. |

## Non-transfer rule

Ни один legacy repair script, worktree permission model, preview shared-writer
contract, production SQLite ownership scheme или agent-operation helper не
является архитектурным источником для Brai New. Допускается переносить только
UI/brand foundation, явно разрешённый корневым `AGENTS.md`.
