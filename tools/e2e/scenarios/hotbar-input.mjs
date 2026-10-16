// HB-I-01..05 — input mechanics: press TTL across messages, OS key repeat,
// keyMapper remap resilience (the "can't bind 9" regression), two digits in
// quick succession, instant keyup (macro) still counts.
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, setSlots, pressDigit,
  logMark, freshLogLines,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const JERKY = 2141;

export default async function hotbarInput(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);
  const jerkyCount = () => t.eval(`$gameParty.numItems($dataItems[${JERKY}])`);

  await t.eval(`(() => {
    $gameParty.gainItem($dataItems[${JERKY}], 10);
    const a = Scene_Item.prototype.user();
    a.setHp(Math.max(1, a.mhp - 200));
    return 'ok';
  })()`);
  // digits 1, 2, 3 and 9 bound to jerky
  await setSlots(t, {
    0: { t: 'item', id: JERKY },
    1: { t: 'item', id: JERKY },
    2: { t: 'item', id: JERKY },
    8: { t: 'item', id: JERKY },
  });

  // HB-I-01: a digit tapped while a message is open must not fire late.
  await t.eval(`$gameMessage.add('E2E: hold on'); 'ok'`);
  await t.waitFor(`$gameMessage.isBusy()`, { timeout: 5000, desc: 'I-01 message open' });
  await t.sleep(100);
  const c0 = await jerkyCount();
  await pressDigit(t, 1);
  await t.sleep(150);
  // Close the message, wait past the 250 ms TTL.
  for (let i = 0; i < 10 && await t.eval(`$gameMessage.isBusy()`); i++) {
    await t.key('enter');
    await t.sleep(250);
  }
  await waitFreeControl(t);
  await t.sleep(500);
  t.assert((await jerkyCount()) === c0, 'I-01 press during message did not fire late');

  // HB-I-02: OS key repeat — repeated keydowns while held count once.
  await t.eval(`(() => {
    for (let i = 0; i < 5; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 49, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 49, bubbles: true }));
    return 'ok';
  })()`);
  await t.sleep(500);
  t.assert((await jerkyCount()) === c0 - 1, 'I-02 held key used exactly once');

  // HB-I-03: a remapped keyMapper entry (9 = 'control') must not break the
  // digit — the mod reads DOM keyCodes directly.
  await t.eval(`Input.keyMapper[57] = 'control'; 'ok'`);
  await pressDigit(t, 9);
  await t.sleep(500);
  t.assert((await jerkyCount()) === c0 - 2, 'I-03 digit 9 works despite keyMapper remap');
  await t.eval(`delete Input.keyMapper[57]; 'ok'`);

  // HB-I-04: two digits in quick succession both fire (one per frame).
  await pressDigit(t, 2);
  await t.sleep(40);
  await pressDigit(t, 3);
  await t.sleep(700);
  t.assert((await jerkyCount()) === c0 - 4, 'I-04 both digits consumed one item each');

  // HB-I-05: instant keyup (keyboard macros) — the press still counts.
  await t.eval(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 49, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 49, bubbles: true }));
    return 'ok';
  })()`);
  await t.sleep(500);
  t.assert((await jerkyCount()) === c0 - 5, 'I-05 instant up/down press counted');

  const fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
