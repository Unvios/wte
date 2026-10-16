// HB-B-01..15 — binding in Scene_Item and Scene_Skill: bind/unbind/rebind,
// every refusal branch, Ctrl+digit must not bind, badges (screenshot).
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, setSlots, selectRowById,
  pressDigit, pressCtrlDigit, logMark, freshLogLines, badgeInk,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const JERKY = 2141;   // food, occasion 0, scope 11
const RAW_JERKY = 2147; // occasion 3 "never"
const KEY_ITEM = 74;  // Basic Skeleton Key, itypeId 2
const COFFEE_MAKER = 2044; // occasion 2, NOT whitelisted
const COFFEE = 2043;  // occasion 2, whitelisted
const MENDING = 52;   // skill, Ritual, occasion 0
const DARK_BLAST = 12;
const BASIC_ATTACK = 1; // stype 0 ("")

export default async function hotbarBind(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);

  await t.eval(`(() => {
    $gameParty.gainItem($dataItems[${JERKY}], 5);
    $gameParty.gainItem($dataItems[${COFFEE}], 2);
    $gameParty.gainItem($dataItems[${RAW_JERKY}], 1);
    $gameParty.gainItem($dataItems[${COFFEE_MAKER}], 1);
    $gameParty.gainItem($dataItems[${KEY_ITEM}], 1);
    const a = $gameParty.menuActor();
    a.learnSkill(${MENDING}); a.learnSkill(${DARK_BLAST}); a.learnSkill(${BASIC_ATTACK});
    return 'ok';
  })()`);
  await setSlots(t, {});
  const slots = () => t.eval(`JSON.stringify($gameSystem._wteConsumableHotkeys)`).then(JSON.parse);

  // --- Scene_Item ---------------------------------------------------------
  await t.eval(`SceneManager.push(Scene_Item); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Item'`,
    { timeout: 15000, desc: 'Scene_Item open' });
  await t.sleep(500);

  // HB-B-01: bind an item to digit 1.
  let sel = await selectRowById(t, JERKY);
  t.assert(sel.ok, `B-01 cursor on jerky (${JSON.stringify(sel)})`);
  await pressDigit(t, 1);
  await t.sleep(200);
  let s = await slots();
  t.assert(s[0] && s[0].t === 'item' && s[0].id === JERKY, `B-01 slot 1 bound to jerky: ${JSON.stringify(s[0])}`);
  await t.shot('B-01-badge-jerky');

  // HB-B-11: the badge digit is drawn on the BOUND row's icon corner and not
  // on its left neighbour (regression: badge used to land one item left).
  const boundRow = sel.index;
  const nbRow = boundRow > 0 ? boundRow - 1 : boundRow + 1;
  const badgeBound = await badgeInk(t, boundRow);
  const badgeNb = await badgeInk(t, nbRow);
  t.assert(badgeBound.ok && badgeNb.ok, `B-11 badge pixels readable: ${JSON.stringify({ badgeBound, badgeNb })}`);
  t.assert(badgeBound.match >= 5, `B-11 badge ink on the bound row (match=${badgeBound.match})`);
  t.assert(badgeNb.match <= Math.max(1, badgeBound.match / 4),
    `B-11 no badge on the neighbour row (match=${badgeNb.match} vs ${badgeBound.match})`);

  // HB-B-02: same digit on the same item unbinds.
  await pressDigit(t, 1);
  await t.sleep(200);
  s = await slots();
  t.assert(s[0] === null, `B-02 slot 1 unbound: ${JSON.stringify(s[0])}`);

  // HB-B-03 + HB-B-08: binding a different (whitelisted menu-only) item moves
  // the slot; the old item ends up bound nowhere.
  await pressDigit(t, 1); // jerky -> 1
  await t.sleep(200);
  sel = await selectRowById(t, COFFEE);
  t.assert(sel.ok, `B-03 cursor on coffee (${JSON.stringify(sel)})`);
  await pressDigit(t, 1); // coffee -> 1
  await t.sleep(200);
  s = await slots();
  t.assert(s[0] && s[0].id === COFFEE, `B-03/08 slot 1 = coffee: ${JSON.stringify(s[0])}`);
  t.assert(!s.some(e => e && e.id === JERKY), 'B-03 jerky unbound everywhere');

  // HB-B-04: binding the same item to another digit moves the binding.
  sel = await selectRowById(t, JERKY);
  await pressDigit(t, 1); // jerky -> 1 (replaces coffee)
  await t.sleep(200);
  await pressDigit(t, 3); // jerky -> 3 (moves)
  await t.sleep(200);
  s = await slots();
  t.assert(s[0] === null && s[2] && s[2].id === JERKY,
    `B-04 binding moved to slot 3: ${JSON.stringify(s)}`);

  // HB-B-06: occasion 3 ("never") refused.
  sel = await selectRowById(t, RAW_JERKY);
  t.assert(sel.ok, `B-06 cursor on raw jerky (${JSON.stringify(sel)})`);
  await pressDigit(t, 4);
  await t.sleep(200);
  s = await slots();
  t.assert(s[3] === null, 'B-06 occasion-3 item refused');

  // HB-B-07: menu-only, not whitelisted refused.
  sel = await selectRowById(t, COFFEE_MAKER);
  t.assert(sel.ok, `B-07 cursor on coffee maker (${JSON.stringify(sel)})`);
  await pressDigit(t, 4);
  await t.sleep(200);
  s = await slots();
  t.assert(s[3] === null, 'B-07 menu-only non-whitelisted refused');

  // HB-B-09: dead-ally scope refused (no such items in the live DB — mutate).
  await t.eval(`$dataItems[${JERKY}].scope = 9; 'ok'`);
  sel = await selectRowById(t, JERKY);
  t.assert(sel.ok, 'B-09 cursor on jerky');
  await pressDigit(t, 4);
  await t.sleep(200);
  await t.eval(`$dataItems[${JERKY}].scope = 11; 'ok'`);
  s = await slots();
  t.assert(s[3] === null, 'B-09 scope-9 item refused');

  // HB-B-10: Ctrl+digit does NOT bind in the inventory.
  await pressCtrlDigit(t, 1);
  await t.sleep(250);
  s = await slots();
  t.assert(s[0] === null, 'B-10 Ctrl+1 did not bind');

  // HB-B-05: key items refused (itypeId 2). Key items don't appear in the
  // window's category data under CDP, so exercise the same refusal branch by
  // mutating a live item's itypeId, with rollback.
  await t.eval(`$dataItems[${JERKY}].itypeId = 2; 'ok'`);
  sel = await selectRowById(t, JERKY);
  t.assert(sel.ok, 'B-05 cursor on jerky-as-key-item');
  await pressDigit(t, 5);
  await t.sleep(200);
  await t.eval(`$dataItems[${JERKY}].itypeId = 1; 'ok'`);
  s = await slots();
  t.assert(s[4] === null, 'B-05 key item refused');

  await t.eval(`SceneManager.pop(); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Map'`,
    { timeout: 15000, desc: 'back on the map' });
  await t.sleep(300);

  // --- Scene_Skill --------------------------------------------------------
  await t.eval(`SceneManager.push(Scene_Skill); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Skill'`,
    { timeout: 15000, desc: 'Scene_Skill open' });
  await t.sleep(500);

  // HB-B-12: bind a ritual to digit 2.
  sel = await selectRowById(t, MENDING);
  t.assert(sel.ok, `B-12 cursor on mending (${JSON.stringify(sel)})`);
  await pressDigit(t, 2);
  await t.sleep(200);
  s = await slots();
  t.assert(s[1] && s[1].t === 'skill' && s[1].id === MENDING,
    `B-12 slot 2 bound to mending: ${JSON.stringify(s[1])}`);
  await t.shot('B-12-badge-skill');
  // Badge pixel check on the skill list too (same V regression as B-11).
  const sBadge = await badgeInk(t, sel.index);
  const sNb = await badgeInk(t, sel.index > 0 ? sel.index - 1 : sel.index + 1);
  t.assert(sBadge.ok && sBadge.match >= 5, `B-12 badge ink on the skill row (match=${sBadge.match})`);
  t.assert(sNb.ok && sNb.match <= Math.max(1, sBadge.match / 4),
    `B-12 no badge on the neighbour skill row (match=${sNb.match})`);

  // HB-B-13: stype 0 ("") skills refused. Stype-0 skills never appear in any
  // skill-type tab of the list, so mutate a listed skill's stypeId instead.
  await t.eval(`$dataSkills[${MENDING}].stypeId = 0; 'ok'`);
  sel = await selectRowById(t, MENDING);
  t.assert(sel.ok, 'B-13 cursor on mending-as-passive');
  await pressDigit(t, 5);
  await t.sleep(200);
  await t.eval(`$dataSkills[${MENDING}].stypeId = 1; 'ok'`);
  s = await slots();
  t.assert(s[4] === null, 'B-13 stype-0 skill refused');

  // HB-B-14: occasion 3 skills refused (none in the live DB — mutate).
  await t.eval(`$dataSkills[${MENDING}].occasion = 3; 'ok'`);
  sel = await selectRowById(t, MENDING);
  await pressDigit(t, 6);
  await t.sleep(200);
  await t.eval(`$dataSkills[${MENDING}].occasion = 0; 'ok'`);
  s = await slots();
  t.assert(s[5] === null, 'B-14 occasion-3 skill refused');

  // HB-B-15: unbind a skill with the same digit.
  sel = await selectRowById(t, MENDING);
  await pressDigit(t, 2);
  await t.sleep(200);
  s = await slots();
  t.assert(s[1] === null, 'B-15 skill unbound');

  await t.eval(`SceneManager.pop(); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Map'`,
    { timeout: 15000, desc: 'back on the map' });

  // Log assertions over the whole run.
  const fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('slot 1 bound:'), 'log: bind event present');
  t.assert(fresh.includes('unbound:'), 'log: unbind event present');
  t.assert(fresh.includes('bind refused:'), 'log: refusal event present');
  t.assert(fresh.includes('whitelisted=false'), 'log: refusal reason (whitelist)');
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
