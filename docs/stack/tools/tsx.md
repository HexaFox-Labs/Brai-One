<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# tsx

**Категория:** [Runtime и сборка](../by-category/runtime.md)  
**Статус:** active  
**Версия:** 4.23.1  
**Тип:** typescript-runner  
**Область:** project

**Теги:** typescript, cli

## Если коротко

Запускает TypeScript CLI и миграционные скрипты прямо в Node.js.

## Что это такое

tsx — это launcher для запуска TypeScript и ESM entrypoints прямо из исходников через Node-compatible workflow. Он удобен для одноразовых utilities, migration helpers и policy scripts, которым не нужен отдельный предварительный build.

## Зачем это нужно Brai

В Brai есть небольшие инженерные scripts, которые важно запускать одинаково локально и в проверках. tsx убирает лишний промежуточный compile step для таких случаев, но production-сервисы всё равно должны идти через обычные build artifacts и project targets.

## Почему мы выбрали именно этот инструмент

Небольшие TypeScript utilities и migrations удобнее запускать без отдельной ручной сборки.

## Как он работает в нашем контуре

tsx разрешает TypeScript/ESM entrypoint через Node, а production services всё равно запускаются из build artifacts.

## Что он даёт

- быстрый TypeScript CLI запуск
- ESM-friendly execution
- удобный local migration tooling

## Практические сценарии

- запустить policy/preflight utility
- выполнить migration helper
- проверить одноразовый script перед включением в package task

## Как мы это используем

Используется в project scripts там, где нужен TypeScript entrypoint.

## Где находится

Root package manifest и CLI scripts.

## Ограничения

Production services запускаются из собранных артефактов.

## Типичные ошибки

- использовать tsx как production runtime для собранного сервиса
- обойти project script и потерять reproducible arguments

## Связанные инструменты

- [Node.js](./nodejs.md) — Среда, в которой запускаются приложения, сервисы, workers и инструменты Brai New.
- [TypeScript](./typescript.md) — Строгий язык и компилятор, который описывает контракты Brai New до запуска.
- [pnpm](./pnpm.md) — Package manager, который устанавливает зависимости и запускает workspace-команды.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**4.23.1**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm exec tsx --version`

## Источники и дальнейшее чтение

- [Package manifest](../../../package.json)

[← Вернуться к каталогу стека](../README.md)
