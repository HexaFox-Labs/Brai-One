# Tasks

## Decisions and guardrails

- [x] Определить границу между тривиальной задачей и durable OpenSpec change.
- [x] Зафиксировать, что пользователь не вводит OpenSpec-команды вручную.
- [x] Сохранить приоритет `AGENTS.md`, постоянных specs, кода/тестов и Memory
      Bank.

## Implementation

- [x] Добавить project-local policy в корневой `AGENTS.md`.
- [x] Добавить autonomous workflow context в `openspec/config.yaml`.
- [x] Пересобрать generated Codex skills и prompts через `openspec update`.

## Verification

- [x] Проверить OpenSpec config и generated integration.
- [x] Запустить `openspec validate --specs` и validation активного change.
- [x] Проверить, что существующие specs и архивы не изменились.

## Documentation

- [x] Обновить `memory-bank/activeContext.md`.
- [x] Обновить `memory-bank/progress.md`.
- [x] Обновить `/home/mark/DEPLOYMENT.md`, если установленный workflow меняет
      публичный способ использования инструмента.

## Completion

- [x] Перенести delta requirements в постоянную
      `openspec/specs/agent-workflow/spec.md`.
- [x] Заархивировать change после всех проверок.
