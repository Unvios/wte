# Changelog — WTE_QOL_Loot_Toasts

Versioning: `<game version>.<mod revision>`.

## 1.0.4d.2

- Added full metadata for the official Mods menu: the mod now displays its supported game version, mod version and language support instead of an unknown game version.
- Installation now uses the built-in Mods menu for verification; no manual `js/plugins.js` edit is needed on the current game version.

## 1.0.4d.1

- Updated for the overhauled post-battle loot sequence in Welcome to Elderfield 1.0.4d. Both the new dedicated loot-roll scene and the legacy message-based flow are supported.
- The new loot scene is skipped entirely: items, EXP and gold appear in the usual non-blocking toasts, and control returns immediately without holding OK, tapping through the roll or closing the scene.
- The summary toast shows the correct rolled die face under the new system, including roll modifiers. Weapon and armor drops keep their localized names and icons through the new loot queue.
- The new mangled-corpse notification is hidden as well, so battles without loot still produce only the EXP summary.

## 1.0.2a.2

- Battle-intro filtering is now limited to actual appearance/attack announcements on the opening turn. Unrelated battle messages, including messages later in a fight, remain visible.
- Special-drop tracking is reset between battles, preventing stale drop information from leaking into a later result.
- Support logging now rotates during long play sessions as well as on startup, while retaining version and diagnostic information.

## 1.0.2a.1

- Initial public release: post-battle items, EXP and gold are shown as non-blocking toasts instead of a sequence of message windows.
- A top summary toast combines the actual rolled die face, earned EXP and gold; item toasts show localized names, icons and stack counts.
- Combat shrine rewards have gold-tinted frames and are grouped below regular drops. Up to seven toasts can be visible, and a new battle replaces the previous battle's loot notifications.
- Battle-start announcements, corpse messages, the Victory window and the blocking die-roll animation are skipped.
- No game data files are edited. An always-on support log is included for troubleshooting.
