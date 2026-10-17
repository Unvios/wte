// Loot Toasts E2E — battle start announcements (LT-BS-01..04).
// The intro watcher records the TEXT of every message window and dismisses
// them (the vanilla battle tutorial still fires in the fixture save). The
// assert is on content: no window may contain an announcement-shaped text.
//   BS-01 troop 5  "A Rat attacks!"                 -> suppressed
//   BS-02 troop 9  "A pair of Rats appear!" (x2)    -> suppressed
//   BS-03 troop 13 "The Mall Administrator appears!"-> suppressed
//   BS-04 troop 19 "The Hall Monitor stops you..." does NOT match the mod's
//     regex (verb not in the list) -> the vanilla window MUST appear (peek
//     path intact). Troop 1 is unusable here: its page has no conditions, so
//     the engine never runs it.
// Run: tools/e2e/run.sh tools/e2e/scenarios/loot-toasts-battle-start.mjs --sandbox --headless

import path from 'node:path';
import {
  waitTitle, loadFixtureSave, startBattleWatch, finishBattleNoClick,
  watchLootFlow, readModLog,
} from '../lib.mjs';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);

export default async function lootToastsBattleStart(t) {
  const logPath = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts', 'logs', 'loot_toasts.log');
  const logOffset = readModLog(logPath, 0).size;

  await waitTitle(t);
  await loadFixtureSave(t, SAVE_SLOT);
  await t.sleep(1000);

  // Same shape as the mod's announcement filter (short, article-first, verb).
  const isAnnouncement = (m) => m.trim().length < 70 && /^(A|An|The)\b/.test(m.trim()) &&
    /\b(appears?|attacks?|emerges?|approaches?)\b/i.test(m);

  async function suppressedCase(id, troopId, label) {
    const res = await startBattleWatch(t, troopId);
    t.log(`${id}: windows seen ${JSON.stringify(res.messages)} (${label})`);
    t.assert(!res.timeout, `${id}: battle reached the input phase (${label})`);
    const hits = res.messages.filter(isAnnouncement);
    t.assert(hits.length === 0,
      `${id}: no announcement window (${label}); offending: ${JSON.stringify(hits)}`);
    const fin = await finishBattleNoClick(t);
    t.assert(fin.onMap, `${id}: back on the map (${label})`);
    const flow = await watchLootFlow(t);
    t.assert(flow.done, `${id}: loot flow drained (${label})`);
    t.log(`${id}: PASS (${label})`);
  }

  await suppressedCase('LT-BS-01', 5, 'A Rat attacks!');
  await suppressedCase('LT-BS-02', 9, 'A pair of Rats appear!');
  await suppressedCase('LT-BS-03', 13, 'The Mall Administrator appears!');

  // ------------------------------------------------------------- LT-BS-04
  const res = await startBattleWatch(t, 19);
  t.log(`LT-BS-04: windows seen ${JSON.stringify(res.messages)} (non-matching announcement)`);
  t.assert(res.messages.some(m => m.includes('The Hall Monitor stops you')),
    'LT-BS-04: non-matching battle text still shows a vanilla window ("The Hall Monitor stops you...")');
  t.assert(!res.timeout, 'LT-BS-04: battle proceeds after the vanilla window');
  const fin = await finishBattleNoClick(t);
  t.assert(fin.onMap, 'LT-BS-04: back on the map after the vanilla announcement');
  const flow = await watchLootFlow(t);
  t.assert(flow.done, 'LT-BS-04: loot flow drained');
  t.log('LT-BS-04: PASS (vanilla path intact)');

  const fresh = readModLog(logPath, logOffset).text;
  t.assert(!fresh.includes('[ERROR]'), 'LT-LOG-02: no ERROR in fresh mod log lines');
}
