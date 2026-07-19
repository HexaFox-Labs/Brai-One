<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# clsx / tailwind-merge / class-variance-authority

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** clsx 2.1.1; tailwind-merge 3.6.0; CVA 0.7.1  
**Тип:** ui-utility  
**Область:** project

**Теги:** ui, css

## Если коротко

Малые утилиты для class names и вариантов UI-компонентов.

## Что это такое

clsx, tailwind-merge и class-variance-authority — небольшие helpers для сборки className и описания вариантов компонентов. Они решают механику условных и конфликтующих CSS-классов, а не принимают бизнес-решения и не заменяют компонентную архитектуру.

## Зачем это нужно Brai

В Brai один control часто имеет loading, disabled, error, size и visual variants одновременно. Эти helpers удерживают className-логику короткой и предсказуемой, уменьшая случайные Tailwind-конфликты, но границы поведения должны оставаться видимыми в React-компоненте.

## Почему мы выбрали именно этот инструмент

UI-компоненты имеют много условных состояний; маленькие class-name helpers держат эти правила короткими.

## Как он работает в нашем контуре

clsx объединяет условия, tailwind-merge разрешает конфликты utility-классов, CVA описывает варианты компонентов.

## Что он даёт

- условные class names
- безопасное объединение Tailwind utilities
- типизированные component variants

## Практические сценарии

- собрать button variants
- показать error/disabled state
- объединить className от consumer и primitive

## Как мы это используем

Утилиты используются в `apps/web` UI layer.

## Где находится

`apps/web`.

## Ограничения

Не выносить случайные бизнес-правила в class-name helpers.

## Типичные ошибки

- прятать business logic в class helper
- добавлять конфликтующие utility classes вместо явного variant

## Связанные инструменты

- [Tailwind CSS](./tailwind-css.md) — Utility-first слой стилей для интерфейса Brai New.
- [Radix UI](./radix-ui.md) — Accessible primitives для интерактивных web-компонентов.
- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**clsx 2.1.1; tailwind-merge 3.6.0; CVA 0.7.1**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- React component tests
- `pnpm --dir apps/web lint`

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)

[← Вернуться к каталогу стека](../README.md)
