/*:
 * @target MZ
 * @plugindesc [WTE QoL] Deposit pins: press P on an item to pin it; the chest scene's Deposit All skips pinned items. Deposit All itself also runs on the Inventory hotkey (E/B by default).
 * @author Unvios
 *
 * @help
 * Lets the player pin items in the party inventory so the container scene's
 * "Deposit All" button leaves them alone.
 *
 * Pinning:
 *   Hover an entry in the party inventory list and press P. Works in the
 *   container (chest) scene's right-hand window and in the regular item
 *   menu (Scene_Item). Pressing P again on the same entry unpins it. A pin
 *   covers the whole stack of an item kind; items, weapons and armors are
 *   tracked independently. Pinned entries show a small "P" badge at the
 *   icon's top-left corner in both lists.
 *
 * Effect:
 *   Only the bulk "Deposit All" transfer skips pinned items. Manual single
 *   deposits (and everything else: selling, using, equipping) are unaffected.
 *
 * Deposit All hotkey:
 *   In the container scene the game's Inventory button (E or B by default,
 *   rebindable in the Button Config — the hotkey follows the binding) runs
 *   "Deposit All", so the whole transfer is doable without the mouse. On
 *   the map that button keeps its vanilla behavior (opens the inventory,
 *   common event 313).
 *
 * Pins live on $gameSystem and persist through save/load.
 * No data files are edited. Disabling the mod restores vanilla behavior.
 */

(() => {
    'use strict';

    // ==========================================================================
    // CONFIG (hardcoded — mod plugins are not registered in PluginManager)
    // ==========================================================================

    const CONFIG = {
        SYSTEM_FIELD: '_wteDepositPins',
        PIN_KEY: 'p', // Input button name; keycode 80 registered below
        // Deposit All hotkey — the Input BUTTON name of the game's Inventory
        // custom button (Hendrix_Keyboard_Gamepad "From Key"), default keys
        // E and B. NOT a keycode: rebinding Inventory in the Button Config
        // moves this hotkey with it.
        DEPOSIT_KEY: 'e',
        DEBUG: false, // verbose internals only; operational events always log
        LOG_DIR: 'logs',
        LOG_FILE: 'deposit_pins.log',
    };

    // Keycode 80 (P) is unused by the vanilla MZ key map; register
    // idempotently in case another plugin rebuilds the map before us.
    if (!Input.keyMapper[80]) Input.keyMapper[80] = CONFIG.PIN_KEY;

    // ==========================================================================
    // Logging. Operational events (pin toggles, errors with stacks) are
    // ALWAYS written — that is what makes remote debugging of someone else's
    // install possible. DEBUG only adds verbose internals. The file lives in
    // <game>/mods/WTE_QOL_Deposit/logs/ and is truncated past 1 MiB.
    // ==========================================================================

    const MOD_VERSION = '1.0.2a.2';

    const LOG_PATH = (() => {
        try {
            const path = require('path');
            const root = path.dirname(process.mainModule.filename);
            return path.join(root, 'mods', 'WTE_QOL_Deposit',
                CONFIG.LOG_DIR, CONFIG.LOG_FILE);
        } catch (e) { return null; }
    })();

    let logInitialized = false;

    function writeLog(line) {
        if (!LOG_PATH) return;
        try {
            const fs = require('fs');
            if (!logInitialized) {
                logInitialized = true;
                fs.mkdirSync(require('path').dirname(LOG_PATH), { recursive: true });
                try {
                    if (fs.statSync(LOG_PATH).size > 1024 * 1024) fs.truncateSync(LOG_PATH, 0);
                } catch (e) { /* first run — no file yet */ }
            }
            fs.appendFileSync(LOG_PATH, `${line}\n`);
        } catch (e) { /* logging must never break the game */ }
    }

    const stamp = () => {
        try {
            return new Date().toISOString().replace('T', ' ').slice(0, 19);
        } catch (e) { return ''; }
    };

    const logEvent = (...args) => writeLog(`${stamp()} [DepositPins] ${args.join(' ')}`);

    const log = (...args) => {
        if (!CONFIG.DEBUG) return;
        logEvent('[debug]', ...args);
    };

    // ==========================================================================
    // Pin state — stored on $gameSystem, survives save/load. Entries are
    // "<type>:<id>" strings; type is 'i' (item), 'w' (weapon) or 'a' (armor)
    // via the DataManager predicates, because plain items carry no etypeId.
    // ==========================================================================

    const alias_Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        alias_Game_System_initialize.call(this);
        this[CONFIG.SYSTEM_FIELD] = [];
    };

    function pins() {
        const sys = window.$gameSystem;
        if (!sys) return [];
        if (!Array.isArray(sys[CONFIG.SYSTEM_FIELD])) sys[CONFIG.SYSTEM_FIELD] = [];
        const arr = sys[CONFIG.SYSTEM_FIELD];
        for (let i = arr.length - 1; i >= 0; i--) {
            if (typeof arr[i] !== 'string' || !/^[iwa]:\d+$/.test(arr[i])) arr.splice(i, 1);
        }
        return arr;
    }

    function pinKeyOf(item) {
        if (!item) return null;
        if (DataManager.isItem(item)) return 'i:' + item.id;
        if (DataManager.isWeapon(item)) return 'w:' + item.id;
        if (DataManager.isArmor(item)) return 'a:' + item.id;
        return null;
    }

    function isPinned(item) {
        const key = pinKeyOf(item);
        return key !== null && pins().includes(key);
    }

    function togglePin(item) {
        const key = pinKeyOf(item);
        if (!key) return;
        const arr = pins();
        const at = arr.indexOf(key);
        if (at >= 0) {
            arr.splice(at, 1);
            SoundManager.playCancel();
            logEvent(`unpinned: ${item.name} (${key})`);
        } else {
            arr.push(key);
            SoundManager.playOk();
            logEvent(`pinned: ${item.name} (${key})`);
        }
    }

    // Same dummy filter DM_ContainerUI_Cleanup applies before Deposit All:
    // VisuStella's visual inventory pads its grid with {} / id -999 objects.
    function isValidItem(item) {
        if (!item || typeof item !== 'object') return false;
        if (item.isDummyItem || item.id === -999 || item.itemId === -999) return false;
        const itemName = (item.name || '').trim();
        if (itemName === '' || itemName.toLowerCase() === 'empty') return false;
        return item.id !== undefined || item.itemId !== undefined;
    }

    // ==========================================================================
    // Deposit All hook. The game's handler (DM_ContainerUI_Cleanup,
    // Scene_Container.prototype.onDepositAllOk) snapshots
    // this._itemWindow._data once at the top and refreshes the window (which
    // rebuilds _data) at the end, so temporarily hiding pinned entries from
    // _data for the duration of the call is safe — and far more
    // update-resilient than reimplementing the whole bulk transfer.
    // ==========================================================================

    if (typeof Scene_Container !== 'undefined') {
        const alias_Scene_Container_onDepositAllOk = Scene_Container.prototype.onDepositAllOk;
        Scene_Container.prototype.onDepositAllOk = function () {
            const win = this._itemWindow;
            if (!win || !Array.isArray(win._data) || pins().length === 0) {
                return alias_Scene_Container_onDepositAllOk.call(this);
            }
            const original = win._data;
            const filtered = original.filter(item => !isPinned(item));
            if (filtered.length === original.length) {
                return alias_Scene_Container_onDepositAllOk.call(this);
            }
            log(`Deposit All: hiding ${original.length - filtered.length} pinned entr(y/ies)`);
            win._data = filtered;
            try {
                alias_Scene_Container_onDepositAllOk.call(this);
            } finally {
                win._data = original;
            }
        };
    } else {
        logEvent('WARNING: Scene_Container missing — Deposit All hook not installed');
    }

    // ==========================================================================
    // Pin toggle on P — container scene (right-hand party window only) and
    // the regular item menu.
    // ==========================================================================

    function tryToggleOnWindow(window) {
        if (!window || !window.active) return false;
        if (!Input.isTriggered(CONFIG.PIN_KEY)) return false;
        const item = window.item();
        if (!item || !isValidItem(item) || !pinKeyOf(item)) return false;
        togglePin(item);
        window.refresh(); // show/hide the badge immediately
        return true;
    }

    if (typeof Scene_Container !== 'undefined') {
        const alias_Scene_Container_update = Scene_Container.prototype.update;
        Scene_Container.prototype.update = function () {
            alias_Scene_Container_update.call(this);
            try {
                if (!this.isActive()) return;
                // A quantity popup owns the keyboard; don't steal P from it.
                if (this._itemDepositWindow && this._itemDepositWindow.active) return;
                if (this._itemWithdrawWindow && this._itemWithdrawWindow.active) return;
                if (this._numberWindow && this._numberWindow.active) return;
                tryToggleOnWindow(this._itemWindow);
                tryDepositHotkey(this);
            } catch (e) {
                logEvent('ERROR in Scene_Container pin hook:', e && e.stack ? e.stack : e);
                throw e;
            }
        };
    }

    // The game's Inventory custom button (Hendrix_Keyboard_Gamepad "From Key"
    // 'e', default keys E and B, common event 313) only fires its CE on
    // Scene_Map — in the container scene the button is dead. Listening to
    // the Input BUTTON name (not a keycode) keeps the hotkey following
    // whatever the player rebound Inventory to in the Button Config.
    function tryDepositHotkey(scene) {
        if (!Input.isTriggered(CONFIG.DEPOSIT_KEY)) return;
        if (typeof scene.onDepositAllOk !== 'function') {
            logEvent('deposit hotkey refused: onDepositAllOk missing (DM_ContainerUI_Cleanup absent?)');
            return;
        }
        // Capture the focus owner before the transfer; onDepositAllOk
        // overwrites it at the end.
        const focusWindows = [scene._categoryWindow, scene._sortModeWindow,
            scene._depositAllWindow, scene._containerWindow, scene._itemWindow].filter(Boolean);
        const prevActive = focusWindows.find(w => w.active) || null;
        const prevIndex = prevActive && typeof prevActive.index === 'function' ? prevActive.index() : -1;
        scene.onDepositAllOk(); // skips pinned items via the wrapper above
        // onDepositAllOk always ends by activating the Deposit All button
        // (that is what a mouse click needs). For the keyboard flow that
        // steals navigation from wherever the player was — and stacked on
        // top of the still-active previous window it leaves several cursors
        // visible at once. Restore focus to the window that was active
        // before the transfer (category bar by default), deactivating
        // everything else.
        const win = prevActive && prevActive.parent ? prevActive : scene._itemWindow;
        focusWindows.forEach(w => { if (w && w !== win) w.deactivate(); });
        if (win) {
            win.activate();
            const max = typeof win.maxItems === 'function' ? win.maxItems() : 0;
            if (max > 0) {
                let idx = prevActive === win ? prevIndex : win.index();
                if (idx < 0) idx = 0;
                else if (idx >= max) idx = max - 1;
                win.select(idx);
            } else {
                win.deselect();
            }
        }
        log('Deposit All triggered via hotkey');
    }

    const alias_Scene_Item_update = Scene_Item.prototype.update;
    Scene_Item.prototype.update = function () {
        alias_Scene_Item_update.call(this);
        try {
            tryToggleOnWindow(this._itemWindow);
        } catch (e) {
            logEvent('ERROR in Scene_Item pin hook:', e && e.stack ? e.stack : e);
            throw e;
        }
    };

    // ==========================================================================
    // Pin badge — "P" at the icon's top-left corner (the hotbar mod owns the
    // top-right). While a row is being drawn, every icon blit is captured at
    // the BITMAP level (Bitmap.prototype.blt from the IconSet) — VisuStella's
    // visual inventory renders icons via a scaled contents.blt that bypasses
    // drawIcon, so hooking drawIcon alone left the badge on the fallback
    // math and it drifted. Flags are our own (_wtePinRow/_wtePinRowIcons) so
    // the hotbar's capture (_wteBadgeRow) stays independent.
    // ==========================================================================

    function beginPinRow(window, index) {
        window._wtePinRow = index;
        window._wtePinRowIcons = null;
        if (window.contents) {
            window.contents._wtePinRow = index;
            window.contents._wtePinRowIcons = null;
        }
    }

    function endPinRow(window) {
        window._wtePinRow = null;
        if (window.contents) window.contents._wtePinRow = null;
    }

    function drawPinBadgeAt(window, iconX, iconY) {
        const badgeWidth = 14;
        const prevFontSize = window.contents.fontSize;
        window.changeTextColor(ColorManager.systemColor());
        window.contents.fontSize = 12;
        window.contents.drawText(CONFIG.PIN_KEY.toUpperCase(),
            iconX, iconY, badgeWidth, 13, 'left');
        window.contents.fontSize = prevFontSize;
        window.resetTextColor();
    }

    // Pins live only where pinning actually works: the container scene's
    // party window (not the container's own list) and the regular item menu —
    // not in sell/battle lists.
    function badgeSceneOk(window) {
        const scene = SceneManager._scene;
        if (typeof Scene_Container !== 'undefined' && scene instanceof Scene_Container) {
            return window === scene._itemWindow;
        }
        if (scene instanceof Scene_Item) return window === scene._itemWindow;
        return false;
    }

    function badgeAfterRow(window, index, item) {
        if (!badgeSceneOk(window)) return;
        const icons = window._wtePinRowIcons ||
            (window.contents && window.contents._wtePinRowIcons) || [];
        const pos = icons.find(c => c.iconIndex === item.iconIndex) || icons[0];
        if (pos) {
            drawPinBadgeAt(window, pos.x, pos.y);
        } else {
            const rect = window.itemLineRect(index);
            const iconY = rect.y + (window.lineHeight() - ImageManager.iconHeight) / 2;
            drawPinBadgeAt(window, rect.x, iconY);
        }
    }

    const alias_Window_Base_drawIcon = Window_Base.prototype.drawIcon;
    Window_Base.prototype.drawIcon = function (iconIndex, x, y) {
        if (this._wtePinRow != null) {
            (this._wtePinRowIcons = this._wtePinRowIcons || []).push({ iconIndex, x, y });
        }
        alias_Window_Base_drawIcon.call(this, iconIndex, x, y);
    };

    const alias_Bitmap_blt = Bitmap.prototype.blt;
    Bitmap.prototype.blt = function (source, sx, sy, sw, sh, dx, dy, dw, dh) {
        if (this._wtePinRow != null && source && source.url &&
            source.url.indexOf('IconSet') >= 0 && sw >= 32 && sh >= 32) {
            (this._wtePinRowIcons = this._wtePinRowIcons || []).push({
                iconIndex: (sy / sh) * 16 + (sx / sw),
                x: dx, y: dy,
            });
        }
        alias_Bitmap_blt.call(this, source, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    const alias_Window_ItemList_drawItem = Window_ItemList.prototype.drawItem;
    Window_ItemList.prototype.drawItem = function (index) {
        beginPinRow(this, index);
        try {
            alias_Window_ItemList_drawItem.call(this, index);
        } finally {
            endPinRow(this); // a draw error must not leak the capture flag
        }
        const item = this.itemAt(index);
        if (!item || !isPinned(item)) return;
        badgeAfterRow(this, index, item);
    };

    logEvent(`mod v${MOD_VERSION} loaded`,
        `| pinKey=${CONFIG.PIN_KEY} depositKey=${CONFIG.DEPOSIT_KEY} field=${CONFIG.SYSTEM_FIELD}`,
        `| sceneContainer=${typeof Scene_Container !== 'undefined'}`,
        `| debug=${CONFIG.DEBUG} log=${LOG_PATH || 'unavailable'}`);
})();
