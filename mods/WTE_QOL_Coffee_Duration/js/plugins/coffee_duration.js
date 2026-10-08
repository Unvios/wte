/*:
 * @target MZ
 * @plugindesc [WTE QoL] Cup of Coffee buff lasts 8 in-game hours instead of 4.
 * @author Unvios
 *
 * @help
 * Duration:
 *   The buff timer is configured in WTE_TimeConverter's "State Durations"
 *   parameter (state 243 -> 4 hours) and is read-only at runtime. This
 *   plugin re-applies the tracker entry right after the original code,
 *   extending the expiry to 8 hours. New applications only; entries already
 *   tracked (e.g. from saves made before this mod) keep their expiry.
 *
 * Text:
 *   The vanilla strings still say "4 hours". Instead of editing data files
 *   (which would break Hendrix localization CSV keys), this plugin swaps the
 *   two coffee strings at display time, in every language the game ships.
 *   With the mod disabled the game is fully vanilla.
 */

(() => {
    'use strict';

    const COFFEE_STATE_ID = 243;
    const COFFEE_DURATION_HOURS = 8;

    // ==========================================================================
    // 1. DURATION
    // ==========================================================================

    const alias_Game_Battler_addState = Game_Battler.prototype.addState;
    Game_Battler.prototype.addState = function (stateId) {
        alias_Game_Battler_addState.call(this, stateId);

        // Same guards as WTE_TimeConverter's own addState patch
        if (stateId !== COFFEE_STATE_ID) return;
        if (this._wteIgnoreTimerRefresh) return; // ReapplyTimedStates must keep the stored expiry
        if (!this.isActor() || typeof $gameTime === 'undefined' || !$gameTime) return;
        if (!Game_Time._actorStates) return;

        const entry = Game_Time._actorStates.find(
            s => s.actorId === this.actorId() && s.stateId === stateId
        );
        if (entry) {
            entry.gameTime = $gameTime.clone().add('hour', COFFEE_DURATION_HOURS);
            console.log(`[CoffeeDuration] Coffee buff set to +${COFFEE_DURATION_HOURS}h for actor ${this.actorId()}`);
        }
    };

    // ==========================================================================
    // 2. TEXT (display-time overrides, all shipped languages)
    // ==========================================================================

    // Vanilla English sources (byte-exact, escape codes included).
    const SRC_DESC = 'Adds +1 \\c[6]Movement Speed\\c[0] for \\c[6]4 hours\\c[0].';
    const SRC_MSG = '\\c[0]+1 \\c[0]Movement Speed\\c[0] for \\c[6]4 hours\\c[0].';

    // 8h targets per language.
    const TARGETS = {
        desc: {
            en: 'Adds +1 \\c[6]Movement Speed\\c[0] for \\c[6]8 hours\\c[0].',
            ru: 'Добавляет +1 к \\c[6]Скорости передвижения\\c[0] на \\c[6]8 часов\\c[0].',
            de: '\\c[6]8 Stunden lang\\c[0] +1 \\c[6]Bewegungsgeschwindigkeit\\c[0].',
            fr: 'Ajoute +1 à la \\c[6]vitesse de déplacement\\c[0] pendant \\c[6]8 heures\\c[0].',
            es: 'Añade +1 a la \\c[6]velocidad de movimiento\\c[0] durante \\c[6]8 horas\\c[0].',
            br: '+1 de \\c[6]velocidade de movimento\\c[0] por \\c[6]8 horas\\c[0].',
            ch: '获得+1\\c[6]移动速度\\c[0]，持续\\c[6]8小时\\c[0]。',
        },
        msg: {
            en: '\\c[0]+1 \\c[0]Movement Speed\\c[0] for \\c[6]8 hours\\c[0].',
            ru: '+1 к \\c[0]скорости передвижения\\c[0] на \\c[6]8 часов\\c[0].',
            de: '\\c[0]8 Stunden\\c[0] lang \\c[0]+1 \\c[6]Bewegungsgeschwindigkeit\\c[0].',
            fr: '+1 \\c[0]à la vitesse de déplacement\\c[0] pendant \\c[6]8 heures\\c[0].',
            es: '+1 \\c[0]a la velocidad de movimiento\\c[0] durante \\c[6]8 horas\\c[0].',
            br: '+1 de \\c[0]velocidade de movimento\\c[0] por \\c[6]8 horas\\c[0].',
            ch: '\\c[0]+1\\c[0]移动速度\\c[0]，持续\\c[6]8小时\\c[0]。',
        },
    };

    // Custom UI pre-translates strings via translateText() before drawing
    // (help windows and elsewhere), so at display time the text can already
    // be the localized "4h" variant from game_messages.csv. Match those too
    // (byte-exact CSV values) and swap them for the same-language 8h target.
    const TRANSLATED_VARIANTS = {
        'Добавляет +1 к \\c[6]Скорости передвижения\\c[0] на \\c[6]4 часа\\c[0].': TARGETS.desc.ru,
        '+1 к \\c[0]скорости передвижения\\c[0] на \\c[6]4 часа\\c[0].': TARGETS.msg.ru,
        '\\c[6]4 Stunden lang\\c[0] +1 \\c[6]Bewegungsgeschwindigkeit\\c[0].': TARGETS.desc.de,
        '\\c[0]4 Stunden\\c[0] lang \\c[0]+1 \\c[6]Bewegungsgeschwindigkeit\\c[0].': TARGETS.msg.de,
        'Ajoute +1 à la \\c[6]vitesse de déplacement\\c[0] pendant \\c[6]4 heures\\c[0].': TARGETS.desc.fr,
        '+1 \\c[0]à la vitesse de déplacement\\c[0] pendant \\c[6]4 heures\\c[0].': TARGETS.msg.fr,
        'Añade +1 a la \\c[6]velocidad de movimiento\\c[0] durante \\c[6]4 horas\\c[0].': TARGETS.desc.es,
        '+1 \\c[0]a la velocidad de movimiento\\c[0] durante \\c[6]4 horas\\c[0].': TARGETS.msg.es,
        '+1 de \\c[6]velocidade de movimento\\c[0] por \\c[6]4 horas\\c[0].': TARGETS.desc.br,
        '+1 de \\c[0]velocidade de movimento\\c[0] por \\c[6]4 hroas\\c[0].': TARGETS.msg.br,
        '获得+1\\c[6]移动速度\\c[0]，持续\\c[6]4小时\\c[0]。': TARGETS.desc.ch,
        '\\c[0]+1\\c[0]移动速度\\c[0]，持续\\c[6]4小时\\c[0]。': TARGETS.msg.ch,
    };

    const currentLanguage = () =>
        (typeof ConfigManager !== 'undefined' && ConfigManager.language) ||
        window.Hendrix_DefaultLanguage ||
        'en';

    function overrideCoffeeText(text) {
        if (typeof text !== 'string') return text;
        // Raw English source -> 8h text in the active language.
        if (text === SRC_DESC) return TARGETS.desc[currentLanguage()] || TARGETS.desc.en;
        if (text === SRC_MSG) return TARGETS.msg[currentLanguage()] || TARGETS.msg.en;
        // Already-localized variant -> same-language 8h text.
        const hit = TRANSLATED_VARIANTS[text];
        return hit !== undefined ? hit : text;
    }

    // Path A: everything rendered via drawTextEx (most UI text) goes through
    // window.Hendrix_Localization.
    if (typeof window.Hendrix_Localization === 'function') {
        const _hendrixLocalization = window.Hendrix_Localization;
        window.Hendrix_Localization = function (text) {
            return _hendrixLocalization.call(this, overrideCoffeeText(text));
        };
    }

    // Path B: plugins that call the exposed global translator directly.
    if (typeof window.translateText === 'function') {
        const _translateText = window.translateText;
        window.translateText = function (text) {
            return _translateText.call(this, overrideCoffeeText(text));
        };
    }

    // Path C: map messages are translated inside the engine via the closure
    // function translateText (see Game_Message.prototype.processMessageBuffer
    // in Hendrix_Localization.js), which cannot be reassigned via window.
    // Patch the buffer processor instead.
    if (typeof Game_Message === 'function' &&
        typeof Game_Message.prototype.processMessageBuffer === 'function') {
        const _processMessageBuffer = Game_Message.prototype.processMessageBuffer;
        Game_Message.prototype.processMessageBuffer = function () {
            if (this.messageBuffer && this.messageBuffer.length) {
                this.messageBuffer = this.messageBuffer.map(overrideCoffeeText);
            }
            _processMessageBuffer.call(this);
        };
    }
})();
