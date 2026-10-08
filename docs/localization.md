# Hendrix Localization

Компоненты (все в `js/plugins/`):

- `Hendrix_Localization_Core.js` — словарь и функция `translateText`:
  читает CSV, ищет переводы, держит текущий язык.
- `Hendrix_Localization.js` — хуки отрисовки: `drawTextEx`, `Game_Message.add`,
  command101/261/355, варианты выбора, шрифты по языку.
- `Hendrix_Localization_Overrides_Module.js` — картинки, буфер сообщений,
  батлог, курсоры.

## Словарь: game_messages.csv (в корне игры)

- Заголовок: `Change,Excluded,Name,Original,en,test,ch,br,es,de,fr,ru,it,ko,jp,pl,…`
  ( escape-коды MZ (`\c[6]` и т.п.) хранятся как есть, `\n` → `{{LINEBREAK}}`).
- Перевод ищется по точному тексту колонки `Original` для текущего языка.
- Язык разблокируется, если в его колонке ≥1000 непустых переводов; символ
  `test` вырезается из списка. Перечитывается при старте, смене языка и
  загрузке сейва (`loadTranslations`).
- Текущий язык: `ConfigManager.language` (сохраняется в config), дефолт —
  параметр `Default Language` (глобал `window.Hendrix_DefaultLanguage`).

## Пайплайн translateText (по приоритету)

1. Быстрый выход: пустой текст / число / имя файла `.png`; если включён
   `Disable Native Loc` и язык = дефолтному — текст возвращается как есть.
2. Точное совпадение ключа (`Excluded`-префиксы учитываются).
3. Fuzzy-ключ: текст без пробелов, в lower case, `<чч:мм>` → `<TIME>`.
4. Построчный поиск (для многострочного текста).
5. `wordTranslations` — постановочные слова из колонки `Excluded`.

Если ничего не нашлось — возвращается исходная строка (поэтому новые строки
из splice-модов «молча» остаются на английском).

## Кто через что переводится (важно для модов)

| Путь | Точка входа | Как перехватить из мода |
|---|---|---|
| Весь UI через `drawTextEx` (описания предметов, помощь, крафт, магазины) | `window.Hendrix_Localization` | обернуть `window.Hendrix_Localization` |
| Сообщения на карте | `Game_Message.processMessageBuffer` → **замыкание** `translateText` (`Hendrix_Localization.js:2138`) | патчить метод `processMessageBuffer` — переназначение `window.translateText` НЕ работает |
| Боевые сообщения | `Window_Message.startMessage` → то же замыкание (2330) | патчить `startMessage`, если нужно |
| Имена в escape-кодах `\i[n]` / `\I[n]` | `Hendrix_Localization($dataItems[n].name)` | обёртка выше покрывает |
| Картинки / фильмы | `translations[имя]` напрямую | только через свой словарь/алиасы файлов |

## Паттерн «мод меняет текст на всех языках»

Реализовано в `mods/WTE_QOL_Coffee_Duration/js/plugins/coffee_duration.js`
(секция «TEXT»):

1. Таблица `{lang: {исходная строка: перевод}}` для языков, переведённых в
   игре (en, ru, de, fr, es, br, ch; список — по колонкам CSV).
2. `overrideCoffeeText(text)` — точное совпадение исходника, фолбэк на `en`
   для неизвестных языков.
3. Обёртка `window.Hendrix_Localization` (путь A) + патч
   `Game_Message.prototype.processMessageBuffer` (путь B).

Исходники в `data/*.json` **не меняем**: изменённая строка перестанет
совпадать с ключом CSV и на всех языках покажется английской. Перехват на
этапе отображения даёт обратимость: мод выключен — игра полностью ванильная.

## Полезные глобалы

- `window.Hendrix_Localization(text)`, `window.translateText(text)`
- `window.loadTranslations(lang)`, `window.changeToLanguage(sym | 'next')`
- `window.Hendrix_ValidLanguages`, `window.Hendrix_GetAvailableLanguages()`
- `window.Hendrix_NativeNames`, `window.Hendrix_DisableNative`,
  `window.Hendrix_DefaultLanguage`
- `window.WTE_GlobalReverseDict` — реверс-словарь «перевод → оригинал»
