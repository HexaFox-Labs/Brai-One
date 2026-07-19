<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Caddy

**Категория:** [Инфраструктура](../by-category/infrastructure.md)  
**Статус:** installed  
**Версия:** host-managed  
**Тип:** ingress  
**Область:** host

**Теги:** tls, proxy, auth

## Если коротко

Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.

## Что это такое

Caddy — это reverse proxy и ingress, который принимает внешний HTTP/HTTPS-трафик, управляет TLS и направляет запросы к внутренним сервисам. Он также может применить redirect, Basic Auth и правила маршрутизации до того, как запрос попадёт в application container.

## Зачем это нужно Brai

Brai нужен один контролируемый вход на 80/443 вместо публичного набора портов для каждого сервиса. Caddy централизует TLS и protected subdomains, оставляет Gateway и web на loopback и помогает одинаково проверять public и technical surfaces.

## Почему мы выбрали именно этот инструмент

Один ingress позволяет централизовать TLS, redirect, Basic Auth и правила public/private surface.

## Как он работает в нашем контуре

Caddy принимает 80/443 и направляет web и `/api/*` на loopback services, не раскрывая application ports.

## Что он даёт

- automatic TLS и HTTP-to-HTTPS redirect
- reverse proxy routing
- unified Basic Auth для protected technical subdomains

## Практические сценарии

- опубликовать Factory route
- проверить authenticated HTTPS smoke
- атомарно добавить или откатить Caddy route

## Как мы это используем

Caddy принимает 80/443, направляет web и `/api/*` в нужные loopback services.

## Где находится

`infrastructure/caddy` и host Caddy configuration.

## Ограничения

Нельзя обходить Caddy и публиковать application ports наружу.

## Типичные ошибки

- обойти Caddy прямым backend port
- перенести пароль Basic Auth в repository docs

## Связанные инструменты

- [Docker Compose](./docker-compose.md) — Описывает локальный и production-like runtime Brai New как набор сервисов.
- [Nginx](./nginx.md) — Непривилегированный static server внутри web runtime image.
- [Chrome DevTools MCP](./chrome-devtools.md) — Основной инструмент глубокой QA-проверки опубликованных защищённых URL.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**host-managed**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Caddy config validation
- Authenticated HTTPS smoke test

## Источники и дальнейшее чтение

- [Caddy README](../../../infrastructure/caddy/README.md)
- [Ingress config](../../../infrastructure/caddy/factory.caddy)

[← Вернуться к каталогу стека](../README.md)
