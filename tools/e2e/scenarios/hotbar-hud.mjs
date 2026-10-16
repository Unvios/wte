// HB-H-01..08 — HUD bar: visibility, position, counts, greying states,
// UltraHUD global switch, live redraw without scene reload.
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, setSlots, hudState,
  logMark, freshLogLines, hudPixels,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const JERKY = 2141;
const MENDING = 52;

export default async function hotbarHud(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);
  const sig = () => t.eval(`SceneManager._scene._wteHotkeyHud
    ? SceneManager._scene._wteHotkeyHud._signature : null`);
  const waitSig = (frag, desc) => t.waitFor(
    `(() => { const h = SceneManager._scene._wteHotkeyHud;
      return h && h._signature && h._signature.includes('${frag}'); })()`,
    { timeout: 8000, desc });

  await t.eval(`(() => {
    $gameParty.gainItem($dataItems[${JERKY}], 5);
    const a = $gameParty.menuActor();
    a.learnSkill(${MENDING});
    a.setMp(a.mmp);
    a.setHp(Math.max(1, a.mhp - 30));
    return 'ok';
  })()`);

  // HB-H-01a: nothing bound -> bar hidden.
  await setSlots(t, {});
  await t.sleep(400);
  let hud = await hudState(t);
  t.assert(hud.exists, `H-01 HUD sprite exists: ${JSON.stringify(hud)}`);
  t.assert(!hud.visible, 'H-01 hidden without bindings');

  // HB-H-01b + HB-H-08: binding shows the bar in the SAME scene (no reload).
  await setSlots(t, { 0: { t: 'item', id: JERKY }, 1: { t: 'skill', id: MENDING } });
  const n0 = await t.eval(`$gameParty.numItems($dataItems[${JERKY}])`);
  await waitSig(`item${JERKY}:${n0}:1`, 'H-08 signature redrawn after bind');
  await waitSig(`skill${MENDING}:1`, 'H-08 skill slot in signature');
  hud = await hudState(t);
  t.assert(hud.visible, 'H-01 visible with bindings');
  t.log('H-01 signature: ' + hud.signature);

  // HB-H-02: position and size (bottom-left anchor).
  const dims = await t.eval(`({ gx: 8, gy: Graphics.height - 8 - 52 })`);
  t.assert(hud.x === dims.gx && hud.y === dims.gy,
    `H-02 position ${hud.x},${hud.y} (expected ${dims.gx},${dims.gy})`);
  t.assert(hud.w === 400 && hud.h === 52, `H-02 bitmap ${hud.w}x${hud.h}`);
  await t.shot('H-01-hud-bar');

  // HB-V-03: HUD slot pixels — icon fully opaque when usable, count text and
  // key digit drawn (item slot), digit but no count on the skill slot.
  const pxItem = await hudPixels(t, 0);
  const pxSkill = await hudPixels(t, 1);
  t.assert(pxItem.ok && pxSkill.ok, `V-03 HUD pixels readable: ${JSON.stringify({ pxItem, pxSkill })}`);
  t.assert(pxItem.iconAlpha > 220, `V-03 enabled item icon opaque (alpha=${pxItem.iconAlpha.toFixed(0)})`);
  t.assert(pxItem.countInk > 0, `V-03 item count text drawn (ink=${pxItem.countInk})`);
  t.assert(pxItem.keyInk > 0, `V-03 item key digit drawn (ink=${pxItem.keyInk})`);
  t.assert(pxSkill.keyInk > 0, `V-03 skill key digit drawn (ink=${pxSkill.keyInk})`);
  // (No "skill has no count" pixel assert: the count zone overlaps the icon's
  // own corner pixels. Count correctness is covered by the signature in H-03.)
  const alphaItemBase = pxItem.iconAlpha;
  const alphaSkillBase = pxSkill.iconAlpha;

  // HB-H-03: stack count in the signature follows the inventory.
  await t.eval(`$gameParty.gainItem($dataItems[${JERKY}], 2); 'ok'`);
  await waitSig(`item${JERKY}:${n0 + 2}:1`, 'H-03 count +2 after gain');
  t.assert(true, 'H-03 count follows inventory');

  // HB-H-06: full HP greys the item (trim CE effects so testApply is honest,
  // same trick as HB-F-08).
  await t.eval(`(() => {
    window.__hudEff = $dataItems[${JERKY}].effects;
    $dataItems[${JERKY}].effects = $dataItems[${JERKY}].effects.filter(e => e.code === 11);
    $gameParty.members().forEach(a => a.setHp(a.mhp));
    return 'ok';
  })()`);
  await waitSig(`item${JERKY}:${n0 + 2}:0`, 'H-06 greyed at full HP');
  t.assert(true, 'H-06 item greyed when effect would not apply');
  let px = await hudPixels(t, 0);
  t.assert(px.iconAlpha < alphaItemBase * 0.8,
    `H-06 icon alpha dropped: ${px.iconAlpha.toFixed(0)} < ${alphaItemBase.toFixed(0)}*0.8`);
  await t.shot('H-06-greyed-fullhp');
  await t.eval(`(() => {
    $dataItems[${JERKY}].effects = window.__hudEff;
    const a = Scene_Item.prototype.user();
    a.setHp(Math.max(1, a.mhp - 30));
    return 'ok';
  })()`);
  await waitSig(`item${JERKY}:${n0 + 2}:1`, 'H-06 ungreyed after heal down');

  // HB-H-04: out of stock greys (count 0; the usable flag stays 1 because the
  // real effects include common events — greying itself is numItems>0 gated).
  await t.eval(`$gameParty.loseItem($dataItems[${JERKY}], $gameParty.numItems($dataItems[${JERKY}])); 'ok'`);
  await waitSig(`item${JERKY}:0:`, 'H-04 zero stock in signature');
  px = await hudPixels(t, 0);
  t.assert(px.iconAlpha < alphaItemBase * 0.8,
    `H-04 icon alpha dropped at zero stock: ${px.iconAlpha.toFixed(0)}`);
  t.assert(true, 'H-04 zero-stock reflected');

  // HB-H-05: skill without MP greys.
  await t.eval(`$gameParty.menuActor().setMp(0); 'ok'`);
  await waitSig(`skill${MENDING}:0`, 'H-05 skill greyed without MP');
  px = await hudPixels(t, 1);
  t.assert(px.iconAlpha < alphaSkillBase * 0.8,
    `H-05 skill icon alpha dropped: ${px.iconAlpha.toFixed(0)} < ${alphaSkillBase.toFixed(0)}*0.8`);
  t.assert(true, 'H-05 no-MP skill greyed');
  await t.eval(`$gameParty.menuActor().setMp($gameParty.menuActor().mmp); 'ok'`);
  await waitSig(`skill${MENDING}:1`, 'H-05 skill back with MP');

  // HB-H-07: the bar follows the global UltraHUD visibility switch.
  await t.eval(`$gameUltraHUD.globalVisibility = false; 'ok'`);
  await waitSig('hidden', 'H-07 signature hidden');
  hud = await hudState(t);
  t.assert(!hud.visible, 'H-07 hidden with global switch off');
  await t.eval(`$gameUltraHUD.globalVisibility = true; 'ok'`);
  await waitSig('shown', 'H-07 signature shown again');
  hud = await hudState(t);
  t.assert(hud.visible, 'H-07 visible again');

  const fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
