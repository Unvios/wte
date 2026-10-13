# Changelog — WTE_QOL_Deposit

Versioning: `<game version>.<mod revision>`.

## 1.0.2a.2

- Fixed the Deposit All hotkey (E/B) stealing the menu selection: after the transfer the focus now returns to the window that was active before (the category bar by default) instead of jumping to the "Deposit All" button, and no phantom cursors are left on several windows at once.

## 1.0.2a.1

- Initial public release: pin items in the party inventory (hover + P, works in the chest scene and the regular item menu) so the chest scene's "Deposit All" leaves them in your inventory.
- Pinned entries show a small "P" badge at the icon's top-left corner in both lists.
- Pins cover the whole stack of an item kind and persist through save/load; manual single deposits are unaffected.
- Deposit All also runs on the game's Inventory button (E/B by default, follows the Button Config binding) when a chest is open — no mouse needed.
