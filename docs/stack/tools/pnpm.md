<!-- Generated from tools/stack/catalog.json. Do not edit manually. -->

# pnpm

**Категория:** [Runtime и сборка](../by-category/runtime.md)  
**Статус:** installed  
**Версия:** >=11.13.1 <12  
**Тип:** package-manager  
**Область:** project

**Теги:** dependencies, workspace

## Если коротко

Package manager, который устанавливает зависимости и запускает workspace-команды.

## Что это такое

pnpm — это package manager для Node.js с workspace-моделью и общим хранилищем зависимостей. Он читает package manifests и lockfile, связывает локальные пакеты и запускает команды проекта с заданными фильтрами.

## Зачем это нужно Brai

Brai — монорепозиторий, где несколько приложений и сервисов должны использовать совместимые версии библиотек. pnpm с frozen lockfile делает установку воспроизводимой, экономит место и не даёт незаметно получить другой dependency graph на другой машине.

## Почему мы выбрали именно этот инструмент

Workspace с одним lockfile и catalog версий нужен для согласованной сборки множества приложений и пакетов.

## Как он работает в нашем контуре

pnpm связывает workspace manifests, хранит зависимости в общем store и запускает корневые фильтрованные команды.

## Что он даёт

- frozen install по lockfile
- workspace filters и package scripts
- экономный общий dependency store

## Практические сценарии

- подготовить чистое окружение через `pnpm install --frozen-lockfile`
- запустить тесты конкретного приложения
- обновить прямую зависимость с проверкой lockfile

## Как мы это используем

Используем pnpm 11 через корневые scripts и фильтры workspace.

## Где находится

`/srv/opt/pnpm` и project-local `.pnpm-store`.

## Ограничения

Зависимости устанавливаются из lockfile; ручное редактирование lockfile запрещено.

## Типичные ошибки

- править lockfile вручную
- запускать npm/yarn-команды, которые обходят project policy

## Связанные инструменты

- [Node.js](./nodejs.md) — Среда, в которой запускаются приложения, сервисы, workers и инструменты Brai New.
- [Nx](./nx.md) — Task graph и cache runner для сборки, тестов и проверок монорепозитория.
- [Lerna](./lerna.md) — Workspace/release-обвязка поверх общего package-based монорепозитория.

## Обновление и жизненный цикл

Статус инструмента: **installed**. Текущая версия или ограничение версии:
**>=11.13.1 <12**. Перед обновлением проверь указанные источники, затем
обнови запись в manifest и перегенерируй каталог. После изменения запускаются
команда проверки ниже и обычные quality gates проекта.

## Как проверить

- `pnpm --version`
- `pnpm install --frozen-lockfile`

## Источники и дальнейшее чтение

- [Package manifest](../../../package.json)
- [Workspace config](../../../pnpm-workspace.yaml)

[← Вернуться к каталогу стека](../README.md)
