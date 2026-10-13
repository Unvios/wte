/*:
 * @target MZ
 * @plugindesc [WTE QoL] <one-line description for the plugin list>
 * @author Unvios
 *
 * @help
 * <Extended description: features, rules, integration points, persistence.
 * This text is what future-you reads before touching the code — keep it
 * accurate when behavior changes.>
 */

(() => {
    'use strict';

    // ==========================================================================
    // CONFIG (hardcoded — mod plugins are not registered in PluginManager)
    // ==========================================================================

    const CONFIG = {
        DEBUG: false, // verbose DEBUG log lines; operational events always log
        // Diagnostics live inside this mod's folder so a shared copy of the
        // mod carries its own logs (the folder is git-ignored).
        LOG_DIR: 'logs',
        LOG_FILE: 'mod_template.log',
    };

    // ==========================================================================
    // Logging. Operational events are ALWAYS written — that is what makes
    // remote debugging of someone else's install possible. The file lives in
    // <game>/mods/WTE_QOL_Template/logs/ and is truncated past 1 MiB.
    // ==========================================================================

    const MOD_VERSION = '1.0.2a.1'; // must match mod.json — release_mod.sh checks

    const LOG_PATH = (() => {
        try {
            const path = require('path');
            const root = path.dirname(process.mainModule.filename);
            return path.join(root, 'mods', 'WTE_QOL_Template',
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

    const logEvent = (...args) => writeLog(`${stamp()} [Template] ${args.join(' ')}`);

    const log = (...args) => {
        if (!CONFIG.DEBUG) return;
        logEvent('[debug]', ...args);
    };

    // Localized text (see docs/localization.md): game strings go through the
    // game's own localization hooks when present.
    const localize = (text) => {
        if (typeof window.Hendrix_Localization === 'function') return window.Hendrix_Localization(text);
        if (typeof window.translateText === 'function') return window.translateText(text);
        return text;
    };

    // ==========================================================================
    // Patches. Alias naming: alias_<Class>_<method>. Always guard integrations
    // with other plugins (typeof checks) — the mod must degrade silently when
    // the target is absent, never crash.
    // ==========================================================================
    //
    // const alias_Scene_Map_create = Scene_Map.prototype.create;
    // Scene_Map.prototype.create = function () {
    //     alias_Scene_Map_create.call(this);
    //     log('Scene_Map created');
    // };

    logEvent(`mod v${MOD_VERSION} loaded`);
})();
