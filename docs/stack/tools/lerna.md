<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# Lerna

**Категория:** [Runtime и сборка](../by-category/runtime.md)  
**Статус:** active  
**Версия:** 9.0.7  
**Тип:** workspace-tool  
**Область:** project

**Теги:** monorepo

## Если коротко

Workspace/release-обвязка поверх общего package-based монорепозитория.

## Что это такое

Lerna — это инструмент для package-based monorepo, который знает о пакетах workspace и поддерживает операции их версионирования и release-подготовки. В текущем проекте это не основной task runner, а совместимая оболочка вокруг package graph.

## Зачем это нужно Brai

Brai сохраняет Lerna-модель, чтобы структура пакетов и будущий release workflow оставались понятными и совместимыми. Исполнение build, lint и test передано Nx, поэтому команды не дублируют друг друга и не создают два конкурирующих графа.

## Почему мы выбрали именно этот инструмент

Lerna сохраняет привычную workspace/release-модель, пока исполнение задач централизовано в Nx.

## Как он работает в нашем контуре

Lerna описывает package-based workspace, но не конкурирует с Nx за запуск build, lint и tests.

## Что он даёт

- управление пакетной workspace-моделью
- подготовка к будущему versioning/release
- совместимость package-based monorepo

## Практические сценарии

- добавить новый workspace package
- проверить package graph
- подготовить будущую публикацию без смены task runner

## Как мы это используем

Lerna описан в `lerna.json`, а build/test/lint/typecheck выполняет Nx.

## Где находится

Корневой `lerna.json`.

## Ограничения

Не добавлять второй независимый task runner для тех же целей.

## Типичные ошибки

- запускать Lerna как второй CI task graph
- смешивать release policy с текущими runtime contracts

## Связанные инструменты

- [Nx](./nx.md) — Task graph и cache runner для сборки, тестов и проверок монорепозитория.
- [pnpm](./pnpm.md) — Package manager, который устанавливает зависимости и запускает workspace-команды.
- [Node.js](./nodejs.md) — Среда, в которой запускаются приложения, сервисы, workers и инструменты Brai New.

## Обновление и жизненный цикл

Статус инструмента: **active**. Текущая версия или ограничение версии:
**9.0.7**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm exec lerna --version`

## Источники и дальнейшее чтение

- [Lerna config](../../../lerna.json)
- [Package manifest](../../../package.json)

[← Вернуться к каталогу стека](../README.md)
