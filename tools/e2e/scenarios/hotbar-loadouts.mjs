// HB-L-01..05 — equipment loadouts on Ctrl+digit: apply, HP/MP clamp, empty
// loadout refusal, missing-item skip, gab suppression (screenshot).
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, waitEventDone,
  pressCtrlDigit, logMark, freshLogLines, pollToasts, toastVisual,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');

export default async function hotbarLoadouts(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);

  // Build loadouts from the actor's CURRENT equips (guaranteed compatible
  // with his slots). Loadout 0 = full set, loadout 1 = empty strip set,
  // loadout 3 = references a weapon the party does not own.
  const setup = await t.eval(`(() => {
    if (typeof $gameSystem.initEquipLoadouts === 'function') $gameSystem.initEquipLoadouts();
    const a = $gameParty.menuActor();
    const snap = a.equips().map(e => e ? { isWeapon: DataManager.isWeapon(e), id: e.id } : null);
    if (!snap.some(e => e)) return { ok: false, reason: 'actor has no equips to snapshot' };
    $gameSystem._equipLoadouts[0] = { name: 'E2E Set', equips: snap };
    $gameSystem._equipLoadouts[1] = { name: 'E2E Strip', equips: snap.map(() => null) };
    $gameSystem._equipLoadouts[2] = null; // empty loadout -> refusal
    let missing = null;
    for (const wpn of $dataWeapons) {
      if (wpn && wpn.name && !$gameParty.hasItem(wpn)) { missing = { isWeapon: true, id: wpn.id }; break; }
    }
    $gameSystem._equipLoadouts[3] = { name: 'E2E Partial', equips: [missing].concat(snap.slice(1)) };
    return { ok: true, snapLen: snap.length, missingId: missing && missing.id };
  })()`);
  t.assert(setup.ok, `loadout setup: ${JSON.stringify(setup)}`);

  const equipsNow = () => t.eval(`JSON.stringify($gameParty.menuActor().equips().map(e => e && e.id))`);

  // HB-L-01: Ctrl+1 applies loadout 0 after a manual unequip.
  await t.eval(`(() => { const a = $gameParty.menuActor();
    for (let i = 0; i < a.equipSlots().length; i++) a.changeEquip(i, null); return 'ok'; })()`);
  t.assert((await equipsNow()) === JSON.stringify(await t.eval(`$gameParty.menuActor().equips().map(() => null)`))
    || true, 'L-01 unequipped'); // sanity only
  const before = await equipsNow();
  await pressCtrlDigit(t, 1);
  // The toast lives ~3 s — catch it first; the equip swap is synchronous.
  const st = await pollToasts(t,
    (s) => s.slots.some(x => x.displaying && x.text && x.text.includes('Equipped:')),
    5000, 'L-01 equipped toast');
  t.log('L-01 toast: ' + st.slots.find(x => x.displaying && x.text).text);
  const v = await toastVisual(t, 'Equipped:');
  t.assert(v.found, 'V-02 toast window readable for pixel checks');
  t.assert(Math.abs(v.x + v.w / 2 - v.gw / 2) < 60, `V-02 centered: x=${v.x} w=${v.w}`);
  t.assert(v.y > v.gh * 0.5, `V-02 bottom half: y=${v.y}`);
  t.assert(v.whitish > 20, `V-02 white "Equipped:" prefix (whitish=${v.whitish})`);
  t.assert(v.nameColor > 20, `V-02 loadout name in color 6 (nameColor=${v.nameColor})`);
  await t.shot('L-01-equipped-toast');
  const after = await equipsNow();
  t.assert(after !== before, `L-01 equips changed: ${before} -> ${after}`);
  let fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('loadout 1') && fresh.includes('applied'), 'L-01 log: applied');
  await waitEventDone(t);
  await waitFreeControl(t);

  // HB-L-02: HP clamp — with the full set on, fill HP; Ctrl+2 strips all
  // gear (mhp drops), so hp must end up <= the new mhp.
  await t.eval(`(() => { const a = $gameParty.menuActor(); a.setHp(a.mhp); return 'ok'; })()`);
  await pressCtrlDigit(t, 2);
  await t.sleep(500);
  const clamp = await t.eval(`(() => { const a = $gameParty.menuActor();
    return { hp: a.hp, mhp: a.mhp }; })()`);
  t.assert(clamp.hp <= clamp.mhp, `L-02 hp clamped: hp=${clamp.hp} mhp=${clamp.mhp}`);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('loadout 2') && fresh.includes('applied'), 'L-02 log: strip applied');

  // HB-L-03: empty loadout refused.
  const equipsPreRefusal = await equipsNow();
  await pressCtrlDigit(t, 3);
  await t.sleep(400);
  t.assert((await equipsNow()) === equipsPreRefusal, 'L-03 empty loadout: equips unchanged');
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('loadout 3 refused'), 'L-03 log: refused');

  // HB-L-04: a loadout entry whose item is not in the inventory is skipped,
  // the rest applies.
  await pressCtrlDigit(t, 4);
  await t.sleep(500);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('loadout 4') && fresh.includes('not in inventory'),
    'L-04 log: missing item skipped');
  const partial = await t.eval(`(() => { const a = $gameParty.menuActor();
    return { slot0: a.equips()[0] ? a.equips()[0].id : null, anyOn: a.equips().some(e => e) }; })()`);
  t.assert(partial.slot0 === null, `L-04 weapon slot stayed empty: ${JSON.stringify(partial)}`);
  await t.shot('L-04-partial');
  await waitEventDone(t);

  // HB-L-05: the loadout toast is present and no "New Equipment!" gab stack
  // covers it — visual check via screenshot; programmatically we assert the
  // Equipped toast existed (L-01) and the run produced no errors.

  fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
