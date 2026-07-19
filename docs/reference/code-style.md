# Стандарт исходного кода

**Статус:** active · **Тип:** Reference

Короткий рабочий стандарт для людей и агентов Brai New. Нормативные требования
находятся в [`openspec/specs/code-quality/spec.md`](../../openspec/specs/code-quality/spec.md),
а эта страница объясняет их применение.

## Минимум

- Форматирование выполняет Prettier из корня репозитория.
- Проверки: `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck` и
  релевантные тесты.
- TypeScript остаётся в strict mode; `any` не добавляется без обоснованного
  исключения.
- Публичные и contract-facing exports документируются TSDoc, если их поведение,
  ограничения, ошибки, deprecation или пример использования не очевидны.
- Комментарии объясняют причину, инвариант, security-условие, внешний workaround
  или trade-off. Они не пересказывают код.
- `eslint-disable` пишется на минимальном scope и содержит причину после `--`.
- Новый deferred work записывается как `TODO(<task-or-issue>): <action>`.
- Закомментированный старый production-код не добавляется.

## Форматирование и структура

Единые редакторские настройки находятся в [`.editorconfig`](../../.editorconfig),
а форматирование — в [`.prettierrc.json`](../../.prettierrc.json): UTF-8, LF,
два пробела, semicolons, double quotes, trailing commas и ширина переноса 80.
Prettier — единственный источник решений о пробелах, переносах и скобках.

ESLint проверяет корректность и поддерживаемость, но не дублирует механические
правила Prettier. Не добавляй локальные style-исключения вместо изменения
исходной конфигурации.

Для TypeScript:

- типы и классы — `UpperCamelCase`;
- функции, параметры, переменные и свойства — `lowerCamelCase`;
- глобальные константы — `CONSTANT_CASE`;
- аббревиатуры пишутся как слова: `HttpUrl`, а не `HTTPURL`;
- type-only зависимости импортируются через `import type`;
- публичные модули используют ES module `import`/`export`, а не `require` или
  внутренние `namespace`.

## Комментарии и TSDoc

Обычный implementation-комментарий — `//`:

```ts
// The old generation must be stopped before new rights become active.
await terminateOldGeneration(generation);
```

Документационный комментарий — `/** ... */`:

```ts
/**
 * Creates an Activity after its database write is acknowledged.
 *
 * @param command - Validated creation command.
 * @returns The stored Activity.
 * @throws {IdempotencyConflictError} If the key is reused for another payload.
 */
export async function createActivity(command: CreateActivityCommand) {
  // ...
}
```

Используй только нужные теги: `@param`, `@returns`, `@throws`, `@remarks`,
`@example`, `@see`, `@deprecated` и `@link`. Не пиши комментарий к очевидному
private коду только ради покрытия.

Хороший комментарий объясняет причину:

```ts
// Gateway timeout is shorter than Caddy's timeout to avoid duplicate retries.
const timeoutMs = 5_000;
```

Плохой комментарий просто повторяет выражение:

```ts
const timeoutMs = 5_000; // Set timeout to 5000
```

## Исключения

Исключение должно быть узким, объяснимым и проверяемым:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy SDK has no type declarations.
const response = legacyClient.call() as any;
```

Generated code и архивные OpenSpec materials не являются рабочей областью
этого стандарта; их не нужно массово переписывать при обычной задаче.

## Сообщения коммитов

Если агент создаёт commit, используй [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <short description>
```

Базовые types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`,
`chore`, `perf`. Breaking change помечается `!` или footer `BREAKING CHANGE:`.
Один commit должен описывать одну логическую группу изменений.

## Что загружает агент

Обычная задача начинается с короткого ядра в [`AGENTS.md`](../../AGENTS.md).
При изменении кода агент дополнительно читает этот Reference, проверяет
затронутые источники через `docflow` и запускает релевантные quality gates.
Портативный маршрутизатор
[`tools/agent/brai-code-standard.md`](../../tools/agent/brai-code-standard.md)
является только компактным skill-источником и не дублирует этот текст.

## Источники практик

- [EditorConfig Specification](https://spec.editorconfig.org/)
- [Prettier documentation](https://prettier.io/docs/)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [TSDoc approach](https://tsdoc.org/pages/intro/approach/)
- [typescript-eslint shared configs](https://typescript-eslint.io/users/configs/)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
