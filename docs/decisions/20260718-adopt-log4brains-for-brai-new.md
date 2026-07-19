# Принять Log4brains для ADR Brai New

- Status: accepted
- Deciders: Сергей Bright, Mark
- Date: 2026-07-18
- Tags: adr, log4brains, documentation, governance

## Контекст

Brai New ведёт reader-facing документацию по Diátaxis и хранит нормативные
требования в OpenSpec. Для долгоживущих архитектурных решений нужен отдельный
просматриваемый ADR-каталог, который сможет использоваться агентами и
публиковаться как статический сайт.

В старом проекте уже существовал Log4brains-сайт, но его записи, checkout и
сгенерированный output не являются источником Brai New. Новый каталог должен
начать собственную историю без импорта старых ADR.

## Решение

- Brai New использует pinned project-local Log4brains 1.1.0.
- Источником ADR является `docs/decisions/`.
- OpenSpec остаётся источником нормативного поведения, а ADR фиксирует
  rationale, alternatives, consequences и verification.
- `adr.brai.one` публикует только ADR, созданные в Brai New, под unified Caddy
  Basic Auth.
- Старый статический ADR-root сохраняется отдельно и не копируется в новый
  каталог.
- Принятое изменение source автоматически проходит checks, собирается и
  атомарно публикуется host service от непривилегированного `mark`; тёмная
  тема Brai добавляется в static output при сборке.

## Рассмотренные альтернативы

- Глобальная установка Log4brains: отклонена, потому что она не воспроизводима
  для другого агента и checkout.
- Перенос старых ADR в новый каталог: отклонён, потому что Сергей явно решил
  начать чистую историю решений Brai New.
- Хранить rationale только в OpenSpec: отклонено, потому что ADR удобнее для
  долговечных trade-off-ов и истории решений.

## Последствия

- Плюс: каждый агент может получить локальный список и статический preview ADR.
- Плюс: домен и публикация больше не зависят от старого исходного проекта.
- Плюс: Сергей не выполняет ручной publish, а тёмное оформление одинаково для
  всех читателей и всех релизов.
- Минус: исторические записи старого проекта не видны в новом каталоге.
- Риск: Caddy route пока находится в общей host-конфигурации и требует
  отдельной проверки источника управления при будущих deployment-изменениях.
- Ограничение: ошибка source не публикуется; старый статический release остаётся
  доступен, пока checks не пройдут.

## Проверка

- `pnpm run adr:check`
- `pnpm run adr:list`
- `pnpm run adr:build`
- `node --test infrastructure/adr/auto-publish.test.mjs tools/docs/apply-adr-theme.test.mjs`
- `openspec validate --all --strict`
- authenticated smoke-check `https://adr.brai.one`

## Ссылки

- `docs/documentation-methodology.md`
- `openspec/changes/archive/2026-07-18-integrate-adr-log4brains/proposal.md`
- `openspec/specs/adr-knowledge-base/spec.md`
- `openspec/specs/adr-publication/spec.md`
- `openspec/specs/documentation-governance/spec.md`
- `docs/decisions/README.md`
- `infrastructure/adr/README.md`

## Заменяет

Нет.

## Заменено

Нет.
