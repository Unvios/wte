# Changelog — WTE_QOL_Hotbar

Versioning: `<game version>.<mod revision>`.

## 1.0.2a.6

- Using a skill whose common event carries battle visuals (e.g. Lesser Mending) no longer reddens the screen and no longer locks controls for a second or two: while a hotbar-reserved common event runs on the field, the VisuMZ BattleCore flourish commands are skipped outright and the event's Wait pacing is dropped, so the real logic (switches, sub-events, the heal itself) finishes in a few frames. Using the same skill from the vanilla menu is untouched.
- These suppressions are written to the support log (`off-battle ActSeq suppressed: ...` lines), so remote diagnosis of "the screen still flashes" cases stays easy.

## 1.0.2a.5

- The menu-only whitelist (`EXTRA_ITEM_IDS`) now covers much more than the Cup of Coffee: all sixteen buff potions (Angler's … Rest, Hazard, Blood, Taunting, Soulbargain, Night-Owl, Commerce, Debt, Refuse), the loot containers (coin pouches, gem bags, Treasure Casket, Goodie Bag), the three dice, Stealth Musk, Extra Pouch, Rain Gem, both Bait Packs, Lesser Rune of Growth and the Recall Potion. All of them can be bound and used from the field; battle stays off-limits, exactly like the vanilla menus.
- Scope-less entries (pouches, dice, gems) use a target-less common-event path, so they actually fire from the hotbar instead of being refused.
- Using whitelisted items no longer pops the inventory open afterwards (the game's "Inv Open" helper event is skipped on the hotkey path; menu use still returns to the inventory as before).

## 1.0.2a.4

- Digit keys and the Ctrl modifier are now read from raw keyboard events instead of the game's remappable key map — bindings and loadouts work even if the control config or another plugin rewired the number keys.
- Frame-rate-independent input handling (no behavioral change at any FPS).
- Battle fix: food and user-scope skills (e.g. Lesser Mending) were silently refused when the entry needed no target selection.
- Battle cleanup: the mod no longer prints its own toast/log lines in battle — the engine already announces the action when the turn executes.
- The HUD greys items whose effect would not apply right now (full HP/MP), mirroring the field menu.

## 1.0.2a.3

- Using an entry that reserves a common event no longer rebuilds the map scene — this removes the slow screen re-darkening after each hotkey use.
- Fixed a crash when casting Lesser Mending outside battle (its common event contains battle-only visual commands; those are now safely skipped when not in battle).
- Toasts show a white, fully localized "Used:" / "Equipped:" prefix in every language the game ships.
- Ctrl+digit no longer binds inside the item/skill menus (loadout modifier stays loadout-only).
- Loadout swaps suppress only their own "New Equipment!" popups, leaving unrelated notifications alone.
- Various polish: HUD refreshes on hero change, key badges render only where binding works, missing database entries refuse with a buzzer and a log line.

## 1.0.2a.2

- Initial public release: ten quick-use slots on 1-9 and 0 for consumables, skills and rituals; bind by hovering an entry and pressing a digit; field and battle use; equipment loadouts on Ctrl+digit; bottom-left HUD bar; localized toasts; persistent bindings; always-on support log.
