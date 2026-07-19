<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# ESLint

**Категория:** [Качество](../by-category/quality.md)  
**Статус:** active  
**Версия:** 9.39.4  
**Тип:** static-analysis  
**Область:** project

**Теги:** lint, typescript

## Если коротко

Проверяет исходный код на ошибки и поддерживаемость.

## Что это такое

ESLint — это статический анализатор JavaScript и TypeScript, который проверяет структуру кода, опасные паттерны, imports и project-specific правила. Он может подсветить проблему без запуска приложения, но не является runtime debugger или formatter.

## Зачем это нужно Brai

В большом workspace ошибки в импорте, API и соглашениях иначе обнаруживаются только во время сборки или review. ESLint даёт ранний fail-fast сигнал для web, сервисов, пакетов и tooling и не позволяет локальному исключению незаметно стать общим стандартом.

## Почему мы выбрали именно этот инструмент

Форматирование исправляет форму кода, но ESLint ловит ошибки использования API и поддерживаемости.

## Как он работает в нашем контуре

Flat config запускается Nx targets для приложений, сервисов, пакетов и tooling.

## Что он даёт

- статический анализ JavaScript/TypeScript
- проверка project-specific rules
- fail-fast lint в CI

## Практические сценарии

- проверить новый Gateway handler
- найти неиспользуемый import
- проверить generated или test code перед handoff

## Как мы это используем

Единый flat config применяется через Nx lint targets.

## Где находится

`eslint.config.mjs` и project lint targets.

## Ограничения

ESLint не заменяет TypeScript и тесты.

## Типичные ошибки

- использовать eslint-disable без узкой причины
- ожидать от ESLint исправления runtime bug

## Связанные инструменты

- [Prettier](./prettier.md) — Автоматически приводит Markdown, JSON и исходники к одному формату.
- [TypeScript](./typescript.md) — Строгий язык и компилятор, который описывает контракты Brai New до запуска.
- [Nx](./nx.md) — Task graph и cache runner для сборки, тестов и проверок монорепозитория.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**9.39.4**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm run lint`

## Источники и дальнейшее чтение

- [ESLint config](../../../eslint.config.mjs)
- [Code style](../../../docs/reference/code-style.md)

[← Вернуться к каталогу стека](../README.md)
