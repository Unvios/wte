# Таймированные состояния (баффы по игровому времени)

Разобрано на примере баффа «Кофе». Движок состоит из двух плагинов:
`DK_Game_Time.js` (игровые часы) и `WTE_TimeConverter.js` (мост: таймеры
состояний, дневной свет, процессоры).

## Цепочка «Кофе»

1. **Предмет** `Items.json` id **2043** «Cup of Coffee»:
   эффект `{"code":44,"dataId":1132}` — вызов общего события 1132.
2. **Общее событие** `CommonEvents.json` id **1132** «Coffee Buff»:
   SE «Buff» (code 250) → воздушный шарик над игроком (code 213) → сообщение
   «+1 Movement Speed for 4 hours» → `code 313, parameters [0,0,0,243]`
   (Change State: весь отряд, операция 0 = добавить, состояние 243).
3. **Состояние** `States.json` id **243** «Coffee»: трейты пустые — сам бонус
   скорости живёт в обфусцированном коде (VisuStella) и считывается по факту
   наличия состояния. В `note` — UI-поля (`<stack: 1>`, `<cgmzdesc:…>`,
   `<stateDesc:…>`, `<tooltipTxt:…>`).
4. **Таймер**: в параметрах `WTE_TimeConverter` секция *State Durations*
   (в `js/plugins.js`): сейчас там ровно одна запись — `State ID 243,
   unit hour, duration 4`.

## Как работает таймер (WTE_TimeConverter.js)

- При загрузке плагина параметр парсится в приватный `STATE_TIMERS`
  (строки 230–238) — снаружи недоступен (const в IIFE).
- Патч `Game_Battler.prototype.addState` (строки 277–294): если состояние есть
  в `STATE_TIMERS`, в статик `Game_Time._actorStates` пишется запись
  `{actorId, stateId, gameTime: $gameTime.clone().add(unit, duration)}`.
  Если запись уже есть — таймер **обновляется до полной длительности**.
- Снятие (строки 517–531, внутри патча `Game_Time.updateVariables`, тикает
  раз в игровую минуту): записи, где `$gameTime.moreEquals(gameTime)`,
  удаляются, состояние снимается. **Фильтр перебирает весь `_actorStates`,
  не только STATE_TIMERS** — это важно для рецепта ниже.
- Флаги-стражки (используются в guard'ах плагина):
  - `_wteIgnoreTimerRefresh` — не перезаписывать таймер при addState;
  - `_wteIgnoreTimerRemoval` — не удалять запись трекера при removeState.
- Плагин-команда `ReapplyTimedStates` (строки 607–620): после `Recover All`
  перенакладывает состояния из трекера с `_wteIgnoreTimerRefresh = true`,
  чтобы сохранённый дедлайн не сбросился.
- DK-шный фреймовый цикл `Game_Time.updateActorStates` отключён самим WTE
  (строка 275) — снятием заведает только фильтр выше.

## API игрового времени (DK_Game_Time)

- `$gameTime.clone().add('hour' | 'min' | 'day', n)` — арифметика по слепку.
- `$gameTime.moreEquals(other)` — «текущее время >= other» (с учётом дней).
- `Game_Time._actorStates` — статик-массив трекера; сериализуется в сейвах
  (поэтому баффи переживают сохранение/загрузку).

## Рецепт: свой таймированный эффект

1. **Состояние** — добавить через `moddedStates.json` (полный объект, новый
   свободный id; свободные id искать скриптом по `data/States.json`).
   Эффект — либо штатными трейтами состояния (`traits`: параметры, xparam,
   sparam), либо своим патчем, проверяющим `actor.isStateAffected(id)`.
2. **Источник применения** — предмет с эффектом `{"code":21,"dataId":<id
   состояния>}` (прямо добавить состояние) или `code 44` → общее событие
   (если нужны SE/сообщение/условия).
3. **Таймер** — паттерн из `mods/WTE_QOL_Coffee_Duration/js/plugins/coffee_duration.js`:
   обёртка `addState`, которая после оригинала пушит/обновляет запись в
   `Game_Time._actorStates`. Снятием по истечении займётся штатный фильтр
   WTE (см. выше). Обязательны те же guard'ы: `this.isActor()`, `$gameTime`
   существует, `_wteIgnoreTimerRefresh` не выставлен.
4. **Тексты** — менять только через обёртки локализации (см.
   `localization.md`), splice-строки с новым текстом не будут переведены.

### Справка по кодам событий, задействованных выше

| code | Команда | parameters |
|---|---|---|
| 44 | эффект предмета «общее событие» | `[commonEventId]` |
| 101 / 401 | показать текст | `[face, faceIndex, background, position]` / `[строка]` |
| 250 | проиграть SE | `[{name, volume, pitch, pan}]` |
| 313 | Change State | `[тип актёра, id актёра, операция (0 add / 1 remove), stateId]` |
