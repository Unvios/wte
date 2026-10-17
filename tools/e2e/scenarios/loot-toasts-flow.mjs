// Loot Toasts E2E — no blocking windows after the battle (LT-FLOW-01/02) and
// the mangled-corpse branch (LT-SUM-03).
// The victory + CE 27 loot flow is ridden WITHOUT pressing enter: any
// "Victory!"/EXP/corpse/die-pause window would stall the flow and set busySeen.
//   Case 1: troop 13, rng=0  -> intact corpse, full loot flow, no busy ever,
//           free control within 2 s after the flow ends.
//   Case 2: troop 13, rng=99 -> corpse roll var2 = 100 > 50 = mangled: no loot
//           table, no die roll. Exactly one loot toast: EXP-only summary
//           (face=0, "200 EXP", no gold, no item toasts).
// Run: tools/e2e/run.sh tools/e2e/scenarios/loot-toasts-flow.mjs --sandbox --headless

import path from 'node:path';
import {
  waitTitle, loadFixtureSave, installRngStub, setRng, resetLootModifiers,
  startBattle, finishBattleNoClick, watchLootFlow, waitFreeControl,
  pollToasts, waitToastsGone, readModLog,
} from '../lib.mjs';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);
const TROOP_ID = 13; // Mall Administrator, exp 200, table CE 554
const EXP_RE = /ОП|EXP/i;

export default async function lootToastsFlow(t) {
  const logPath = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts', 'logs', 'loot_toasts.log');
  const logOffset = readModLog(logPath, 0).size;

  await waitTitle(t);
  await loadFixtureSave(t, SAVE_SLOT);
  await installRngStub(t);
  await resetLootModifiers(t);
  await t.sleep(500);

  async function flowCase(id, rng) {
    await setRng(t, rng);
    await startBattle(t, TROOP_ID); // clicky: dismisses the vanilla tutorial only
    const fin = await finishBattleNoClick(t);
    t.assert(fin.onMap, `${id}: back on the map without clicking`);
    t.assert(!fin.busySeen, `${id}: no victory/EXP message window (LT-FLOW-01)`);
    const flow = await watchLootFlow(t);
    t.assert(flow.done, `${id}: loot flow started and ended`);
    t.assert(!flow.busySeen, `${id}: no corpse/die-pause message window (LT-FLOW-01)`);
    return flow;
  }

  // ------------------------------------------------- case 1: intact corpse
  const flow1 = await flowCase('LT-FLOW-01 (intact)', 0);
  const controlAt = Date.now();
  await waitFreeControl(t);
  const delta = Date.now() - flow1.endedAt;
  t.assert(Date.now() - controlAt < 2000 && delta < 2500,
    `LT-FLOW-02: free control right after the flow (${delta} ms)`);
  t.log(`LT-FLOW-02: control returned ${delta} ms after the loot flow`);
  await setRng(t, null);
  await waitToastsGone(t);

  // ------------------------------------------------ case 2: mangled corpse
  await flowCase('LT-FLOW-01 (mangled)', 99);
  const st = await pollToasts(t, s => s.slots.some(x => x.displaying && x.loot),
    15000, 'LT-SUM-03: EXP-only summary visible');
  const loot = st.slots.filter(x => x.displaying && x.loot);
  const queuedLoot = st.queued.filter(q => q.loot);
  t.assert(loot.length === 1 && queuedLoot.length === 0,
    `LT-SUM-03: exactly one loot toast (got ${loot.length} + ${queuedLoot.length} queued)`);
  const summary = loot[0];
  t.assert(summary.face === 0, `LT-SUM-03: no die face (got ${summary.face})`);
  t.assert(EXP_RE.test(summary.text || '') && summary.text.includes('200'),
    `LT-SUM-03: summary is "200 EXP" ("${summary.text}")`);
  t.assert(!/i\[314\]/.test(summary.text || ''), `LT-SUM-03: no gold part ("${summary.text}")`);
  t.assert(!summary.text.includes('ii['), 'LT-SUM-03: no item content in the summary');
  t.log(`LT-SUM-03: mangled corpse -> EXP-only toast "${summary.text}"`);
  await t.shot('sum-03-mangled');
  await setRng(t, null);
  await waitToastsGone(t);

  const fresh = readModLog(logPath, logOffset).text;
  t.assert(!fresh.includes('[ERROR]'), 'LT-LOG-02: no ERROR in fresh mod log lines');
}
