// Loot Toasts E2E: loads the fixture save (slot 90, tools/e2e/fixtures/),
// runs a scripted battle (troop 5 = "Rat"), kills the enemy instantly and lets
// the real victory flow run — CE 27, loot tables, die roll. Asserts on the
// mod's own log (flush line), on live toast windows marked _wteLootToast and
// on toast geometry. Screenshots are artifacts.
// Run: node tools/e2e/run.mjs tools/e2e/scenarios/loot-toasts.mjs --sandbox [--headless]
// Overrides: WTE_SLOT=58 (save slot, default 90), WTE_TROOP=8 (troop id).

import fs from 'node:fs';
import path from 'node:path';

const SAVE_SLOT = Number(process.env.WTE_SLOT || 90);
const TROOP_ID = Number(process.env.WTE_TROOP || 5);

function readLogFrom(logPath, offset) {
  if (!fs.existsSync(logPath)) return '';
  const size = fs.statSync(logPath).size;
  const from = size >= offset ? offset : 0; // log rotated -> read whole file
  const fd = fs.openSync(logPath, 'r');
  const buf = Buffer.alloc(size - from);
  fs.readSync(fd, buf, 0, buf.length, from);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

export default async function lootToasts(t) {
  const logPath = path.join(t.gameRoot, 'mods', 'WTE_QOL_Loot_Toasts', 'logs', 'loot_toasts.log');
  const logSizeAtStart = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Title'`,
    { timeout: 120000, poll: 500, desc: 'title screen' });

  t.log(`loading save slot ${SAVE_SLOT} via the native load UI path...`);
  // WTE_GlobalSaveRebuilder rebuilds globalInfo asynchronously on boot;
  // until it finishes, the load scene shows the fixture slot as empty.
  await t.waitFor(`DataManager._globalInfo && !!DataManager._globalInfo[${SAVE_SLOT}]`,
    { timeout: 60000, desc: 'globalInfo rebuilt with the fixture slot' });
  // Programmatic DataManager.loadGame + SceneManager.goto(Scene_Map) leaves
  // the map renderer half-initialized (black tiles) — the native Scene_Load
  // chain (fadeOutAll, reloadMapIfUpdated, plugin hooks) is required.
  // Enter via Scene_Load exactly as the title's "Continue" does.
  const cont = await t.eval(`(() => {
    const s = SceneManager._scene;
    if (typeof s.commandContinue === 'function') { s.commandContinue(); return 'commandContinue'; }
    if (typeof Scene_Load === 'function') { SceneManager.push(Scene_Load); return 'push(Scene_Load)'; }
    return 'none';
  })()`);
  t.assert(cont !== 'none', `entered continue flow (${cont})`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Load'`,
    { timeout: 15000, desc: 'Scene_Load opened' });
  const sel = await t.eval(`(() => {
    const lw = SceneManager._scene._listWindow;
    for (let i = 0; i < lw.maxItems(); i++) {
      if (lw.indexToSavefileId(i) === ${SAVE_SLOT}) { lw.select(i); lw.refresh(); return i; }
    }
    return -1;
  })()`);
  t.assert(sel >= 0, `save slot ${SAVE_SLOT} found in the load list (index ${sel})`);
  // Scene_File.create triggers another async globalInfo rebuild — wait until
  // the slot is actually loadable, not just present in the list.
  await t.waitFor(`(() => {
    const s = SceneManager._scene;
    return s && s.constructor.name === 'Scene_Load' && s.isSavefileEnabled(${SAVE_SLOT});
  })()`, { timeout: 30000, desc: 'slot enabled in the load scene' });
  // The slot list / DR-submenu plumbing exists only to derive the savefileId
  // for the player; we know ours. Scene_Load.executeLoad IS the native chain:
  // DataManager.loadGame -> onLoadSuccess (fadeOutAll, reloadMapIfUpdated,
  // goto(Scene_Map), plugin hooks). Call it directly.
  await t.eval(`(() => {
    const s = SceneManager._scene;
    if (typeof s.executeLoad === 'function') { s.executeLoad(${SAVE_SLOT}); return 'executeLoad'; }
    DataManager.loadGame(${SAVE_SLOT});
    return 'loadGame';
  })()`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Map'`,
    { timeout: 60000, desc: 'Scene_Map after load' });
  t.log(`on map ${await t.eval(`$gameMap.mapId()`)}`);
  await t.sleep(2000);
  // Render sanity: the map must not stay a black void (sampled pixels, no
  // image recognition). Poll: right after load the scene is mid fade-in and
  // textures are still streaming, so a fixed sleep is not enough.
  const litExpr = `(() => {
    const b = SceneManager.snap();
    const d = b.canvas.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let lit = 0, n = 0;
    for (let i = 0; i + 2 < d.length; i += 4 * 997) {
      n++;
      if (d[i] > 16 || d[i + 1] > 16 || d[i + 2] > 16) lit++;
    }
    return lit / n > 0.05;
  })()`;
  await t.waitFor(litExpr, { timeout: 30000, poll: 500, desc: 'map renders (lit pixels > 5%)' });

  t.log(`starting scripted battle: troop ${TROOP_ID}...`);
  await t.eval(`BattleManager.setup(${TROOP_ID}, true, false); SceneManager.push(Scene_Battle); 'ok'`);
  await t.waitFor(`SceneManager._scene?.constructor.name === 'Scene_Battle'`,
    { timeout: 30000, desc: 'battle scene active' });

  // Wait until the battle leaves its intro phase. First battles in this save
  // may open a long tutorial message chain — dismiss messages by pressing ok.
  await t.waitFor(`['start', 'turn', 'input'].includes(BattleManager._phase)`,
    { timeout: 30000, desc: 'battle phase started' });
  for (let i = 0; i < 60; i++) {
    if (!(await t.eval(`$gameMessage.isBusy()`))) break;
    await t.key('enter');
    await t.sleep(300);
  }
  // In this MZ core die() does NOT apply the death state — refresh() does when
  // hp reaches 0. setHp(0) + refresh() is the honest kill path.
  await t.eval(`$gameTroop.members().forEach(e => { e.setHp(0); e.refresh(); }); 'ok'`);
  // checkBattleEnd only fires after actions/turn ends in vanilla; poke it.
  await t.eval(`BattleManager.checkBattleEnd(); 'ok'`);

  // Victory flow may still surface messages; keep dismissing until we are
  // back on the map (with the mod, victory windows are skipped entirely).
  const mapDeadline = Date.now() + 60000;
  let onMap = false;
  while (Date.now() < mapDeadline) {
    onMap = await t.eval(`SceneManager._scene?.constructor.name === 'Scene_Map'`);
    if (onMap) break;
    if (await t.eval(`$gameMessage.isBusy()`)) await t.key('enter');
    if (await t.eval(`SceneManager._scene?.constructor.name === 'Scene_Battle' && $gameTroop.isAllDead() && BattleManager._phase !== 'battleEnd'`)) {
      await t.eval(`BattleManager.checkBattleEnd(); 'ok'`);
    }
    await t.sleep(500);
  }
  t.assert(onMap, 'back on the map after victory');

  t.log('waiting for the mod to flush the loot batch...');
  const deadline = Date.now() + 30000;
  let newLog = '';
  while (Date.now() < deadline) {
    newLog = readLogFrom(logPath, logSizeAtStart);
    if (/\bflush:/.test(newLog)) break;
    await t.sleep(500);
  }
  t.assert(/\bflush:/.test(newLog), 'mod logged a loot flush');
  const flushLine = newLog.trim().split('\n').filter(l => l.includes('flush:')).pop();
  t.log(`flush line: ${flushLine}`);

  // Toasts fade in/out (~3 s lifetime): poll until one is displaying AND
  // fully opaque, otherwise geometry/visibility checks catch it mid-fade.
  const toastExpr = `(() => {
    const scene = SceneManager._scene;
    const out = [];
    for (let i = 1; i <= 10; i++) {
      const w = scene['_cgmz_toastWindow' + i];
      if (w && w.isDisplaying && w.isDisplaying() &&
          w.opacity > 250 && w.contentsOpacity > 250 &&
          w._wteActiveToast && w._wteActiveToast._wteLootToast) {
        out.push({ slot: i, text: w._wteActiveToast.lineOne || '',
                   shrine: !!w._wteActiveToast._wteShrine,
                   face: w._wteActiveToast._wteSummaryFace || 0 });
      }
    }
    return out;
  })()`;
  let toasts = [];
  const toastDeadline = Date.now() + 15000;
  while (Date.now() < toastDeadline) {
    toasts = await t.eval(toastExpr);
    if (toasts.length > 0) break;
    await t.sleep(100);
  }
  t.log(`visible loot toasts: ${JSON.stringify(toasts)}`);
  t.assert(toasts.length > 0, 'at least one loot toast on screen');

  // Programmatic visual checks (no pixels): geometry, visibility, overlap.
  const geom = await t.eval(`(() => {
    const scene = SceneManager._scene;
    const wins = [];
    for (let i = 1; i <= 10; i++) {
      const w = scene['_cgmz_toastWindow' + i];
      if (w && w.isDisplaying && w.isDisplaying() &&
          w._wteActiveToast && w._wteActiveToast._wteLootToast) {
        // Who covers this window: siblings in the same parent that intersect
        // its rect and are drawn later (= on top), visible and not transparent.
        const covers = [];
        if (w.parent) {
          const idx = w.parent.children.indexOf(w);
          for (let j = idx + 1; j < w.parent.children.length; j++) {
            const o = w.parent.children[j];
            if (!o.visible || (o.opacity !== undefined && o.opacity < 128)) continue;
            if (o.x === undefined || o.width === undefined) continue;
            const overlap = o.x < w.x + w.width && o.x + o.width > w.x &&
                            o.y < w.y + w.height && o.y + o.height > w.y;
            if (overlap) covers.push(o.constructor?.name + '#' + j);
          }
        }
        wins.push({ slot: i, x: w.x, y: w.y, w: w.width, h: w.height,
                    opacity: w.opacity, contentsOpacity: w.contentsOpacity,
                    openness: w.openness, visible: !!w.visible,
                    text: w._wteActiveToast.lineOne, coveredBy: covers });
      }
    }
    return { wins, boxW: Graphics.boxWidth, boxH: Graphics.boxHeight };
  })()`);
  const EXPECT_W = 380, EXPECT_MARGIN = 8; // mirrors mod CONFIG
  for (const win of geom.wins) {
    t.assert(win.w === EXPECT_W, `toast slot ${win.slot} width ${win.w} === ${EXPECT_W}`);
    t.assert(win.x === geom.boxW - EXPECT_W - EXPECT_MARGIN,
      `toast slot ${win.slot} right margin (${win.x} + ${win.w} + ${EXPECT_MARGIN} === ${geom.boxW})`);
    t.assert(win.h > 0, `toast slot ${win.slot} has height (${win.h})`);
    t.assert(win.visible && win.opacity === 255 && win.contentsOpacity === 255 && win.openness === 255,
      `toast slot ${win.slot} fully visible (visible=${win.visible} opacity=${win.opacity} contents=${win.contentsOpacity} openness=${win.openness})`);
    t.assert(win.x >= 0 && win.x + win.w <= geom.boxW && win.y >= 0 && win.y + win.h <= geom.boxH,
      `toast slot ${win.slot} fully on screen (x=${win.x} y=${win.y} w=${win.w} h=${win.h})`);
    t.assert(win.coveredBy.length === 0,
      `toast slot ${win.slot} not covered by anything (coveredBy: ${win.coveredBy.join(', ') || 'none'})`);
  }
  // Stack order: bottom-up, no two toasts overlap.
  const sorted = [...geom.wins].sort((a, b) => a.slot - b.slot);
  for (let i = 1; i < sorted.length; i++) {
    t.assert(sorted[i].y + sorted[i].h <= sorted[i - 1].y,
      `toast slot ${sorted[i].slot} stacked above slot ${sorted[i - 1].slot} without overlap`);
  }

  // snap() is the engine-internal render (works even when the CDP compositor
  // capture is black); shot() is the plain CDP screenshot.
  const dataUrl = await t.eval(`SceneManager.snap().canvas.toDataURL('image/png')`);
  fs.writeFileSync(path.join(t.artifactsDir, 'snap.png'),
    Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  await t.shot('loot-toasts');
}
