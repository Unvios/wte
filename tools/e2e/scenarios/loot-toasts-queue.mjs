// Loot Toasts E2E — queue pacing and purge-on-new-battle.
//   LT-ORD-02: 9 synthetic loot-marked toasts into 7 slots. Vanilla CGMZ pacing
//     (no queue accelerator): the first 7 open in order into slots 1..7, never
//     more than 7 at once, and toast 8 waits for a NATURALLY freed slot
//     (>= 2 s after toast 1 opened; the accelerator would force-fade it
//     immediately). All 9 get screen time.
//   LT-ORD-03: a game (non-loot) toast in a mixed queue still displays.
//   LT-PURGE-01: a long-lived loot toast + a long-lived game toast are placed,
//     then a new battle runs. At the new flush the loot toast is gone (window
//     AND queue) while the game toast survives.
// Run: tools/e2e/run.sh tools/e2e/scenarios/loot-toasts-queue.mjs --sandbox --headless

import path from 'node:path';
import {
  waitTitle, loadFixtureSave, toastState, pollToasts, waitToastsGone,
  enqueueTestToast, installRngStub, setRng, watchLootFlow, readModLog,
} from '../lib.mjs';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);

export default async function lootToastsQueue(t) {
  const logPath = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts', 'logs', 'loot_toasts.log');
  const logOffset = readModLog(logPath, 0).size;

  await waitTitle(t);
  await loadFixtureSave(t, SAVE_SLOT);
  await t.sleep(1000);

  // ------------------------------------------------------------- LT-ORD-02
  for (let i = 1; i <= 9; i++) await enqueueTestToast(t, `LT-ORD-${i}`, { loot: true, displayTime: 180 });
  const firstSeen = {}; // text -> { time, slot }
  let maxConcurrent = 0;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && Object.keys(firstSeen).length < 9) {
    const st = await toastState(t);
    const displaying = st.slots.filter(x => x.displaying);
    maxConcurrent = Math.max(maxConcurrent, displaying.length);
    for (const w of displaying) {
      if (w.text && w.text.startsWith('LT-ORD-') && !firstSeen[w.text]) {
        firstSeen[w.text] = { time: Date.now(), slot: w.slot };
      }
    }
    await t.sleep(80);
  }
  t.log(`LT-ORD-02 firstSeen: ${JSON.stringify(firstSeen)} maxConcurrent=${maxConcurrent}`);
  for (let i = 1; i <= 9; i++) {
    t.assert(!!firstSeen[`LT-ORD-${i}`], `LT-ORD-02: toast ${i} got screen time`);
  }
  t.assert(maxConcurrent <= 7, `LT-ORD-02: never more than 7 displaying (got ${maxConcurrent})`);
  for (let i = 1; i <= 7; i++) {
    t.assert(firstSeen[`LT-ORD-${i}`].slot === i,
      `LT-ORD-02: toast ${i} opened in slot ${i} (got ${firstSeen[`LT-ORD-${i}`].slot})`);
  }
  const wait8 = firstSeen['LT-ORD-8'].time - firstSeen['LT-ORD-1'].time;
  t.assert(wait8 >= 2000,
    `LT-ORD-02: toast 8 waited for a natural free slot (${wait8} ms after toast 1; accelerator would be ~instant)`);
  t.log(`LT-ORD-02: toast 8 opened ${wait8} ms after toast 1`);

  // ------------------------------------------------------------- LT-ORD-03
  await enqueueTestToast(t, 'LT-ORD-GAME', { displayTime: 120 });
  const stGame = await pollToasts(t, s => s.slots.some(x => x.displaying && x.text === 'LT-ORD-GAME'),
    20000, 'LT-ORD-03: game toast in a mixed queue displays');
  t.assert(!!stGame, 'LT-ORD-03: game toast not starved by the loot pacing');
  t.log('LT-ORD-03: game toast displayed among loot toasts');
  await waitToastsGone(t, 40000);

  // ------------------------------------------------------------- LT-PURGE-01
  // The flush (and its purge) is triggered by reserving CE 27 directly on the
  // map — same code path as a post-battle flush, but WITHOUT a scene change.
  // (A real Scene_Battle roundtrip destroys/recreates toast windows of its
  // own, which is vanilla scene lifecycle and only adds noise here.)
  await enqueueTestToast(t, 'LT-PURGE-old', { loot: true, displayTime: 3000 });
  await enqueueTestToast(t, 'LT-PURGE-game', { displayTime: 3000 });
  await pollToasts(t, s => s.slots.some(x => x.displaying && x.text === 'LT-PURGE-old') &&
    s.slots.some(x => x.displaying && x.text === 'LT-PURGE-game'),
    15000, 'LT-PURGE-01: both long-lived toasts on screen');
  await installRngStub(t);
  await setRng(t, 0); // intact corpse -> a real batch, so the flush happens
  await t.eval(`$gameVariables.setValue(22, 13); $gameTemp.reserveCommonEvent(27); 'ok'`);
  const flow = await watchLootFlow(t);
  t.assert(flow.done, 'LT-PURGE-01: loot flow drained');
  await setRng(t, null);
  const stP = await toastState(t);
  t.log(`LT-PURGE-01 after flush: ${JSON.stringify(stP.slots.filter(x => x.displaying).map(x => x.text))} queued=${JSON.stringify(stP.queued.map(q => q.text))}`);
  t.assert(!stP.slots.some(x => x.displaying && x.text === 'LT-PURGE-old'),
    'LT-PURGE-01: old loot toast closed on screen');
  t.assert(!stP.queued.some(q => q.text === 'LT-PURGE-old'),
    'LT-PURGE-01: old loot toast removed from the queue');
  t.assert(stP.slots.some(x => x.displaying && x.text === 'LT-PURGE-game') ||
    stP.queued.some(q => q.text === 'LT-PURGE-game'),
    'LT-PURGE-01: game toast NOT purged');

  const fresh = readModLog(logPath, logOffset).text;
  t.assert(!fresh.includes('[ERROR]'), 'LT-LOG-02: no ERROR in fresh mod log lines');
}
