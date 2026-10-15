// Shared helpers for E2E scenarios: boot, fixture load, scripted battle,
// RNG control, toast inspection. Used by loot-toasts-matrix.mjs.

export async function waitTitle(t) {
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Title'`,
    { timeout: 120000, poll: 500, desc: 'title screen' });
}

// Native load chain: title "Continue" -> Scene_Load.executeLoad(slot).
// Direct DataManager.loadGame + goto(Scene_Map) leaves the map renderer
// half-initialized (black tiles) — do not use it.
export async function loadFixtureSave(t, slot) {
  await t.waitFor(`DataManager._globalInfo && !!DataManager._globalInfo[${slot}]`,
    { timeout: 60000, desc: 'globalInfo rebuilt with the fixture slot' });
  const cont = await t.eval(`(() => {
    const s = SceneManager._scene;
    if (typeof s.commandContinue === 'function') { s.commandContinue(); return 'ok'; }
    return 'none';
  })()`);
  t.assert(cont === 'ok', 'entered continue flow');
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Load'`,
    { timeout: 15000, desc: 'Scene_Load opened' });
  await t.waitFor(`(() => {
    const s = SceneManager._scene;
    return s && s.constructor.name === 'Scene_Load' && s.isSavefileEnabled(${slot});
  })()`, { timeout: 30000, desc: 'slot enabled in the load scene' });
  await t.eval(`(() => {
    const s = SceneManager._scene;
    if (typeof s.executeLoad === 'function') { s.executeLoad(${slot}); return 'executeLoad'; }
    DataManager.loadGame(${slot});
    return 'loadGame';
  })()`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Map'`,
    { timeout: 60000, desc: 'Scene_Map after load' });
  // Render sanity: map must not stay a black void (sampled pixels).
  await t.waitFor(`(() => {
    const b = SceneManager.snap();
    const d = b.canvas.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let lit = 0, n = 0;
    for (let i = 0; i + 2 < d.length; i += 4 * 997) {
      n++;
      if (d[i] > 16 || d[i + 1] > 16 || d[i + 2] > 16) lit++;
    }
    return lit / n > 0.05;
  })()`, { timeout: 30000, poll: 500, desc: 'map renders (lit pixels > 5%)' });
}

// Deterministic event rolls: Game_Interpreter "Control Variables > Random"
// goes through Math.randomInt. fixed=null disables the stub.
export async function installRngStub(t) {
  await t.eval(`(() => {
    if (window.__rng) return 'ok';
    const origInt = Math.randomInt.bind(Math);
    const origRandom = Math.random.bind(Math);
    window.__rng = { fixed: null, origInt, origRandom };
    Math.randomInt = (n) => window.__rng.fixed === null ? origInt(n) : Math.min(window.__rng.fixed, n - 1);
    Math.random = () => window.__rng.fixed === null ? origRandom() : 0;
    return 'ok';
  })()`);
}

export async function setRng(t, value) {
  await t.eval(`window.__rng.fixed = ${value === null ? 'null' : value}; 'ok'`);
}

// Starts a real battle and wins it instantly. Returns when back on the map.
export async function runScriptedBattle(t, troopId) {
  // The previous battle's CE chain (loot flow, autosave, etc.) must be fully
  // done, and the map interpreter idle — otherwise the battle push can stall.
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Map' &&
    !$gameMap._interpreter.isRunning() && !$gameMessage.isBusy() &&
    (!$gameTemp.isCommonEventReserved || !$gameTemp.isCommonEventReserved())`,
    { timeout: 30000, desc: 'map idle before battle' });
  await t.eval(`BattleManager.setup(${troopId}, true, false); SceneManager.push(Scene_Battle); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Battle'`,
    { timeout: 30000, desc: 'battle scene active' });
  await t.waitFor(`['start', 'turn', 'input'].includes(BattleManager._phase)`,
    { timeout: 30000, desc: 'battle phase started' });
  // Battle tutorial may open a long message chain in fresh saves.
  for (let i = 0; i < 60; i++) {
    if (!(await t.eval(`$gameMessage.isBusy()`))) break;
    await t.key('enter');
    await t.sleep(300);
  }
  // die() does NOT apply the death state in this core; refresh() does.
  await t.eval(`$gameTroop.members().forEach(e => { e.setHp(0); e.refresh(); }); 'ok'`);
  await t.eval(`BattleManager.checkBattleEnd(); 'ok'`);
  const mapDeadline = Date.now() + 60000;
  while (Date.now() < mapDeadline) {
    if (await t.eval(`SceneManager._scene?.constructor.name === 'Scene_Map'`)) return;
    if (await t.eval(`$gameMessage.isBusy()`)) await t.key('enter');
    if (await t.eval(`SceneManager._scene?.constructor.name === 'Scene_Battle' && $gameTroop.isAllDead() && BattleManager._phase !== 'battleEnd'`)) {
      await t.eval(`BattleManager.checkBattleEnd(); 'ok'`);
    }
    await t.sleep(500);
  }
  throw new Error('not back on the map within 60s after victory');
}

// Waits until the map interpreter chain is executing CE 27 (the battle-win
// loot flow). The reserved common event starts only when the interpreter is
// free, so right after a battle it may take a while — or never start, which
// is exactly the regression this test exists to catch.
export async function waitLootFlowStart(t, timeoutMs = 30000) {
  await t.waitFor(`(() => {
    const ce27 = $dataCommonEvents[27];
    if (!ce27 || !ce27.list || typeof $gameMap === 'undefined' || !$gameMap) return false;
    for (let i = $gameMap._interpreter; i; i = i._childInterpreter) {
      if (i._list === ce27.list) return true;
    }
    return false;
  })()`, { timeout: timeoutMs, poll: 200, desc: 'loot flow (CE 27) started' });
}

// Waits until the CE 27 chain has finished running.
export async function waitLootFlowEnd(t, timeoutMs = 30000) {
  await t.waitFor(`(() => {
    const ce27 = $dataCommonEvents[27];
    if (!ce27 || !ce27.list || typeof $gameMap === 'undefined' || !$gameMap) return true;
    for (let i = $gameMap._interpreter; i; i = i._childInterpreter) {
      if (i._list === ce27.list) return false;
    }
    return true;
  })()`, { timeout: timeoutMs, poll: 200, desc: 'loot flow (CE 27) finished' });
}

// Reads toast queue + windows state from the page.
export async function toastState(t) {
  return t.eval(`(() => {
    const scene = SceneManager._scene;
    const queued = (typeof $cgmzTemp !== 'undefined' && $cgmzTemp && $cgmzTemp._toastWindows)
      ? $cgmzTemp._toastWindows.map(w => ({
          text: w.lineOne, shrine: !!w._wteShrine, face: w._wteSummaryFace || 0,
          loot: !!w._wteLootToast,
        })) : [];
    const slots = [];
    for (let i = 1; i <= 10; i++) {
      const w = scene['_cgmz_toastWindow' + i];
      if (!w) continue;
      slots.push({
        slot: i,
        displaying: !!(w.isDisplaying && w.isDisplaying()),
        opaque: w.opacity > 250 && w.contentsOpacity > 250,
        text: w._wteActiveToast ? w._wteActiveToast.lineOne : null,
        shrine: !!(w._wteActiveToast && w._wteActiveToast._wteShrine),
        face: w._wteActiveToast ? (w._wteActiveToast._wteSummaryFace || 0) : 0,
        x: w.x, y: w.y, w: w.width, h: w.height,
      });
    }
    return { queued, slots, maxSlots: (typeof CGMZ !== 'undefined' && CGMZ.ToastManager) ? CGMZ.ToastManager.MaxWindowCount : null };
  })()`);
}

// Polls until `pred(state)` holds; returns the matching state.
export async function pollToasts(t, pred, timeoutMs = 15000, desc = 'toast condition') {
  const deadline = Date.now() + timeoutMs;
  let st = null;
  const debug = !!process.env.E2E_DEBUG;
  while (Date.now() < deadline) {
    st = await toastState(t);
    if (debug) {
      const d = st.slots.filter(x => x.displaying);
      t.log(`poll: queued=${st.queued.length} displaying=${d.length} opaque=${d.filter(x => x.opaque).length} texts=[${d.map(x => x.text).join(' | ')}]`);
    }
    if (pred(st)) return st;
    await t.sleep(150);
  }
  throw new Error(`pollToasts timed out (${timeoutMs} ms): ${desc}; last state: ${JSON.stringify(st).slice(0, 400)}`);
}

export async function waitToastsGone(t, timeoutMs = 20000) {
  await pollToasts(t, (st) => st.queued.length === 0 && !st.slots.some(s => s.displaying),
    timeoutMs, 'all toasts faded');
}

// Reads new lines of the mod's log since `offset`; returns { text, size }.
import fs from 'node:fs';

export function readModLog(logPath, offset) {
  if (!fs.existsSync(logPath)) return { text: '', size: 0 };
  const size = fs.statSync(logPath).size;
  const from = size >= offset ? offset : 0;
  const fd = fs.openSync(logPath, 'r');
  const buf = Buffer.alloc(size - from);
  fs.readSync(fd, buf, 0, buf.length, from);
  fs.closeSync(fd);
  return { text: buf.toString('utf8'), size };
}

// Waits for a fresh `flush:` line in the mod log. offsetRef must start at the
// file size captured at scenario start, and `since` (ms epoch) filters out
// lines from earlier runs AND from a parallel live game (the sandbox mods/
// dir is a junction, so a playing user writes into the same log file).
export async function waitFlushLine(t, logPath, offsetRef, since, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { text, size } = readModLog(logPath, offsetRef.offset);
    offsetRef.offset = Math.max(offsetRef.offset, size);
    const lines = text.trim().split('\n').filter(l => {
      if (!l.includes('flush:')) return false;
      const m = l.match(/^\[(.+?)\]/);
      return !m || Date.parse(m[1]) >= since;
    });
    if (lines.length) return lines[lines.length - 1];
    await t.sleep(400);
  }
  throw new Error('no fresh flush line in the mod log within ' + timeoutMs + ' ms');
}
