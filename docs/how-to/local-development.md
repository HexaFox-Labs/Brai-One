# How to запустить локальную разработку

Этот how-to доводит новый checkout до проверенного состояния и, при наличии
локальной конфигурации, запускает ручную Compose-модель.

## Предварительные условия

- Node.js `>=22.22.3 <23`;
- pnpm `>=11.13.1 <12`;
- Docker Engine с Compose;
- checkout в `/srv/projects/brai-new`;
- секреты и protected env только вне репозитория.

## Шаги

1. Проверь версии и установи зависимости:

   ```bash
   node --version
   pnpm --version
   pnpm install
   ```

2. Выполни полный локальный CI:

   ```bash
   pnpm run ci
   ```

3. Проверь, что Compose-модель разрешается:

   ```bash
   pnpm run compose:config
   ```

4. Если защищённая локальная конфигурация уже подготовлена, запусти runtime:

   ```bash
   docker compose up -d --build \
     brai-web brai-api-gateway brai-nats brai-factory brai-access
   ```

5. Проверь состояние контейнеров:

   ```bash
   docker compose ps
   ```

   Для UI/API QA используй правила из `AGENTS.md`: опубликованный protected
   URL проверяется изолированным Chrome DevTools после Caddy Auth и login
   приложения. Localhost-проверка не заменяет production/preview QA.

6. Останови локальную модель без удаления named volumes:

   ```bash
   docker compose down
   ```

## Verification

Успешный результат означает:

- `pnpm run ci` завершился без ошибок;
- `pnpm run compose:config` вывел валидную модель;
- `docker compose ps` показывает ожидаемые сервисы без immediate restart loop.

## Troubleshooting

- **Не хватает переменной окружения.** Прочитай
  [`infrastructure/docker/README.md`](../../infrastructure/docker/README.md) и
  используй protected env вне checkout. Не добавляй значение в `.env.example`.
- **Policy проверяет не того владельца.** Не запускай recursive `chown` или
  `chmod`; выясни, какой процесс нарушил contract, и следуй access preflight.
- **NATS/Factory не готовы.** Проверь health и логи Compose, затем сверяй
  конфигурацию subjects/credentials с
  [`infrastructure/nats/README.md`](../../infrastructure/nats/README.md).
- **Нужно проверить production/dev URL.** Используй Chrome DevTools MCP с
  headless isolated profile, а не личный браузер и не обход Caddy.
