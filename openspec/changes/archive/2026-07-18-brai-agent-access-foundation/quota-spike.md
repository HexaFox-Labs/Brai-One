# One-disk quota spike — 2026-07-17

## Host facts

- Единственный writable filesystem хоста: ext4 на root device.
- На момент проверки: около 31 GiB свободно; отдельного block device для
  пользовательских данных нет.
- Текущий ext4 не смонтирован с quota/project feature. Включение ext4 project
  quota требует offline filesystem maintenance, поэтому оно не подходит для
  безопасной активации без recovery console.

## Executed disposable checks

1. Временный ext4 loop image подтвердил: после offline enable quota feature и
   mount с `prjquota` project hard limit останавливает запись на заданном
   размере. Online `tune2fs -O project -Q prjquota` ожидаемо отказал, потому
   что quota feature нельзя менять на mounted filesystem.
2. Временный sparse XFS loop image логического размера 1 GiB занял около
   65 MiB после `mkfs.xfs`, а не 1 GiB.
3. Project `10000` получил hard limit 8 MiB/32 inodes. Запись 9 MiB от
   непривилегированного пользователя завершилась ошибкой после ровно
   8,388,608 bytes.
4. Sparse backing allocation вырос только на фактически записанные blocks;
   само назначение project limit не выделило 8 MiB.
5. Временные mounts, loop devices, images и каталоги удалены после проверки.

## Decision

На текущем одном диске используется один общий bounded sparse XFS pool-файл,
смонтированный с `prjquota`. Это не отдельный физический диск и не объект на
пользователя/агента. Логический размер pool ограничивает максимальный вклад
ordinary-user data в расход системного раздела; per-user project quota
ограничивает каждого пользователя. Оба лимита не являются резервированием
свободного места.
