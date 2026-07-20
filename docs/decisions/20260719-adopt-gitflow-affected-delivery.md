# Принять Git Flow с affected delivery и ограниченными preview slots

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: delivery, git-flow, preview, storage, security

## Контекст

Legacy окружения копировали checkout, зависимости, Gradle caches и build
outputs в каждую ветку. Малое изменение запускало полную CI-проверку и
создавало многогигабайтные preview. При этом auto-merge мог сработать до
завершения checks, а public repository не имел достаточно узкой trust boundary
для deployment automation.

## Решение

Принят Git Flow с `dev` как integration branch, `release/*` как frozen
candidate и `main` только как production history. Affected catalog на основе
Nx определяет точный runtime scope. Сервисные образы строятся один раз в
GitHub Actions, адресуются digest и накладываются на полный manifest прошлого
здорового окружения.

Runtime PR получает preview только после первого зелёного qualifying commit.
Controller выбирает lowest free `p01`–`p20`, стартуя не более пяти preview,
и использует release-priority FIFO при дефиците. Одной ветке соответствует
один lease: последующие commits обновляют существующий preview. Slot хранит
data-only seed из dev, isolated Docker volumes/networks и контейнеры
`pNN-brai-*`; он не хранит checkout или зависимости.

`dev` использует `d-brai-*`. Production не выкатывается из обычного push в
`main`: это отдельное protected promotion точного проверенного release.
Runtime acceptance закрепляется обязательным status точной revision через
owner-only dispatch; ручной merge его не обходит. Non-runtime Dev/release
revision получает только новый малый manifest без image build и runtime
restart. Production и rollback используют один package
`ghcr.io/hexafox-labs/brai-one` с digest-only ссылками и явный fail-closed
host-контракт.

## Рассмотренные альтернативы

- Клонировать проект и зависимости в каждую preview directory. Отклонено:
  это повторяет измеренный legacy waste и делает cleanup рискованным.
- Резервировать slot при создании ветки. Отклонено: documentation/non-runtime
  ветки заняли бы все slots до первого изменения runtime.
- Делать один общий preview database. Отклонено: ветки могли бы менять данные
  друг друга и не отражали бы real integration state.
- Публиковать application ports напрямую. Отклонено: Caddy должен остаться
  единой TLS/auth boundary.

## Последствия

- Плюс: быстрый feedback, shared image layers, ограниченный disk use и
  rollback к прошлому healthy manifest.
- Плюс: forks не получают CI compute, secrets, packages или preview.
- Минус: preview может быть queued при capacity limit; DNS ceiling не означает
  20 одновременно работающих runtime.
- Минус: migration changes остаются консервативными и могут затронуть полный
  relevant runtime closure.

## Проверка

- Unit tests проверяют impact, manifest overlay, ordered lease, stale
  generation, strict OIDC и failure rollback.
- Compose test подтверждает отсутствие source/bind mounts и loopback-only
  ports.
- Host controller проверяется через systemd health endpoint, Caddy validation
  и synthetic dev/preview before legacy cutover.

## Ссылки

- [`docs/reference/affected-delivery.md`](../reference/affected-delivery.md)
- [`openspec/specs/gitflow-affected-delivery/spec.md`](../../openspec/specs/gitflow-affected-delivery/spec.md)
- [`openspec/changes/gitflow-affected-delivery/`](../../openspec/changes/gitflow-affected-delivery/)

## Заменяет

Нет.

## Заменено

Нет.
