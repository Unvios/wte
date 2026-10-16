# E2E тест-план мода WTE_QOL_Hotbar

Каталог кейсов для полного e2e-покрытия мода `mods/WTE_QOL_Hotbar` (хотбар 1–0: биндинг предметов/навыков в меню, использование на поле и в бою, Ctrl+цифра для комплектов, HUD, тосты). Харнес и API тулкита — `docs/e2e-testing.md`; здесь только кейсы и специфика мода. Реализовано целиком: сценарии `tools/e2e/scenarios/hotbar-*.mjs` (бывший `hotbar-mending.mjs` поглощён `hotbar-field-skills.mjs`), прогон пачки — `tools/e2e/run_suite.sh hotbar`.

## Подход

- Проверки — на состоянии игры через `t.eval` (`$gameSystem._wteConsumableHotkeys`, `$gameParty`, `BattleManager`, окна сцен), плюс свежие строки мод-лога (`readModLog` с offset, стемпы UTC — парсить с суффиксом `Z`), плюс скриншоты-артефакты для визуала (бейджи, HUD).
- Сетап программный: предметы выдаём `$gameParty.gainItem`, навыки — `actor.learnSkill`, слоты для тестов ИСПОЛЬЗОВАНИЯ выставляем напрямую в `$gameSystem._wteConsumableHotkeys` (биндинг через реальные клавиши тестируем отдельно в BIND-блоке).
- Биндинг и использование жмём реальными клавишами `t.key('1'..'0')` — DOM-listeners мода видят CDP-ввод как настоящий.
- **Ctrl+цифра**: `t.key('1', { ctrl: true })` — `pressKey` держит Control с CDP-модификатором 2, события доверенные и DOM `ctrlKey` честный (мод читает именно его, а не `Input.isPressed('control')`).
- Курсор в инвентаре/меню навыков ставим программно: открыть сцену, найти индекс строки по id в данных окна, `_itemWindow.select(i)` — категории/сортировка VisuMZ-инвентаря тогда не важны.
- Фикстура `file90` (карта, туториал боя пройден). Persistence-кейсы пишут слот 95 — гонять строго с `--sandbox`.
- Общий пост-ассерт каждого сценария: свежие строки мод-лога не содержат `ERROR`.
- Веток отказа по scope 9/10/12 (dead-ally) в живой БД нет (проверено по Items.json/Skills.json) — покрываем синтетической мутацией `$dataItems[id].scope = 9` на время кейса с обязательным откатом.

## Тестовые данные (id проверены по БД)

| Сущность | id | Свойства | Для чего |
|---|---|---|---|
| Spiced Jerky | 2141 | item, occasion 0, scope 11 | основная еда: бинд, поле, бой |
| Simple Jerky (Raw) | 2147 | item, occasion 3 («never») | отказ бинда |
| Basic Skeleton Key | 74 | item, itypeId 2 (ключевой) | отказ бинда |
| Coffee Maker | 2044 | item, occasion 2, НЕ в whitelist | отказ бинда menu-only |
| Cup of Coffee | 2043 | item, occasion 2, в whitelist, scope 11 | whitelist: бинд + использование на поле, отказ в бою |
| Lucky Die | 79 | item, occasion 2, whitelist, scope 0, CE-only | scope-less использование без цели |
| Combat Drink | 2064 | item, occasion 1 (battle-only), scope 11 | отказ на поле, использование в бою |
| Lesser Mending | 52 | skill, occasion 0, scope 11, stype 1, mp 10, CE 291 | поле (хил + CE-гард), бой |
| Warp | 3 | skill, occasion 2, scope 0, CE | scope-less ритуал на поле |
| Dark Blast | 12 | skill, occasion 1, scope 1, stype 1 | атакующий ритуал: отказ на поле, бой |
| Basic Attack | 1 | skill, stype 0 («») | отказ бинда навыка (passive/placeholder) |

Skill types в этой игре: 1 = «Ritual», 2 = «Skill», 0 и 3 = «» (небиндятся).

## Кейсы

### BIND — биндинг в инвентаре и меню навыков (P0)

- **HB-B-01** Бинд предмета: открыть Scene_Item, выбрать jerky, `key('1')` → слот 0 = `{t:'item',id:2141}`, лог `slot 1 bound`, скриншот бейджа «1» в правом верхнем углу иконки.
- **HB-B-02** Отвязка: повторный `key('1')` на том же предмете → слот 0 = null, лог `unbound`.
- **HB-B-03** Переназначение слота: jerky на 1, затем coffee на 1 → слот 0 = coffee, jerky не привязан нигде (все слоты проверить).
- **HB-B-04** Перенос привязки: jerky на 1, затем jerky на 3 → слот 0 = null, слот 2 = jerky.
- **HB-B-05** Отказ: ключевой предмет (itypeId 2) — ключевые не появляются в `_data` окна под CDP, поэтому ветка проверяется синтетической мутацией `$dataItems[2141].itypeId = 2` с откатом → слот пуст, лог `itype=2`.
- **HB-B-06** Отказ: occasion 3 (2147) → refused, лог `occasion=3`.
- **HB-B-07** Отказ: menu-only вне whitelist (2044) → refused, лог `whitelisted=false`.
- **HB-B-08** Whitelist: coffee (2043, occasion 2) → биндится успешно.
- **HB-B-09** Отказ dead-scope: мутация `$dataItems[2141].scope=9` → refused; откатить scope.
- **HB-B-10** Ctrl+цифра в инвентаре НЕ биндит: синтетический keydown с `ctrlKey:true` → слот остался пуст.
- **HB-B-11** Бейдж на ПРАВИЛЬНОЙ строке (регрессия «смещение на предмет левее»): после бинда и `refresh()` проверить пиксели `contents` в rect выбранной строки (непрозрачность в правом верхнем углу иконки) + скриншот; пометка best-effort, основной контроль — скриншот.
- **HB-B-12** Бинд навыка: learnSkill(52), Scene_Skill, выбрать, `key('2')` → слот 1 = `{t:'skill',id:52}`.
- **HB-B-13** Отказ навыка stype 0 («») — stype-0 навыки не показываются ни в одной вкладке списка, поэтому мутация `$dataSkills[52].stypeId = 0` с откатом → refused, лог `stype=0("")`.
- **HB-B-14** Отказ навыка occasion 3: мутация `$dataSkills[52].occasion=3` → refused; откатить.
- **HB-B-15** Отвязка навыка той же клавишей → слот null.

### FIELD-ITEMS — использование предметов на поле (P0)

- **HB-F-01** Еда с хоткея: HP занижено, jerky на слоте, `key('1')` на карте → HP вырос, `numItems` −1, тост с префиксом `Used:` + иконка + имя, лог `used on map`.
- **HB-F-02** Формат тоста: `lineOne` содержит `\C[0]Used: \C[6]\i[<icon>]` и локализованное имя; скриншот до протухания (3 с).
- **HB-F-03** Пустой сток: `numItems=0` → отказ, лог `stock=0`, тоста нет, HP не изменилось.
- **HB-F-04** Whitelist на поле: coffee (2043) → срабатывает (эффект/бафф применён), тост есть.
- **HB-F-05** Scope-less CE-предмет: Lucky Die (79) → потрачен, CE зарезервирован и выполнен (лог `CE reserved: true`), тост есть, краша нет.
- **HB-F-06** Strip CE 313 («Inv Open»): предмет из whitelist, у которого в effects есть CE 313 (уточнить по `$dataItems[id].effects` при реализации — кандидаты 105/166/957/2070) → после использования сцена осталась `Scene_Map`, инвентарь НЕ открылся; лог `stripped CE 313` (DEBUG) либо косвенно по сцене.
- **HB-F-07** Battle-only на поле: Combat Drink (2064, occasion 1) → refused, лог `occasion=1`.
- **HB-F-08** Полное HP: jerky при `hp=mhp` → refused (`testApply` false), предмет не потрачен.
- **HB-F-09** Битый бинд: слот `{t:'item',id:9999}` → buzzer + лог `no longer exists in the database`, краша нет.
- **HB-F-10** Локализация префикса тоста: `ConfigManager.language='ru'` → тост с `Использовано: `; вернуть `en`. P2, best-effort (смена языка на лету может требовать перезагрузки строк — тогда кейс ручной).

### FIELD-SKILLS — навыки и ритуалы на поле (P0)

- **HB-F-11** Lesser Mending (52, CE 291): heal + тост + busy-окно интерпретатора < 900 мс + лог `off-battle ActSeq suppressed` — уже реализовано в `hotbar-mending.mjs`, переносится сюда. Добавить: после прогона CE повторное использование работает (гард отпущен).
- **HB-F-12** Нет MP: `mp=0` → refused, лог с `mp=0/… cost=10`, HP не изменилось.
- **HB-F-13** Навык не выучен: слот со skill 52, актёр без навыка → refused, лог `hasSkill=false`.
- **HB-F-14** Атакующий ритуал на поле: Dark Blast (12) → refused, лог `forOpponent=true`.
- **HB-F-15** Warp (3, scope-less CE-ритуал): использование на карте → CE выполняется, `ERROR` в логе нет. Осторожно: если CE Warp открывает выбор точки телепорта — закрыть UI клавишей escape либо заменить на другой scope-less ритуал.

### BATTLE — использование в бою (P0)

Требуется разделить `runScriptedBattle` в lib.mjs на `startBattle(troopId)` (без убийства врагов) и `finishBattle()` (добить + дождаться карты и лут-флоу). Тroop — одиночный враг без резиста смерти (как в loot-toasts: troop 13).

- **HB-BT-01** Предмет в бою: jerky на слоте, фаза input, `key('1')` → `inputtingAction.item()` = jerky, после `selectNextCommand` индекс актёра продвинулся; ход выполнен → предмет потрачен; тоста `Used:` НЕТ (движок сам пишет строку); лог `used in battle`.
- **HB-BT-02** Атакующий ритуал: Dark Blast на слоте → цель первый живой враг; после выполнения HP врага снижено, MP потрачен.
- **HB-BT-03** Лечащий ритуал в бою: Mending → цель сам актёр, HP вырос.
- **HB-BT-04** Отказ: нет MP → buzzer, action не выставлен, актёр не продвинулся, лог refused.
- **HB-BT-05** Отказ whitelist-предмета в бою: coffee (occasion 2) → `canUse=false`, refused — бой запрещён для EXTRA-ids как в ванили.
- **HB-BT-06** Цифра не перехватывает выбор цели: у inputtingAction уже выставлен item (выбор цели открыт) → `key('1')` → action не изменился.
- **HB-BT-07** Ctrl+цифра в бою — ничего: loadout не применяется, action не тронут.
- **HB-BT-08** Пустой слот: цифра без бинда → action остался пустым, сцена жива.

### LOADOUTS — Ctrl+цифра, комплекты снаряжения (P1)

- **HB-L-01** Применение: `_equipLoadouts[0]` = weapon+armor (предметы выданы), synthetic Ctrl+1 на карте → экипировка актёра изменилась ожидаемо, тост `Equipped: <имя>`, лог `loadout 1 ... applied`.
- **HB-L-02** HP/MP-кламп: до свопа hp выше нового mhp → после `hp<=mhp`.
- **HB-L-03** Пустой комплект: `_equipLoadouts[2]` без equips → buzzer, лог `refused ... saved=false`.
- **HB-L-04** Нет предмета в инвентаре: один элемент комплекта не выдан → слот пропущен, лог `not in inventory`, остальные надеты.
- **HB-L-05** Gab-подавление: во время свопа нет gab-окон `Notif`/`weapon` («New Equipment!») — best-effort по окнам сцены + скриншот; основной assert — тост `Equipped:` присутствует.

### HUD — панель хотбара (P1)

Спрайт доступен как `SceneManager._scene._wteHotkeyHud`; `_signature` — строка вида `<actor>;item2141:5:1|…|shown` — основной объект ассертов.

- **HB-H-01** Видимость: с биндами `visible=true`, без биндов `visible=false`.
- **HB-H-02** Позиция и размер: `x=8`, `y=Graphics.height-8-52`, bitmap 400×52.
- **HB-H-03** Счётчик предмета: `gainItem`/`loseItem` меняет `_signature` (`item2141:6:1` → `item2141:5:1`) и триггерит refresh; скриншот.
- **HB-H-04** Grey: сток 0 → в `_signature` слот `…:0:0`; скриншот (пиксельная проверка alpha иконки — опционально через `bitmap.getPixel`).
- **HB-H-05** Grey: навык без MP → usable=0 в сигнатуре.
- **HB-H-06** Grey: полное HP у цели еды → usable=0.
- **HB-H-07** Глобальный выключатель: `$gameUltraHUD.globalVisibility=false` → `visible=false`; обратно `true` → виден.
- **HB-H-08** Перерисовка без перезахода (регрессия «HUD обновлялся только после перезахода в инвентарь»): бинд/анбинд/использование меняют `_signature` и вызывают refresh в той же Scene_Map.

### PERSIST — сохранение (P1, строго `--sandbox`)

- **HB-P-01** Бинды переживают save/load: выставить 3 слота (item+skill), `DataManager.saveGame(95)`, загрузка через `Scene_Load.executeLoad(95)` (нативная цепочка) → слоты идентичны.
- **HB-P-02** Миграция legacy-формата: `$gameSystem._wteConsumableHotkeys[0] = 2141` (голое число) → HUD видит слот и `key('1')` использует предмет (slots() мигрирует число в `{t:'item'}`).

### INPUT — механика клавиш (P0, регрессии реальных багов)

- **HB-I-01** TTL против «выстрела с задержкой»: пока открыто сообщение (`!$gamePlayer.canMove()`), нажать цифру, закрыть сообщение, подождать > 250 мс → использования НЕТ (press протух). Сообщение открыть зарезервированным CE с Show Text (подобрать простой CE при реализации).
- **HB-I-02** Удержание клавиши: `key('1', {holdMs:600})` → ровно одно использование (keyHeld игнорирует OS key repeat).
- **HB-I-03** Переназначение keyMapper (регрессия «не биндится 9»): `$dataSystem`/control-config симуляция — `Input.keyMapper[57]='control'` → `key('9')` всё равно использует слот 9 (мод читает DOM keyCode напрямую).
- **HB-I-04** Две цифры подряд: нажать 2 и 3 в быстрой последовательности → обе обработаны по одному разу, краша нет (одна — в текущем update, вторая — в следующем, пока TTL жив).
- **HB-I-05** Мгновенный keyup (клавиатурные макросы): synthetic keydown+keyup без задержки → нажатие засчитано (keyup не сбрасывает pending).

### VISUAL — структурные и пиксельные проверки (P1, реализовано)

Читаются не скриншоты, а bitmap'ы окон/спрайтов (`getPixel`/`getAlphaPixel` — рендерер не участвует, headless-safe). Helpers: `toastVisual`, `badgeInk`, `hudPixels` в lib.mjs.

- **HB-V-01** (hotbar-field-items, внутри F-02): тост `Used:` — окно по центру по X (±60px) и в нижней половине экрана; в contents есть «чернила» (ink>0.5%), цветные пиксели иконки (colorful>20), белые пиксели префикса (whitish>20) и пиксели имени в цвете `\C[6]` (nameColor>20). Opacity не ассертится: poll ловит тост в начале fade-in, а в headless рамп медленный — пиксельные проверки от opacity не зависят.
- **HB-V-02** (hotbar-loadouts, внутри L-01): то же для тоста `Equipped:`.
- **HB-V-03** (hotbar-hud): слот HUD — иконка opaque при usable (средняя alpha верхней полосы иконки > 220), текст количества и цифра клавиши нарисованы; при grey (полный HP / сток 0 / нет MP) alpha падает до ~160 (< 80% базовой).
- **HB-V-04** (hotbar-bind, B-11/B-12): бейдж цифры — systemColor-пиксели в правом верхнем углу иконки забинденной строки (match≥5) и их отсутствие у соседней строки (match≤1). Зона скана: грид-ячейки инвентаря — правые 20% верхней полосы; широкие строки списка навыков — правый верхний угол иконки слева (x 14–36, y 0–16). У каждой ячейки есть свой синий маркер в левом верхнем углу (#84aaff, systemColor-семейство) — широкая зона скана маскировала бы бейдж.

### LOG — диагностика (P1, встроено в прочие сценарии)

- **HB-LOG-01** При старте мода в `mods/WTE_QOL_Hotbar/logs/hotkeys_consumable.log` пишется строка `mod v<версия> loaded` с конфигом.
- **HB-LOG-02** Каждый сценарий финально проверяет: свежие строки лога содержат ожидаемые события своих кейсов и не содержат `ERROR`.

### REGRESSION — ваниль не тронута (P0)

- **HB-R-01** Меню-использование предмета: Scene_Item → выбрать jerky → enter → эффект применён как в ванили; для menu-only (coffee) после использования инвентарь открывается обратно (CE 313 НЕ зачищен на меню-пути — только хоткей-путь чистит).
- **HB-R-02** Бой без хоткеев: `runScriptedBattle` проходит целиком (совместимость с лут-флоу и loot-toasts модом).

## Раскладка по файлам сценариев

| Файл | Кейсы | Примечания |
|---|---|---|
| `hotbar-bind.mjs` | HB-B-01…15 | Открывает Scene_Item и Scene_Skill; синтетика для B-09/B-14 с откатом мутаций |
| `hotbar-field-items.mjs` | HB-F-01…09 (+F-10 best-effort) | — |
| `hotbar-field-skills.mjs` | HB-F-11…15 | Поглощает `hotbar-mending.mjs` (старый файл удалить) |
| `hotbar-battle.mjs` | HB-BT-01…08 | Нужны `startBattle`/`finishBattle` в lib.mjs |
| `hotbar-loadouts.mjs` | HB-L-01…05 | Нужен `pressCtrlDigit` (synthetic DOM KeyboardEvent) |
| `hotbar-hud.mjs` | HB-H-01…08 | Ассерты по `_wteHotkeyHud._signature`/`visible`/позиции |
| `hotbar-persistence.mjs` | HB-P-01…02 | Только `--sandbox`; пишет слот 95 |
| `hotbar-input.mjs` | HB-I-01…05 | Синтетические DOM-события для keyup/remap |
| `hotbar-regression.mjs` | HB-R-01…02 | — |

## Доработки харнеса (реализовано)

- `lib.mjs`: `startBattle`/`finishBattle` (разделённый `runScriptedBattle`), `waitEventDone` (ожидание CE с прожатием сообщений), `waitFreeControl`, `pressDigit`/`pressCtrlDigit` (Ctrl — через CDP-модификатор в `pressKey`, доверенные события), `logMark`/`freshLogLines` (UTC-стемпы мод-лога), `hudState` (visible/позиция/`_signature` спрайта), `selectRowById` (курсор по id + гашение sibling-окон DM_EasyWindowNavigation), `setSlots`.
- Прогон всей пачки одной командой: `tools/e2e/run_suite.sh hotbar` (последовательно, сводка PASS/FAIL).

## Не автоматизируем

- Пиксель-точный визуал бейджей/HUD/тостов — теперь автоматизирован через bitmap-чтение (см. HB-V-*); скриншоты-артефакты остаются для ручного разбора. Скриншот-диффы и golden images сознательно не используем (SwiftShader в headless неточен, эталоны дороги в поддержке).
- Полная матрица 28 языков тостов — покрываем en (+ru best-effort); остальные языки гарантированы таблицей TEXTS и единым кодовым путём.
- Поведение на боевом `Game.exe` — финальный ручной дымовой прогон релиза (SDK ≠ shipping бинарник).
