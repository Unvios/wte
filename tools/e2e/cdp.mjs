// Minimal Chrome DevTools Protocol client over the built-in WebSocket (Node >= 22).
// No dependencies. Used by run.mjs to drive the game under the NW.js SDK binary.

export class CdpError extends Error {}

export class CDP {
  constructor() {
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.listeners = new Map(); // method -> Set<fn>
    this.consoleLog = []; // collected console + log entries
  }

  get isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  static async connect(wsUrl, timeoutMs = 10000) {
    const cdp = new CDP();
    cdp.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError(`WS connect timeout: ${wsUrl}`)), timeoutMs);
      cdp.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      cdp.ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new CdpError(`WS error: ${e.message || 'unknown'}`)); }, { once: true });
    });
    cdp.ws.addEventListener('message', (ev) => cdp._onMessage(ev));
    cdp.ws.addEventListener('close', () => cdp._onClose());
    return cdp;
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new CdpError(`${msg.error.message} (code ${msg.error.code})`));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params;
      const text = p.args.map((a) => a.value !== undefined ? String(a.value) : (a.description ?? a.type)).join(' ');
      this.consoleLog.push({ kind: 'console', level: p.type, text });
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      this.consoleLog.push({ kind: 'log', level: e.level, text: `[${e.source}] ${e.text}` });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const text = d.exception?.description || d.text;
      this.consoleLog.push({ kind: 'exception', level: 'error', text });
    }
    const set = this.listeners.get(msg.method);
    if (set) for (const fn of set) fn(msg.params);
  }

  _onClose() {
    for (const { reject } of this.pending.values()) {
      reject(new CdpError('WebSocket closed'));
    }
    this.pending.clear();
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (!this.isOpen) return Promise.reject(new CdpError('WebSocket not open'));
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

// --- High-level helpers ---------------------------------------------------

// Key table for Input.dispatchKeyEvent. RPG Maker MZ listens for real
// keydown/keyup on document, so trusted CDP input events drive it natively.
const KEYS = {
  enter:     { windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' },
  escape:    { windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' },
  shift:     { windowsVirtualKeyCode: 16, key: 'Shift', code: 'ShiftLeft' },
  control:   { windowsVirtualKeyCode: 17, key: 'Control', code: 'ControlLeft' },
  tab:       { windowsVirtualKeyCode: 9,  key: 'Tab', code: 'Tab' },
  space:     { windowsVirtualKeyCode: 32, key: ' ', code: 'Space', text: ' ' },
  pageup:    { windowsVirtualKeyCode: 33, key: 'PageUp', code: 'PageUp' },
  pagedown:  { windowsVirtualKeyCode: 34, key: 'PageDown', code: 'PageDown' },
  up:        { windowsVirtualKeyCode: 38, key: 'ArrowUp', code: 'ArrowUp' },
  down:      { windowsVirtualKeyCode: 40, key: 'ArrowDown', code: 'ArrowDown' },
  left:      { windowsVirtualKeyCode: 37, key: 'ArrowLeft', code: 'ArrowLeft' },
  right:     { windowsVirtualKeyCode: 39, key: 'ArrowRight', code: 'ArrowRight' },
};

for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(97 + i); // 'a'..'z'
  KEYS[ch] = { windowsVirtualKeyCode: 65 + i, key: ch, code: 'Key' + ch.toUpperCase(), text: ch };
}
for (let i = 0; i <= 9; i++) {
  KEYS[String(i)] = { windowsVirtualKeyCode: 48 + i, key: String(i), code: 'Digit' + i, text: String(i) };
}

export async function pressKey(cdp, name, { holdMs = 60 } = {}) {
  const def = KEYS[name.toLowerCase()];
  if (!def) throw new CdpError(`Unknown key: ${name}`);
  const base = { ...def, nativeVirtualKeyCode: def.windowsVirtualKeyCode };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await new Promise((r) => setTimeout(r, holdMs));
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

export async function evaluate(cdp, expression, { timeoutMs = 30000 } = {}) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, timeoutMs);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new CdpError(`evaluate failed: ${d.exception?.description || d.text}\n  in: ${expression.slice(0, 200)}`);
  }
  return res.result.value;
}

export async function screenshot(cdp, filePath, fs, path) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
  return filePath;
}
