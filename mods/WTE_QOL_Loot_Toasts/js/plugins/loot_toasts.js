/*:
 * @target MZ
 * @plugindesc [WTE QoL] Post-battle loot messages become non-blocking toasts.
 * @author Unvios
 *
 * @help
 * After every battle, common event 27 ("Battle Win") checks whether the corpse
 * is intact, rolls the die and hands out loot through ~40 loot table common
 * events. Every step blocks player input with message windows: corpse text, a
 * hidden pause on the die face, then one window per obtained item.
 *
 * This plugin converts that event chain into CGMZ toasts (right side of the
 * screen, stacked upward from the bottom like the game's own toasts,
 * auto-fade), so control returns immediately after the roll. What you see:
 *   - die roll:     a free-floating popup at the bottom center of the screen
 *                   with just the die face picture (outside the 3-slot CGMZ
 *                   queue, so it can never be pushed out by a long loot list);
 *   - item drops:   icon + localized item name (+ xN when more than one);
 *   - gold:         coin icon + amount;
 *   - combat shrine bonus loot: same toasts, prefixed with a Combat Offering
 *                   icon (the "The combat shrine rewards you..." wording is
 *                   dropped entirely).
 * The "Victory!" window is skipped too; the earned EXP shows up as one last
 * toast ("N EXP" in the game's own terms) after the loot toasts.
 * The "Obtained …" wording is dropped in every language — the strings are
 * rebuilt from the game data instead of being reworded, so localization comes
 * from the item database for free. The corpse state texts, the battle start
 * announcements ("A Rat appears!") and the die roll animation (CE 28:
 * tumbling d1-d6 pictures with frame waits that freeze the player) are all
 * skipped entirely.
 *
 * No data files are edited. Disabling the mod restores 100% vanilla behavior.
 */

(() => {
    'use strict';

    const CONFIG = {
        BATTLE_WIN_CE_ID: 27,                       // reserved after each battle (CGMZ_BattleResultEvents)
        DICE_ANIMATION_CE_ID: 28,                   // "Dice Roll Effect": tumbling d1-d6 on pictures 9/10 + frame waits
        DICE_FACE_CE_IDS: [29, 30, 31, 32, 33, 34], // "Dice Result 1..6"; their empty pause message marks the roll
        SUPPRESSED_PICTURES: [5, 11, 12],           // Obj_DEATHLOOT icon, final die face, luck banner
        SUPPRESSED_TEXTS: [                         // corpse state texts — no toast, no window
            'The corpse is still relatively intact.',
            'You search it for loot...',
            'The corpse was too mangled to search for loot...',
        ],
        REMOVE_BATTLE_START_MESSAGES: true,         // skip troop "A Rat appears!" announcements
        VICTORY_EXP_TOAST: true,                    // skip "Victory!" window; show earned EXP as a toast
        SHRINE_REWARD_TEXT: 'The combat shrine rewards you...', // combat shrine bonus loot announcement
        SHRINE_MARKER_ICON: 2311,                   // Combat Offering icon: prefixes bonus loot toasts
        TOAST_DISPLAY_TIME: 240,                    // frames (4 s) per loot toast
        TOAST_WIDTH: 380,
        RIGHT_MARGIN: 8,
        SHOW_DIE_POPUP: true,
        DIE_POPUP_SIZE: 72,                         // px; source art is 100x100
        DIE_POPUP_DURATION: 180,                    // frames (3 s) after fade-in
        DIE_POPUP_Y: 0,                             // offset up from the bottom; 0 = flush with the loot toasts
        DEBUG: false,
        DEBUG_FORCE_SHRINE: false,                 // test helper: mark every drop as shrine loot
        LOG_FILE: 'loot_toasts_debug.log',          // console is unavailable in this build; DEBUG writes here
    };

    // Raw event strings (byte-exact) that we replace with rebuilt, word-free text.
    const RAW_ITEM_XN = 'Obtained \\C[6]\\ii[\\V[30]] \\C[0]x\\V[31]';
    const RAW_ITEM = 'Obtained \\C[6]\\ii[\\V[30]]';
    const RAW_GOLD = 'Obtained \\i[314]\\c[14]\\v[1039]\\c[0]!';

    const log = (...args) => {
        if (!CONFIG.DEBUG) return;
        const line = `[LootToasts] ${args.join(' ')}`;
        try {
            console.log(line);
            require('fs').appendFileSync(CONFIG.LOG_FILE, `${line}\n`);
        } catch (e) { /* logging must never break the game */ }
    };

    const localize = (text) => {
        if (typeof window.Hendrix_Localization === 'function') return window.Hendrix_Localization(text);
        if (typeof window.translateText === 'function') return window.translateText(text);
        return text;
    };

    // ==========================================================================
    // Loot flow detection: CE 27 anywhere in the map interpreter chain.
    // Reserved common events run on $gameMap._interpreter; nested "Call Common
    // Event" commands become _childInterpreter. Comparing list references means
    // newly added loot tables are covered automatically, and a game update that
    // renumbers the event simply makes the check never fire (vanilla behavior).
    // ==========================================================================

    function isLootFlow() {
        const ce27 = $dataCommonEvents[CONFIG.BATTLE_WIN_CE_ID];
        if (!ce27 || !ce27.list) return false;
        if (typeof $gameMap === 'undefined' || !$gameMap || !$gameMap._interpreter) return false;
        for (let interp = $gameMap._interpreter; interp; interp = interp._childInterpreter) {
            if (interp._list === ce27.list) return true;
        }
        return false;
    }

    function diceFaceOfList(list) {
        for (let i = 0; i < CONFIG.DICE_FACE_CE_IDS.length; i++) {
            const ce = $dataCommonEvents[CONFIG.DICE_FACE_CE_IDS[i]];
            if (ce && ce.list === list) return i + 1;
        }
        return 0;
    }

    // ==========================================================================
    // Vanilla message routine, replicated (face/background/choices included) so
    // consumed 401 lines can still reach the message window when needed.
    // ==========================================================================

    function collectTextLines(interpreter) {
        const lines = [];
        while (interpreter.nextEventCode() === 401) {
            interpreter._index++;
            lines.push(interpreter.currentCommand().parameters[0]);
        }
        return lines;
    }

    function showVanillaMessage(interpreter, params, lines) {
        $gameMessage.setFaceImage(params[0], params[1]);
        $gameMessage.setBackground(params[2]);
        $gameMessage.setPositionType(params[3]);
        $gameMessage.setSpeakerName(params[4] || '');
        for (const line of lines) $gameMessage.add(line);
        const nextCode = interpreter.nextEventCode();
        if (nextCode === 102 || nextCode === 103 || nextCode === 104) {
            interpreter._index++;
            if (nextCode === 102) interpreter.setupChoices(interpreter.currentCommand().parameters);
            else if (nextCode === 103) interpreter.setupNumberInput(interpreter.currentCommand().parameters);
            else interpreter.setupItemChoice(interpreter.currentCommand().parameters);
        }
        interpreter.setWaitMode('message');
        return true;
    }

    // ==========================================================================
    // Die roll popup: a free-floating sprite at the top center of the screen —
    // the same spot and transparent look as the game's own free toasts, but
    // drawn outside the 3-slot CGMZ queue, so a long loot list can never push
    // it out. Official d1-d6 art, loaded through the same ImageManager the
    // event commands use.
    // ==========================================================================

    class DiePopup extends Sprite {
        constructor(face) {
            super(ImageManager.loadPicture('d' + face));
            this.anchor.x = 0.5;
            this.anchor.y = 0.5;
            this.x = (Graphics.width - Graphics.boxWidth) / 2 + Graphics.boxWidth / 2;
            this.y = (Graphics.height - Graphics.boxHeight) / 2 + Graphics.boxHeight
                - CONFIG.DIE_POPUP_Y - CONFIG.DIE_POPUP_SIZE / 2;
            this.opacity = 0;
            this._hold = CONFIG.DIE_POPUP_DURATION;
            this._dying = false;
            this._applyScale();
            if (this.bitmap && !this.bitmap.isReady()) {
                this.bitmap.addLoadListener(() => this._applyScale());
            }
        }
        _applyScale() {
            if (!this.bitmap || !this.bitmap.width) return;
            const s = CONFIG.DIE_POPUP_SIZE / this.bitmap.width;
            this.scale.x = s;
            this.scale.y = s;
        }
        update() {
            super.update();
            if (this._dying) {
                this.opacity = Math.max(0, this.opacity - 16);
                if (this.opacity === 0 && this.parent) this.parent.removeChild(this);
                return;
            }
            if (this.opacity < 255) this.opacity = Math.min(255, this.opacity + 16);
            else if (this._hold > 0) this._hold--;
            else this._dying = true;
        }
    }

    function spawnDiePopup(face) {
        if (!CONFIG.SHOW_DIE_POPUP || face < 1) return;
        const scene = SceneManager._scene;
        if (!scene || typeof scene.addChild !== 'function') return;
        scene.addChild(new DiePopup(face));
        log('die popup:', face);
    }

    // ==========================================================================
    // Loot toasts. Toast windows are fixed at one text line by the game config,
    // so multi-line messages are joined. CGMZ toasts draw lineOne through the
    // full escape-code pipeline, and Toast_Localization_Fix snapshots \V
    // variables at queue time (variables 30/31 are overwritten by later rolls
    // long before the toast gets drawn).
    // ==========================================================================

    function enqueueLootToast(text) {
        if (typeof $cgmzTemp === 'undefined' || !$cgmzTemp) return false;
        $cgmzTemp.createNewToast({
            isText: true,
            lineOne: text,
            lineOneColor: 0,
            lineOneAlignment: 'left',
            lineTwo: '',
            displayTime: CONFIG.TOAST_DISPLAY_TIME,
            width: CONFIG.TOAST_WIDTH,
            _wteLootToast: true, // our marker: right-side placement
        });
        log('toast:', text);
        return true;
    }

    // ==========================================================================
    // Drop tracking: special drops are given via Change Item/Weapon/Armor
    // (126/127/128) right before their "Obtained …" message. Remember the last
    // one so the message can be rebuilt as icon + name with no wrapper text.
    // Combat shrine bonus loot is flagged when the shrine announcement fires
    // and marked with an icon until the loot flow ends.
    // ==========================================================================

    let lastDrop = null;
    let shrineLootActive = false;
    let pendingExp = null;

    const alias_Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        alias_Game_Map_update.call(this, sceneActive);
        const inFlow = isLootFlow();
        if (CONFIG.DEBUG_FORCE_SHRINE && inFlow) shrineLootActive = true;
        if (inFlow) return;
        shrineLootActive = false;
        // Battle just ended (or had no loot flow): flush the held-back EXP toast.
        if (pendingExp !== null) {
            const exp = pendingExp;
            pendingExp = null;
            enqueueLootToast(`\\c[6]${exp} ${TextManager.exp}\\c[0]`);
        }
    };

    // ==========================================================================
    // Victory flow (MZ core, not events): "Victory!" and "Obtained: N EXP!" are
    // message windows shown in the battle scene. Skip them; remember the EXP and
    // toast it on the map after the loot flow, so it lands on top of the stack
    // and nothing pushes it out. TextManager.exp keeps the word localized.
    // ==========================================================================

    if (typeof BattleManager === 'object' || typeof BattleManager === 'function') {
        const alias_BattleManager_displayVictoryMessage = BattleManager.displayVictoryMessage;
        BattleManager.displayVictoryMessage = function () {
            if (CONFIG.VICTORY_EXP_TOAST) return; // "Victory!" window skipped entirely
            alias_BattleManager_displayVictoryMessage.call(this);
        };
        const alias_BattleManager_displayExp = BattleManager.displayExp;
        BattleManager.displayExp = function () {
            if (CONFIG.VICTORY_EXP_TOAST) {
                const exp = this._rewards ? this._rewards.exp : 0;
                if (exp > 0) pendingExp = exp;
                return;
            }
            alias_BattleManager_displayExp.call(this);
        };
    }

    function trackDrop(commandCode) {
        const method = 'command' + commandCode;
        const alias = Game_Interpreter.prototype[method];
        Game_Interpreter.prototype[method] = function (params) {
            if (isLootFlow()) {
                lastDrop = { code: commandCode, id: params[0] };
            }
            return alias.call(this, params);
        };
    }

    trackDrop(126); // Change Items
    trackDrop(127); // Change Weapons
    trackDrop(128); // Change Armors

    function dropToastText(raw) {
        if (raw === RAW_ITEM_XN || raw === RAW_ITEM) {
            // CE 12 "Check and Give Item": item id in var 30, amount in var 31.
            const id = $gameVariables.value(30);
            const count = $gameVariables.value(31);
            if (!id) return null;
            return `\\c[6]\\ii[${id}]\\c[0]` + (count > 1 ? ` x${count}` : '');
        }
        if (raw === RAW_GOLD) {
            // CE 599 "Give Gold": amount in var 1039, coin icon 314.
            return `\\i[314]\\c[14]${$gameVariables.value(1039)}\\c[0]`;
        }
        if (raw.indexOf('Obtained ') === 0) {
            // Special drop announced right after a 126/127/128 in this flow.
            const drop = lastDrop;
            lastDrop = null;
            const db = drop && drop.code === 126 ? $dataItems
                : drop && drop.code === 127 ? $dataWeapons
                : drop ? $dataArmors : null;
            const data = db && db[drop.id];
            if (data) {
                if (drop.code === 126) return `\\c[14]\\ii[${drop.id}]\\c[0]`;
                return `\\i[${data.iconIndex}]\\c[14]${localize(data.name)}\\c[0]`;
            }
            return raw.slice('Obtained '.length);
        }
        return null;
    }

    // ==========================================================================
    // Interception: messages inside the loot flow become toasts; battle start
    // announcements are skipped. Vanilla command101 fills $gameMessage and sets
    // the "message" wait mode, which blocks the player until the window is
    // clicked through. Here the 401 lines are consumed and the interpreter
    // simply continues.
    // ==========================================================================

    const alias_Game_Interpreter_command101 = Game_Interpreter.prototype.command101;
    Game_Interpreter.prototype.command101 = function (params) {
        if (!isLootFlow()) {
            // Battle start: troops announce themselves ("A Rat appears!") in a
            // message window. Skip those and go straight to the fight.
            if (CONFIG.REMOVE_BATTLE_START_MESSAGES &&
                typeof Scene_Battle === 'function' && SceneManager._scene instanceof Scene_Battle &&
                !$gameMessage.isBusy()) {
                const lines = collectTextLines(this);
                const text = lines.join(' ').trim();
                // Announcement-style lines only: "A Cute Flower attacks!",
                // "The Mall Administrator appears!" — short, article-first.
                if (text && text.length < 70 && /^(A|An|The)\b/.test(text) &&
                    /\b(appears?|attacks?|emerges?|approaches?)\b/i.test(text)) return true;
                return showVanillaMessage(this, params, lines);
            }
            return alias_Game_Interpreter_command101.call(this, params);
        }
        if ($gameMessage.isBusy()) return false; // mirror vanilla retry

        const lines = collectTextLines(this);
        const text = lines.join(' ').trim();
        if (!text) {
            // The die face CEs use an empty message as a blocking pause.
            spawnDiePopup(diceFaceOfList(this._list));
            return true;
        }
        if (CONFIG.SUPPRESSED_TEXTS.indexOf(text) !== -1) return true;
        if (text === CONFIG.SHRINE_REWARD_TEXT) {
            // Combat shrine bonus loot follows; mark it instead of wording it.
            shrineLootActive = true;
            return true;
        }

        // A prompt followed by a choice/number/item window must stay a real
        // message (the choice window has no text of its own).
        const nextCode = this.nextEventCode();
        if (nextCode === 102 || nextCode === 103 || nextCode === 104) {
            return showVanillaMessage(this, params, lines);
        }

        const rebuilt = dropToastText(text);
        let toastText = rebuilt !== null ? rebuilt : text;
        if (rebuilt !== null && shrineLootActive) {
            toastText = `\\i[${CONFIG.SHRINE_MARKER_ICON}] ` + toastText;
        }
        if (!enqueueLootToast(toastText)) {
            // CGMZ toasts unavailable — degrade to a vanilla message window.
            return showVanillaMessage(this, params, lines);
        }
        return true;
    };

    // ==========================================================================
    // Skip the die roll animation CE wholesale. It only cycles d1-d6 pictures
    // (numbers 9/10) with ~50 frame waits; the waits freeze the player, the
    // pictures would be invisible flicker, and without the waits its ~20 tick
    // sound effects would fire in a single frame.
    // ==========================================================================

    const alias_Game_Interpreter_command117 = Game_Interpreter.prototype.command117;
    Game_Interpreter.prototype.command117 = function (params) {
        if (isLootFlow() && params[0] === CONFIG.DICE_ANIMATION_CE_ID) return true;
        return alias_Game_Interpreter_command117.call(this, params);
    };

    // ==========================================================================
    // Hide the remaining loot roll pictures (death loot icon in CE 27, final
    // die face / luck banner in CE 29-34). Skipping the moves also skips their
    // built-in frame waits; the result sound effects still play.
    // ==========================================================================

    function shouldSkipPicture(params) {
        return isLootFlow() && CONFIG.SUPPRESSED_PICTURES.indexOf(params[0]) !== -1;
    }

    const alias_Game_Interpreter_command231 = Game_Interpreter.prototype.command231;
    Game_Interpreter.prototype.command231 = function (params) {
        if (shouldSkipPicture(params)) return true;
        return alias_Game_Interpreter_command231.call(this, params);
    };

    const alias_Game_Interpreter_command232 = Game_Interpreter.prototype.command232;
    Game_Interpreter.prototype.command232 = function (params) {
        if (shouldSkipPicture(params)) return true;
        return alias_Game_Interpreter_command232.call(this, params);
    };

    const alias_Game_Interpreter_command235 = Game_Interpreter.prototype.command235;
    Game_Interpreter.prototype.command235 = function (params) {
        if (shouldSkipPicture(params)) return true;
        return alias_Game_Interpreter_command235.call(this, params);
    };

    // ==========================================================================
    // Toast window: right-side placement for loot toasts. Vertical stacking
    // stays vanilla: bottom-up, so the first drop lands at the bottom.
    // ==========================================================================

    if (typeof CGMZ_Window_Toast !== 'undefined' && CGMZ_Window_Toast.prototype.refresh) {
        const alias_CGMZ_Window_Toast_refresh = CGMZ_Window_Toast.prototype.refresh;
        CGMZ_Window_Toast.prototype.refresh = function (toastObject) {
            alias_CGMZ_Window_Toast_refresh.call(this, toastObject);
            if (toastObject && toastObject._wteLootToast) {
                this.x = Graphics.boxWidth - this.width - CONFIG.RIGHT_MARGIN;
            }
        };
    }
})();
