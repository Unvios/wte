# WTE QOL Template

A quality-of-life mod for **Welcome to Elderfield** (RPG Maker MZ): <one sentence — what the mod does>.

## What you get

- <feature 1 — what the player sees>
- <feature 2>

The mod edits no game files: disable it and the game is completely original again.

## Requirements

- Welcome to Elderfield 1.0.4d with the official Mods menu (mod revision `1.0.4d.1`).
- Game updates can wipe the `mods/` folder — just re-drop the mod afterwards.

## Install

1. Extract the archive into the game folder so that `WTE_QOL_Template` ends up inside `<game>/mods/`.
2. Launch the game and open **Options → Mods** from the main menu. Check that the mod is listed with the correct game and mod versions. No manual `js/plugins.js` edit is required.
3. On first run, the loader may rebuild its injector and reload the game once.

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
