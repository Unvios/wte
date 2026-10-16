// HB-F-01..10 — field use of items: effects, consumption, toasts, whitelist,
// CE 313 strip, refusal branches, toast localization.
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, waitEventDone, setSlots, pressDigit,
  logMark, freshLogLines, pollToasts, installRngStub, setRng, toastVisual,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const JERKY = 2141;   // food: recover HP 65 + CE 342/343, occasion 0
const COFFEE = 2043;  // occasion 2 whitelisted, CE 1132 (no 313)
const DIE = 79;       // Lucky Die: scope-less CE 51 + CE 313
const ANGLERS = 150;  // Angler's Potion: buff CE 1903 + CE 313
const COMBAT_DRINK = 2064; // occasion 1 (battle only)

const userHp = () => t0.eval(`Scene_Item.prototype.user().hp`);
let t0 = null; // set in main

export default async function hotbarFieldItems(t) {
  t0 = t;
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);
  const slots = () => t.eval(`JSON.stringify($gameSystem._wteConsumableHotkeys)`).then(JSON.parse);
  const numItems = (id) => t.eval(`$gameParty.numItems($dataItems[${id}])`);

  await t.eval(`(() => {
    $gameParty.gainItem($dataItems[${JERKY}], 5);
    $gameParty.gainItem($dataItems[${COFFEE}], 1);
    $gameParty.gainItem($dataItems[${DIE}], 1);
    $gameParty.gainItem($dataItems[${ANGLERS}], 1);
    $gameParty.gainItem($dataItems[${COMBAT_DRINK}], 1);
    const a = Scene_Item.prototype.user();
    a.setHp(Math.max(1, a.mhp - 30));
    return 'ok';
  })()`);

  // HB-F-01 + HB-F-02: food from the hotkey heals, consumes, toasts.
  // The toast lives ~3 s — poll for it FIRST, then verify state.
  await setSlots(t, { 0: { t: 'item', id: JERKY } });
  const hp0 = await userHp();
  const jerky0 = await numItems(JERKY);
  await pressDigit(t, 1);
  let st = await pollToasts(t,
    (s) => s.slots.some(x => x.displaying && x.text && x.text.includes('Used:')),
    5000, 'F-02 use toast');
  const toastText = st.slots.find(x => x.displaying && x.text && x.text.includes('Used:')).text;
  t.assert(toastText.includes('\\i['), `F-02 toast has the icon code: ${toastText}`);
  t.log(`F-02 toast: ${toastText}`);

  // HB-V-01: toast visuals — centered bottom anchor, opaque, real pixels:
  // colorful icon, white prefix, name in color 6.
  const v = await toastVisual(t, 'Used:');
  t.assert(v.found, 'V-01 toast window readable for pixel checks');
  t.assert(Math.abs(v.x + v.w / 2 - v.gw / 2) < 60,
    `V-01 horizontally centered: x=${v.x} w=${v.w} gw=${v.gw}`);
  t.assert(v.y > v.gh * 0.5, `V-01 bottom half of the screen: y=${v.y} gh=${v.gh}`);
  // Note: opacity is not asserted — pollToasts catches the toast at fade-in
  // start (opacity still ~0) and headless ramps it slowly. The pixel checks
  // below are opacity-independent (contents bitmap alpha, not window opacity).
  t.assert(v.inkRatio > 0.005, `V-01 content drawn (ink ${(v.inkRatio * 100).toFixed(1)}%)`);
  t.assert(v.colorful > 20, `V-01 icon pixels present (colorful=${v.colorful})`);
  t.assert(v.whitish > 20, `V-01 white "Used:" prefix pixels (whitish=${v.whitish})`);
  t.assert(v.nameColor > 20, `V-01 name pixels in color 6 (nameColor=${v.nameColor})`);
  await t.shot('F-01-use-toast');

  await t.waitFor(`Scene_Item.prototype.user().hp > ${hp0}`,
    { timeout: 5000, desc: 'F-01 jerky healed' });
  t.assert((await numItems(JERKY)) === jerky0 - 1, 'F-01 jerky consumed');
  await waitFreeControl(t);

  // HB-F-03: empty stock refused.
  await t.eval(`$gameParty.loseItem($dataItems[${JERKY}], $gameParty.numItems($dataItems[${JERKY}])); 'ok'`);
  const hpBeforeEmpty = await userHp();
  await pressDigit(t, 1);
  await t.sleep(400);
  t.assert((await userHp()) === hpBeforeEmpty, 'F-03 no heal with empty stock');
  let fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('stock=0'), 'F-03 log refusal stock=0');
  await t.eval(`$gameParty.gainItem($dataItems[${JERKY}], 3); 'ok'`);

  // HB-F-04: whitelisted menu-only item (coffee) works on the field.
  await setSlots(t, { 1: { t: 'item', id: COFFEE } });
  const coffee0 = await numItems(COFFEE);
  await pressDigit(t, 2);
  await t.waitFor(`$gameParty.numItems($dataItems[${COFFEE}]) === ${coffee0 - 1}`,
    { timeout: 5000, desc: 'F-04 coffee consumed' });
  await pollToasts(t, (s) => s.slots.some(x => x.displaying && x.text && x.text.includes('Used:')),
    5000, 'F-04 coffee toast');
  await waitEventDone(t);
  await waitFreeControl(t);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('(#2043)'), 'F-04 log: coffee used');

  // HB-F-05: scope-less CE item (Lucky Die) without a target.
  await installRngStub(t);
  await setRng(t, 0);
  await setSlots(t, { 2: { t: 'item', id: DIE } });
  await pressDigit(t, 3);
  await t.waitFor(`$gameParty.numItems($dataItems[${DIE}]) === 0`,
    { timeout: 5000, desc: 'F-05 die consumed' });
  await waitEventDone(t);
  await setRng(t, null);
  await waitFreeControl(t);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('(#79)'), 'F-05 log: die used');
  t.assert(fresh.includes('CE reserved: true'), 'F-05 log: CE was reserved');

  // HB-F-06: CE 313 ("Inv Open") stripped — inventory must NOT open.
  await setSlots(t, { 3: { t: 'item', id: ANGLERS } });
  await pressDigit(t, 4);
  await t.waitFor(`$gameParty.numItems($dataItems[${ANGLERS}]) === 0`,
    { timeout: 5000, desc: 'F-06 potion consumed' });
  await waitEventDone(t);
  await t.sleep(500);
  const sceneName = await t.eval(`SceneManager._scene.constructor.name`);
  t.assert(sceneName === 'Scene_Map', `F-06 still on the map (CE 313 stripped), scene=${sceneName}`);
  await waitFreeControl(t);

  // HB-F-07: battle-only item refused on the field.
  await setSlots(t, { 4: { t: 'item', id: COMBAT_DRINK } });
  await pressDigit(t, 5);
  await t.sleep(400);
  t.assert((await numItems(COMBAT_DRINK)) === 1, 'F-07 combat drink not consumed');
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('(#2064)') && fresh.includes('occasion=1'), 'F-07 log refusal occasion=1');

  // HB-F-08: full HP — effect would not apply, refused (like the field menu).
  // Jerky's real effects include common events, which testApply treats as
  // always-applicable, so trim effects to the bare heal for this case.
  await setSlots(t, { 0: { t: 'item', id: JERKY } });
  await t.eval(`(() => {
    $gameParty.members().forEach(a => a.setHp(a.mhp));
    const it = $dataItems[${JERKY}];
    window.__f8 = it.effects;
    it.effects = it.effects.filter(e => e.code === 11);
    return 'ok';
  })()`);
  const jerkyFull = await numItems(JERKY);
  await pressDigit(t, 1);
  await t.sleep(400);
  t.assert((await numItems(JERKY)) === jerkyFull, 'F-08 jerky not consumed at full HP');
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('applies=[false]'), 'F-08 log refusal applies=false');
  await t.eval(`$dataItems[${JERKY}].effects = window.__f8; 'ok'`);

  // HB-F-09: binding pointing at a deleted database entry.
  await setSlots(t, { 5: { t: 'item', id: 9999 } });
  await pressDigit(t, 6);
  await t.sleep(400);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('no longer exists in the database'), 'F-09 log: missing item refusal');

  // HB-F-10: toast prefix localizes with ConfigManager.language.
  await t.eval(`(() => {
    const a = Scene_Item.prototype.user();
    a.setHp(Math.max(1, a.mhp - 30));
    ConfigManager.language = 'ru';
    ConfigManager.save();
    return 'ok';
  })()`);
  await setSlots(t, { 6: { t: 'item', id: JERKY } });
  await pressDigit(t, 7);
  st = await pollToasts(t,
    (s) => s.slots.some(x => x.displaying && x.text && x.text.includes('Использовано:')),
    5000, 'F-10 ru toast');
  t.log('F-10 ru toast: ' + st.slots.find(x => x.displaying && x.text).text);
  await t.eval(`ConfigManager.language = 'en'; ConfigManager.save(); 'ok'`);
  await waitFreeControl(t);

  fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
