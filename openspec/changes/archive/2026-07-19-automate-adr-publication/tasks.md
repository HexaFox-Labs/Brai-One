# Tasks

## 1. Контракт и проектирование

- [x] 1.1 Проверить существующий Log4brains publisher, Caddy static root и
      ownership release path.
- [x] 1.2 Оформить OpenSpec proposal, design и delta для automatic publication.
- [x] 1.3 Синхронизировать delta в permanent `adr-publication` spec после
      подтверждённой установки.

## 2. Реализация

- [x] 2.1 Реализовать manifest-aware, fail-closed ADR auto-publisher и tests.
- [x] 2.2 Добавить systemd service, path watcher, reconciliation timer и
      root-only installer/status command.
- [x] 2.3 Добавить project script и CI/focused test coverage.
- [x] 2.4 Добавить проверяемую тёмную тему во все статические HTML ADR output.
- [x] 2.5 Нормализовать timezone-опасные date-only timestamps Log4brains и
      отклонять будущие даты в ADR source.

## 3. Документация и эксплуатация

- [x] 3.1 Обновить ADR publication docs, governance policy, ADR и Memory Bank.
- [x] 3.2 Обновить `/home/mark/DEPLOYMENT.md` после host installation без
      добавления секретов.

## 4. Проверка и запуск

- [x] 4.1 Проверить source checks, static build, idempotent publish и
      fail-closed invalid source.
- [x] 4.2 Установить units, проверить path/timer, status и initial promotion.
- [x] 4.3 Проверить реальный `https://adr.brai.one` через isolated Chrome
      DevTools: Basic Auth, новый ADR, console/network и mobile viewport.
- [x] 4.5 Проверить timezone-safe дату на опубликованном сайте и fail-closed
      отказ future source date.
- [x] 4.4 Выполнить docflow finalize, sync permanent spec и архивировать Change.
