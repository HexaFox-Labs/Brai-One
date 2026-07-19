<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Nginx

**Категория:** [Инфраструктура](../by-category/infrastructure.md)  
**Статус:** active  
**Версия:** image-managed  
**Тип:** static-server  
**Область:** project

**Теги:** static, web

## Если коротко

Непривилегированный static server внутри web runtime image.

## Что это такое

Nginx — это лёгкий HTTP server для выдачи готовых статических файлов и простых health surfaces. Он не собирает React-приложение и не реализует бизнес-API: его задача — эффективно отдать уже созданный static export.

## Зачем это нужно Brai

После сборки Next.js Brai не требуется отдельный Node application process для каждой страницы. Nginx уменьшает runtime surface web-контейнера, оставляет API за Gateway и отдаёт artifact предсказуемо, пока внешний TLS и маршрутизацию контролирует Caddy.

## Почему мы выбрали именно этот инструмент

После static export нужен простой и предсказуемый server, а не отдельный application runtime.

## Как он работает в нашем контуре

Nginx внутри `brai-web` читает только `apps/web/out`; внешний TLS и routing остаются ответственностью Caddy.

## Что он даёт

- static file serving
- непривилегированный web runtime
- простая container health surface

## Практические сценарии

- отдать собранный Next.js export
- проверить статический сайт после image rebuild
- отделить static web от Gateway

## Как мы это используем

Nginx получает только уже собранный `apps/web/out`; вход снаружи проходит через Caddy.

## Где находится

`apps/web/nginx.conf` и web runtime image.

## Ограничения

Nginx не является API edge и не должен получать database или NATS доступ.

## Типичные ошибки

- добавить API logic в Nginx config
- считать Nginx внешним ingress вместо Caddy

## Связанные инструменты

- [Next.js](./nextjs.md) — Web-фреймворк, который собирает пользовательский интерфейс Brai New.
- [Caddy](./caddy.md) — Единая внешняя точка входа с TLS, redirect, Basic Auth и маршрутизацией.
- [Docker Compose](./docker-compose.md) — Описывает локальный и production-like runtime Brai New как набор сервисов.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**image-managed**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Web container healthcheck
- Static web E2E

## Источники и дальнейшее чтение

- [Nginx config](../../../apps/web/nginx.conf)
- [Infrastructure stack](../../../docs/stack/infrastructure-and-operations.md)

[← Вернуться к каталогу стека](../README.md)
