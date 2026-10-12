# WTE QOL Hotbar

A quality-of-life mod for **Welcome to Elderfield** (RPG Maker MZ): a
ten-slot quick-use hotbar for consumable items, skills and rituals on the
number keys 1-9 and 0 — plus one-press equipment loadouts on Ctrl+digit.

## What you get

- **Ten slots on keys 1-9 and 0.** Hover an item in the inventory (or a
  skill/ritual in the skill menu) and press a key to bind it. Press the same
  key on the same entry to unbind; binding a different entry moves the
  binding. Bound entries show their key digit on the item/skill icon.
- **Use on the field** while the character has free control (not during
  messages or events), **or in battle** during the current hero's input —
  it consumes the turn, skills pay MP, exactly like choosing from the menu.
  A skill can only be used by an actor who knows it (same as the menu).
- **A center-bottom toast announces every field use** — "Used: <item>", same
  look as the world item-pickup toast, in every language the game ships. In
  battle nothing extra is printed — the engine announces the action itself
  when the turn executes.
- **HUD bar** (bottom-left of the screen): each bound slot shows its icon,
  the inventory count at the icon's corner and the key digit underneath.
  Out-of-stock items and skills you cannot currently cast (no MP, not
  learned) show greyed.
- **Equipment loadouts on Ctrl+digit**: applies one of the game's equipment
  loadouts to the current hero in a single press (inventory-verified, same
  logic as the loadout menu) and shows a toast with the loadout name.
- **Bindings persist in your savegames.**

Everything the mod cannot legally do, it refuses with a buzzer instead —
exactly the cases where the field menu greys an entry out (out of stock,
wrong occasion, effect would not apply, and so on). The mod edits no game
files: disable it and the game is completely original again.

## Requirements

- Welcome to Elderfield (the mod targets game version 1.0.2a; see the mod
  version `1.0.2a.x` for the exact revision).
- The game's official mod loader enabled in `js/plugins.js` — see Install
  step 2, it ships turned off and updates reset it.
- The Ctrl+digit loadout keys use the game's built-in equipment loadout
  feature; if a game update ever removes it, those keys simply buzz.
- Game updates wipe the `mods/` folder — just re-drop the mod afterwards.

## Install

1. Copy the `WTE_QOL_Hotbar` folder into `<game>/mods/`.
2. Enable the mod loader (once per game install): open `<game>/js/plugins.js`
   in any text editor, find `"name":"VirtualModLoader","status":false"`
   and change `false` to `true`. Save the file. (Game updates and Steam's
   "verify integrity of game files" restore the original file — flip it
   back after each update.)
3. Launch the game — the mod loader rebuilds its injector and reloads once.

To disable, rename the folder with a `!` prefix: `!WTE_QOL_Hotbar`.

## Configuration

All settings live in the `CONFIG` object at the top of
`js/plugins/hotkeys_consumable.js` (mod plugins can't use the in-game
plugin manager):

| Setting | Default | What it does |
|---|---|---|
| `SLOT_KEYS` | `['1'…'9','0']` | the ten slot keys |
| `EXTRA_ITEM_IDS` | `[2043]` | item ids bindable despite "menu-only" (Cup of Coffee). Empty for strict game rules |
| `TOAST.WIDTH` / `TOAST.DISPLAY_TIME` | `360` / `180` | toast width and display time |
| `HUD.LEFT` / `HUD.BOTTOM` | `8` / `8` | hotbar position (bottom-left corner) |
| `HUD.SLOT_WIDTH` / `HUD.HEIGHT` | `40` / `52` | hotbar geometry |
| `DEBUG` | `false` | verbose DEBUG log lines |

## Logs for troubleshooting

The mod always writes to `mods/WTE_QOL_Hotbar/logs/hotkeys_consumable.log`
(the folder is created automatically): startup with version and config,
every bind/unbind, every use, every loadout applied, every refusal **with
its reason** (stock, occasion, MP, applicability), and any errors. If
something breaks on your machine, attaching this file makes diagnosis
trivial. The log self-rotates at 1 MiB.

## Compatibility notes

- Works with any game language — toast names come from the game databases,
  the "Used:"/"Equipped:" prefixes ship in all 28 game languages.
- Items and skills are applied by the game's own engine paths, so effects,
  common events and the battle log behave exactly like menu usage.
- Loadout hotkeys integrate with the game's equipment loadout plugin; all
  other features are fully self-contained.

## Credits

Made by **Unvios**. Feel free to report issues with the log file attached.
