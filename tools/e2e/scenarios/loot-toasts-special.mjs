// Loot Toasts E2E — special drop via direct command128 (LT-SPEC-01).
// Setup: switch 247 = OFF (MZ event semantics: command111/121 use 0 = ON,
// 1 = OFF; the drop branch requires the unique to be NOT looted yet = OFF),
// troop 8 (Rat v2, table CE 551), rng=5.
// Traced live: CE 35 rolls var2 = 6, then CE 138 adds +2 -> var2 = 8, so the
// "var2 >= 7" special branch fires (face is still 6: any var2 >= 6 -> CE 34).
// That branch drops armor 152 "Cloak of Darkness" via a direct command128 and
// marks switch 247 = ON. (The var2>=6 "Spiked Bat" branch is jumped over by
// design of the loot table, so the armor is the deterministic target here.)
// The mod must rebuild that toast from the tracked drop (lastDrop), not from
// the raw "Obtained ..." string: \i[<icon>] + localized name, no \ii[.
// Run: tools/e2e/run.sh tools/e2e/scenarios/loot-toasts-special.mjs --sandbox --headless

import path from 'node:path';
import {
  waitTitle, loadFixtureSave, installRngStub, setRng, resetLootModifiers,
  startBattle, finishBattleNoClick, watchLootFlow, pollToasts, waitToastsGone,
  readModLog,
} from '../lib.mjs';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);
const TROOP_ID = 8;
const ARMOR_ID = 152; // Cloak of Darkness

export default async function lootToastsSpecial(t) {
  const logPath = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts', 'logs', 'loot_toasts.log');
  const logOffset = readModLog(logPath, 0).size;

  await waitTitle(t);
  await loadFixtureSave(t, SAVE_SLOT);
  await installRngStub(t);
  await resetLootModifiers(t);
  await t.eval(`$gameSwitches.setValue(247, false); 'ok'`);
  const before = await t.eval(`$gameParty.numItems($dataArmors[${ARMOR_ID}])`);
  const icon = await t.eval(`$dataArmors[${ARMOR_ID}].iconIndex`);
  const dbName = await t.eval(`$dataArmors[${ARMOR_ID}].name`);
  t.log(`setup: Cloak of Darkness icon=${icon}, dbName="${dbName}", owned before=${before}`);

  await setRng(t, 5);
  await startBattle(t, TROOP_ID);
  const fin = await finishBattleNoClick(t);
  t.assert(fin.onMap && !fin.busySeen, 'LT-SPEC-01: victory without windows');
  const flow = await watchLootFlow(t);
  t.assert(flow.done, 'LT-SPEC-01: loot flow drained');
  await setRng(t, null);

  // The summary is enqueued last: once it displays, the whole small batch is
  // on screen or still queued — read both.
  const st = await pollToasts(t, s => s.slots.some(x => x.displaying && x.loot && x.face > 0),
    15000, 'LT-SPEC-01: summary with die face visible');
  const displaying = st.slots.filter(x => x.displaying && x.loot);
  const all = [
    ...displaying.map(x => ({ text: x.text, face: x.face })),
    ...st.queued.filter(q => q.loot).map(q => ({ text: q.text, face: q.face })),
  ];
  t.log(`LT-SPEC-01 batch: ${JSON.stringify(all)}`);

  const summary = all.find(x => x.face > 0);
  t.assert(summary.face === 6, `LT-SPEC-01: summary die face === 6 (got ${summary.face})`);

  // The event's hardcoded text is just "Cloak of Darkness", but the DB name is
  // "Cloak of Darkness +2" — the mod deliberately shows the DB name.
  const expected = `\\i[${icon}]\\c[14]${dbName}\\c[0]`;
  const cloak = all.find(x => (x.text || '').includes('Cloak of Darkness'));
  t.assert(!!cloak, 'LT-SPEC-01: Cloak of Darkness toast exists');
  t.assert(cloak.text === expected,
    `LT-SPEC-01: toast rebuilt from the DB ("${cloak.text}" === "${expected}")`);
  t.assert(!cloak.text.includes('ii['), 'LT-SPEC-01: special drop does not use the \\ii macro');
  t.assert(all.every(x => !(x.text || '').includes('Obtained')),
    'LT-SPEC-01: no "Obtained" wording anywhere');

  const after = await t.eval(`$gameParty.numItems($dataArmors[${ARMOR_ID}])`);
  t.assert(after === before + 1, `LT-SPEC-01: armor actually granted (${before} -> ${after})`);
  const uniqueLeft = await t.eval(`$gameSwitches.value(247)`);
  t.assert(uniqueLeft === true, 'LT-SPEC-01: unique switch 247 marked as looted (ON)');
  await t.shot('spec-01-cloak');
  await waitToastsGone(t);

  const fresh = readModLog(logPath, logOffset).text;
  t.assert(!fresh.includes('[ERROR]'), 'LT-LOG-02: no ERROR in fresh mod log lines');
}
