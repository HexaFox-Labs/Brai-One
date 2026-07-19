<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Zod

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 4.4.3  
**Тип:** validation-library  
**Область:** project

**Теги:** validation, contracts

## Если коротко

Runtime-проверка входных данных и контрактов на HTTP/NATS границах.

## Что это такое

Zod — это библиотека runtime-схем, которые проверяют реальные значения и одновременно могут выводить из схем TypeScript-типы. В отличие от одного интерфейса TypeScript, Zod работает после получения HTTP payload или сообщения и может вернуть понятную ошибку.

## Зачем это нужно Brai

Данные на границе Brai приходят извне compile-time мира и могут быть неполными, лишними или злонамеренно сформированными. Zod не даёт такому payload пройти в Gateway, NATS или service code и удерживает request/response contracts одинаковыми для отправителя и получателя.

## Почему мы выбрали именно этот инструмент

TypeScript types не защищают runtime boundary, поэтому входящие payloads должны проверяться отдельными схемами.

## Как он работает в нашем контуре

Zod schemas валидируют HTTP и contract data до того, как команда попадёт в NATS или service code.

## Что он даёт

- runtime validation
- вывод TypeScript типов из схем
- явные сообщения об ошибках

## Практические сценарии

- проверить Activity create payload
- отвергнуть неизвестное поле на Gateway
- согласовать request и response contract

## Как мы это используем

Схемы Zod применяются для API payloads и версионируемых контрактов.

## Где находится

Gateway и `packages/contracts`.

## Ограничения

Схема должна совпадать с нормативным контрактом и тестами.

## Типичные ошибки

- проверить тип только на compile-time
- дублировать одну схему в нескольких местах без общего contract package

## Связанные инструменты

- [TypeScript](./typescript.md) — Строгий язык и компилятор, который описывает контракты Brai New до запуска.
- [Fastify](./fastify.md) — Единственный HTTP edge для Gateway Brai New.
- [NATS](./nats.md) — Приватная шина request/reply между Gateway и сервисами Brai New.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**4.4.3**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- Contract tests
- `pnpm run typecheck`

## Источники и дальнейшее чтение

- [Gateway manifest](../../../apps/api-gateway/package.json)
- [Contracts package](../../../packages/contracts/package.json)

[← Вернуться к каталогу стека](../README.md)
