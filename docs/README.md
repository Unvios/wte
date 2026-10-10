# Моддинг Welcome to Elderfield — рабочие заметки

Собрано при разборе игры (RPG Maker MZ, рантайм NW.js) в октябре 2026.
Официальный гайд от разработчиков лежит в `mods/How to Mod.txt` — здесь то, что
не влезает в него или нарылось по исходникам.

## Оглавление

- [mod-loader.md](mod-loader.md) — архитектура WTE Mod Loader: как грузятся моды,
  плагины, splice-файлы, приоритеты, подводные камни.
- [timed-states.md](timed-states.md) — система таймированных состояний
  (баффы по игровому времени): разбор цепочки «Кофе» и рецепт для своих эффектов.
- [loot-toasts.md](loot-toasts.md) — лут после боя: цепочка CE 27 → лут-таблицы,
  почему сообщения блокируют управление и как это перехватывается тостами.
- [hotkeys-consumable.md](hotkeys-consumable.md) — хоткеи 1–0 для предметов,
  навыков и ритуалов: биндинг в меню, использование через штатные флоу
  движка, Ctrl+цифра для комплектов снаряжения, тосты, HUD-панель.
- [localization.md](localization.md) — Hendrix Localization: где словарь, как
  проходит перевод текста и как модам править строки на всех языках.

## Базовые факты

- Игра — RPG Maker MZ, запускается в NW.js: в плагинах доступны `require('fs')`,
  `require('path')`, `process`, DOM и DevTools-консоль. Модулей нет — весь движок
  это глобальные классы, патчатся через прототипы.
- Моды кладутся в `mods/<ИмяПапки>/`, отключаются префиксом `!` в имени папки.
  **Обновления игры затирают папку `mods/`** — держать бэкап/репозиторий.
- Пример рабочего мода: `mods/WTE_QOL_Coffee_Duration` (бафф кофе 4ч → 8ч,
  включает в себя все описанные паттерны).

## Ключевые глобальные объекты движка

| Глобалка | Что это |
|---|---|
| `$gamePlayer`, `$gameParty`, `$gameMap`, `$gameActors`, `$gameVariables`, `$gameSwitches`, `$gameSystem` | Рантайм-состояние (сериализуется в сейвы) |
| `$dataItems`, `$dataStates`, `$dataMapXXX`… | Статическая БД из `data/*.json` |
| `$gameTime`, `Game_Time` | Игровые часы (плагин DK_Game_Time) |
| `SceneManager` | Стек сцен (`Scene_Title`, `Scene_Map`, `Scene_Battle`…) |
| `ConfigManager.language` | Текущий язык локализации |

Стандартный паттерн изменения поведения движка — алиас + переопределение
метода прототипа (моды грузятся последними, поэтому их версия побеждает):

```js
(() => {
    const alias_Game_Player_realMoveSpeed = Game_Player.prototype.realMoveSpeed;
    Game_Player.prototype.realMoveSpeed = function () {
        return alias_Game_Player_realMoveSpeed.call(this) * 1.5;
    };
})();
```
