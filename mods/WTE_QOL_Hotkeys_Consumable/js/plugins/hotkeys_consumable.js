/*:
 * @target MZ
 * @plugindesc [WTE QoL] Consumable/skill hotkeys (1-0): bind in menus, use on field/in battle, equipment loadouts on Ctrl+digit, HUD bar, toasts.
 * @author Unvios
 *
 * @help
 * Adds ten quick-use slots bound to number keys 1-9 and 0.
 *
 * Binding:
 *   Items: hover an item in the inventory and press a digit. Skills and
 *   rituals: same, inside the skill menu. Press the same digit on the same
 *   entry to unbind; binding a different entry moves the binding (the old
 *   one is unbound). Items keep the vanilla field rules (key items,
 *   menu-only and dead-ally-target items are refused; menu-only items can
 *   be whitelisted via CONFIG.EXTRA_ITEM_IDS — Cup of Coffee 2043 is by
 *   default). Skills need a real skill type (Ritual/Skill), must not be
 *   "never", and must not target dead allies; scope-less common-event
 *   rituals (Warp) are allowed. Bound entries show their slot digit at the
 *   icon's top-right corner in the lists.
 *
 * Using:
 *   Field: press the digit while the player has free control. Battle: press
 *   the digit while the current actor is awaiting a command — the entry
 *   becomes that actor's action and consumes the turn (skills pay MP).
 *   The engine performs everything, so behavior matches menu usage; a
 *   center-bottom toast (same look as the world item-pickup toast)
 *   announces each use. Skills can only be used by an actor who knows them.
 *
 * Equipment loadouts (plugin WTE_EquipmentLoadouts):
 *   Ctrl + digit on the field applies equipment loadout N (the same logic
 *   as the loadout menu: inventory-verified re-equip of the menu actor) and
 *   shows a toast with the loadout name. Empty loadouts buzz.
 *
 * HUD:
 *   A frameless bar in the top-left screen corner shows each bound slot:
 *   icon, inventory count at the icon's bottom-right (items only) and the
 *   hotkey digit centered under the icon. Out-of-stock items and
 *   unaffordable/unknown skills show greyed. Slots without a binding are
 *   not drawn. The bar follows the global HUD visibility switch.
 *
 * Toasts are prefixed with a localized "Used:" / "Equipped:" string for
 * every language the game ships; the item/skill/loadout name itself is
 * localized from the game database.
 *
 * Bindings live on $gameSystem and persist through save/load.
 * No data files are edited. Disabling the mod restores vanilla behavior.
 */

(() => {
    'use strict';

    // ==========================================================================
    // CONFIG (hardcoded — mod plugins are not registered in PluginManager)
    // ==========================================================================

    const CONFIG = {
        SLOT_KEYS: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        SYSTEM_FIELD: '_wteConsumableHotkeys',
        // Held modifier for equipment loadouts (Input button name).
        LOADOUT_MODIFIER: 'control',
        // Item ids that may be bound even when the game marks them menu-only
        // (occasion 2). Their hotkey use works like menu use on the field.
        // NOTE: the field menu itself greys such items out; whitelisting them
        // here deliberately deviates from that for the hotkey path only.
        // 2043 = Cup of Coffee (the game ships it as menu-only; battle use
        // stays forbidden for it exactly like the vanilla battle menu).
        EXTRA_ITEM_IDS: [2043],
        // Mirrors the world item-pickup toast (data/CommonEvents.json, CE 2838).
        TOAST: {
            WIDTH: 360,
            DISPLAY_TIME: 180, // frames (3 s)
            BACKGROUND_STYLE: 'Dim',
            WINDOWSKIN_TONE: '{"Red":"0","Green":"0","Blue":"0"}',
        },
        // Anchored to the bottom-left screen corner. The top-right is
        // occupied by the SRD HUD Maker Ultra clock/gold cluster; tweak
        // LEFT/BOTTOM if needed. Note: message windows render above the HUD
        // layer, so the bar is hidden behind dialogue text while it is open.
        HUD: {
            SLOT_WIDTH: 40,
            HEIGHT: 52,
            LEFT: 8,   // bar left edge
            BOTTOM: 8, // bar bottom edge = Graphics.height - BOTTOM
            ICON_SIZE: 32,
            FONT_SIZE: 12,
            KEY_ROW: 16,
        },
        DEBUG: false, // verbose internals only; operational events always log
        // Diagnostics live inside this mod's folder so a shared copy of the
        // mod carries its own logs (the folder is git-ignored).
        LOG_DIR: 'logs',
        LOG_FILE: 'hotkeys_consumable.log',
    };

    const SLOT_COUNT = CONFIG.SLOT_KEYS.length;

    // Hendrix_Keyboard_Gamepad already maps digit keys; enforce idempotently
    // in case another plugin rebuilds the key map before us.
    CONFIG.SLOT_KEYS.forEach((key, i) => {
        Input.keyMapper[i === 9 ? 48 : 49 + i] = key; // 1-9 = 49-57, 0 = 48
    });

    // ==========================================================================
    // Logging. Operational events (binds, uses, refusals with reasons,
    // loadouts, errors with stacks) are ALWAYS written — that is what makes
    // remote debugging of someone else's install possible. DEBUG only adds
    // verbose internals. The file lives in <game>/mods/WTE_QOL_Hotkeys_
    // Consumable/logs/ and is truncated once it grows past 1 MiB.
    // ==========================================================================

    const LOG_PATH = (() => {
        try {
            const path = require('path');
            const root = path.dirname(process.mainModule.filename);
            return path.join(root, 'mods', 'WTE_QOL_Hotkeys_Consumable',
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

    const logEvent = (...args) => writeLog(`${stamp()} [HotkeysConsumable] ${args.join(' ')}`);

    const log = (...args) => {
        if (!CONFIG.DEBUG) return;
        logEvent('[debug]', ...args);
    };

    const localize = (text) => {
        if (typeof window.Hendrix_Localization === 'function') return window.Hendrix_Localization(text);
        if (typeof window.translateText === 'function') return window.translateText(text);
        return text;
    };

    // UI prefixes for the use/equip toasts. New strings cannot be added to
    // the game's game_messages.csv (a game file), so per the Coffee mod
    // pattern (docs/localization.md) every shipped language is hardcoded
    // here and picked by ConfigManager.language with an English fallback.
    const TEXTS = {
        used: {
            en: 'Used: ', ru: 'Использовано: ', de: 'Verwendet: ', fr: 'Utilisé : ',
            es: 'Usado: ', br: 'Usado: ', it: 'Usato: ', pl: 'Użyto: ',
            ch: '已使用：', jp: '使用：', ko: '사용: ',
            da: 'Brugt: ', nl: 'Gebruikt: ', fi: 'Käytetty: ', no: 'Brukt: ',
            sv: 'Använt: ', hu: 'Használva: ', cs: 'Použito: ', ro: 'Folosit: ',
            tr: 'Kullanıldı: ', ar: 'مستخدم: ', bg: 'Използвано: ', el: 'Χρησιμοποιήθηκε: ',
            uk: 'Використано: ', vi: 'Đã dùng: ', th: 'ใช้แล้ว: ', id: 'Digunakan: ',
        },
        equipped: {
            en: 'Equipped: ', ru: 'Надето: ', de: 'Angelegt: ', fr: 'Équipé : ',
            es: 'Equipado: ', br: 'Equipado: ', it: 'Equipaggiato: ', pl: 'Założono: ',
            ch: '已装备：', jp: '装備：', ko: '장착: ',
            da: 'Udstyret: ', nl: 'Uitgerust: ', fi: 'Varustettu: ', no: 'Utstyrt: ',
            sv: 'Utrustad: ', hu: 'Felszerelve: ', cs: 'Vybaveno: ', ro: 'Echipat: ',
            tr: 'Kuşanıldı: ', ar: 'مجهز: ', bg: 'Екипирано: ', el: 'Εξοπλίστηκε: ',
            uk: 'Споряджено: ', vi: 'Đã trang bị: ', th: 'สวมใส่แล้ว: ', id: 'Dipakai: ',
        },
    };

    function textFor(key) {
        const lang = (typeof ConfigManager !== 'undefined' && ConfigManager.language) || 'en';
        const table = TEXTS[key];
        return (table && table[lang]) || TEXTS[key].en;
    }

    // ==========================================================================
    // Slot state — stored on $gameSystem, survives save/load. Entries are
    // {t: 'item'|'skill', id} or null; plain numbers from older mod versions
    // are migrated to item entries.
    // ==========================================================================

    const alias_Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function () {
        alias_Game_System_initialize.call(this);
        this[CONFIG.SYSTEM_FIELD] = new Array(SLOT_COUNT).fill(null);
    };

    function slots() {
        const sys = window.$gameSystem;
        if (!sys) return new Array(SLOT_COUNT).fill(null);
        if (!Array.isArray(sys[CONFIG.SYSTEM_FIELD])) sys[CONFIG.SYSTEM_FIELD] = [];
        const arr = sys[CONFIG.SYSTEM_FIELD];
        for (let i = 0; i < arr.length; i++) {
            if (typeof arr[i] === 'number') arr[i] = { t: 'item', id: arr[i] };
        }
        while (arr.length < SLOT_COUNT) arr.push(null);
        if (arr.length > SLOT_COUNT) arr.length = SLOT_COUNT;
        return arr;
    }

    function slotEntry(index) {
        return slots()[index] || null;
    }

    function slotObject(index) {
        const entry = slotEntry(index);
        if (!entry || entry.id <= 0) return null;
        const db = entry.t === 'skill' ? $dataSkills : $dataItems;
        if (typeof db === 'undefined') return null;
        return db[entry.id] || null;
    }

    function slotIndexFor(t, id) {
        const s = slots();
        for (let i = 0; i < SLOT_COUNT; i++) {
            const e = s[i];
            if (e && e.t === t && e.id === id) return i;
        }
        return -1;
    }

    function isBindable(item) {
        if (!item || !DataManager.isItem(item)) return false;
        if (item.itypeId !== 1) return false; // key items cannot be used at all
        if (item.occasion !== 0 && item.occasion !== 1 &&
            !CONFIG.EXTRA_ITEM_IDS.includes(item.id)) return false; // menu-only / never
        // Scopes 9/10/12 involve dead allies — auto-targeting cannot pick them
        // sensibly, so binding is refused rather than wasting the item.
        if (item.scope === 9 || item.scope === 10 || item.scope === 12) return false;
        return true;
    }

    function isSkillBindable(skill) {
        if (!skill || !DataManager.isSkill(skill)) return false;
        if (skill.occasion === 3) return false; // "never"
        if (skill.scope === 9 || skill.scope === 10 || skill.scope === 12) return false;
        // Skills of unnamed ("") types are engine passives/placeholders.
        const typeName = $dataSystem.skillTypes[skill.stypeId];
        if (!typeName) return false;
        return true;
    }

    function bindToggle(index, obj, t) {
        const s = slots();
        const key = CONFIG.SLOT_KEYS[index];
        const cur = s[index];
        if (cur && cur.t === t && cur.id === obj.id) {
            s[index] = null;
            SoundManager.playCancel();
            logEvent(`slot ${key} unbound: ${obj.name} (#${obj.id}, ${t})`);
            return;
        }
        for (let i = 0; i < SLOT_COUNT; i++) {
            const e = s[i];
            if (e && e.t === t && e.id === obj.id) s[i] = null;
        }
        s[index] = { t, id: obj.id };
        SoundManager.playOk();
        logEvent(`slot ${key} bound: ${obj.name} (#${obj.id}, ${t})`);
    }

    // ==========================================================================
    // Binding UI — hover an entry and press a digit.
    // ==========================================================================

    const alias_Scene_Item_update = Scene_Item.prototype.update;
    Scene_Item.prototype.update = function () {
        alias_Scene_Item_update.call(this);
        try {
            if (!this._itemWindow || !this._itemWindow.active) return;
            for (let i = 0; i < SLOT_COUNT; i++) {
                if (Input.isTriggered(CONFIG.SLOT_KEYS[i])) {
                    const item = this._itemWindow.item();
                    if (!item) return;
                    if (!isBindable(item)) {
                        SoundManager.playBuzzer();
                        logEvent(`bind refused: ${item.name} (#${item.id})`,
                            `itype=${item.itypeId} occasion=${item.occasion}`,
                            `scope=${item.scope}`,
                            `whitelisted=${CONFIG.EXTRA_ITEM_IDS.includes(item.id)}`);
                        return;
                    }
                    bindToggle(i, item, 'item');
                    this._itemWindow.refresh(); // show the badge immediately
                    return;
                }
            }
        } catch (e) {
            logEvent('ERROR in Scene_Item bind hook:', e && e.stack ? e.stack : e);
            throw e;
        }
    };

    const alias_Scene_Skill_update = Scene_Skill.prototype.update;
    Scene_Skill.prototype.update = function () {
        alias_Scene_Skill_update.call(this);
        try {
            if (!this._itemWindow || !this._itemWindow.active) return;
            for (let i = 0; i < SLOT_COUNT; i++) {
                if (Input.isTriggered(CONFIG.SLOT_KEYS[i])) {
                    const skill = this._itemWindow.item();
                    if (!skill) return;
                    if (!isSkillBindable(skill)) {
                        SoundManager.playBuzzer();
                        logEvent(`bind refused: ${skill.name} (#${skill.id})`,
                            `occasion=${skill.occasion} scope=${skill.scope}`,
                            `stype=${skill.stypeId}("${$dataSystem.skillTypes[skill.stypeId]}")`);
                        return;
                    }
                    bindToggle(i, skill, 'skill');
                    this._itemWindow.refresh();
                    return;
                }
            }
        } catch (e) {
            logEvent('ERROR in Scene_Skill bind hook:', e && e.stack ? e.stack : e);
            throw e;
        }
    };

    // Slot digit at the icon's top-right corner. While a row is being drawn,
    // every icon blit is captured at the BITMAP level (Bitmap.prototype.blt
    // from the IconSet) — VisuStella's visual inventory renders icons via a
    // scaled contents.blt that bypasses drawIcon, so hooking drawIcon alone
    // left the badge on the fallback math and it drifted. The entry's icon is
    // the captured blit matching its iconIndex (else the first blit of the
    // row); if nothing was captured, the vanilla rect formula is the last
    // resort. Captures carry the drawn width, so the badge hugs the actual
    // icon edge even when icons are scaled up.
    function beginBadgeRow(window, index) {
        window._wteBadgeRow = index;
        window._wteRowIcons = null;
        if (window.contents) {
            window.contents._wteBadgeRow = index;
            window.contents._wteRowIcons = null;
        }
    }

    function endBadgeRow(window) {
        window._wteBadgeRow = null;
        if (window.contents) window.contents._wteBadgeRow = null;
    }

    function drawSlotBadgeAt(window, iconX, iconY, iconW, slotIndex) {
        const badgeWidth = 14;
        window.changeTextColor(ColorManager.systemColor());
        window.contents.fontSize = 12;
        window.contents.drawText(CONFIG.SLOT_KEYS[slotIndex],
            iconX + iconW - badgeWidth, iconY, badgeWidth, 13, 'right');
        window.contents.fontSize = $gameSystem.mainFontSize();
        window.resetTextColor();
    }

    function badgeAfterRow(window, index, obj, t) {
        const slotIndex = slotIndexFor(t, obj.id);
        if (slotIndex < 0) return;
        const icons = window._wteRowIcons ||
            (window.contents && window.contents._wteRowIcons) || [];
        const pos = icons.find(c => c.iconIndex === obj.iconIndex) || icons[0];
        if (pos) {
            drawSlotBadgeAt(window, pos.x, pos.y, pos.w || ImageManager.iconWidth, slotIndex);
        } else {
            const rect = window.itemLineRect(index);
            const iconY = rect.y + (window.lineHeight() - ImageManager.iconHeight) / 2;
            drawSlotBadgeAt(window, rect.x, iconY, ImageManager.iconWidth, slotIndex);
        }
    }

    const alias_Window_Base_drawIcon = Window_Base.prototype.drawIcon;
    Window_Base.prototype.drawIcon = function (iconIndex, x, y) {
        if (this._wteBadgeRow != null) {
            (this._wteRowIcons = this._wteRowIcons || []).push({ iconIndex, x, y });
        }
        alias_Window_Base_drawIcon.call(this, iconIndex, x, y);
    };

    const alias_Bitmap_blt = Bitmap.prototype.blt;
    Bitmap.prototype.blt = function (source, sx, sy, sw, sh, dx, dy, dw, dh) {
        if (this._wteBadgeRow != null && source && source.url &&
            source.url.indexOf('IconSet') >= 0 && sw >= 32 && sh >= 32) {
            (this._wteRowIcons = this._wteRowIcons || []).push({
                iconIndex: (sy / sh) * 16 + (sx / sw),
                x: dx, y: dy, w: dw,
            });
        }
        alias_Bitmap_blt.call(this, source, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    const alias_Window_ItemList_drawItem = Window_ItemList.prototype.drawItem;
    Window_ItemList.prototype.drawItem = function (index) {
        beginBadgeRow(this, index);
        alias_Window_ItemList_drawItem.call(this, index);
        endBadgeRow(this);
        const item = this.itemAt(index);
        if (!item || !DataManager.isItem(item)) return; // dummies, weapons, armors
        badgeAfterRow(this, index, item, 'item');
    };

    const alias_Window_SkillList_drawItem = Window_SkillList.prototype.drawItem;
    Window_SkillList.prototype.drawItem = function (index) {
        beginBadgeRow(this, index);
        alias_Window_SkillList_drawItem.call(this, index);
        endBadgeRow(this);
        const skill = this.itemAt(index);
        if (!skill || !DataManager.isSkill(skill)) return;
        badgeAfterRow(this, index, skill, 'skill');
    };

    // ==========================================================================
    // Using a bound entry
    // ==========================================================================

    function hotkeyUser() {
        // Same actor the vanilla item menu would use: the first movable party
        // member with the highest pha (in practice the leader).
        return Scene_Item.prototype.user();
    }

    function hotkeySkillUser() {
        // Same actor the skill menu would use: the current menu actor.
        return $gameParty.menuActor();
    }

    function targetsForAction(action, user) {
        // Mirror of Scene_ItemBase.prototype.itemTargetActors with the hotkey
        // user standing in for the actor-window selection.
        if (!action.isForFriend()) return [];
        if (action.isForAll()) return $gameParty.members();
        return [user];
    }

    function occasionOkForHotkey(item) {
        // Vanilla isOccasionOk, plus whitelisted menu-only items on the field
        // (they are usable from the menu, so the hotkey mirrors that).
        if (item.occasion === 0) return true;
        return item.occasion === 2 && CONFIG.EXTRA_ITEM_IDS.includes(item.id);
    }

    function useItemOnMap(item) {
        if (!item) return;
        const user = hotkeyUser();
        if (!user) {
            SoundManager.playBuzzer();
            logEvent('map use refused: no usable party member (user=null)');
            return;
        }
        // Replicates Scene_ItemBase.prototype.canUse + useItem/applyItem so
        // availability, effects, consumption, common events and gameover
        // behave exactly like the field item menu (occasion check relaxed
        // only for CONFIG.EXTRA_ITEM_IDS).
        const action = new Game_Action(user);
        action.setItemObject(item);
        const targets = targetsForAction(action, user);
        const usable = user.canMove() && $gameParty.hasItem(item) &&
            occasionOkForHotkey(item) && action.isForFriend() &&
            targets.some(target => action.testApply(target));
        if (!usable) {
            SoundManager.playBuzzer();
            logEvent(`map use refused: ${item.name} (#${item.id})`,
                `stock=${$gameParty.numItems(item)} occasion=${item.occasion}`,
                `canMove=${user.canMove()} forFriend=${action.isForFriend()}`,
                `applies=[${targets.map(t => action.testApply(t)).join(',')}]`,
                `whitelisted=${CONFIG.EXTRA_ITEM_IDS.includes(item.id)}`);
            return;
        }
        SoundManager.playUseItem();
        applyEntry(user, action, targets, item);
    }

    function useSkillOnMap(skill) {
        if (!skill) return;
        const user = hotkeySkillUser();
        const known = !!(user && user.hasSkill(skill.id));
        const canUse = !!(user && user.canUse(skill));
        if (!user || !known || !canUse) {
            SoundManager.playBuzzer();
            logEvent(`map skill refused: ${skill.name} (#${skill.id})`,
                `user=${user ? user.name() : 'null'} hasSkill=${known}`,
                `canUse=${canUse} occasion=${skill.occasion}`,
                `mp=${user ? `${user.mp}/${user.mmp}` : '-'} cost=${skill.mpCost}`);
            return;
        }
        const action = new Game_Action(user);
        action.setItemObject(skill);
        const targets = targetsForAction(action, user);
        let usable;
        if (action.isForFriend()) {
            usable = targets.some(target => action.testApply(target));
        } else if (action.isForOpponent()) {
            usable = false; // no manual enemy targeting on the field, like the menu
        } else {
            usable = skill.effects.length > 0; // scope-less rituals (Warp: common event)
        }
        if (!usable) {
            SoundManager.playBuzzer();
            logEvent(`map skill refused: ${skill.name} (#${skill.id})`,
                `forFriend=${action.isForFriend()} forOpponent=${action.isForOpponent()}`,
                `scope=${skill.scope} effects=${skill.effects.length}`,
                `applies=[${targets.map(t => action.testApply(t)).join(',')}]`);
            return;
        }
        SoundManager.playUseSkill();
        applyEntry(user, action, targets, skill);
    }

    // Shared tail of map usage: effects, global effects (incl. common
    // events), toast and gameover check. A reserved common event starts on
    // the map interpreter by itself — restarting Scene_Map (vanilla's
    // checkCommonEvent does SceneManager.goto from menu scenes) would just
    // trigger fade/loading plugins, so it is skipped when already on the map.
    function applyEntry(user, action, targets, obj) {
        user.useItem(obj);
        for (const target of targets) {
            for (let i = 0; i < action.numRepeats(); i++) {
                action.apply(target);
            }
        }
        action.applyGlobal();
        showUseToast(obj);
        logEvent(`used on map: ${obj.name} (#${obj.id}), left: ${$gameParty.numItems(obj)}`);
        log(`CE reserved: ${$gameTemp.isCommonEventReserved()}, scene: ${SceneManager._scene.constructor.name}`);
        if ($gameTemp.isCommonEventReserved() && !(SceneManager._scene instanceof Scene_Map)) {
            SceneManager.goto(Scene_Map);
        }
        if ($gameParty.isAllDead()) {
            SceneManager.goto(Scene_Gameover);
        }
    }

    // ==========================================================================
    // Equipment loadouts (WTE_EquipmentLoadouts) — Ctrl+digit on the field.
    // Replicates Scene_Equip.prototype.onLoadoutEquip's logic for the menu
    // actor without any of the scene UI.
    // ==========================================================================

    // The game announces equipment changes with MK_GabWindows gab windows
    // (CE 2233 "New Equipment!" / CE 2234 "New Weapon!", top-left anchor)
    // fired via DM_InvChangeCommonEvent after any equip change. During a
    // hotkey loadout swap those are noise next to our named toast, so they
    // are dropped for a few frames (the reserved CE runs on the map
    // interpreter slightly after applyLoadout returns).
    let suppressEquipGabs = 0;

    const alias_PluginManager_callCommand = PluginManager.callCommand;
    PluginManager.callCommand = function (interpreter, pluginName, commandName, args) {
        if (suppressEquipGabs > 0 && pluginName === 'MK_GabWindows' && commandName === 'addGabWindow') {
            log('suppressed equip gab window');
            return;
        }
        alias_PluginManager_callCommand.call(this, interpreter, pluginName, commandName, args);
    };

    function applyLoadout(index) {
        const keyLabel = CONFIG.SLOT_KEYS[index];
        if (typeof $gameSystem.initEquipLoadouts === 'function') {
            $gameSystem.initEquipLoadouts();
        }
        const loadouts = $gameSystem._equipLoadouts;
        const actor = $gameParty.menuActor();
        const loadout = loadouts && loadouts[index];
        if (!actor || !loadout || !loadout.equips) {
            SoundManager.playBuzzer();
            logEvent(`loadout ${keyLabel} refused: actor=${actor ? actor.name() : 'null'}`,
                `exists=${!!loadout} saved=${!!(loadout && loadout.equips)}`);
            return;
        }
        suppressEquipGabs = 120;
        const preHp = actor.hp;
        const preMp = actor.mp;
        for (let i = 0; i < actor.equipSlots().length; i++) {
            actor.changeEquip(i, null);
        }
        let toastIcon = 0;
        for (let i = 0; i < loadout.equips.length; i++) {
            const saved = loadout.equips[i];
            if (!saved) continue;
            const base = saved.isWeapon ? $dataWeapons[saved.id] : $dataArmors[saved.id];
            if (base && $gameParty.hasItem(base)) {
                actor.changeEquip(i, base);
                if (!toastIcon) toastIcon = base.iconIndex;
            } else {
                logEvent(`loadout ${keyLabel}: slot ${i} "${saved.isWeapon ? 'weapon' : 'armor'} #${saved.id}"`,
                    base ? 'not in inventory' : 'missing from database');
            }
        }
        actor._hp = Math.min(preHp, actor.mhp);
        actor._mp = Math.min(preMp, actor.mmp);
        actor.refresh();
        SoundManager.playEquip();
        showIconToast(toastIcon, textFor('equipped') + localize(loadout.name));
        logEvent(`loadout ${keyLabel} "${loadout.name}" applied to ${actor.name()}`);
    }

    const alias_Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function () {
        alias_Scene_Map_update.call(this);
        try {
            if (this._wteHotkeyHud) this._wteHotkeyHud.updateHud();
            if (suppressEquipGabs > 0) suppressEquipGabs--;
            if (!$gamePlayer.canMove()) return; // no hotkeys during messages/events
            if (Input.isPressed(CONFIG.LOADOUT_MODIFIER)) {
                for (let i = 0; i < SLOT_COUNT; i++) {
                    if (Input.isTriggered(CONFIG.SLOT_KEYS[i])) {
                        applyLoadout(i);
                        return;
                    }
                }
                return; // modifier held: digits mean loadouts, not consumption
            }
            for (let i = 0; i < SLOT_COUNT; i++) {
                if (Input.isTriggered(CONFIG.SLOT_KEYS[i])) {
                    const entry = slotEntry(i);
                    if (!entry) return;
                    if (entry.t === 'skill') useSkillOnMap(slotObject(i));
                    else useItemOnMap(slotObject(i));
                    return;
                }
            }
        } catch (e) {
            logEvent('ERROR in Scene_Map hotkey hook:', e && e.stack ? e.stack : e);
            throw e;
        }
    };

    // ==========================================================================
    // Battle usage — the entry becomes the inputting actor's action and the
    // engine performs it (costs, log line, effects) like a menu choice.
    // ==========================================================================

    function useItemInBattle(item, actor, action) {
        if (!item) return;
        if (!actor || !actor.canUse(item)) {
            SoundManager.playBuzzer();
            logEvent(`battle use refused: ${item ? item.name : 'none'}`,
                `actor=${actor ? actor.name() : 'null'}`,
                `canUse=${actor ? actor.canUse(item) : '-'}`,
                item ? `stock=${$gameParty.numItems(item)} occasion=${item.occasion}` : '');
            return;
        }
        action.setItem(item.id);
        $gameParty.setLastItem(item);
        if (!pickTarget(action, actor)) return; // already buzzed, action cleared
        SoundManager.playOk();
        showUseToast(item);
        logEvent(`used in battle: ${item.name} (#${item.id}) by ${actor.name()}`);
        SceneManager._scene.selectNextCommand();
    }

    function useSkillInBattle(skill, actor, action) {
        if (!skill) return;
        if (!actor || !actor.hasSkill(skill.id) || !actor.canUse(skill)) {
            SoundManager.playBuzzer();
            logEvent(`battle skill refused: ${skill ? skill.name : 'none'}`,
                `actor=${actor ? actor.name() : 'null'}`,
                `hasSkill=${actor ? actor.hasSkill(skill.id) : '-'}`,
                `canUse=${actor ? actor.canUse(skill) : '-'}`,
                skill ? `mp=${actor ? actor.mp : '-'}/${actor ? actor.mmp : '-'} cost=${skill.mpCost}` : '');
            return;
        }
        action.setSkill(skill.id);
        $gameParty.setLastItem(skill);
        if (!pickTarget(action, actor)) return; // already buzzed, action cleared
        SoundManager.playOk();
        showUseToast(skill);
        logEvent(`used in battle: ${skill.name} (#${skill.id}) by ${actor.name()}`);
        SceneManager._scene.selectNextCommand();
    }

    // Same choice Scene_Battle.onSelectAction would ask for, made
    // automatically: opponents -> first alive enemy, one ally -> the actor.
    function pickTarget(action, actor) {
        if (!action.needsSelection()) return;
        if (action.isForOpponent()) {
            const target = $gameTroop.aliveMembers()[0];
            if (!target) {
                action.clear();
                SoundManager.playBuzzer();
                logEvent('battle use refused: no alive enemy to target');
                return false;
            }
            action.setTarget(target.index());
        } else {
            action.setTarget($gameParty.battleMembers().indexOf(actor));
        }
        return true;
    }

    const alias_Scene_Battle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function () {
        alias_Scene_Battle_update.call(this);
        try {
            if (!BattleManager.isInputting()) return;
            const actor = BattleManager.actor();
            if (!actor) return;
            const action = BattleManager.inputtingAction();
            // A fresh inputting action has no item yet; once a skill/item is
            // chosen (target selection open) the digits must not hijack it.
            if (!action || action.item()) return;
            if (Input.isPressed(CONFIG.LOADOUT_MODIFIER)) return; // no equip swaps in battle
            for (let i = 0; i < SLOT_COUNT; i++) {
                if (Input.isTriggered(CONFIG.SLOT_KEYS[i])) {
                    const entry = slotEntry(i);
                    if (!entry) return;
                    if (entry.t === 'skill') useSkillInBattle(slotObject(i), actor, action);
                    else useItemInBattle(slotObject(i), actor, action);
                    return;
                }
            }
        } catch (e) {
            logEvent('ERROR in Scene_Battle hotkey hook:', e && e.stack ? e.stack : e);
            throw e;
        }
    };

    // ==========================================================================
    // Use toast — same look as the world item-pickup toast (CE 2838), but the
    // wording is just the entry itself (no stored game strings; the name is
    // localized from the database at show time).
    // ==========================================================================

    function showUseToast(obj) {
        showIconToast(obj.iconIndex, textFor('used') + localize(obj.name));
    }

    function showIconToast(iconIndex, text) {
        if (typeof $cgmzTemp === 'undefined' || !$cgmzTemp ||
            typeof $cgmzTemp.createNewToast !== 'function') return;
        const icon = iconIndex ? `\\i[${iconIndex}]` : '';
        $cgmzTemp.createNewToast({
            isText: true,
            lineOne: `\\C[6]${icon}${text}\\C[0]`,
            lineOneColor: 0,
            lineOneAlignment: 'center',
            lineTwo: '',
            lineTwoColor: 0,
            lineTwoAlignment: 'center',
            height: 1,
            width: CONFIG.TOAST.WIDTH,
            displayTime: CONFIG.TOAST.DISPLAY_TIME,
            backgroundStyle: CONFIG.TOAST.BACKGROUND_STYLE,
            windowskinTone: CONFIG.TOAST.WINDOWSKIN_TONE,
            windowskin: '',
        });
    }

    // ==========================================================================
    // HUD bar in the top-right screen corner (Scene_Map only). Implemented as
    // a plain Sprite inside SRD HUD Maker Ultra's `_ultraHudContainer`, so it
    // lives in the exact same coordinate space as the gold counter and the
    // clock (windowLayer positioning proved unreliable in this build).
    // ==========================================================================

    function slotStateSig(entry) {
        if (entry.t === 'item') {
            return String($gameParty.numItems($dataItems[entry.id]));
        }
        const user = $gameParty.menuActor();
        return (user && user.hasSkill(entry.id) && user.canUse($dataSkills[entry.id])) ? '1' : '0';
    }

    function buildHudSignature() {
        let sig = '';
        const s = slots();
        for (let i = 0; i < SLOT_COUNT; i++) {
            const entry = s[i];
            sig += entry ? `${entry.t}${entry.id}:${slotStateSig(entry)}|` : '-|';
        }
        sig += hudAllowed() ? 'shown' : 'hidden';
        return sig;
    }

    function hudAllowed() {
        return !(typeof $gameUltraHUD !== 'undefined' && $gameUltraHUD &&
            $gameUltraHUD.globalVisibility === false);
    }

    function WTE_HotkeyHudSprite() {
        this.initialize(...arguments);
    }

    WTE_HotkeyHudSprite.prototype = Object.create(Sprite.prototype);
    WTE_HotkeyHudSprite.prototype.constructor = WTE_HotkeyHudSprite;

    WTE_HotkeyHudSprite.prototype.initialize = function () {
        Sprite.prototype.initialize.call(this);
        this.bitmap = new Bitmap(CONFIG.HUD.SLOT_WIDTH * SLOT_COUNT, CONFIG.HUD.HEIGHT);
        this._signature = null;
        this.updatePosition();
        this.refresh();
    };

    WTE_HotkeyHudSprite.prototype.updatePosition = function () {
        this.x = CONFIG.HUD.LEFT;
        this.y = Graphics.height - CONFIG.HUD.BOTTOM - this.bitmap.height;
    };

    // Driven manually from the Scene_Map update alias (the UltraHUD container
    // does not cascade updates to its children).
    WTE_HotkeyHudSprite.prototype.updateHud = function () {
        if (this._broken) return; // a logged error disabled the HUD for this scene
        try {
            this.updatePosition();
            const signature = buildHudSignature();
            if (signature !== this._signature) {
                this._signature = signature;
                this.refresh();
            }
        } catch (e) {
            this._broken = true;
            logEvent('ERROR in HUD update (HUD disabled for this scene):',
                e && e.stack ? e.stack : e);
        }
    };

    WTE_HotkeyHudSprite.prototype.refresh = function () {
        const bmp = this.bitmap;
        bmp.clear();
        bmp.fontSize = CONFIG.HUD.FONT_SIZE;
        bmp.textColor = ColorManager.normalColor();
        const s = slots();
        let anyBound = false;
        for (let i = 0; i < SLOT_COUNT; i++) {
            const entry = s[i];
            const obj = entry ? slotObject(i) : null;
            if (!obj) continue;
            anyBound = true;
            const cx = i * CONFIG.HUD.SLOT_WIDTH;
            const iconX = cx + (CONFIG.HUD.SLOT_WIDTH - CONFIG.HUD.ICON_SIZE) / 2;
            const iconY = 2;
            let enabled = true;
            if (entry.t === 'item') {
                enabled = $gameParty.numItems(obj) > 0;
            } else {
                const user = $gameParty.menuActor();
                enabled = !!(user && user.hasSkill(obj.id) && user.canUse(obj));
            }
            bmp.paintOpacity = enabled ? 255 : 160; // grey when unusable
            this.blitIcon(bmp, obj.iconIndex, iconX, iconY);
            bmp.paintOpacity = 255;
            // stack count at the icon's bottom-right corner (items only)
            if (entry.t === 'item') {
                bmp.drawText('x' + $gameParty.numItems(obj),
                    iconX + CONFIG.HUD.ICON_SIZE - 22, iconY + CONFIG.HUD.ICON_SIZE - 13, 22, 13, 'right');
            }
            // hotkey digit centered under the icon
            bmp.textColor = ColorManager.systemColor();
            bmp.drawText(CONFIG.SLOT_KEYS[i], cx, iconY + CONFIG.HUD.ICON_SIZE + 1,
                CONFIG.HUD.SLOT_WIDTH, CONFIG.HUD.KEY_ROW, 'center');
            bmp.textColor = ColorManager.normalColor();
        }
        this.visible = anyBound && hudAllowed();
    };

    WTE_HotkeyHudSprite.prototype.blitIcon = function (bmp, iconIndex, x, y) {
        const sheet = ImageManager.loadSystem('IconSet');
        const pw = ImageManager.iconWidth;
        const ph = ImageManager.iconHeight;
        const sx = (iconIndex % 16) * pw;
        const sy = Math.floor(iconIndex / 16) * ph;
        if (sheet.isReady()) {
            bmp.blt(sheet, sx, sy, pw, ph, x, y);
        } else {
            sheet.addLoadListener(() => this.refresh());
        }
    };

    const alias_Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function () {
        alias_Scene_Map_createAllWindows.call(this);
        if (this._ultraHudContainer) {
            this._wteHotkeyHud = new WTE_HotkeyHudSprite();
            this._ultraHudContainer.addChild(this._wteHotkeyHud);
        } else {
            logEvent('WARNING: _ultraHudContainer missing — HUD not created');
        }
    };

    logEvent(`loaded: slots=${SLOT_COUNT} keys=${CONFIG.SLOT_KEYS.join('')} ` +
        `modifier=${CONFIG.LOADOUT_MODIFIER} extraItemIds=[${CONFIG.EXTRA_ITEM_IDS}] ` +
        `debug=${CONFIG.DEBUG} log=${LOG_PATH || 'unavailable'}`);
})();
