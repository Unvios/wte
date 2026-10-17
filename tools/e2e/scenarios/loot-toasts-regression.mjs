// Loot Toasts E2E — vanilla outside the loot flow + version/log guard.
//   LT-REG-01: CE 12 ("Check and Give Item") reserved on the map, OUTSIDE the
//     CE 27 battle loot flow, must show a VANILLA message window and create no
//     loot toast. Proves the command101 interception is context-scoped.
//   LT-REG-02: a game toast without our markers displays at the default CGMZ
//     position (not right-aligned) and fades normally.
//   LT-LOG-01: the last "mod v<X> loaded" line matches mod.json's version.
//   LT-LOG-02: fresh mod-log lines contain no ERROR (all scenarios).
// Run: tools/e2e/run.sh tools/e2e/scenarios/loot-toasts-regression.mjs --sandbox --headless

import fs from 'node:fs';
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, toastState, pollToasts, waitToastsGone,
  enqueueTestToast, waitEventDone, readModLog,
} from '../lib.mjs';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);
const ITEM_ID = 2141; // Spiced Jerky — plain consumable, exists in the DB

export default async function lootToastsRegression(t) {
  const modDir = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts');
  const logPath = path.join(modDir, 'logs', 'loot_toasts.log');
  const logOffset = readModLog(logPath, 0).size;

  await waitTitle(t);
  await loadFixtureSave(t, SAVE_SLOT);
  await t.sleep(1000);

  // ------------------------------------------------------------- LT-LOG-01
  const modVersion = JSON.parse(fs.readFileSync(path.join(modDir, 'mod.json'), 'utf8')).version;
  const wholeLog = readModLog(logPath, 0).text;
  const loaded = [...wholeLog.matchAll(/mod v(\S+) loaded/g)].map(m => m[1]).pop();
  t.assert(!!loaded, 'LT-LOG-01: mod logged a startup line');
  t.assert(loaded === modVersion,
    `LT-LOG-01: startup version ${loaded} === mod.json ${modVersion}`);
  t.log(`LT-LOG-01: version ${modVersion} in sync`);

  // ------------------------------------------------------------- LT-REG-01
  const before = await t.eval(`$gameParty.numItems($dataItems[${ITEM_ID}])`);
  await t.eval(`$gameVariables.setValue(30, ${ITEM_ID}); $gameVariables.setValue(31, 1);
    $gameTemp.reserveCommonEvent(12); 'ok'`);
  await t.waitFor(`$gameMessage.isBusy()`,
    { timeout: 15000, desc: 'LT-REG-01: vanilla message window from CE 12 outside battle' });
  const st = await toastState(t);
  t.assert(!st.queued.some(q => q.loot) && !st.slots.some(s => s.displaying && s.loot),
    'LT-REG-01: no loot toast created outside the loot flow');
  const after = await t.eval(`$gameParty.numItems($dataItems[${ITEM_ID}])`);
  t.assert(after === before + 1, `LT-REG-01: item granted by vanilla CE 12 (${before} -> ${after})`);
  await t.shot('reg-01-vanilla-window');
  await waitEventDone(t); // dismisses the vanilla window(s) with enter
  t.log('LT-REG-01: vanilla message path intact');

  // ------------------------------------------------------------- LT-REG-02
  await enqueueTestToast(t, 'e2e-probe', { displayTime: 120 });
  const st2 = await pollToasts(t, s => s.slots.some(x => x.displaying && x.text === 'e2e-probe'),
    10000, 'LT-REG-02: probe toast visible');
  const win = st2.slots.find(x => x.displaying && x.text === 'e2e-probe');
  const boxW = await t.eval('Graphics.boxWidth');
  t.assert(!win.loot, 'LT-REG-02: probe toast is not loot-marked');
  t.assert(win.x !== boxW - win.w - 8,
    `LT-REG-02: game toast keeps default placement (x=${win.x}, right-margin would be ${boxW - win.w - 8})`);
  await waitToastsGone(t);
  t.log(`LT-REG-02: game toast shown at x=${win.x} and faded`);

  // ------------------------------------------------------------- LT-LOG-02
  const fresh = readModLog(logPath, logOffset).text;
  t.assert(!fresh.includes('[ERROR]'), 'LT-LOG-02: no ERROR in fresh mod log lines');
}
