# WTE QOL Deposit Pins

A quality-of-life mod for **Welcome to Elderfield** (RPG Maker MZ): pin items in the party inventory so the chest scene's "Deposit All" leaves them alone, plus a keyboard hotkey for Deposit All itself.

## What you get

- Hover an item and press **P** to pin it; press P again to unpin. Works both in the chest scene (right-hand window) and in the regular item menu.
- **Deposit All** skips pinned items — they stay in your inventory. Manual single deposits are not blocked.
- Pinned entries show a small "P" badge at the icon's top-left corner in both lists.
- With a chest open, the game's Inventory button (**E** or **B** by default, follows your Button Config binding) triggers Deposit All — no mouse needed. On the map that button still opens the inventory as usual.
- A pin covers the whole stack of an item kind (items, weapons and armors are tracked separately) and persists through save/load.

The mod edits no game files: disable it and the game is completely original again.

## Requirements

- Welcome to Elderfield (the mod targets game version 1.0.2a; see the mod version `1.0.2a.x` for the exact revision).
- The game's official mod loader enabled in `js/plugins.js` — see Install step 2, it ships turned off and updates reset it.
- Game updates wipe the `mods/` folder — just re-drop the mod afterwards.

## Install

1. Copy the `WTE_QOL_Deposit` folder into `<game>/mods/`.
2. Enable the mod loader (once per game install): open `<game>/js/plugins.js` in any text editor, find `"name":"VirtualModLoader","status":false"` and change `false` to `true`. Save the file. (Game updates and Steam's "verify integrity of game files" restore the original file — flip it back after each update.)
3. Launch the game — the mod loader rebuilds its injector and reloads once.

To disable, rename the folder with a `!` prefix: `!WTE_QOL_Deposit`.

## Configuration

All settings live in the `CONFIG` object at the top of `js/plugins/deposit_pins.js` (mod plugins can't use the in-game plugin manager):

| Setting | Default | What it does |
|---|---|---|
| `PIN_KEY` | `'p'` | key that toggles the pin |
| `DEPOSIT_KEY` | `'e'` | Input button for the Deposit All hotkey (by default the game's "Inventory" button: E/B) |
| `DEBUG` | `false` | verbose DEBUG log lines |

## Logs for troubleshooting

The mod always writes to `mods/WTE_QOL_Deposit/logs/deposit_pins.log` (the folder is created automatically): startup with version and config, every pin/unpin, and any errors. If something breaks on your machine, attaching this file makes diagnosis trivial. The log self-rotates at 1 MiB.

## Credits

Made by **Unvios**. Feel free to report issues with the log file attached.
