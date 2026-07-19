<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Tailwind CSS

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 4.3.1  
**Тип:** styling  
**Область:** project

**Теги:** css, ui

## Если коротко

Utility-first слой стилей для интерфейса Brai New.

## Что это такое

Tailwind CSS — это utility-first CSS framework, где визуальные правила задаются небольшими классами для layout, spacing, цвета, typography и responsive states. Он генерирует итоговый CSS из реально использованных классов, поэтому стили остаются близко к компоненту.

## Зачем это нужно Brai

Страницы Brai должны быстро меняться и одинаково работать на desktop и mobile, а их визуальные состояния должны быть видны рядом с JSX. Tailwind сокращает расхождения в spacing и цветах и помогает поддерживать единый UI без отдельного большого stylesheet для каждой страницы.

## Почему мы выбрали именно этот инструмент

Utility-first CSS ускоряет итерации интерфейса и держит spacing, color и responsive rules рядом с компонентом.

## Как он работает в нашем контуре

Tailwind проходит через PostCSS и генерирует только классы, найденные в web source; production output отдаёт Nginx.

## Что он даёт

- utility-классы для layout и states
- responsive modifiers
- согласованный визуальный baseline

## Практические сценарии

- собрать карточку инструмента
- добавить mobile layout
- проверить hover/focus/error state в браузере

## Как мы это используем

Tailwind подключён в web build через PostCSS и используется в компонентах.

## Где находится

`apps/web` и `postcss.config.mjs`.

## Ограничения

Изменения визуальной системы проверяются на desktop и mobile viewport.

## Типичные ошибки

- исправлять visual regression только на desktop
- раздувать className вместо выделения повторного компонента

## Связанные инструменты

- [Next.js](./nextjs.md) — Web-фреймворк, который собирает пользовательский интерфейс Brai New.
- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Radix UI](./radix-ui.md) — Accessible primitives для интерактивных web-компонентов.
- [clsx / tailwind-merge / class-variance-authority](./class-names-tools.md) — Малые утилиты для class names и вариантов UI-компонентов.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**4.3.1**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --dir apps/web build`
- Playwright desktop/mobile checks

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)
- [PostCSS config](../../../apps/web/postcss.config.mjs)

[← Вернуться к каталогу стека](../README.md)
