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

// Starts a real battle and waits for the input phase, leaving enemies alive.
// Pair with finishBattle. runScriptedBattle = startBattle + finishBattle.
export async function startBattle(t, troopId) {
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
}

// Kills all enemies and rides the victory flow back to the map.
export async function finishBattle(t) {
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

// Starts a real battle and wins it instantly. Returns when back on the map.
export async function runScriptedBattle(t, troopId) {
  await startBattle(t, troopId);
  await finishBattle(t);
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

// --- Hotbar mod helpers ---------------------------------------------------

// Capture point for mod-log assertions: { offset, since }. Pair with
// freshLogLines. The log's stamps are UTC (toISOString) — the comparison in
// freshLogLines adds the Z suffix.
export function logMark(logPath) {
  return { offset: readModLog(logPath, 0).size, since: Date.now() };
}

// Lines appended to the mod log since `mark` (from logMark), filtered to
// entries stamped after mark.since (5 s slack). Lines without a stamp pass.
export function freshLogLines(logPath, mark) {
  const { text } = readModLog(logPath, mark.offset);
  return text.split('\n').filter(l => {
    const m = l.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    return !m || Date.parse(m[1].replace(' ', 'T') + 'Z') >= mark.since - 5000;
  }).join('\n');
}

// Press a hotbar digit (1-9, 0 = slot 10).
export async function pressDigit(t, digit) {
  await t.key(String(digit));
}

// Ctrl+digit for equipment loadouts: trusted CDP events with the Ctrl
// modifier held — the mod reads the DOM ctrlKey flag, which keyMapper
// remapping cannot fake. Slightly longer hold so the press is consumed
// while the modifier is still down.
export async function pressCtrlDigit(t, digit) {
  await t.key(String(digit), { ctrl: true, holdMs: 150 });
}

// Reset all ten hotbar slots; optionally set some: setSlots(t, {0:{t:'item',id:2141}}).
export async function setSlots(t, entries = {}) {
  const json = JSON.stringify(entries);
  await t.eval(`(() => {
    $gameSystem._wteConsumableHotkeys = new Array(10).fill(null);
    const e = ${json};
    for (const k of Object.keys(e)) $gameSystem._wteConsumableHotkeys[Number(k)] = e[k];
    return 'ok';
  })()`);
}

// Reads the hotbar HUD sprite state (Scene_Map only).
export async function hudState(t) {
  return t.eval(`(() => {
    const s = SceneManager._scene;
    const h = s && s._wteHotkeyHud;
    if (!h) return { exists: false, scene: s ? s.constructor.name : 'none' };
    return {
      exists: true, visible: !!h.visible, x: h.x, y: h.y,
      w: h.bitmap ? h.bitmap.width : 0, h: h.bitmap ? h.bitmap.height : 0,
      signature: h._signature || null, broken: !!h._broken,
    };
  })()`);
}

// In Scene_Item / Scene_Skill: find the row holding entry `id` in the item
// window's data and put the cursor on it (the bind hook reads
// _itemWindow.item()). DM_EasyWindowNavigation deactivates+deselects the item
// window every frame while the category/prompt window is active (in real play
// the mouse hover reactivates it), so sibling selector windows are
// deactivated explicitly. Returns { ok, index?, reason? }.
export async function selectRowById(t, id) {
  return t.eval(`(() => {
    const s = SceneManager._scene;
    const w = s && s._itemWindow;
    if (!w) return { ok: false, reason: 'no _itemWindow', scene: s ? s.constructor.name : 'none' };
    for (const k of ['_categoryWindow', '_promptWindow', '_statusWindow', '_actorWindow', '_skillTypeWindow']) {
      const sw = s[k];
      if (sw && sw !== w && sw.active && typeof sw.deactivate === 'function') sw.deactivate();
    }
    const data = w._data || w._items || [];
    const i = data.findIndex(it => it && it.id === ${id});
    if (i < 0) return { ok: false, reason: 'id not in list', len: data.length };
    w.select(i);
    if (typeof w.activate === 'function') w.activate();
    return { ok: true, index: i, active: !!w.active };
  })()`);
}

// Free control on the map: no messages, no running events, player movable.
export async function waitFreeControl(t, timeoutMs = 15000) {
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Map' &&
    $gamePlayer.canMove() && !$gameMap.isEventRunning()`,
    { timeout: timeoutMs, desc: 'free control on the map' });
}

// --- Visual checks (structure + bitmap pixels, renderer-independent) -------
// These read window/sprite contents bitmaps — NOT screenshots — so they are
// deterministic under headless SwiftShader. Note the MZ API: Bitmap.getPixel
// returns a '#rrggbb' STRING and alpha comes separately via getAlphaPixel
// ('#ff') — read both through the readPx helper below.

const PX_READER = `
  const readPx = (bmp, x, y) => {
    const hex = bmp.getPixel(x, y);       // '#rrggbb' string
    const ah = bmp.getAlphaPixel(x, y);   // number 0-255 in this core
    return {
      r: parseInt(hex.substr(1, 2), 16) || 0,
      g: parseInt(hex.substr(3, 2), 16) || 0,
      b: parseInt(hex.substr(5, 2), 16) || 0,
      a: typeof ah === 'number' ? ah : (parseInt(String(ah).substr(1, 2), 16) || 0),
    };
  };
  const parseCss = (s) => {
    if (!s) return null;
    if (s[0] === '#') return { r: parseInt(s.substr(1, 2), 16), g: parseInt(s.substr(3, 2), 16), b: parseInt(s.substr(5, 2), 16) };
    const m = s.match(/(\\d+)\\D+(\\d+)\\D+(\\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
  };
`;

// Geometry + ink analysis of the currently displaying toast whose lineOne
// contains `needle`. Returns { found, x, y, w, h, opacity, inkRatio,
// colorful, whitish, nameColor, gw, gh } — geometry for position asserts,
// ink/colorful/whitish/nameColor pixel counters for content asserts
// (dim background excluded by a brightness floor).
export async function toastVisual(t, needle) {
  return t.eval(`(() => {
    ${PX_READER}
    const scene = SceneManager._scene;
    if (!scene) return { found: false };
    for (let i = 1; i <= 10; i++) {
      const w = scene['_cgmz_toastWindow' + i];
      if (!w || !w.isDisplaying || !w.isDisplaying()) continue;
      const text = w._wteActiveToast ? w._wteActiveToast.lineOne : null;
      if (!text || !text.includes(${JSON.stringify(needle)})) continue;
      const bmp = w.contents;
      if (!bmp || !bmp.width) return { found: true, error: 'no contents bitmap' };
      const nameC = parseCss(ColorManager.textColor(6)); // mod draws names in \\C[6]
      let ink = 0, total = 0, colorful = 0, whitish = 0, nameColor = 0;
      for (let y = 0; y < bmp.height; y += 2) {
        for (let x = 0; x < bmp.width; x += 2) {
          const p = readPx(bmp, x, y);
          total++;
          if (p.a < 60) continue;
          if (p.r + p.g + p.b < 90) continue; // dim background is not ink
          ink++;
          const spread = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
          if (p.a > 128 && spread > 50) colorful++;
          if (p.a > 128 && p.r > 200 && p.g > 200 && p.b > 200) whitish++;
          if (nameC && p.a > 128 && Math.abs(p.r - nameC.r) < 50 &&
              Math.abs(p.g - nameC.g) < 50 && Math.abs(p.b - nameC.b) < 50) nameColor++;
        }
      }
      return {
        found: true, x: w.x, y: w.y, w: w.width, h: w.height,
        opacity: w.opacity, contentsOpacity: w.contentsOpacity,
        inkRatio: ink / total, colorful, whitish, nameColor,
        gw: Graphics.width, gh: Graphics.height,
      };
    }
    return { found: false };
  })()`);
}

// Ink of the hotkey badge (systemColor digit at the icon's TOP-RIGHT corner)
// within a list row of Scene_Item / Scene_Skill. Scans only the top band and
// the right 20% of the row rect — every cell carries a blue-ish overlay icon
// at its top-LEFT (same systemColor family), which would otherwise mask the
// badge. Compare a bound row with an unbound neighbour — catches the "badge
// landed on the item to the left" regression.
export async function badgeInk(t, rowIndex) {
  return t.eval(`(() => {
    ${PX_READER}
    const s = SceneManager._scene;
    const w = s && s._itemWindow;
    if (!w || !w.contents || !w.contents.width) return { ok: false, reason: 'no item window contents' };
    const rect = w.itemRect(${rowIndex});
    const bmp = w.contents;
    const sys = parseCss(ColorManager.systemColor());
    // Grid cells (square-ish): badge sits in the right 20% of the top band.
    // Wide list rows (skill menu): icon is at the row's left, badge at its
    // top-right corner — x in [14, 36], y in the top 16.
    const wide = rect.width >= 2 * rect.height;
    const x0 = wide ? rect.x + 14 : Math.floor(rect.x + rect.width * 0.8);
    const x1 = wide ? rect.x + 36 : rect.x + rect.width;
    const band = wide ? 16 : Math.min(20, rect.height);
    let match = 0;
    for (let y = Math.max(0, rect.y); y < rect.y + band && y < bmp.height; y++) {
      for (let x = Math.max(0, x0); x < x1 && x < bmp.width; x++) {
        const p = readPx(bmp, x, y);
        if (p.a > 100 && sys && Math.abs(p.r - sys.r) < 60 &&
            Math.abs(p.g - sys.g) < 60 && Math.abs(p.b - sys.b) < 60) match++;
      }
    }
    return { ok: true, match, wide };
  })()`);
}

// Pixel state of one HUD slot: mean alpha over the icon area (greyed icons
// are painted at paintOpacity 160), ink in the count text zone and in the
// key-digit zone. Returns { ok, iconAlpha, countInk, keyInk }.
export async function hudPixels(t, slotIndex) {
  return t.eval(`(() => {
    ${PX_READER}
    const h = SceneManager._scene && SceneManager._scene._wteHotkeyHud;
    if (!h || !h.bitmap || !h.bitmap.width) return { ok: false, reason: 'no HUD sprite' };
    const bmp = h.bitmap;
    const slot = ${slotIndex}, SW = 40, ICON = 32;
    const iconX = slot * SW + (SW - ICON) / 2, iconY = 2;
    // Mean alpha over the icon's upper strip only — the count text sits in
    // the icon's bottom-right at full opacity and would mask the greying.
    let n = 0, alphaSum = 0;
    for (let y = iconY; y < iconY + 20; y++) {
      for (let x = iconX; x < iconX + ICON; x++) {
        const p = readPx(bmp, x, y);
        if (p.a > 20) { n++; alphaSum += p.a; }
      }
    }
    const inkIn = (x0, y0, w0, h0) => {
      let c = 0;
      for (let y = y0; y < y0 + h0; y++) for (let x = x0; x < x0 + w0; x++) {
        const p = readPx(bmp, x, y);
        if (p.a > 80) c++;
      }
      return c;
    };
    return {
      ok: true,
      iconAlpha: n ? alphaSum / n : 0,
      countInk: inkIn(iconX + ICON - 22, iconY + ICON - 13, 22, 13),
      keyInk: inkIn(slot * SW, iconY + ICON + 1, SW, 16),
    };
  })()`);
}

// Waits for the map interpreter to finish, dismissing message windows with
// enter as they appear (common events behind consumables often Show Text,
// which parks the interpreter until confirmed).
export async function waitEventDone(t, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await t.eval(`$gameMessage.isBusy()`)) {
      await t.key('enter');
      await t.sleep(200);
      continue;
    }
    if (!(await t.eval(`$gameMap.isEventRunning()`))) return;
    await t.sleep(200);
  }
  throw new Error('map event still running after ' + timeoutMs + ' ms');
}
