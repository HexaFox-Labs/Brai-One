# Принять immutable artifact delivery вне live checkout

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: architecture, deployment, security, ci-cd

## Контекст

Production deployment не должен зависеть от изменяемого checkout, ручной
сборки на host или mutable image tags. Такие пути смешивают developer writes,
runtime и delivery identity, усложняют rollback и делают проверку provenance
неопределённой. Миграции базы при этом нельзя безопасно «откатывать наугад»
вместе с образом.

## Решение

Production delivery использует digest-addressed OCI images и root-owned
receiver вне `/srv/projects/brai-new`.

- CI собирает полный согласованный набор образов и передаёт только строгий
  manifest c GHCR `sha256` digests.
- Host receiver в `/srv/opt/brai-new-deploy` проверяет fixed deploy principal,
  manifest, ownership, Compose, backup, migrations и healthchecks.
- Runtime configuration и secrets остаются в `/etc/brai-new`; production
  Compose не содержит `build` keys или source bind mounts.
- `current` переключается только после healthy release; `previous` хранит
  предыдущий healthy image set для rollback.
- Миграции транзакционны, но automatic destructive schema rollback запрещён.
  Любая destructive DDL/DML или privilege broadening требует отдельной
  reviewed maintenance path.

Документ фиксирует целевую delivery boundary. Его host activation — отдельная
административная операция и не следует из наличия исходников в репозитории.

## Рассмотренные альтернативы

- **Собирать и запускать production из live checkout:** отклонено из-за
  смешения developer state и production artifact, а также source ownership
  drift.
- **Использовать image tags:** отклонено: tag не доказывает точный байтовый
  образ и затрудняет воспроизводимый rollback.
- **Автоматически откатывать database schema вместе с образом:** отклонено:
  destructive rollback может потерять данные и права.
- **Разрешить CI произвольно выполнять host команды:** отклонено: receiver
  принимает только strict manifest через fixed least-privilege principal.

## Последствия

- Плюс: delivery имеет проверяемый artifact provenance и чёткую release
  границу.
- Плюс: rollback образов не переписывает checkout и не пытается скрытно
  удалить данные.
- Плюс: deployment identity не получает Docker, sudo или shell access шире
  фиксированного receiver.
- Минус: первый activation требует отдельной подготовки GitHub Environment,
  host key и root-owned tooling.
- Минус: database evolution требует дисциплины expand/contract и backup.

## Проверка

- `infrastructure/deployment/test/` проверяет manifest, receiver, migration и
  production Compose policy.
- [`infrastructure/deployment/README.md`](../../infrastructure/deployment/README.md)
  описывает exact activation и rollback gates.
- Host registry `/home/mark/DEPLOYMENT.md` обновляется только при фактической
  установке или изменении host tooling.

## Ссылки

- [`infrastructure/deployment/README.md`](../../infrastructure/deployment/README.md)
- [`infrastructure/deployment/compose.production.yml`](../../infrastructure/deployment/compose.production.yml)
- [`docs/reference/microservice-topology.md`](../reference/microservice-topology.md)
- [`docs/agent-access-architecture.md`](../agent-access-architecture.md)

## Заменяет

Нет.

## Заменено

Нет.
