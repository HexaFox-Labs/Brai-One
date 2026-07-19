<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Testing Library

**Категория:** [Качество](../by-category/quality.md)  
**Статус:** active  
**Версия:** DOM 10.4.1; React 16.3.2  
**Тип:** component-testing  
**Область:** project

**Теги:** tests, dom, react

## Если коротко

Тестирует UI через поведение пользователя и DOM assertions.

## Что это такое

Testing Library — это набор инструментов для component tests, которые ищут элементы так, как их видит пользователь: по role, label, text и accessible name. Он помогает проверять rendered DOM и действия пользователя, а не внутренние state-поля или implementation classes.

## Зачем это нужно Brai

Brai UI должен оставаться рабочим после изменения структуры компонентов и стилей, поэтому тесты не должны ломаться от безвредного refactor markup. Testing Library закрепляет observable behavior и одновременно подсвечивает, когда control не имеет понятного accessible имени.

## Почему мы выбрали именно этот инструмент

UI tests должны описывать действия и наблюдаемый результат пользователя, а не внутреннюю структуру компонента.

## Как он работает в нашем контуре

Testing Library queries DOM по ролям, labels и тексту; React tests запускаются в Vitest/jsdom.

## Что он даёт

- user-facing DOM queries
- React component rendering
- accessibility-oriented assertions

## Практические сценарии

- найти input по label
- проверить submit и error message
- проверить loading state после действия

## Как мы это используем

DOM и React packages используются в web component tests.

## Где находится

`apps/web`.

## Ограничения

Component tests не заменяют E2E и real published URL QA.

## Типичные ошибки

- искать элементы по implementation class
- тестировать компонент без проверки accessible name

## Связанные инструменты

- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Vitest](./vitest.md) — Быстрый runner unit и integration тестов.
- [jsdom](./jsdom.md) — Browser-like DOM environment для Vitest component tests.
- [Playwright](./playwright.md) — E2E-проверки web-сценариев в desktop и mobile viewport.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**DOM 10.4.1; React 16.3.2**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --dir apps/web test`

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)

[← Вернуться к каталогу стека](../README.md)
