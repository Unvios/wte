// HB-P-01..02 — persistence: bindings survive save/load, legacy number
// entries migrate. MUST run with --sandbox (writes save slot 95).
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, setSlots, pressDigit,
  logMark, freshLogLines, hudState,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const JERKY = 2141;
const MENDING = 52;
const SAVE_SLOT = 95;

export default async function hotbarPersistence(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);

  await t.eval(`(() => {
    $gameParty.gainItem($dataItems[${JERKY}], 3);
    const a = $gameParty.menuActor();
    a.learnSkill(${MENDING});
    a.setMp(a.mmp);
    a.setHp(Math.max(1, a.mhp - 30));
    return 'ok';
  })()`);

  // HB-P-01: save with two bindings, reload, they must survive.
  await setSlots(t, { 0: { t: 'item', id: JERKY }, 3: { t: 'skill', id: MENDING } });
  const saved = await t.eval(`(() => {
    $gameSystem.onBeforeSave();
    DataManager.saveGame(${SAVE_SLOT});
    return 'ok';
  })()`);
  t.assert(saved === 'ok', 'P-01 save written');
  await t.sleep(500);

  // Scramble the in-memory state, then load the save back.
  await setSlots(t, { 1: { t: 'item', id: 2043 } });
  await t.eval(`DataManager.loadGame(${SAVE_SLOT}); $gamePlayer.reserveTransfer(
    $gameMap.mapId(), $gamePlayer.x, $gamePlayer.y, 2, 0); 'ok'`);
  await t.waitFor(`(() => {
    const s = $gameSystem._wteConsumableHotkeys;
    return Array.isArray(s) && s[0] && s[0].t === 'item' && s[0].id === ${JERKY} &&
      s[3] && s[3].t === 'skill' && s[3].id === ${MENDING};
  })()`, { timeout: 15000, desc: 'P-01 bindings restored after load' });
  t.assert(true, 'P-01 bindings survived save/load');
  await waitFreeControl(t, 20000);

  // The HUD must pick the restored bindings up.
  const hud = await hudState(t);
  t.assert(hud.exists && hud.visible, `P-01 HUD visible after load: ${JSON.stringify(hud)}`);

  // HB-P-02: legacy plain-number entries migrate to {t:'item'} on access.
  await t.eval(`$gameSystem._wteConsumableHotkeys = new Array(10).fill(null);
    $gameSystem._wteConsumableHotkeys[0] = ${JERKY}; 'ok'`);
  await t.eval(`(() => { const a = Scene_Item.prototype.user();
    a.setHp(Math.max(1, a.mhp - 30)); return 'ok'; })()`);
  const hp0 = await t.eval(`Scene_Item.prototype.user().hp`);
  await pressDigit(t, 1);
  await t.waitFor(`Scene_Item.prototype.user().hp > ${hp0}`,
    { timeout: 5000, desc: 'P-02 legacy number binding usable' });
  const migrated = await t.eval(`JSON.stringify($gameSystem._wteConsumableHotkeys[0])`);
  t.assert(JSON.parse(migrated).t === 'item', `P-02 migrated to typed entry: ${migrated}`);

  const fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
