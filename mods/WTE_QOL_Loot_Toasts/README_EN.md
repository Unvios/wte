# WTE QOL Loot Toasts

A quality-of-life mod for **Welcome to Elderfield** (RPG Maker MZ). It removes
the click-fest after every battle and replaces it with non-blocking toasts —
control returns the moment the die stops rolling.

## What you see after a battle

- A **summary toast on top of the stack** (bottom-right of the screen): the
  rolled die face (original in-game art), earned EXP and gold in one line, e.g.
  `[die face]  50 EXP  24[coin]`. Missing parts are simply omitted.
- **Items** as toasts under it: icon + localized name (+ `xN` when more than
  one). No "Obtained" wording in any language.
- **Combat shrine bonus loot** — same item toasts with a gold frame, sunk to
  the bottom of the stack. The "The combat shrine rewards you..." line is gone.
- Reading order is always top-down: **summary → items → shrine items**.
  When a new battle's loot is handed out, the previous battle's toasts are
  cleared instantly.
- No more windows: "A Rat appears!" / "A Cute Flower attacks!" (battle start),
  "The corpse is intact / mangled", "Victory! Obtained: N EXP" — all skipped.

Everything outside battles (chests, quests, dialogue, fishing, shrines) stays
100% vanilla. The mod edits no game files: disable it and the game is
completely original again.

## Requirements

- Welcome to Elderfield (the mod targets game version 1.0.2a; see the mod
  version `1.0.2a.x` for the exact revision).
- The game's official mod loader enabled in `js/plugins.js` — see Install
  step 2, it ships turned off and updates reset it.
- Game updates wipe the `mods/` folder — just re-drop the mod afterwards.

## Install

1. Copy the `WTE_QOL_Loot_Toasts` folder into `<game>/mods/`.
2. Enable the mod loader (once per game install): open `<game>/js/plugins.js`
   in any text editor, find `"name":"VirtualModLoader","status":false"`
   and change `false` to `true`. Save the file. (Game updates and Steam's
   "verify integrity of game files" restore the original file — flip it
   back after each update.)
3. Launch the game — the mod loader rebuilds its injector and reloads once.

To disable, rename the folder with a `!` prefix: `!WTE_QOL_Loot_Toasts`.

## Configuration

All settings live in the `CONFIG` object at the top of
`js/plugins/loot_toasts.js` (mod plugins can't use the in-game plugin manager):

| Setting | Default | What it does |
|---|---|---|
| `TOAST_DISPLAY_TIME` | `180` | frames per toast (3 s) |
| `TOAST_WIDTH` | `380` | toast width, px |
| `RIGHT_MARGIN` | `8` | stack offset from the right edge, px |
| `MAX_TOAST_SLOTS` | `7` | toast slots (game default is 3) |
| `SUMMARY_SEPARATOR` | `'  '` | separator between summary parts |
| `SHRINE_FRAME_COLOR` | `0xFFD700` | frame tint for combat shrine loot |
| `REMOVE_BATTLE_START_MESSAGES` | `true` | hide "X appears!" announcements |
| `VICTORY_EXP_TOAST` | `true` | fold "Victory!/N EXP" into the summary toast |
| `BATTLE_WIN_CE_ID` | `27` | id of the "Battle Win" common event |
| `DICE_ANIMATION_CE_ID` | `28` | id of the die roll animation event (skipped entirely) |
| `DICE_FACE_CE_IDS` | `[29–34]` | ids of the die face 1–6 events (their empty pause marks the roll) |
| `SUPPRESSED_PICTURES` | `[5, 11, 12]` | loot flow picture numbers that are never shown |
| `SUPPRESSED_TEXTS` | 3 lines | corpse state texts — never shown |
| `SHRINE_REWARD_TEXT` | `'The combat shrine rewards you...'` | flag line for combat shrine bonus loot |
| `LOG_MAX_BYTES` | `524288` | log rotation threshold (512 KB) |
| `DEBUG` | `false` | verbose DEBUG log lines |

## Logs for troubleshooting

The mod always writes to `mods/WTE_QOL_Loot_Toasts/logs/loot_toasts.log`
(the folder is created automatically): startup with version and config, every
loot flush, shrine events, fallbacks to vanilla windows, and any uncaught game
errors. If something breaks on your machine, attaching this file makes
diagnosis trivial. `DEBUG: true` adds per-toast detail. The log self-rotates
at 512 KB.

## Compatibility notes

- Works with any game language — toast text is rebuilt from the item database,
  so item names stay localized.
- If a game update renumbers the internal "Battle Win" event (id 27), the mod
  detects nothing and silently stays vanilla (set `BATTLE_WIN_CE_ID`).
- Battle drops from the enemy database ("You find N gold." lines) are shown as
  regular toasts.

## Credits

Made by **Unvios**. Feel free to report issues with the log file attached.
