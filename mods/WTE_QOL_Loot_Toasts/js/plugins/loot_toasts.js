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
 *   - item drops:   icon + localized item name (+ xN when more than one);
 *   - summary toast on top of the stack: the rolled die face picture (official
 *                   d1-d6 art), earned EXP and gold in one line, e.g.
 *                   "[d5]  16 EXP  [coin]34" (missing parts are omitted);
 *   - combat shrine bonus loot: same item toasts with a gold frame (the "The
 *                   combat shrine rewards you..." wording is dropped entirely).
 * The "Victory!" window is skipped too.
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
        VICTORY_EXP_TOAST: true,                    // skip "Victory!" window; EXP goes into the summary toast
        SHRINE_REWARD_TEXT: 'The combat shrine rewards you...', // combat shrine bonus loot announcement
        SHRINE_FRAME_COLOR: 0xFFD700,               // gold tint for the windowskin frame of bonus loot toasts
        SUMMARY_SEPARATOR: '  ',                    // between EXP and gold parts of the summary toast
        TOAST_DISPLAY_TIME: 180,                    // frames (3 s) per loot toast
        TOAST_WIDTH: 380,
        RIGHT_MARGIN: 8,
        MAX_TOAST_SLOTS: 7,                         // CGMZ toast slots; the game default is 3
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
    // Loot toasts. Toast windows are fixed at one text line by the game config,
    // so multi-line messages are joined. CGMZ toasts draw lineOne through the
    // full escape-code pipeline, and Toast_Localization_Fix snapshots \V
    // variables at queue time (variables 30/31 are overwritten by later rolls
    // long before the toast gets drawn).
    // ==========================================================================

    function enqueueLootToast(text, shrine, face) {
        if (typeof $cgmzTemp === 'undefined' || !$cgmzTemp) {
            log('toast dropped, CGMZ toasts unavailable:', text);
            return false;
        }
        $cgmzTemp.createNewToast({
            isText: true,
            lineOne: text,
            lineOneColor: 0,
            lineOneAlignment: 'left',
            lineTwo: '',
            displayTime: CONFIG.TOAST_DISPLAY_TIME,
            width: CONFIG.TOAST_WIDTH,
            _wteLootToast: true, // our marker: right-side placement
            _wteShrine: !!shrine, // gold tint for the windowskin frame
            _wteSummaryFace: face || 0, // die face drawn from the d1-d6 pictures
        });
        log('toast:', text);
        return true;
    }

    // ==========================================================================
    // Loot batch: the whole CE 27 chain runs within a few frames, so instead of
    // streaming toasts we buffer every entry, then flush them in one sorted go
    // when the flow ends. The rolled die face, earned EXP and gold merge into a
    // single summary toast on top of the stack. Combat shrine bonus loot is
    // flagged while the shrine announcement is active and gets a gold frame
    // tint on the toast window.
    // ==========================================================================

    // Display order for the flush. The stack grows bottom-up, so enqueue
    // shrine items first to read top-down as:
    // summary (die face + EXP + gold) -> plain items -> shrine items.
    const KIND_ORDER = { plain: 1, item: 1 };
    const batchOrder = (entry) =>
        entry.kind === 'item' && entry.shrine ? 0 : KIND_ORDER[entry.kind];

    let lootBatch = [];
    let lastDrop = null;
    let shrineLootActive = false;
    let pendingExp = null;
    let rollFace = 0; // last die roll (1-6), consumed by the summary toast at flush

    function purgeLootToasts() {
        // A new battle's loot replaces the previous one: drop queued loot
        // toasts and instantly close the ones on screen (same force-kill the
        // game's duplicate-clear patch uses). Other toasts are untouched.
        if (typeof $cgmzTemp !== 'undefined' && $cgmzTemp && $cgmzTemp._toastWindows) {
            $cgmzTemp._toastWindows = $cgmzTemp._toastWindows
                .filter(toast => !(toast && toast._wteLootToast));
        }
        const scene = SceneManager._scene;
        if (scene && scene._cgmz_hasToastWindows) {
            const wins = [scene._cgmz_toastWindow1, scene._cgmz_toastWindow2, scene._cgmz_toastWindow3];
            for (const win of wins) {
                if (win && win.isDisplaying() && win._wteActiveToast && win._wteActiveToast._wteLootToast) {
                    win._showCount = 0;
                    win.opacity = 0;
                    win.contentsOpacity = 0;
                    if (win._dimmerSprite) win._dimmerSprite.opacity = 0;
                    win.y = 0;
                    win.height = 0;
                    win._isDisplaying = false;
                    win._wteActiveToast = null;
                }
            }
        }
    }

    function bufferLootToast(kind, text, amount) {
        lootBatch.push({ kind: kind, text: text, shrine: shrineLootActive, amount: amount });
    }

    const alias_Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
        alias_Game_Map_update.call(this, sceneActive);
        const inFlow = isLootFlow();
        if (CONFIG.DEBUG_FORCE_SHRINE && inFlow) shrineLootActive = true;
        if (inFlow) return;
        shrineLootActive = false;
        // Battle just ended (or had no loot flow): flush the batch. Items go
        // first (shrine items at the very bottom of the bottom-up stack); the
        // die face, earned EXP and gold merge into one summary toast on top.
        const expAmount = pendingExp;
        pendingExp = null;
        const face = rollFace;
        rollFace = 0;
        if (!lootBatch.length && expAmount === null && !face) return;
        purgeLootToasts();
        const batch = lootBatch;
        lootBatch = [];
        let goldTotal = 0;
        const items = [];
        for (const entry of batch) {
            if (entry.kind === 'gold') {
                goldTotal += entry.amount || 0;
                continue;
            }
            items.push(entry);
        }
        items.sort((a, b) => batchOrder(a) - batchOrder(b));
        for (const entry of items) enqueueLootToast(entry.text, entry.shrine);
        if (face > 0 || expAmount !== null || goldTotal > 0) {
            const parts = [];
            if (expAmount !== null && expAmount > 0) parts.push(`${expAmount} ${TextManager.exp}`);
            if (goldTotal > 0) parts.push(`\\i[314]\\c[14]${goldTotal}\\c[0]`);
            enqueueLootToast(parts.join(CONFIG.SUMMARY_SEPARATOR), false, face);
        }
    };

    // ==========================================================================
    // Victory flow (MZ core, not events): "Victory!" and "Obtained: N EXP!" are
    // message windows shown in the battle scene. Skip them; the earned EXP is
    // remembered and merged into the summary toast at flush. TextManager.exp
    // keeps the word localized.
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
            return {
                kind: 'item',
                text: `\\c[6]\\ii[${id}]\\c[0]` + (count > 1 ? ` x${count}` : ''),
            };
        }
        if (raw === RAW_GOLD) {
            // CE 599 "Give Gold": amount in var 1039, coin icon 314.
            return { kind: 'gold', text: '', amount: $gameVariables.value(1039) };
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
                if (drop.code === 126) return { kind: 'item', text: `\\c[14]\\ii[${drop.id}]\\c[0]` };
                return {
                    kind: 'item',
                    text: `\\i[${data.iconIndex}]\\c[14]${localize(data.name)}\\c[0]`,
                };
            }
            return { kind: 'item', text: raw.slice('Obtained '.length) };
        }
        return null;
    }

    // ==========================================================================
    // Interception: messages inside the loot flow are buffered as batch
    // entries; battle start announcements are skipped. Vanilla command101 fills
    // $gameMessage and sets the "message" wait mode, which blocks the player
    // until the window is clicked through. Here the 401 lines are consumed and
    // the interpreter simply continues.
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
            // The die face CEs use an empty message as a blocking pause; the
            // face value goes into the summary toast.
            rollFace = diceFaceOfList(this._list);
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
        bufferLootToast(rebuilt !== null ? rebuilt.kind : 'plain',
            rebuilt !== null ? rebuilt.text : text,
            rebuilt !== null ? rebuilt.amount : undefined);
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
    // Toast display order. Toast_Localization_Fix's "queue accelerator" force-
    // fades the oldest toast whenever the queue is non-empty and all 3 slots
    // are taken; the newest toast then takes the freed FIRST slot (bottom),
    // which scrambles the stack (the summary must stay on top). For queues
    // fronted by a loot toast we run the vanilla CGMZ pacing instead: queued
    // toasts simply wait for a naturally freed slot. Game-owned toasts keep
    // the accelerator.
    // ==========================================================================

    if (typeof Scene_Base !== 'undefined' && Scene_Base.prototype.CGMZ_ToastManager_updateToastWindows) {
        // Read at scene creation, which happens after mods load — so bumping the
        // slot count here gives every scene more toast windows.
        if (CONFIG.MAX_TOAST_SLOTS > 3 && typeof CGMZ !== 'undefined' && CGMZ.ToastManager) {
            CGMZ.ToastManager.MaxWindowCount = CONFIG.MAX_TOAST_SLOTS;
        }
        const alias_Scene_Base_CGMZ_ToastManager_updateToastWindows = Scene_Base.prototype.CGMZ_ToastManager_updateToastWindows;
        Scene_Base.prototype.CGMZ_ToastManager_updateToastWindows = function () {
            const frontIsLoot = typeof $cgmzTemp !== 'undefined' && $cgmzTemp &&
                $cgmzTemp.hasToast() && !!$cgmzTemp.peekToast()._wteLootToast;
            if (!frontIsLoot || !this._cgmz_hasToastWindows) {
                alias_Scene_Base_CGMZ_ToastManager_updateToastWindows.call(this);
                return;
            }
            // Vanilla CGMZ_ToastManager.js pacing (v1.5.0): one toast per free
            // slot per frame, no forced fade-out, generalized over however many
            // toast windows the scene has.
            const wins = [];
            for (let i = 1; i <= CGMZ.ToastManager.MaxWindowCount; i++) {
                const win = this['_cgmz_toastWindow' + i];
                if (win) wins.push(win);
            }
            for (let i = 0; i < wins.length; i++) {
                const win = wins[i];
                if (win.isDisplaying()) continue;
                if (i > 0 && !this.CGMZ_ToastManager_canDisplayToast(i + 1, $cgmzTemp.peekToast())) continue;
                if (i === 0) {
                    win.y = CGMZ.ToastManager.DisplayFromBottom ? Graphics.boxHeight : 0;
                } else if (CGMZ.ToastManager.DisplayFromBottom) {
                    win.y = wins[i - 1].y - CGMZ.ToastManager.Spacing;
                } else {
                    win.y = wins[i - 1].y + wins[i - 1].height + CGMZ.ToastManager.Spacing;
                }
                win.open($cgmzTemp.getToast());
                break;
            }
        };
    }

    // ==========================================================================
    // Toast window: right-side placement for loot toasts; combat shrine bonus
    // loot keeps the original windowskin frame, tinted gold (the frame is 8
    // sprites sharing the skin — tint multiplies the drawn art). Vertical
    // stacking stays vanilla: bottom-up, so the first flushed entry lands at
    // the bottom.
    // ==========================================================================

    if (typeof CGMZ_Window_Toast !== 'undefined' && CGMZ_Window_Toast.prototype.refresh) {
        const alias_CGMZ_Window_Toast_refresh = CGMZ_Window_Toast.prototype.refresh;
        CGMZ_Window_Toast.prototype.refresh = function (toastObject) {
            this._wteActiveToast = toastObject || null; // stashed before: processCustomToast runs inside
            alias_CGMZ_Window_Toast_refresh.call(this, toastObject);
            const tinted = !!(toastObject && toastObject._wteLootToast && toastObject._wteShrine);
            if (this._frameSprite) {
                for (const child of this._frameSprite.children) {
                    child.tint = tinted ? CONFIG.SHRINE_FRAME_COLOR : 0xFFFFFF;
                }
            }
            if (toastObject && toastObject._wteLootToast) {
                this.x = Graphics.boxWidth - this.width - CONFIG.RIGHT_MARGIN;
            }
        };

        if (CGMZ_Window_Toast.prototype.processCustomToast) {
            const alias_CGMZ_Window_Toast_processCustomToast = CGMZ_Window_Toast.prototype.processCustomToast;
            CGMZ_Window_Toast.prototype.processCustomToast = function (toastObject) {
                alias_CGMZ_Window_Toast_processCustomToast.call(this, toastObject);
                if (!toastObject || !toastObject._wteSummaryFace) return;
                // Draw the actual rolled die face (official d1-d6 art) at the
                // left of the single-line summary toast, text shifted right.
                const bitmap = ImageManager.loadPicture('d' + toastObject._wteSummaryFace);
                const draw = () => {
                    // redraw only while this very toast is still on this window
                    if (this._wteActiveToast !== toastObject || !this.isDisplaying()) return;
                    const size = Math.max(16, this.contents.height - 6);
                    const y = Math.max(0, (this.contents.height - size) / 2);
                    this.contents.clear();
                    this.contents.blt(bitmap, 0, 0, bitmap.width, bitmap.height, 2, y, size, size);
                    if (toastObject.lineOne && toastObject.lineOne.trim()) {
                        this.CGMZ_drawTextLine(toastObject.lineOne, size + 8, 0,
                            this.contents.width - size - 8, 'left');
                    }
                };
                if (bitmap.isReady()) draw();
                else bitmap.addLoadListener(draw);
            };
        }
    }
})();
