// E2E scenario runner: launches the game under the NW.js SDK binary with a CDP
// port, connects, executes a scenario module, collects artifacts, kills the game.
//
// Usage: node tools/e2e/run.mjs tools/e2e/scenarios/smoke.mjs [--keep] [--port 9222] [--headless] [--sandbox]
// Requires Node >= 22 (built-in WebSocket and fetch).

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CDP, pressKey, evaluate, screenshot } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..', '..');
const nwExe = path.join(realRoot, 'tools', 'nwjs-sdk', 'nw.exe');
const fixturesDir = path.join(here, 'fixtures');
const sandboxDir = path.join(here, 'sandbox');

function parseArgs(argv) {
  const args = { scenario: null, keep: false, port: 9222, protectSaves: true, headless: false, sandbox: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep') args.keep = true;
    else if (argv[i] === '--no-protect-saves') args.protectSaves = false;
    else if (argv[i] === '--headless') args.headless = true;
    else if (argv[i] === '--sandbox') args.sandbox = true;
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (!args.scenario) args.scenario = argv[i];
  }
  if (!args.scenario) {
    console.error('Usage: node tools/e2e/run.mjs <scenario.mjs> [--keep] [--port N] [--headless] [--sandbox] [--no-protect-saves]');
    process.exit(2);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function isGameTarget(t) {
  return t.type === 'page' && t.title === 'WelcomeToElderfield' && /index/i.test(t.url);
}

// --- Save protection ------------------------------------------------------
// Snapshot + full backup of save/ before launch; after the run any changed or
// deleted file is restored from the backup and any new file is removed.

function snapshotDir(dir) {
  const files = new Map();
  const walk = (sub) => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else {
        const st = fs.statSync(path.join(dir, rel));
        files.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  walk('');
  return files;
}

function createSaveGuard(saveDir) {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wte-saves-'));
  fs.cpSync(saveDir, backupDir, { recursive: true });
  const snapshot = snapshotDir(saveDir);
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  };
  return {
    restore() {
      const current = snapshotDir(saveDir);
      const restored = [], removed = [];
      for (const [rel, before] of snapshot) {
        const cur = current.get(rel);
        if (!cur || cur.size !== before.size || cur.mtimeMs !== before.mtimeMs) {
          fs.mkdirSync(path.dirname(path.join(saveDir, rel)), { recursive: true });
          fs.cpSync(path.join(backupDir, rel), path.join(saveDir, rel));
          restored.push(rel);
        }
      }
      for (const rel of current.keys()) {
        if (!snapshot.has(rel)) {
          fs.rmSync(path.join(saveDir, rel));
          removed.push(rel);
        }
      }
      dispose();
      return { restored, removed };
    },
    dispose,
    get disposed() { return disposed; },
  };
}

async function waitForTarget(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const target = list.find(isGameTarget);
      if (target) return target;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Game page target not found on port ${port} within ${timeoutMs} ms`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarioPath = path.resolve(args.scenario);
  const scenarioName = path.basename(args.scenario, '.mjs');

  if (!fs.existsSync(nwExe)) {
    throw new Error(`NW.js SDK not found at ${nwExe} — see docs/e2e-testing.md`);
  }

  // Fail fast if the debug port is already taken (leftover game instance).
  try {
    await fetchJson(`http://127.0.0.1:${args.port}/json/version`, 1500);
    throw new Error(`Port ${args.port} is already serving CDP — close the running game first (or pass --port).`);
  } catch (e) {
    if (e.message.includes('already serving')) throw e;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactsDir = path.join(here, 'artifacts', `${scenarioName}-${stamp}`);
  fs.mkdirSync(artifactsDir, { recursive: true });

  // --sandbox: run on the junction-linked copy with its own disposable save/.
  const gameRoot = args.sandbox ? sandboxDir : realRoot;
  if (args.sandbox && !fs.existsSync(path.join(sandboxDir, 'package.json'))) {
    throw new Error('sandbox not found — run tools/e2e/make_sandbox.sh first');
  }

  const saveDir = path.join(gameRoot, 'save');
  const saveGuard = (args.protectSaves && fs.existsSync(saveDir)) ? createSaveGuard(saveDir) : null;
  if (saveGuard) console.log(`[e2e] ${args.sandbox ? 'sandbox ' : ''}save/ backed up — any change made by the run will be rolled back`);

  // Install fixture saves (tools/e2e/fixtures/*.rmmzsave) into the run's save/.
  if (fs.existsSync(fixturesDir)) {
    for (const f of fs.readdirSync(fixturesDir)) {
      if (f.endsWith('.rmmzsave')) {
        fs.copyFileSync(path.join(fixturesDir, f), path.join(saveDir, f));
      }
    }
  }

  console.log(`[e2e] launching game under NW.js SDK (port ${args.port}${args.headless ? ', headless' : ''}${args.sandbox ? ', sandbox' : ''})...`);
  const nwArgs = [gameRoot, `--remote-debugging-port=${args.port}`];
  let headlessProfile = null;
  if (args.headless) {
    // NW.js headless refuses to start without an explicit user data dir.
    headlessProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'wte-nw-profile-'));
    nwArgs.push('--headless=new', '--mute-audio', `--user-data-dir=${headlessProfile}`);
  }
  const game = spawn(nwExe, nwArgs, {
    cwd: gameRoot,
    stdio: 'ignore',
  });
  let gameKilled = false;
  const killGame = () => {
    if (gameKilled || !game.pid) return;
    gameKilled = true;
    try { execSync(`taskkill /F /T /PID ${game.pid}`, { stdio: 'ignore' }); } catch {}
  };
  process.on('SIGINT', () => { killGame(); process.exit(130); });
  process.on('exit', () => {
    if (args.keep) return; // game intentionally left running, saves not rolled back
    killGame();
    // Last-resort rollback for abrupt exits (SIGINT, fatal). Sync ops only.
    if (saveGuard && !saveGuard.disposed) {
      try { saveGuard.restore(); } catch {}
    }
  });

  let cdp = null;
  const connect = async () => {
    const target = await waitForTarget(args.port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
  };
  // The mod loader may reload the game once on first run; reconnect lazily.
  const ensureConnected = async () => {
    if (!cdp || !cdp.isOpen) {
      console.log('[e2e] (re)connecting to game target...');
      await connect();
    }
  };

  const saveArtifacts = async (prefix) => {
    if (cdp) {
      const consoleFile = path.join(artifactsDir, `${prefix}console.log`);
      fs.writeFileSync(consoleFile, cdp.consoleLog.map((e) => `[${e.level}] ${e.text}`).join('\n'));
    }
  };

  let failures = 0;
  const t = {
    async eval(expr) {
      await ensureConnected();
      return evaluate(cdp, expr);
    },
    async waitFor(expr, { timeout = 30000, poll = 250, desc } = {}) {
      const deadline = Date.now() + timeout;
      let lastErr = null;
      while (Date.now() < deadline) {
        try {
          if (await this.eval(expr)) return;
        } catch (e) { lastErr = e; }
        await sleep(poll);
      }
      throw new Error(`waitFor timed out (${timeout} ms): ${desc || expr}${lastErr ? ` — last error: ${lastErr.message}` : ''}`);
    },
    async key(name, opts) {
      await ensureConnected();
      await pressKey(cdp, name, opts);
    },
    async shot(name = 'shot') {
      await ensureConnected();
      const file = path.join(artifactsDir, `${name}.png`);
      await screenshot(cdp, file, fs, path);
      console.log(`[e2e] screenshot: ${file}`);
      return file;
    },
    assert(cond, msg) {
      if (!cond) {
        failures++;
        throw new Error(`assert failed: ${msg}`);
      }
      console.log(`[e2e] ok: ${msg}`);
    },
    sleep,
    log: (msg) => console.log(`[e2e] ${msg}`),
    consoleText: () => (cdp ? cdp.consoleLog.map((e) => `[${e.level}] ${e.text}`).join('\n') : ''),
    artifactsDir,
    gameRoot,
    realRoot,
  };

  let exitCode = 0;
  try {
    const scenario = (await import(pathToFileURL(scenarioPath).href)).default;
    if (typeof scenario !== 'function') throw new Error(`${scenarioPath} must export default async function`);
    console.log(`[e2e] scenario: ${scenarioName}`);
    const started = Date.now();
    await scenario(t);
    console.log(`[e2e] PASS ${scenarioName} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    exitCode = 1;
    console.error(`[e2e] FAIL ${scenarioName}: ${e.message}`);
    try {
      await ensureConnected();
      await t.shot('FAIL');
    } catch {}
  } finally {
    await saveArtifacts('');
    console.log(`[e2e] artifacts: ${artifactsDir}`);
    if (!args.keep) killGame();
    else console.log('[e2e] --keep: game left running');
    if (headlessProfile && !args.keep) {
      try { fs.rmSync(headlessProfile, { recursive: true, force: true }); } catch {}
    }
    if (saveGuard) {
      if (args.keep) {
        console.log('[e2e] WARNING: --keep leaves the game running — save rollback skipped (--no-protect-saves assumed)');
        saveGuard.dispose();
      } else {
        // Roll back after the game process is dead, so it cannot rewrite files.
        const { restored, removed } = saveGuard.restore();
        if (restored.length + removed.length === 0) {
          console.log('[e2e] saves untouched');
        } else {
          console.log(`[e2e] save protection: rolled back ${restored.length} changed (${restored.slice(0, 10).join(', ')}), removed ${removed.length} new (${removed.slice(0, 10).join(', ')})`);
        }
      }
    }
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(`[e2e] fatal: ${e.message}`);
  process.exit(1);
});
