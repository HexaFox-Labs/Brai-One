# Принять canonical catalog как источник страниц стека

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-19
- Tags: documentation, tooling, stack, generated-content

## Контекст

Brai New использовал несколько обзорных таблиц стека и отдельный host registry.
Они фиксировали назначение инструментов, но не давали отдельной понятной
страницы на каждый инструмент и не предоставляли стабильные данные для будущего
стекового раздела сайта. Ручное поддержание таблиц, страниц и web data в
нескольких местах создавало риск расхождения.

## Решение

Использовать `tools/stack/catalog.json` как единственный редактируемый manifest
инструментов Brai New.

- Каждая запись получает стабильный id, тип, категорию, область, человеческое
  описание, назначение, способ использования, версию, источники и проверку.
- `tools/stack/catalog.mjs` детерминированно генерирует отдельную Markdown
  страницу, category indexes, `docs/stack/catalog.md` и
  `docs/stack/catalog.json` для будущего сайта.
- `pnpm run stack:check` запускается в CI и блокирует ручное расхождение,
  неполные записи, неизвестные категории и отсутствующие repository sources.
- Host registry остаётся источником host facts; его секреты не импортируются в
  каталог.

## Рассмотренные альтернативы

- **Редактировать отдельные страницы вручную:** отклонено из-за расхождения
  индекса, reader-facing docs и данных сайта.
- **Извлекать всё только из package manifests:** отклонено, потому что так
  нельзя описать Caddy, RTK, browser tooling и человеческое назначение.
- **Парсить `/home/mark/DEPLOYMENT.md` во время генерации:** отклонено, чтобы
  генерация оставалась переносимой и не зависела от host state или секретных
  файлов.

## Последствия

- Плюс: добавление или изменение инструмента выполняется в одном manifest и
  одной генерацией обновляет все представления.
- Плюс: будущий сайт получает структурированный JSON без Markdown parsing.
- Плюс: RTK и остальные текущие инструменты получают одинаковый формат
  человеческих mini-landing pages.
- Минус: человеческое описание всё равно требует осознанного заполнения; его
  нельзя надёжно вывести из package manager.
- Ограничение: web route стека не входит в это решение и подключается отдельно.

## Проверка

- `pnpm run stack:generate`
- `pnpm run stack:check`
- `node --test tools/stack/catalog.test.mjs`
- `pnpm run docs:check`
- `pnpm run format:check`
- `openspec validate --all --strict`

## Ссылки

- [`tools/stack/catalog.json`](../../tools/stack/catalog.json)
- [`tools/stack/catalog.mjs`](../../tools/stack/catalog.mjs)
- [`docs/stack/catalog.md`](../stack/catalog.md)
- [`docs/how-to/manage-stack-tool.md`](../how-to/manage-stack-tool.md)
- [`openspec/specs/tooling-catalog/spec.md`](../../openspec/specs/tooling-catalog/spec.md)

## Заменяет

Нет.

## Заменено

Нет.
