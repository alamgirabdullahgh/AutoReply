'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, shell, session, nativeImage, safeStorage, webContents } = require('electron');
const path = require('path');
const { createStore } = require('./store');
const { createAi } = require('./ai');
const { createDecider } = require('./decide');

// ওয়েব অ্যাপগুলো যেন ইংরেজি ইন্টারফেসে খোলে (অপঠিত চিহ্ন চেনার জন্য); মেসেজ বাংলায় লেখা/পড়া স্বাভাবিকই চলে
app.commandLine.appendSwitch('lang', 'en-US');

const PARTITIONS = ['persist:whatsapp', 'persist:telegram', 'persist:messenger'];
const ALLOWED_HOST = /^https:\/\/([\w-]+\.)*(whatsapp\.com|whatsapp\.net|telegram\.org|messenger\.com|facebook\.com|fbcdn\.net)(\/|$)/;

let win = null;
let tray = null;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot);
}

function chromeUA() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
    process.versions.chrome + ' Safari/537.36';
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function applyAutostart(v) {
  try { app.setLoginItemSettings({ openAtLogin: !!v, args: ['--hidden'] }); } catch (e) { /* ignore */ }
}

// Chrome DevTools Protocol দিয়ে টাইপ: অ্যাপের জানালায় ফোকাস না থাকলেও চলে, আর আপনি অন্য ট্যাবে লিখতে থাকলে সেটা বিগড়ায় না
async function typeText(wcId, text) {
  const wc = webContents.fromId(wcId);
  if (!wc) throw new Error('ট্যাব পাওয়া যায়নি');
  const attachedHere = !wc.debugger.isAttached();
  if (attachedHere) wc.debugger.attach('1.3');
  const send = (m, p) => wc.debugger.sendCommand(m, p);
  const key = async (type, o) => send('Input.dispatchKeyEvent', Object.assign({ type }, o));
  try {
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // আগের অসমাপ্ত লেখা থাকলে সেটা সরিয়ে নতুন উত্তর বসে
    await key('rawKeyDown', { modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await key('keyUp', { modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        await key('rawKeyDown', { modifiers: 8, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await key('keyUp', { modifiers: 8, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      }
      if (lines[i]) await send('Input.insertText', { text: lines[i] });
    }
    await new Promise((r) => setTimeout(r, 200));
    await key('keyDown', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
    await key('keyUp', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  } finally {
    try { await send('Emulation.setFocusEmulationEnabled', { enabled: false }); } catch (e) { /* ignore */ }
    if (attachedHere) { try { wc.debugger.detach(); } catch (e) { /* ignore */ } }
  }
}

function boot() {
  const store = createStore({ dir: app.getPath('userData'), safe: safeStorage });
  const ai = createAi();
  const decider = createDecider({ getSettings: () => store.get(), ai });

  const ua = chromeUA();
  for (const p of PARTITIONS) {
    const s = session.fromPartition(p);
    s.setUserAgent(ua, 'en-US,en');
    s.setPermissionRequestHandler((wc, permission, cb, details) => {
      const url = (details && details.requestingUrl) || wc.getURL();
      const ok = ALLOWED_HOST.test(url) && ['notifications', 'media', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'mediaKeySystem'].includes(permission);
      cb(ok);
    });
  }

  app.on('web-contents-created', (_e, c) => {
    c.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: !process.argv.includes('--hidden'),
    autoHideMenuBar: true,
    title: 'AutoReply',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  });
  win.setMenu(null);

  // ভেতরের ওয়েব ট্যাবগুলোতে নিজের স্ক্রিপ্ট বসানো; অন্য ঠিকানা খুলতে দেওয়া হয় না
  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    if (!ALLOWED_HOST.test(params.src || '')) { e.preventDefault(); return; }
    webPreferences.preload = path.join(__dirname, 'adapter.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.backgroundThrottling = false;
    delete params.preload;
  });

  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); } // বন্ধ করলে ট্রে-তে চলতে থাকে, যেন উত্তর যেতে থাকে
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('AutoReply');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'AutoReply খুলুন', click: showWindow },
      { type: 'separator' },
      { label: 'বন্ধ করুন (উত্তর দেওয়া থামবে)', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', showWindow);
  } catch (e) { /* ট্রে না হলেও অ্যাপ চলে */ }

  applyAutostart(store.get().autostart);

  ipcMain.handle('settings:get', () => store.get());
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = store.set(patch);
    if (patch && typeof patch.autostart === 'boolean') applyAutostart(patch.autostart);
    return s;
  });
  ipcMain.handle('decide', (_e, p) => decider.decide(p));
  ipcMain.handle('type', async (_e, p) => {
    try { await typeText(p.id, p.text); return { ok: true }; } catch (x) { return { ok: false, err: String(x && x.message || x) }; }
  });
  ipcMain.handle('ai:test', async (_e, cfg) => {
    const r = await ai.test(cfg, 'আপনারা কী কী সেবা দেন?');
    return r;
  });

  app.on('before-quit', () => { quitting = true; });
}

app.on('window-all-closed', () => { /* ট্রে-তে চলতে থাকে */ });
