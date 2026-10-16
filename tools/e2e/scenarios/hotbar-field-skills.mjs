// HB-F-11..15 — field use of skills/rituals: heal with the CE flourish
// suppression (ex hotbar-mending), refusals (no MP / not learned / opponent
// scope), scope-less Warp ritual.
import path from 'node:path';
import {
  waitTitle, loadFixtureSave, waitFreeControl, waitEventDone, setSlots,
  pressDigit, logMark, freshLogLines, pollToasts,
} from '../lib.mjs';

const LOG_NAME = path.join('mods', 'WTE_QOL_Hotbar', 'logs', 'hotkeys_consumable.log');
const MENDING = 52;    // Lesser Mending: occasion 0, scope 11, CE 291 (battle visuals)
const DARK_BLAST = 12; // attack ritual: occasion 1, scope 1
const WARP = 3;        // Warp: occasion 2, scope 0, common-event ritual
const SLOT = 3;        // digit "4"

export default async function hotbarFieldSkills(t) {
  await waitTitle(t);
  await loadFixtureSave(t, 90);
  await waitFreeControl(t);

  const logPath = path.join(t.gameRoot, LOG_NAME);
  const mark = logMark(logPath);
  const actorHp = () => t.eval(`$gameParty.menuActor().hp`);

  await t.eval(`(() => {
    const a = $gameParty.menuActor();
    a.learnSkill(${MENDING});
    a.setMp(a.mmp);
    a.setHp(Math.max(1, a.mhp - 30));
    return 'ok';
  })()`);

  // HB-F-11: Lesser Mending — heal, toast, no red tint, no control lock.
  await setSlots(t, { [SLOT]: { t: 'skill', id: MENDING } });
  const hp0 = await actorHp();
  const t0 = Date.now();
  await pressDigit(t, 4);
  await t.waitFor(`$gameParty.menuActor().hp > ${hp0}`,
    { timeout: 5000, desc: 'F-11 mending healed' });
  const hp1 = await actorHp();
  t.log(`F-11 healed: ${hp0} -> ${hp1}`);

  // The toast fades in ~3 s; catch it before the busy-window sampling below.
  const st = await pollToasts(t,
    (s) => s.slots.some(x => x.displaying && x.text && x.text.includes('Used:')),
    5000, 'F-11 use toast');
  t.log('F-11 toast: ' + st.slots.find(x => x.displaying && x.text).text);
  await t.shot('F-11-use-toast');

  // Vanilla CE 291 parks the interpreter ~1.5-2 s on battle visuals; with the
  // hotbar suppression it is a handful of frames.
  let firstBusy = -1;
  let lastBusy = -1;
  while (Date.now() - t0 < 6000) {
    const busy = await t.eval(`!!$gameMap.isEventRunning()`);
    if (busy) {
      if (firstBusy < 0) firstBusy = Date.now();
      lastBusy = Date.now();
    } else if (lastBusy > 0 ? Date.now() - lastBusy > 500 : Date.now() - t0 > 1500) {
      break;
    }
    await t.sleep(25);
  }
  const lockMs = lastBusy < 0 ? 0 : lastBusy - firstBusy;
  t.log(`F-11 interpreter busy window: ${lockMs} ms`);
  t.assert(lockMs < 900, `F-11 control lock too long: ${lockMs} ms`);

  let fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('used on map:'), 'F-11 log: use event');
  t.assert(fresh.includes('(#52)'), 'F-11 log: mending id');
  t.assert(fresh.includes('off-battle ActSeq suppressed'), 'F-11 log: ActSeq suppression fired');

  // F-11b: after the CE finishes the guard must be released — a second use
  // works normally.
  await waitEventDone(t);
  await waitFreeControl(t);
  await t.eval(`(() => { const a = $gameParty.menuActor();
    a.setMp(a.mmp); a.setHp(Math.max(1, a.mhp - 30)); return 'ok'; })()`);
  const hp2 = await actorHp();
  await pressDigit(t, 4);
  await t.waitFor(`$gameParty.menuActor().hp > ${hp2}`,
    { timeout: 5000, desc: 'F-11b second use after CE guard released' });
  await waitEventDone(t);
  await waitFreeControl(t);

  // HB-F-12: no MP — refused.
  await t.eval(`(() => { const a = $gameParty.menuActor();
    a.setMp(0); a.setHp(Math.max(1, a.mhp - 30)); return 'ok'; })()`);
  const hpNoMp = await actorHp();
  await pressDigit(t, 4);
  await t.sleep(400);
  t.assert((await actorHp()) === hpNoMp, 'F-12 no heal without MP');
  fresh = freshLogLines(logPath, mark);
  t.assert(/mp=0\/\d+ cost=10/.test(fresh), 'F-12 log refusal mp=0');
  await t.eval(`$gameParty.menuActor().setMp($gameParty.menuActor().mmp); 'ok'`);

  // HB-F-13: skill not learned — refused.
  await t.eval(`$gameParty.menuActor().forgetSkill(${MENDING}); 'ok'`);
  const hpNotLearned = await actorHp();
  await pressDigit(t, 4);
  await t.sleep(400);
  t.assert((await actorHp()) === hpNotLearned, 'F-13 no heal without the skill');
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('hasSkill=false'), 'F-13 log refusal hasSkill=false');
  await t.eval(`$gameParty.menuActor().learnSkill(${MENDING}); 'ok'`);

  // HB-F-14: battle-only ritual refused on the field (occasion gate fires
  // before the opponent-scope gate — canUse=false, occasion=1).
  await t.eval(`$gameParty.menuActor().learnSkill(${DARK_BLAST}); 'ok'`);
  await setSlots(t, { 4: { t: 'skill', id: DARK_BLAST } });
  await pressDigit(t, 5);
  await t.sleep(400);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('map skill refused') && fresh.includes('(#12)') &&
    (fresh.includes('occasion=1') || fresh.includes('forOpponent=true')),
    'F-14 log refusal (occasion or opponent scope)');

  // HB-F-15: scope-less CE ritual (Warp) runs without a target and without
  // crashing; any UI it opens gets closed back to the map.
  await setSlots(t, { 5: { t: 'skill', id: WARP } });
  await pressDigit(t, 6);
  await t.sleep(800);
  for (let i = 0; i < 40; i++) {
    const scene = await t.eval(`SceneManager._scene.constructor.name`);
    if (scene === 'Scene_Map' && await t.eval(`!$gameMap.isEventRunning() && !$gameMessage.isBusy()`)) break;
    if (await t.eval(`$gameMessage.isBusy()`)) await t.key('enter');
    else if (scene !== 'Scene_Map') await t.key('escape');
    await t.sleep(300);
  }
  await waitFreeControl(t, 20000);
  fresh = freshLogLines(logPath, mark);
  t.assert(fresh.includes('(#3)'), 'F-15 log: warp used');
  t.assert(fresh.includes('CE reserved: true'), 'F-15 log: CE was reserved');
  await t.shot('F-15-after-warp');

  fresh = freshLogLines(logPath, mark);
  t.assert(!fresh.includes('ERROR'), 'log: no ERROR lines\n' + fresh);
}
