# WTE QOL Template

A quality-of-life mod for **Welcome to Elderfield** (RPG Maker MZ): <one sentence — what the mod does>.

## What you get

- <feature 1 — what the player sees>
- <feature 2>

The mod edits no game files: disable it and the game is completely original again.

## Requirements

- Welcome to Elderfield (the mod targets game version 1.0.2a; see the mod version `1.0.2a.x` for the exact revision).
- The game's official mod loader enabled in `js/plugins.js` — see Install step 2, it ships turned off and updates reset it.
- Game updates wipe the `mods/` folder — just re-drop the mod afterwards.

## Install

1. Copy the `WTE_QOL_Template` folder into `<game>/mods/`.
2. Enable the mod loader (once per game install): open `<game>/js/plugins.js` in any text editor, find `"name":"VirtualModLoader","status":false"` and change `false` to `true`. Save the file. (Game updates and Steam's "verify integrity of game files" restore the original file — flip it back after each update.)
3. Launch the game — the mod loader rebuilds its injector and reloads once.

To disable, rename the folder with a `!` prefix: `!WTE_QOL_Template`.

## Configuration

All settings live in the `CONFIG` object at the top of `js/plugins/mod_template.js` (mod plugins can't use the in-game plugin manager):

| Setting | Default | What it does |
|---|---|---|
| `DEBUG` | `false` | verbose DEBUG log lines |

## Logs for troubleshooting

The mod always writes to `mods/WTE_QOL_Template/logs/mod_template.log` (the folder is created automatically): startup with version and config, <what else>, and any errors. If something breaks on your machine, attaching this file makes diagnosis trivial. The log self-rotates at 1 MiB.

## Credits

Made by **Unvios**. Feel free to report issues with the log file attached.
