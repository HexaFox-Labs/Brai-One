# How to добавить новый сервис

Результат: новый workspace-проект с согласованными scripts, тестами и явной
границей владения данными.

## Предварительные условия

- требования к сервису оформлены в OpenSpec, если меняется контракт;
- известно, владеет ли сервис базой данных;
- определены NATS subjects и ACL;
- выбран тип `service` или `worker`.

## Шаги

1. Создай каркас генератором:

   ```bash
   pnpm generate:service --name=activity-worker --kind=service --database=false
   ```

   Замени `activity-worker` на имя своего сервиса. Для владельца данных
   используй `--database=true`; для фонового процесса замени
   `--kind=service` на `--kind=worker`.

2. Проверь созданные package scripts и добавь тесты для публичного поведения:

   ```bash
   pnpm --filter @brai/activity-worker typecheck
   pnpm --filter @brai/activity-worker test
   ```

   В примере используется имя из предыдущего шага.

3. Подключи сервис к NATS. Межсервисный прикладной трафик не должен появляться
   как прямой HTTP-вызов. Добавь subjects и минимальные ACL в
   [`infrastructure/nats/nats-server.conf`](../../infrastructure/nats/nats-server.conf).

4. Если сервис владеет данными, выдели ему свою schema, migration path и
   least-privilege runtime role. Gateway и web не получают эти credentials.

5. Добавь сервис в local Compose и digest production model только после того,
   как healthcheck, env contract и network boundary определены.

6. Обнови справочник:

   - [`reference/repository-map.md`](../reference/repository-map.md);
   - [`stack/application.md`](../stack/application.md), если появился новый
     прямой runtime/tooling dependency;
   - соответствующий OpenSpec и ADR.

## Verification

```bash
pnpm run ci
pnpm run compose:config
```

Для database-owning service дополнительно проверь migration-role audit и
отсутствие database credentials у Gateway/web.

## Troubleshooting

- **Сервис начал ходить к другому сервису по HTTP.** Удали прямой вызов и
  оформи NATS subject с ACL.
- **Новый runtime получил общую базу.** Верни ownership к отдельной schema и
  отдельным migration/runtime roles.
- **Генератор не найден.** Сначала выполни `pnpm install` и повтори корневую
  команду; генератор собирается перед `nx generate`.
