// HB-BT-01..08 — battle usage: item/skill become the inputting actor's action,
// auto-targeting, refusal branches, no hijack during target selection, no
// loadouts and no extra toasts in battle.
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, setSlots, pressDigit,
  pressCtrlDigit, logMark, freshLogLines, startBattle, finishBattle,
  toastState, waitLootFlowStart, waitLootFlowEnd,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const TROOP = 13;      // Mall Administrator: single enemy, no death resist
const JERKY = 2141;    // occasion 0 food
const COFFEE = 2043;   // occasion 2 whitelisted — still battle-forbidden
const DARK_BLAST = 12; // attack ritual, scope 1
const MENDING = 52;    // heal ritual, scope 11

export default async function hotbarBattle(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);

  await t.eval(`(() => {
    const a = $gameParty.menuActor();
    a.learnSkill(${DARK_BLAST});
    a.learnSkill(${MENDING});
    a.setMp(a.mmp);
    a.setHp(Math.max(1, a.mhp - 40));
    $gameParty.gainItem($dataItems[${JERKY}], 3);
    $gameParty.gainItem($dataItems[${COFFEE}], 1);
    return 'ok';
  })()`);
  await setSlots(t, {
    0: { t: 'item', id: JERKY },
    1: { t: 'item', id: COFFEE },
    2: { t: 'skill', id: DARK_BLAST },
    3: { t: 'skill', id: MENDING },
    // slots 5-9 stay empty (BT-08 uses slot 10 / digit 0)
  });

  await startBattle(t, TROOP);
  // VisuMZ keeps _phase at 'turn' while the actor command window is up —
  // isInputting()+actor() is the reliable "ready for a hotkey" signal.
  const waitInput = () => t.waitFor(
    `BattleManager.isInputting() && !!BattleManager.actor()`,
    { timeout: 45000, desc: 'input phase' });
  await waitInput();

  const actorName = await t.eval(`BattleManager.actor().name()`);
  t.log(`battle input actor: ${actorName}`);

  // HB-BT-08: empty slot press changes nothing.
  await pressDigit(t, 0);
  await t.sleep(300);
  t.assert(await t.eval(`BattleManager.isInputting() && !BattleManager.inputtingAction().item()`),
    'BT-08 empty slot: no action set');

  // HB-BT-05: whitelisted menu-only item refused in battle (like vanilla).
  const coffee0 = await t.eval(`$gameParty.numItems($dataItems[${COFFEE}])`);
  await pressDigit(t, 2);
  await t.sleep(300);
  t.assert(await t.eval(`(() => { const a = BattleManager.inputtingAction(); return !a || !a.item(); })()`), 'BT-05 coffee: no action set');
  t.assert((await t.eval(`$gameParty.numItems($dataItems[${COFFEE}])`)) === coffee0,
    'BT-05 coffee not consumed');
  let fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('battle use refused'), 'BT-05 log: item refusal');

  // HB-BT-04: skill without MP refused.
  await t.eval(`BattleManager.actor().setMp(0); 'ok'`);
  await pressDigit(t, 3);
  await t.sleep(300);
  t.assert(await t.eval(`(() => { const a = BattleManager.inputtingAction(); return !a || !a.item(); })()`), 'BT-04 no-MP: no action set');
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('battle skill refused'), 'BT-04 log: skill refusal');
  await t.eval(`BattleManager.actor().setMp(BattleManager.actor().mmp); 'ok'`);

  // HB-BT-07: Ctrl+digit does nothing in battle (no loadout swaps).
  const equipsBefore = await t.eval(`JSON.stringify($gameParty.menuActor().equips().map(e => e && e.id))`);
  await pressCtrlDigit(t, 1);
  await t.sleep(400);
  t.assert(await t.eval(`(() => { const a = BattleManager.inputtingAction(); return !a || !a.item(); })()`),
    'BT-07 Ctrl+1: no action set');
  t.assert(await t.eval(`JSON.stringify($gameParty.menuActor().equips().map(e => e && e.id))`) === equipsBefore,
    'BT-07 equips unchanged');

  // HB-BT-06: digits must not hijack an open target selection.
  await waitInput();
  await t.eval(`BattleManager.inputtingAction().setItem(${JERKY}); 'ok'`);
  await pressDigit(t, 4);
  await t.sleep(300);
  t.assert(await t.eval(`(() => { const a = BattleManager.inputtingAction(); return a && a.isItem(); })()`),
    'BT-06 action unchanged while target selection open');
  await t.eval(`(() => { const a = BattleManager.inputtingAction(); if (a) a.clear(); return 'ok'; })()`);
  await waitInput();

  // HB-BT-01: item becomes the actor's action and executes on the turn.
  // (No mid-state assert on inputtingAction: with a single actor the phase
  // advances within a frame of selectNextCommand, so it is racy by design.)
  const jerky0 = await t.eval(`$gameParty.numItems($dataItems[${JERKY}])`);
  await pressDigit(t, 1);
  await t.waitFor(`$gameParty.numItems($dataItems[${JERKY}]) === ${jerky0 - 1}`,
    { timeout: 60000, desc: 'BT-01 jerky consumed on execution' });
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('used in battle:'), 'BT-01 log: battle use');
  // No hotbar toast in battle — the engine announces the action itself.
  const toastCheck = await toastState(t);
  t.assert(!toastCheck.slots.some(x => x.displaying && x.text && x.text.includes('Used:')),
    'BT-01 no "Used:" toast in battle');

  // Next input phase (the enemy takes its turn).
  await waitInput();
  await t.eval(`(() => { const a = BattleManager.actor();
    a.setHp(Math.max(1, a.mhp - 40)); a.setMp(a.mmp); return 'ok'; })()`);

  // HB-BT-03: heal ritual targets the actor himself.
  const hpM = await t.eval(`$gameParty.menuActor().hp`);
  await pressDigit(t, 4);
  await t.waitFor(`$gameParty.menuActor().hp > ${hpM}`,
    { timeout: 60000, desc: 'BT-03 mending healed in battle' });

  // Next input phase.
  await waitInput();
  await t.eval(`BattleManager.actor().setMp(BattleManager.actor().mmp); 'ok'`);

  // HB-BT-02: attack ritual targets the first alive enemy.
  const enemyHp0 = await t.eval(`$gameTroop.aliveMembers()[0].hp`);
  const mpB = await t.eval(`BattleManager.actor().mp`);
  await pressDigit(t, 3);
  await t.waitFor(`$gameTroop.aliveMembers().length === 0 || $gameTroop.aliveMembers()[0].hp < ${enemyHp0}`,
    { timeout: 60000, desc: 'BT-02 enemy took damage' });
  t.assert(await t.eval(`$gameParty.menuActor().mp`) < mpB, 'BT-02 MP spent');

  // Wrap up: kill whatever is left, ride the victory flow home.
  await finishBattle(t);
  try {
    await waitLootFlowStart(t, 20000);
    await waitLootFlowEnd(t, 30000);
  } catch (e) {
    t.log('loot flow wait: ' + e.message);
  }

  fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
