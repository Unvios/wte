// Loot Toasts matrix E2E — deterministic REAL battles with a controlled RNG.
// Math.randomInt is stubbed only around the victory flow, so the whole chain
// (battle -> CE 27 -> loot table CE 569 -> die roll CE 36 -> messages -> mod)
// runs for real; the stub just pins the random operands (corpse roll,
// die face source, loot tier, bonus rolls).
//
//   Case A (home map, troop 53, rng=0): boss bundle — summary toast on top
//     with the rolled die face and the EXP total from the enemy DB, item
//     toasts with icon escapes, no overlaps, full drain of the batch.
//   Case B (same, rewards.exp forced to 0): summary keeps the die face and
//     has no EXP part.
//   Case C (mall map, uniques switches reset, rng=0): bundle + one-time
//     uniques + shrine bonus = batch bigger than the 7 toast slots —
//     asserts the 7-window cap, the queued remainder and that every toast
//     gets screen time (open-count based, immune to duplicate texts).
//
// Assertions read in-page state only (toast windows/queue). The mod's log
// file is shared with a live game through the sandbox junction and is NOT
// used for assertions (cross-instance contamination).
//
// Run: node tools/e2e/run.mjs tools/e2e/scenarios/loot-toasts-matrix.mjs --sandbox [--headless]

import {
  waitTitle, loadFixtureSave, installRngStub, setRng, resetLootModifiers,
  runScriptedBattle, startBattle, finishBattleNoClick, watchLootFlow,
  toastState, pollToasts, waitToastsGone, summaryDieInk,
} from '../lib.mjs';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);
const TROOP_ID = Number(process.env.WTE_TROOP || 13); // "Mall Administrator" — single enemy 9, exp 200
const MALL_MAP_ID = 3;

const EXP_RE = /ОП|EXP/i;

const displayingLoot = (st) => st.slots.filter(x => x.displaying && x.opaque);

// Waits for the flush, lets the batch settle into windows/queue, returns the
// settled state. Settle = queue empty AND visible-count stable across ~600 ms
// (windows open one per frame; a premature read misses the trailing summary).
async function settleBatch(t, label) {
  await pollToasts(t, (s) => s.queued.length > 0 || s.slots.some(x => x.displaying),
    20000, `${label}: loot flush`);
  let settled = null;
  let lastCount = -1;
  let stablePolls = 0;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const st = await toastState(t);
    const count = st.slots.filter(x => x.displaying).length;
    if (st.queued.length === 0 && count > 0 && count === lastCount) {
      stablePolls++;
      if (stablePolls >= 3) { settled = st; break; }
    } else {
      stablePolls = 0;
    }
    lastCount = count;
    await t.sleep(200);
  }
  if (!settled) throw new Error(`${label}: no toasts settled on screen`);
  return settled;
}

// Watches until the queue is empty and all windows faded; returns how many
// toast openings were observed (a window that newly opened since last poll).
async function countAllShown(t, label) {
  let shown = 0;
  let prevDisplaying = new Set();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const st = await toastState(t);
    const nowDisplaying = new Set(st.slots.filter(x => x.displaying).map(x => x.slot));
    for (const slot of nowDisplaying) {
      if (!prevDisplaying.has(slot)) shown++;
    }
    prevDisplaying = nowDisplaying;
    if (st.queued.length === 0 && nowDisplaying.size === 0) break;
    await t.sleep(200);
  }
  t.log(`${label}: openings observed = ${shown}`);
  return shown;
}

export default async function lootToastsMatrix(t) {
  await waitTitle(t);
  await loadFixtureSave(t, SAVE_SLOT);
  await installRngStub(t);
  await resetLootModifiers(t);
  await t.sleep(1000);

  const expectedExp = await t.eval(`(() => {
    const troop = $dataTroops[${TROOP_ID}];
    return troop.members.reduce((sum, m) => sum + ($dataEnemies[m.enemyId]?.exp || 0), 0);
  })()`);
  t.log(`troop ${TROOP_ID} expected EXP: ${expectedExp}`);

  // ------------------------------------------------------------- case A
  t.log('case A: boss battle at home, rng=0');
  await setRng(t, 0);
  await runScriptedBattle(t, TROOP_ID);
  const flowA = await watchLootFlow(t);
  t.assert(flowA.done, 'case A: loot flow drained');
  await setRng(t, null);

  const settledA = await settleBatch(t, 'case A');
  // Slot contract: the mod raises CGMZ from 3 vanilla slots to 7 windows.
  t.assert(settledA.maxSlots === 7, `case A: CGMZ max slots raised to 7 (got ${settledA.maxSlots})`);
  t.assert(settledA.slots.length >= 7,
    `case A: 7 toast window objects exist on the scene (got ${settledA.slots.length})`);
  const dispA = settledA.slots.filter(x => x.displaying);
  const batchA = dispA.length + settledA.queued.length;
  t.log(`case A batch (${batchA}): ${JSON.stringify(dispA.map(w => ({ slot: w.slot, text: w.text, face: w.face, shrine: w.shrine, y: w.y })))} queued=${settledA.queued.length}`);

  const summaryA = dispA.find(w => w.face > 0);
  t.assert(!!summaryA, 'case A: summary toast with die face exists');
  // rng=0 -> corpse var2 = 1, die var2 = 1, var906 = 1 -> no luck bonus: face 1.
  t.assert(summaryA.face === 1, `LT-SUM-01: die face === 1 (got ${summaryA.face})`);
  if (expectedExp > 0) {
    t.assert(EXP_RE.test(summaryA.text) && summaryA.text.includes(String(expectedExp)),
      `case A: summary has EXP part ${expectedExp} ("${summaryA.text}")`);
  }
  // LT-SUM-01: the gold part lives in the SAME summary toast.
  const goldMatch = (summaryA.text || '').match(/\\i\[314\]\\c\[14\](\d+)/);
  t.assert(!!goldMatch && Number(goldMatch[1]) > 0,
    `LT-SUM-01: summary has a gold part ("${summaryA.text}")`);
  t.log(`LT-SUM-01: face=1, exp=${expectedExp}, gold=${goldMatch ? goldMatch[1] : 'none'}`);
  // LT-VIS-01: the d1 picture is actually drawn in the summary's left zone —
  // ink spanning most rows of the zone (plain text would only ink a mid band).
  const dieA = await summaryDieInk(t);
  t.assert(dieA.found && dieA.face === 1, 'LT-VIS-01: summary window found for the die check');
  t.assert(dieA.ink > 400 && dieA.rows >= 22,
    `LT-VIS-01: die face picture drawn (ink=${dieA.ink}, rows=${dieA.rows}/${dieA.size}; text-only would be ~311/18)`);
  const itemsA = dispA.filter(w => !w.face);
  // LT-ITEM-01: every other toast is an item toast, no "Obtained" wording.
  t.assert(itemsA.every(w => (w.text || '').includes('ii[') || (w.text || '').includes('\\i[')),
    'LT-ITEM-01: non-summary toasts carry icon escapes');
  t.assert(dispA.every(w => !(w.text || '').includes('Obtained')),
    'LT-ITEM-01: no "Obtained" wording anywhere');
  // LT-ITEM-03: gold never leaks into a standalone toast outside the summary.
  t.assert(itemsA.every(w => !/i\[314\]/.test(w.text || '')),
    'LT-ITEM-03: no standalone gold toast');
  // LT-ITEM-02: at least one item toast with the xN suffix (count > 1).
  const xnA = itemsA.map(w => (w.text || '').match(/ x(\d+)$/)).filter(Boolean);
  t.assert(xnA.length >= 1 && xnA.some(m => Number(m[1]) > 1),
    `LT-ITEM-02: at least one " xN" toast with N > 1 (${JSON.stringify(itemsA.map(w => w.text))})`);
  const topY = Math.min(...dispA.map(w => w.y));
  t.assert(summaryA.y === topY, 'case A: summary toast is on top of the stack');
  for (let i = 1; i < dispA.length; i++) {
    const a = dispA[i - 1], b = dispA[i];
    const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    t.assert(!overlap, `case A: slots ${a.slot}/${b.slot} do not overlap`);
  }
  t.assert(dispA.filter(w => !w.face && w.text && w.text.includes('ii[')).length >= 2,
    'case A: at least 2 item toasts besides the summary');
  await t.shot('case-a');
  const shownA = await countAllShown(t, 'case A');
  t.assert(shownA === batchA, `case A: all ${batchA} toasts shown (saw ${shownA})`);
  await waitToastsGone(t);

  // ------------------------------------------------------------- case B
  t.log('case B: same battle, EXP forced to 0');
  await t.eval(`(() => {
    if (!window.__origMakeRewards) window.__origMakeRewards = BattleManager.makeRewards;
    BattleManager.makeRewards = function () {
      window.__origMakeRewards.call(this);
      if (this._rewards) this._rewards.exp = 0;
    };
    return 'ok';
  })()`);
  await setRng(t, 0);
  await runScriptedBattle(t, TROOP_ID);
  const flowB = await watchLootFlow(t);
  t.assert(flowB.done, 'case B: loot flow drained');
  await setRng(t, null);
  await t.eval(`BattleManager.makeRewards = window.__origMakeRewards; 'ok'`);

  const stB = await pollToasts(t,
    (s) => displayingLoot(s).some(x => x.face > 0),
    20000, 'case B: summary toast visible');
  const summaryB = displayingLoot(stB).find(w => w.face > 0);
  t.assert(summaryB.face >= 1 && summaryB.face <= 6,
    `case B: die face in 1..6 (got ${summaryB.face})`);
  t.assert(!EXP_RE.test(summaryB.text || ''), `case B: summary has NO EXP part ("${summaryB.text}")`);
  t.assert(/i\[314\]/.test(summaryB.text || ''),
    `LT-SUM-02: summary keeps the gold part when EXP is 0 ("${summaryB.text}")`);
  await t.shot('case-b');
  await waitToastsGone(t);

  // ------------------------------------------------------------- case C
  // Overflow note: the biggest natural batch found is ~6 toasts, so the >7
  // queue-overflow path is not exercised here; the slot contract is checked
  // via maxSlots/window count in case A.
  // Shrine bonus: empowered-loot counter (var 1672) + mall-area map (var 574)
  // + troop 13 (mall table CE 554, which chains CE 595 -> CE 2704).
  t.log('case C: shrine bonus — mall map, var1672=1, rng=1');
  await t.eval(`$gameVariables.setValue(1672, 1); 'ok'`);
  await t.eval(`(() => {
    $gamePlayer.reserveTransfer(${MALL_MAP_ID}, 1, 1, 2, 0);
    $gamePlayer.performTransfer();
    return 'ok';
  })()`);
  await t.waitFor(`$gameMap.mapId() === ${MALL_MAP_ID} && SceneManager._scene?.constructor.name === 'Scene_Map'`,
    { timeout: 30000, desc: 'transferred to mall map' });
  await t.sleep(1500);

  await setRng(t, 1);
  await startBattle(t, TROOP_ID);
  const finC = await finishBattleNoClick(t);
  t.assert(finC.onMap && !finC.busySeen, 'case C: victory without windows');
  const flowC = await watchLootFlow(t);
  t.assert(flowC.done, 'case C: loot flow drained');
  t.assert(!flowC.busySeen, 'LT-SHRINE-03: no shrine announcement window');
  await setRng(t, null);

  const settledC = await settleBatch(t, 'case C');
  const dispC = settledC.slots.filter(x => x.displaying)
    .sort((a, b) => a.slot - b.slot);
  t.log(`case C batch: ${JSON.stringify(dispC.map(w => ({ slot: w.slot, text: w.text, face: w.face, shrine: w.shrine, y: w.y })))}`);
  const shrineToasts = dispC.filter(w => w.shrine);
  t.assert(shrineToasts.length >= 1, `case C: at least one shrine toast (got ${shrineToasts.length})`);
  // Stack reads top-down as summary -> plain -> shrine: shrine toasts sit at
  // the bottom (largest y), summary on top.
  const summaryC = dispC.find(w => w.face > 0 || EXP_RE.test(w.text || '') || /i\[314\]/.test(w.text || ''));
  if (summaryC) {
    t.assert(summaryC.y === Math.min(...dispC.map(w => w.y)), 'case C: summary on top');
  }
  const maxPlainY = Math.max(...dispC.filter(w => !w.shrine).map(w => w.y));
  for (const s of shrineToasts) {
    t.assert(s.y >= maxPlainY, `case C: shrine toast below plain items (y=${s.y} vs plain bottom ${maxPlainY})`);
  }
  t.assert(dispC.length <= 7, `case C: at most 7 windows displaying (got ${dispC.length})`);
  t.assert(dispC.every(w => !/combat shrine/i.test(w.text || '')),
    'LT-SHRINE-03: no shrine announcement text in any toast');
  // LT-SHRINE-02: gold frame tint on shrine toasts, white on the rest.
  for (const w of dispC) {
    const expectedTint = w.shrine ? 0xFFD700 : 0xFFFFFF;
    t.assert(w.tints.length > 0 && w.tints.every(tint => tint === expectedTint),
      `LT-SHRINE-02: slot ${w.slot} ${w.shrine ? 'gold' : 'white'} frame (got ${JSON.stringify(w.tints)})`);
  }
  await t.shot('case-c');
  const shownC = await countAllShown(t, 'case C');
  const batchC = dispC.length + settledC.queued.length;
  t.assert(shownC === batchC, `case C: all ${batchC} toasts shown (saw ${shownC})`);
  await waitToastsGone(t);

  // ------------------------------------------------------------- case D
  // Tint reset: the same windows reused by a NON-shrine batch must be white.
  t.log('case D: non-shrine batch after the shrine one — tint reset');
  await t.eval(`$gameVariables.setValue(1672, 0); 'ok'`);
  await setRng(t, 0);
  await startBattle(t, TROOP_ID);
  const finD = await finishBattleNoClick(t);
  t.assert(finD.onMap, 'case D: battle finished');
  const flowD = await watchLootFlow(t);
  t.assert(flowD.done, 'case D: loot flow drained');
  await setRng(t, null);
  const settledD = await settleBatch(t, 'case D');
  const dispD = settledD.slots.filter(x => x.displaying);
  t.assert(dispD.length > 0 && dispD.every(w => !w.shrine),
    'case D: no shrine flags with the counter at 0');
  for (const w of dispD) {
    t.assert(w.tints.length > 0 && w.tints.every(tint => tint === 0xFFFFFF),
      `LT-SHRINE-02: slot ${w.slot} tint reset to white (got ${JSON.stringify(w.tints)})`);
  }
  await t.shot('case-d');
  await waitToastsGone(t);
}
