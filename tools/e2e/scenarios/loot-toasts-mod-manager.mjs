// Loot Toasts E2E — official Options > Mods menu metadata (LT-UI-01).
// Run: tools/e2e/run.sh tools/e2e/scenarios/loot-toasts-mod-manager.mjs --sandbox --headless

import path from 'node:path';
import { waitTitle, readModLog } from '../lib.mjs';

const EXPECTED = {
  folderName: 'WTE_QOL_Loot_Toasts',
  name: 'WTE QOL Loot Toasts',
  author: 'Unvios',
  gameversion: '1.0.4d',
  modversion: '1.0.4d.2',
  languages: 'All game languages',
};

async function selectTitleCommand(t, text) {
  const found = await t.eval(`(() => {
    const w = SceneManager._scene._commandWindow;
    if (!w || typeof w.commandName !== 'function') return { index: -1, rows: [] };
    const rows = [];
    for (let i = 0; i < w.maxItems(); i++) {
      const name = String(w.commandName(i) || '');
      rows.push(name);
      if (name.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())}) {
        w.select(i);
        w.activate();
        return { index: i, rows };
      }
    }
    return { index: -1, rows };
  })()`);
  t.log(`LT-UI-01: title rows ${JSON.stringify(found.rows)}`);
  t.assert(found.index >= 0, `LT-UI-01: title command "${text}" exists`);
  await t.sleep(200);
  await t.eval(`SceneManager._scene._commandWindow.processOk(); 'ok'`);
}

async function selectOptionsRow(t, text) {
  const found = await t.eval(`(() => {
    const scene = SceneManager._scene;
    const rows = [];
    for (const key of Object.keys(scene)) {
      const w = scene[key];
      if (!w || typeof w.commandName !== 'function' || typeof w.maxItems !== 'function') continue;
      for (let i = 0; i < w.maxItems(); i++) {
        const name = String(w.commandName(i) || '');
        const normalized = name.trim().toLowerCase();
        rows.push({ key, index: i, name });
        if (normalized.includes(${JSON.stringify(text.toLowerCase())})) {
          w.select(i);
          w.activate();
          return { found: true, key, index: i, rows };
        }
      }
    }
    return { found: false, rows };
  })()`);
  t.log(`LT-UI-01: options rows ${JSON.stringify(found.rows)}`);
  t.assert(found.found, `LT-UI-01: options row "${text}" found and selected`);
  await t.key('enter');
  await t.sleep(200);
  // Another installed mod can occupy Options > Mods with its own settings.
  // Open the game's official scene explicitly to test its metadata contract.
  await t.eval(`SceneManager.push(Scene_ModList); 'ok'`);
}

export default async function lootToastsModManager(t) {
  const logPath = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts', 'logs', 'loot_toasts.log');
  const logOffset = readModLog(logPath, 0).size;

  await waitTitle(t);
  t.assert(await t.eval(`VirtualModLoader.hasMod(${JSON.stringify(EXPECTED.folderName)})`),
    'LT-UI-01: VirtualModLoader reports Loot Toasts as installed');

  await selectTitleCommand(t, 'options');
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Options'`,
    { timeout: 15000, desc: 'Options scene from the title command' });
  await selectOptionsRow(t, 'Mods');
  await t.waitFor(`SceneManager._scene instanceof Scene_ModList`,
    { timeout: 15000, desc: 'official Mod List scene' });

  const index = await t.eval(`(() => {
    const scene = SceneManager._scene;
    const index = scene._mods.findIndex(m => m.folderName === ${JSON.stringify(EXPECTED.folderName)});
    if (index >= 0) scene._listWindow.select(index);
    return index;
  })()`);
  t.assert(index >= 0, 'LT-UI-01: Loot Toasts is present in the official Mods list');
  await t.waitFor(`SceneManager._scene._detailsWindow._mod?.folderName === ${JSON.stringify(EXPECTED.folderName)}`,
    { timeout: 5000, desc: 'Loot Toasts details card selected' });

  const mod = await t.eval(`SceneManager._scene._detailsWindow._mod`);
  for (const [key, value] of Object.entries(EXPECTED)) {
    t.assert(mod[key] === value, `LT-UI-01: ${key} === "${value}" (got "${mod[key]}")`);
  }
  t.assert(!Object.values(mod).some(v => String(v).includes('Unknown')),
    `LT-UI-01: no Unknown metadata in the details card (${JSON.stringify(mod)})`);
  await t.shot('mod-manager');

  const fresh = readModLog(logPath, logOffset).text;
  t.assert(!fresh.includes('[ERROR]'), 'LT-LOG-02: no ERROR in fresh mod log lines');
}
