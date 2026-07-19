<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Pino

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 10.3.1  
**Тип:** logging  
**Область:** project

**Теги:** logs, observability

## Если коротко

Структурированные логи для приложений и сервисов.

## Что это такое

Pino — это быстрый structured logger для Node.js, который записывает события в машиночитаемом JSON-виде. Помимо текста сообщения, запись может содержать уровень, request context и диагностические поля, удобные для container logs.

## Зачем это нужно Brai

Сервисы Brai работают через несколько процессов и NATS, поэтому произвольный текстовый log трудно сопоставить по времени и correlation id. Pino делает operational evidence пригодным для диагностики, не разрешая при этом логировать токены, пароли или целые пользовательские payloads.

## Почему мы выбрали именно этот инструмент

Структурированные логи нужны для диагностики сервисов без хрупкого парсинга произвольного текста.

## Как он работает в нашем контуре

Pino пишет JSON events из Gateway/runtime helpers; container logs остаются operational evidence.

## Что он даёт

- быстрый structured logging
- уровни и context fields
- удобный container log output

## Практические сценарии

- записать request correlation event
- объяснить NATS timeout
- проверить startup/readiness sequence

## Как мы это используем

Logger подключён к Gateway/runtime helpers с согласованными полями.

## Где находится

Gateway и `packages/runtime`.

## Ограничения

Логи не должны содержать секретные значения или полные пользовательские payloads без необходимости.

## Типичные ошибки

- записывать секреты или целые пользовательские payloads
- заменять error handling одним log statement

## Связанные инструменты

- [Fastify](./fastify.md) — Единственный HTTP edge для Gateway Brai New.
- [Node.js](./nodejs.md) — Среда, в которой запускаются приложения, сервисы, workers и инструменты Brai New.
- [NATS](./nats.md) — Приватная шина request/reply между Gateway и сервисами Brai New.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**10.3.1**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Service tests
- Container log inspection

## Источники и дальнейшее чтение

- [Gateway manifest](../../../apps/api-gateway/package.json)
- [Runtime package](../../../packages/runtime/package.json)

[← Вернуться к каталогу стека](../README.md)
