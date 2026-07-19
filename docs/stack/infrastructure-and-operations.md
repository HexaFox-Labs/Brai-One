# Инфраструктура и эксплуатационный стек

**Статус:** `active`

Эти компоненты образуют runtime boundary. Их нельзя рассматривать только как
«инструменты разработки»: изменение конфигурации может менять безопасность,
доступность или правила изоляции.

## Сервисы и сети

| Компонент           | Роль                                                        | Источник                                                                                                                                         |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docker Compose      | Локальная/manual-модель и production digest-модель          | [`compose.yml`](../../compose.yml), [`infrastructure/deployment/compose.production.yml`](../../infrastructure/deployment/compose.production.yml) |
| Caddy               | TLS, HTTP→HTTPS redirect, Basic Auth, маршрутизация web/API | [`infrastructure/caddy/`](../../infrastructure/caddy/)                                                                                           |
| NATS Server         | Приватный bus, JetStream и loopback endpoint runtime host   | [`infrastructure/nats/`](../../infrastructure/nats/)                                                                                             |
| Supabase/PostgreSQL | Service-owned schemas и роли                                | [`infrastructure/supabase/`](../../infrastructure/supabase/)                                                                                     |
| Nginx               | Раздача static web export внутри `brai-web`                 | [`apps/web/nginx.conf`](../../apps/web/nginx.conf)                                                                                               |
| Log4brains ADR      | Сборка и просмотр архитектурных решений                     | [`infrastructure/adr/README.md`](../../infrastructure/adr/README.md)                                                                             |

Порты контейнеров публикуются только на `127.0.0.1`; внешними остаются Caddy
80/443 и SSH 22 по host policy. `brai-nats:4222` — специальный loopback-only
endpoint доверенного runtime host, а не публичный или browser-facing сервис.
Приложения не получают публичного binding. Полная карта сетей и ролей:
[микросервисная топология](../reference/microservice-topology.md).

## Доступ и изоляция агентов

| Механизм                    | Назначение                                                 |
| --------------------------- | ---------------------------------------------------------- |
| systemd-nspawn              | OS boundary обычного пользователя                          |
| rootless Docker engine      | Контейнеры конкретного пользователя без host Docker socket |
| Linux user/group namespaces | Числовое отделение user identity                           |
| XFS project quota           | Жёсткая byte/inode quota внутри общего sparse pool         |
| cgroups/systemd slice       | Aggregate и per-environment CPU, RAM, swap и task limits   |
| nftables/network policy     | Запрет доступа к host/private endpoints из sandbox         |
| AppArmor/RootlessKit        | Ограничение rootless engine и user namespace path          |
| systemd units/timers        | Lifecycle runtime, storage setup и trim                    |

Решение профиля (`user-sandbox` или `developer`) принимает trusted server code
до старта. Эти границы описаны в
[`openspec/specs/agent-access/spec.md`](../../openspec/specs/agent-access/spec.md)
и операционных README
[`infrastructure/agent-runtime/README.md`](../../infrastructure/agent-runtime/README.md).

## Deployment

Production использует immutable digest-addressed images, root-owned receiver,
отдельные migration steps и health/rollback gates. Живой checkout не является
местом сборки или генерации production-артефактов.

Операторские host paths, service names и факт установки регистрируются в
[`/home/mark/DEPLOYMENT.md`](/home/mark/DEPLOYMENT.md). В этот репозиторий нельзя
добавлять реальные env-файлы, credentials, private keys или Basic Auth values.

ADR-site публикуется отдельным статическим release-root и обслуживается через
существующий Caddy `adr.brai.one`; его процедуры описаны в
[`infrastructure/adr/README.md`](../../infrastructure/adr/README.md).

## Браузерная проверка и диаграммы

- Chrome DevTools MCP — основной инструмент QA защищённого опубликованного
  preview/dev URL; для protected URL сначала проходит Caddy Basic Auth, затем
  login приложения.
- `agent-browser` — быстрый просмотр и простые действия, когда не нужны
  console/network/performance details DevTools.
- Kroki на `http://127.0.0.1:8000` — локальный renderer текстовых диаграмм;
  по умолчанию выбираем SVG.

Эти инструменты являются средой агента, а не runtime-зависимостями Brai. Они
не должны попадать в package manifest только ради документации.
