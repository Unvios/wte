# Хоткеи 1–0 для предметов/навыков + комплекты снаряжения (WTE_QOL_Hotkeys)

Разобрано при разработке мода `mods/WTE_QOL_Hotkeys/` (октябрь 2026).

## Что делает мод

Десять слотов быстрого использования на цифрах 1–9/0 (предметы, навыки,
ритуалы), биндинг наведением в инвентаре/меню навыков, использование на
карте и в бою, Ctrl+цифра — применение комплектов снаряжения
(`WTE_EquipmentLoadouts`), тосты, HUD-панель. Один плагин без правок
данных: `mods/WTE_QOL_Hotkeys/js/plugins/hotkeys_consumable.js`.

## Ввод: почему `Input.isTriggered('1')` работает из коробки

- `Hendrix_Keyboard_Gamepad.js` строит кеймап рантайма из MZ-дефолта +
  `charToKeyCode` (п.361-375): все цифры (`'1'..'9'` → 49–57, `'0'` → 48)
  уже лежат в `Input.keyMapper` как отдельные экшены. Конфликтов по цифрам
  нет (проверено grep'ом по `js/`). В моде idempotent-страховка
  `Input.keyMapper[код]=ключ` на случай перестройки кеймапа чужим плагином.
- Ограничение ядра MZ: `isTriggered` срабатывает только для `_latestButton`
  (js/rmmz_core.js:5790) — одновременный тап двух цифр схлопывается в одну;
  модификатор (Ctrl) читается через `Input.isPressed('control')` отдельно —
  комбинация Ctrl+цифра корректна.
- `Input._shouldPreventDefault` цифры и Ctrl не блокирует.

## Состояние слотов

- `$gameSystem._wteConsumableHotkeys` — массив из 10 записей
  `{t: 'item'|'skill', id} | null`. `Game_System` сериализуется целиком без
  whitelist → сейвы бесплатно; ленивая инициализация + алиас
  `Game_System.prototype.initialize`.
- Миграция: записи-числа из версии 1 превращаются в `{t:'item', id}`.

## Биндинг

- Предметы — алиас `Scene_Item.prototype.update` (стоковая сцена;
  `_itemWindow.active` закрывает окно цели и action-меню `DM_ItemActions`):
  `_itemWindow.item()` + `Input.isTriggered(цифра)`.
- Навыки/ритуалы — аналогичный алиас `Scene_Skill.prototype.update`.
  Сцена навыков стоковая по структуре (`WTE_SkillMenuOverhaul` правит
  только layout окнами).
- `bindToggle(index, obj, t)`: тот же объект в том же слоте → снять
  (`playCancel`); иначе записать и вычистить дубли по всем слотам.
  После — `_itemWindow.refresh()` (значок виден сразу).
- `isBindable(item)`: `itypeId === 1` (не ключевой) && occasion 0|1 (или
  `CONFIG.EXTRA_ITEM_IDS` — белый список menu-only; дефолт `[2043]` = Cup
  of Coffee) && scope ∉ {9,10,12} (мёртвые союзники — только ручной выбор).
- `isSkillBindable(skill)`: `DataManager.isSkill` && occasion ≠ 3 &&
  scope ∉ {9,10,12} && именованный тип (`$dataSystem.skillTypes[stypeId]`
  непуст — пустые типы это пассивы/заглушки; в игре типы:
  `["", "Ritual", "Skill", ""]`). Scope 0 (ритуалы-CE вроде Warp) —
  разрешён, пригодность решает гейт использования.
- Маркеры в списках: алиасы `Window_ItemList.prototype.drawItem` и
  `Window_SkillList.prototype.drawItem` (у каждого свой drawItem!) + обёртка
  `Window_Base.prototype.drawIcon` + обёртка `Bitmap.prototype.blt`. Пока
  строка рисуется, `_wteBadgeRow` помечает окно И его contents, и обе
  обёртки захватывают ФАКТИЧЕСКИЕ координаты/ширину блита иконки. Зачем так
  глубоко: VisuMZ_4_VisualItemInv + VisualInventoryScaler рисуют иконки
  сетки увеличенными напрямую через `contents.blt` (размер `itemWidth()*0.9`,
  центрирование в ячейке) — мимо `drawIcon` (тогда захват пустой и значок
  сползал на фолбэк-формулу, которая про 36px-строки, а не про эту сетку).
  Блит отбирается по `source.url` (IconSet) и `sw/sh >= 32`; значок (клавиша
  из `CONFIG.SLOT_KEYS`, 12px, systemColor) ставится в правый верхний угол
  блита с учётом захваченной ширины. После `bindToggle` — `_itemWindow.refresh()`.

## Использование предметов на карте

Зеркало `Scene_ItemBase.prototype.canUse + useItem/applyItem`
(js/rmmz_scenes.js:1525, 1499, 1536):

1. `user = Scene_Item.prototype.user()` (первый подвижный член с макс.
   pha — тот, кто ел бы предмет из меню).
2. Гейт: `user.canMove() && $gameParty.hasItem(item) &&
   occasionOkForHotkey(item) && action.isForFriend() &&
   targets.some(testApply)` — последнее это `isItemEffectsValid`
   (js/rmmz_scenes.js:1530): эффект должен работать на цели; предметы
   «по врагу» с карты меню не использует вообще. `occasionOkForHotkey` =
   vanilla `isOccasionOk` + белый список menu-only.
3. `SoundManager.playUseItem()` → `user.useItem(item)` → `Game_Action`
   + `setItemObject` → цели (`itemTargetActors` с `user` вместо окна
   актёра) ×`numRepeats()` → `applyGlobal()` → тост → геймовер-проверка.
4. Reserved CE: `SceneManager.goto(Scene_Map)` вызывается ТОЛЬКО если
   текущая сцена не карта. На карте зарезервированное CE запускает сам
   `Game_Map` (`setupReservedCommonEvent` в `updateInterpreter`) — лишний
   рестарт сцены провоцировал визуальные артефакты (замеченное игроком
   «медленное темнение»).
Хук — алиас `Scene_Map.prototype.update`, гейт `$gamePlayer.canMove()`.

## Использование навыков/ритуалов на карте

1. `user = $gameParty.menuActor()` — тот, чей список навыков в меню
   (`Scene_Skill.prototype.user = this.actor()`, js/rmmz_scenes.js:1751).
2. Гейт: `user.hasSkill(skill.id)` (защита от использования чужого навыка —
   `canUse` наличие навыка НЕ проверяет!) && `user.canUse(skill)`
   (occasion + MP + canMove).
3. Пригодность: friend-scope → `targets.some(testApply)`; opponent-scope →
   отказ (на карте нет ручного выбора врага); scope 0 → наличие любых
   эффектов (Warp: только CE 40 «домой», occasion 2 — работает через
   `applyGlobal` → `$gameTemp.reserveCommonEvent` → рестарт Scene_Map).
4. `SoundManager.playUseSkill()` → общий `applyEntry` (трата MP через
   `useItem` → `paySkillCost`, эффекты, тост, CE, геймовер).

## Использование в бою

Тот же штатный флоу, что и для предметов: гейты `isInputting()` +
свежий `inputtingAction()` (`!action.item()`) + знание навыка/предмета +
`actor.canUse` (для навыков — с MP). Далее `setItem`/`setSkill` +
`$gameParty.setLastItem` + автонаведение (`pickTarget`: оппоненты →
первый живой, союзник → индекс актёра) + `scene.selectNextCommand()`.
Ctrl в бою игнорируется (смена снаряжения в бою не положена).

## Комплекты снаряжения (Ctrl+цифра на карте)

- Источник истины — плагин `WTE_EquipmentLoadouts.js`: хранилище
  `$gameSystem._equipLoadouts` (MAX_SLOTS штук `{name, equips|null}`,
  инициализация `Game_System.prototype.initEquipLoadouts`, имя по умолчанию
  локализованное «Loadout N»), логика применения в
  `Scene_Equip.prototype.onLoadoutEquip` (413-455): снять все слоты →
  надеть сохранённое при наличии в инвентаре → зажать HP/MP прежними
  значениями (по `Math.min`) → refresh.
- Мод дублирует эту логику в `applyLoadout(index)` для
  `$gameParty.menuActor()` без всякого UI, добавляя `playEquip` и тост
  (иконка первого надетого предмета + локализованное имя комплекта).
- Пустой комплект / нет актёра → buzzer, тост не показывается.
- Игровые «New Equipment!»/«New Weapon!» при смене экипировки — это
  gab-окна MK_GabWindows (CE 2233/2234, якорь Top Left), запускаемые через
  `DM_InvChangeCommonEvent` после ЛЮБОЙ смены экипировки. При хоткее они
  подавляются: `applyLoadout` взводит счётчик на 120 кадров, обёртка
  `PluginManager.callCommand` (command357 идёт через неё) глушит команды
  `MK_GabWindows/addGabWindow`, пока счётчик > 0. Меню комплектов
  (ванильный путь) gabs не трогает.
- В `Scene_Map.prototype.update` ветка Ctrl стоит ПЕРЕД обычным
  использованием: пока модификатор зажат, цифры не тратят предметы.

## Тосты

- Донор — игровой тост поднятия предмета (CE 2838,
  `data/CommonEvents.json:2840`): `width 360`, `height 1`, `Display Time
  180`, `backgroundStyle Dim`, `windowskinTone {"Red":"0",…}`,
  `windowskin ""`; позиция центр-снизу (глобальные настройки CGMZ).
- `$cgmzTemp.createNewToast` с
  `lineOne = '\C[6]{префикс}\i[icon]{локализованное имя}\C[0]'`; перевод
  имени — явный `window.Hendrix_Localization` (паттерн
  `loot_toasts.js:74`), `\i[n]` — стандартный код.
- Префиксы «Used:» (предметы/навыки) и «Equipped:» (комплекты) — новые
  строки, которых нет в `game_messages.csv` (файл игры не правим) → таблица
  `TEXTS` на всех 28 языках игры по паттерну Coffee-мода
  (docs/localization.md), выбор по `ConfigManager.language`, фолбэк `en`.
  Уже переведённая строка не является ключом словаря Hendrix → проходит
  через translateText без изменений.

## HUD-панель в левом верхнем углу

- Реализация — **спрайт** `WTE_HotkeyHudSprite` (PIXI Sprite + Bitmap:
  ручной blt иконок из IconSet и `bitmap.drawText`), а не окно: оконный
  вариант через `Scene_Map.addWindow` в этой сборке рендерился со смещением
  относительно заданного rect (~+50px по y — так и не выяснено, кто двигает
  windowLayer/окно). Спрайт добавляется в `scene._ultraHudContainer` (Stage
  SRD HUD Maker Ultra) — та же координатная сетка 1248×720, что у золота
  и часов. Создание — в алиасе `Scene_Map.prototype.createAllWindows`
  (контейнер уже есть, он создаётся в `createSpriteset`), обновление —
  вручную из алиаса `Scene_Map.prototype.update` (контейнер не каскадит
  update детям).
- Позиция: левый нижний угол, `CONFIG.HUD.LEFT` (=8), низ экрана минус
  `CONFIG.HUD.BOTTOM` (=8). Левый нижний угол карты свободен; правый верхний
  занят часами/золотом/полосами HP/MP SRD HUD Maker Ultra. Окна сообщений
  рисуются поверх HUD-слоя — во время диалогов панель перекрывает текст.
- Слот: иконка 32 по центру ячейки (`bitmap.paintOpacity` 160 при
  «нельзя»), для предметов количество `xN` правым нижним углом иконки,
  цифра клавиши по центру под иконкой (`textColor = systemColor()`).
- Сигнатура перерисовки: `t+id+состояние` по слотам + глобальная
  видимость `$gameUltraHUD.globalVisibility` — без алиасов на gain/lose.
- Видимость: есть ≥1 привязка; предметы серые при остатке 0, навыки — если
  menuActor не знает навык или не может оплатить.

## Инварианты

- Игровые строки мод не хранит; данные не правит; состояние — на
  `$gameSystem` (сейвы) → выключение мода возвращает ваниллу целиком
  (кроме уже применённых эффектов, разумеется).
- Консоль (F12) в этой сборке недоступна. Журнал:
  `mods/WTE_QOL_Hotkeys/logs/hotkeys_consumable.log` — пишется
  всегда (операционные события с таймстампами: бинды, использования,
  отказы с причинами, комплекты, ошибки со стектрейсами; хуки сцен
  логируют исключения и пробрасывают их дальше, HUD при ошибке отключается
  на сцену и логирует один раз). `DEBUG: true` добавляет внутренние
  детали. Папка `logs/` в `.gitignore` не трекается. Ротация: файл
  обрезается при превышении 1 МБ.

## Известные ограничения

- Одновременное нажатие двух цифр = сработает одна (`_latestButton`).
- Однострочный тост 360px: длинные локализованные имена могут обрезаться.
- Атакующие предметы/навыки («по врагу») в бою целят первого живого врага;
  на карте отказывают (как меню).
- Комплекты применяются к menuActor (герой, открытый в меню экипировки).
- Если `WTE_EquipmentLoadouts` выключен/удалён, Ctrl+цифра просто buzzer.
