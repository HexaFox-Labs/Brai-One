<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Radix UI

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 1.6.0  
**Тип:** ui-primitives  
**Область:** project

**Теги:** ui, accessibility

## Если коротко

Accessible primitives для интерактивных web-компонентов.

## Что это такое

Radix UI — это набор accessible React primitives для dialog, menu, select, focus management и других сложных interaction patterns. Primitives дают поведение и semantics, но не навязывают готовую визуальную тему, поэтому styling остаётся в проекте.

## Зачем это нужно Brai

Stack pages и интерфейс Brai должны корректно работать с клавиатурой, focus и screen-reader semantics без копирования сложной interaction logic в каждом компоненте. Radix снижает риск недоступных controls, а финальная проверка всё равно остаётся обязанностью UI tests и browser QA.

## Почему мы выбрали именно этот инструмент

Accessible primitives позволяют получить корректные keyboard/focus states без повторного написания сложной interaction logic.

## Как он работает в нашем контуре

Radix-компоненты используются внутри React web layer и получают визуальное оформление через Tailwind.

## Что он даёт

- accessible interaction primitives
- keyboard и focus behavior
- composable React API

## Практические сценарии

- добавить menu/dialog/select
- проверить focus flow
- собрать reusable control для страниц стека

## Как мы это используем

Примитивы подключаются в `apps/web` и оформляются через проектную визуальную систему.

## Где находится

`apps/web`.

## Ограничения

Primitive не заменяет проверку готового интерфейса на desktop и mobile.

## Типичные ошибки

- считать primitive полной visual design system
- не проверять final component на keyboard и mobile

## Связанные инструменты

- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Tailwind CSS](./tailwind-css.md) — Utility-first слой стилей для интерфейса Brai New.
- [Testing Library](./testing-library.md) — Тестирует UI через поведение пользователя и DOM assertions.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**1.6.0**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- React component tests
- Playwright accessibility flow

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)

[← Вернуться к каталогу стека](../README.md)
