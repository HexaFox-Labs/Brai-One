# Автоматический OpenSpec workflow агента

## Why

Сейчас OpenSpec CLI и Codex-интеграция установлены, но пользователь должен
знать и вручную вводить `/opsx:*`. Это противоречит естественному режиму работы:
пользователь должен формулировать задачу обычным языком, а агент — сам выбрать и
выполнить нужный workflow.

## What changes

- Ввести обязательную классификацию естественно-языковых задач агента.
- Для нетривиальных изменений автоматически создавать или продолжать OpenSpec
  change.
- Выполнять CLI-команды и обновлять OpenSpec-артефакты самому, без требования к
  пользователю вводить slash-команды.
- Встроить правило в корневой `AGENTS.md` и project context OpenSpec.
- Проверять и архивировать завершённые changes только после реализации и
  верификации.

## Capabilities

### New Capabilities

- `agent-workflow`: автономная маршрутизация естественно-языковых задач через
  OpenSpec без ручного запуска внутренних команд.

### Modified Capabilities

- Нет.

## Impact

- Изменяются project-local инструкции `AGENTS.md` и `openspec/config.yaml`.
- Codex skills и prompts пересобираются из обновлённого project context.
- Бизнес-код, runtime access profiles и существующие capabilities не меняются.

## Boundaries

### In scope

- Рабочий процесс агентов в `/srv/projects/brai-new`.
- Выбор, ведение, проверка и завершение OpenSpec changes.
- Согласование `AGENTS.md`, `openspec/config.yaml`, Memory Bank и постоянных
  спецификаций.

### Out of scope

- Изменение модели доступа или профилей `user-sandbox`/`developer`.
- Автоматический deploy, merge или production-релиз без явной команды.
- Принуждение создавать change для тривиальных исправлений без изменения
  поведения или контракта.
