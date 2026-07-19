<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# lucide-react

**Категория:** [Прикладной стек](../by-category/application.md)  
**Статус:** active  
**Версия:** 1.21.0  
**Тип:** icon-library  
**Область:** project

**Теги:** ui, icons

## Если коротко

Единый набор SVG-иконок для web-интерфейса.

## Что это такое

lucide-react — это библиотека SVG-иконок, экспортируемых как React components с единым outline-языком. Размер, цвет и stroke наследуются через props и CSS, поэтому иконка остаётся частью композиции интерфейса, а не отдельной картинкой.

## Зачем это нужно Brai

Единые иконки помогают Brai одинаково обозначать navigation, actions и statuses на разных страницах. Библиотека убирает разрозненные самодельные SVG, но не отменяет требования дать icon-only control понятное доступное имя.

## Почему мы выбрали именно этот инструмент

Единый icon set делает действия и статусы узнаваемыми и не требует разрозненных SVG-копий.

## Как он работает в нашем контуре

React icon components получают размер и color от родительского UI и входят в static web bundle.

## Что он даёт

- SVG icons как React components
- currentColor и size props
- единый outline visual language

## Практические сценарии

- обозначить действие в toolbar
- показать статус или navigation item
- добавить icon-only control с accessible label

## Как мы это используем

Иконки импортируются в web components и подстраиваются под currentColor.

## Где находится

`apps/web`.

## Ограничения

Brand assets и логотипы не заменяются случайной generic-иконкой.

## Типичные ошибки

- использовать icon без доступного имени
- подменять brand logo generic icon

## Связанные инструменты

- [React](./react.md) — UI-библиотека, из которой собраны интерактивные компоненты Brai New.
- [Tailwind CSS](./tailwind-css.md) — Utility-first слой стилей для интерфейса Brai New.
- [Next.js](./nextjs.md) — Web-фреймворк, который собирает пользовательский интерфейс Brai New.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**1.21.0**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --dir apps/web test`
- Visual browser QA

## Источники и дальнейшее чтение

- [Web manifest](../../../apps/web/package.json)

[← Вернуться к каталогу стека](../README.md)
