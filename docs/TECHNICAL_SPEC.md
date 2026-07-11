# Last Epoch Build Analyzer: Decky Integration

Этот репозиторий является первым рабочим срезом системы из ТЗ `Last Epoch Build Analyzer`.
Текущий Decky-плагин не должен быть отдельным временным инструментом: он является первым companion-адаптером системы и должен оставаться совместимым с будущим веб-анализатором билдов.

## Роль Decky

Decky-плагин отвечает только за безопасный доступ к локальным данным Steam Deck:

- обнаруживает Full Offline сохранения Last Epoch, stash и loot-фильтры;
- читает файлы в режиме read-only;
- формирует snapshot;
- отправляет snapshot на backend по HTTP JSON;
- хранит только настройки подключения, pairing/device token и последний snapshot id;
- не рассчитывает билд, не принимает решений по предметам и не изменяет игровые save-файлы.

Веб-приложение и backend отвечают за тяжелую часть:

- нормализацию save/stash/filter данных;
- разбор itemData, passive tree и skill tree;
- расчет характеристик;
- поиск улучшений в stash;
- рекомендации, симуляции и план развития;
- генерацию loot-фильтров.

Так Decky остается легким интерфейсом Steam Deck, а большой экран ноутбука/ПК/VPS остается местом анализа.

## Companion Контракт

Все companion-клиенты должны отправлять один и тот же snapshot-контракт.
Сейчас поддерживаются два совместимых endpoint:

```text
POST /api/snapshots
POST /api/v1/companion/snapshots
```

Для явного Decky-импорта также доступен alias:

```text
POST /api/v1/imports/decky-snapshot
```

Текущий Decky-плагин может продолжать использовать legacy endpoint `/api/snapshots`.
Будущая версия плагина может перейти на `/api/v1/companion/snapshots` без изменения payload.

Минимальный payload:

```json
{
  "deckName": "steamdeck",
  "pluginVersion": "0.1.10",
  "createdAt": "2026-07-11T00:00:00.000Z",
  "savesRoot": "/home/deck/...",
  "filtersRoot": "/home/deck/...",
  "source": {
    "kind": "companion",
    "companion": "decky-plugin",
    "transport": "http-json",
    "apiVersion": "v1"
  },
  "files": [
    {
      "kind": "save",
      "relativePath": "Saves/1CHARACTERSLOT_BETA_0",
      "mtimeMs": 1783710000000,
      "sha256": "optional-client-hash",
      "contentBase64": "..."
    }
  ]
}
```

Backend сохраняет snapshot как неизменяемый импорт и добавляет `source` в manifest.
Это позволяет позже смешивать источники без путаницы:

- `decky-plugin`;
- desktop companion;
- ручная загрузка файла;
- импорт из браузера;
- будущий официальный API или внешний build planner.

## Требования К Совместимости

- Установленный Decky-плагин не должен ломаться при развитии backend.
- Legacy `/api/snapshots` остается поддержанным, пока не будет отдельной миграции плагина.
- Новый `/api/v1/companion/snapshots` должен проходить через тот же pipeline сохранения и анализа.
- Snapshot из Decky должен попадать в те же списки, анализы, историю и UI, что и любой другой импорт.
- UI должен показывать источник snapshot, чтобы пользователь понимал, откуда пришли данные.

## Ограничения Decky

На Steam Deck нельзя строить тяжелый build planner внутри плагина.
Decky-UI должен оставаться button-first и пригодным для управления геймпадом:

- Start Pairing;
- Check Pairing;
- Scan Local Files;
- Send Snapshot;
- Download Review Filter;
- Check/Install Update.

Клавиатурный ввод на Decky считается запасным вариантом, а не основным UX.

## Безопасность

- Decky читает только локальные save/filter файлы.
- Игровые файлы не изменяются без отдельного действия пользователя.
- Для публичного VPS используется pairing/device token.
- Admin token не должен попадать в публичный setup-файл.
- Для долгосрочного использования предпочтительны HTTPS, домен, Tailscale или WireGuard.
- В будущем backend должен уметь скрывать или хешировать полные локальные пути, оставляя для UI только безопасные относительные пути и диагностический источник.

## Миграционный План

1. Оставить текущий Decky endpoint `/api/snapshots`.
2. Добавить v1 companion endpoint с тем же payload.
3. Сохранять `source` в manifest snapshot.
4. Показывать источник snapshot в web UI.
5. Позже обновить Decky-плагин, чтобы он отправлял на `/api/v1/companion/snapshots`.
6. После появления desktop companion использовать тот же endpoint и отличать источник через `source.companion`.

## Definition Of Done

Интеграция считается рабочей, если:

- Decky-плагин отправляет saves, stash и filters одной кнопкой;
- backend создает snapshot и analysis;
- web UI показывает snapshot, источник, персонажей, stash, фильтры и itemData;
- тот же backend принимает v1 companion endpoint;
- обновление backend не требует ручного копирования файлов на Steam Deck;
- Decky можно обновить через GitHub release и встроенный update flow.
