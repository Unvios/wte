// HB-R-01..02 — vanilla paths stay intact: menu item use keeps its flow
// (menu-only items reopen the inventory, i.e. CE 313 survives outside the
// hotkey path) and a plain scripted battle runs to completion.
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, waitEventDone, setSlots,
  selectRowById, logMark, freshLogLines, runScriptedBattle,
  waitLootFlowStart, waitLootFlowEnd,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const JERKY = 2141;
const COFFEE = 2043; // menu-only whitelisted; CE 1132, no 313 of its own
const ANGLERS = 150; // menu-only whitelisted; CE 1903 + CE 313 (Inv Open)

export default async function hotbarRegression(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);

  await t.eval(`(() => {
    $gameParty.gainItem($dataItems[${JERKY}], 3);
    $gameParty.gainItem($dataItems[${ANGLERS}], 1);
    const a = Scene_Item.prototype.user();
    a.setHp(Math.max(1, a.mhp - 30));
    return 'ok';
  })()`);
  await setSlots(t, {});

  // HB-R-01a: vanilla menu use of a regular item applies its effect.
  await t.eval(`SceneManager.push(Scene_Item); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Item'`,
    { timeout: 15000, desc: 'Scene_Item open' });
  await t.sleep(500);
  let sel = await selectRowById(t, JERKY);
  t.assert(sel.ok, `R-01a cursor on jerky (${JSON.stringify(sel)})`);
  const hp0 = await t.eval(`Scene_Item.prototype.user().hp`);
  await t.key('enter');
  // A prompt (use/cancel?) may follow — confirm once more if still open.
  await t.sleep(400);
  for (let i = 0; i < 6; i++) {
    const st = await t.eval(`({
      hp: Scene_Item.prototype.user().hp,
      scene: SceneManager._scene.constructor.name,
    })`);
    if (st.hp > hp0) break;
    await t.key('enter');
    await t.sleep(400);
  }
  t.assert(await t.eval(`Scene_Item.prototype.user().hp`) > hp0, 'R-01a menu use healed');
  await waitEventDone(t).catch(() => {});

  // HB-R-01b: menu use of a menu-only item keeps CE 313 — the inventory
  // reopens afterwards (the hotbar path alone strips it).
  const onItemScene = async () => t.eval(`(() => {
    let s = SceneManager._scene;
    if (s instanceof Scene_Item) return true;
    return false;
  })()`);
  // Close whatever the jerky flow left open, back to the map.
  for (let i = 0; i < 10; i++) {
    const scene = await t.eval(`SceneManager._scene.constructor.name`);
    if (scene === 'Scene_Map') break;
    await t.key('escape');
    await t.sleep(300);
  }
  await waitFreeControl(t);

  await t.eval(`SceneManager.push(Scene_Item); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Item'`,
    { timeout: 15000, desc: 'Scene_Item open again' });
  await t.sleep(500);
  sel = await selectRowById(t, ANGLERS);
  t.assert(sel.ok, `R-01b cursor on angler's potion (${JSON.stringify(sel)})`);
  await t.key('enter');
  await t.sleep(400);
  for (let i = 0; i < 8; i++) {
    // confirm any prompt; the potion applies, then CE 313 reopens Scene_Item
    const done = await t.eval(`$gameParty.numItems($dataItems[${ANGLERS}]) === 0`);
    if (done) break;
    await t.key('enter');
    await t.sleep(400);
  }
  t.assert(await t.eval(`$gameParty.numItems($dataItems[${ANGLERS}])`) === 0,
    'R-01b potion consumed from the menu');
  await waitEventDone(t).catch(() => {});
  await t.sleep(1000);
  t.assert(await onItemScene(), 'R-01b inventory reopened after menu use (CE 313 intact)');

  // Close back to the map.
  for (let i = 0; i < 10; i++) {
    const scene = await t.eval(`SceneManager._scene.constructor.name`);
    if (scene === 'Scene_Map') break;
    await t.key('escape');
    await t.sleep(300);
  }
  await waitFreeControl(t);

  // HB-R-02: a plain battle (no hotkeys) completes with the loot flow.
  await runScriptedBattle(t, 13);
  try {
    await waitLootFlowStart(t, 20000);
    await waitLootFlowEnd(t, 30000);
    t.assert(true, 'R-02 battle + loot flow completed');
  } catch (e) {
    t.assert(false, 'R-02 loot flow did not complete: ' + e.message);
  }

  const fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
