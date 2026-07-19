## Context

Текущий стек хранится в четырёх обзорных Markdown-файлах, а host-level
установки — в `/home/mark/DEPLOYMENT.md`. Эти источники полезны для оператора,
но не образуют единого каталога: нет устойчивого id, типа, web-ready записи и
гарантии, что новый инструмент получил страницу.

Первый практический пример — установленный RTK `0.42.4`, который уже имеет
операционную запись и `RTK.md`, но должен стать полноценной карточкой каталога.

## Goals / Non-Goals

**Goals:**

- иметь один редактируемый JSON manifest с простыми полями для человека;
- классифицировать записи стабильным `category` и дополнительными `tags`;
- генерировать страницу каждого инструмента, классифицированный индекс и JSON
  для будущего сайта;
- проверять полноту и источники до CI, чтобы generated docs нельзя было случайно
  изменить вручную;
- сделать добавление нового инструмента повторяемой процедурой `stack:generate`
  / `stack:check`.

**Non-Goals:**

- не строить в этом change отдельный web route или UI сайта;
- не извлекать человеческие описания из package manager автоматически;
- не читать секреты и не импортировать весь host registry во время генерации;
- не менять runtime, deployment, Caddy или access boundaries.

## Decisions

### Канонический manifest вместо таблиц и package manifests

Каноническим источником описания становится `tools/stack/catalog.json`.
Package manifests, конфигурация и `/home/mark/DEPLOYMENT.md` остаются источниками
фактов о версии и установке, на которые manifest ссылается полями `sources` и
`verification`. Это позволяет хранить человеческое объяснение отдельно от
машинных dependency-файлов и не записывать host secrets в checkout.

Рассмотренная альтернатива — парсить только package manifests. Она не покрывает
Caddy, RTK, browser tooling и системные границы, а также не может дать понятное
описание назначения.

### Generated Markdown плюс JSON

Из manifest генерируются `docs/stack/tools/<id>.md`,
`docs/stack/catalog.json` и `docs/stack/by-category/*.md`. Markdown остаётся
reader-facing источником текущего устройства, JSON — стабильным контрактом для
будущего сайта. Generated files имеют явный заголовок и не редактируются вручную.

Рассмотренная альтернатива — писать страницы вручную. Она быстро приведёт к
расхождению между индексом, страницами и данными сайта.

### Небольшая фиксированная taxonomy

`category` выбирается из списка `runtime`, `application`, `infrastructure`,
`data`, `quality`, `documentation`, `developer-experience`, `security` и
`browser`. Новая категория требует изменения валидатора и явного решения,
поэтому опечатка не создаёт молча новую ветку каталога.

### Проверка в CI и отдельная команда синхронизации

`stack:check` валидирует manifest, локальные source paths, generated parity и
Markdown links; он вызывается из CI рядом с `docs:check`. `stack:generate`
обновляет все derived artifacts. Установка инструмента считается завершённой
только после добавления manifest entry и запуска генерации; это фиксируется в
how-to, а не скрывается в postinstall, который не должен мутировать рабочее
дерево при обычной установке зависимостей.

## Risks / Trade-offs

- **[Risk]** Человеческое описание может устареть относительно фактического
  использования. → Manifest требует `sources`, `verification` и reviewable
  `lastReviewed`.
- **[Risk]** Generated output увеличивает число файлов. → Один source manifest,
  deterministic output и `stack:check` делают файлы предсказуемыми.
- **[Risk]** Host-only source path отсутствует на другой машине. → Проверяются
  только repository-relative paths; host paths остаются ссылками и не являются
  обязательным runtime input генератора.
- **[Risk]** Каталог станет слишком широким и смешает Brai New с другими
  workspace. → Каждая запись имеет `scope`, initial scope ограничен Brai New и
  явно отмеченными host tools, нужными его workflow.
