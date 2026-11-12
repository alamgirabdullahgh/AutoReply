'use strict';
// ওয়েব WhatsApp / Telegram পাতার ভেতরে চলা স্ক্রিপ্ট (webview preload)।
// কাজ: নতুন মেসেজ খোঁজা -> অ্যাপের দিকে পাঠানো -> সিদ্ধান্ত এলে লেখার ঘরে ফোকাস দেওয়া। আসল টাইপ ও Enter করে মূল প্রক্রিয়া।
// লগে বা অ্যাপের দিকে মেসেজের লেখা শুধু সিদ্ধান্তের জন্য যায়; কোথাও জমা রাখা হয় না।

let ipc;
try { ipc = require('electron').ipcRenderer; } catch (e) { ipc = globalThis.__AR_IPC; }

const BN = '০১২৩৪৫৬৭৮৯';
function digits(s) { return String(s).replace(/[০-৯]/g, (c) => String(BN.indexOf(c))); }
function firstNumber(s) {
  const m = digits(s).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}
function txt(el) { return el ? String(el.textContent || '').trim() : ''; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function clickEl(el) {
  const w = el.ownerDocument.defaultView;
  for (const t of ['mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w }));
  }
}

// ---------------- WhatsApp Web ----------------
const whatsapp = {
  app: 'WhatsApp',
  loggedIn: (d) => !!d.querySelector('#pane-side'),
  rows: (d) => {
    const all = Array.from(d.querySelectorAll('#pane-side [role="row"], #pane-side [role="listitem"]'));
    return all.filter((r) => !all.some((o) => o !== r && r.contains(o)));
  },
  rowKey: (r) => {
    const t = r.querySelector('span[title]');
    return t ? (t.getAttribute('title') || txt(t)).trim() : '';
  },
  rowUnread: (r) => {
    for (const s of Array.from(r.querySelectorAll('span[aria-label]'))) {
      const l = s.getAttribute('aria-label') || '';
      if (/unread|অপঠিত/i.test(l)) {
        const n = firstNumber(l);
        return n > 0 ? n : 1;
      }
    }
    return 0;
  },
  clickRow: (r) => clickEl(r.querySelector('[role="gridcell"], [data-testid="cell-frame-container"]') || r),
  openKey: (d) => {
    const e = d.querySelector('#main header span[title]') || d.querySelector('#main header span[dir="auto"]');
    return e ? (e.getAttribute('title') || txt(e)).trim() : '';
  },
  lastMessage: (d) => {
    const els = Array.from(d.querySelectorAll('#main div[data-id]')).filter((e) => /^(true|false)_/.test(e.getAttribute('data-id')));
    const e = els[els.length - 1];
    if (!e) return null;
    const id = e.getAttribute('data-id');
    const own = id.startsWith('true_');
    let spans = Array.from(e.querySelectorAll('span.selectable-text.copyable-text'));
    if (!spans.length) spans = Array.from(e.querySelectorAll('span.selectable-text'));
    const text = spans.map((s) => String(s.innerText || s.textContent || '').trim()).filter(Boolean).join('\n');
    let skip = null;
    if (/@(broadcast|newsletter)/.test(id) || /status@broadcast/.test(id)) skip = 'ব্রডকাস্ট/চ্যানেল/স্ট্যাটাস, তাই বাদ';
    return { id, own, text, isGroup: /@g\.us/.test(id), skip };
  },
  input: (d) => {
    const l = Array.from(d.querySelectorAll('#main footer div[contenteditable="true"]'));
    return l.length ? l[l.length - 1] : null;
  }
};

// ---------------- Telegram Web (A সংস্করণ, web.telegram.org/a) ----------------
const telegram = {
  app: 'Telegram',
  loggedIn: (d) => !!d.querySelector('#LeftColumn .chat-list'),
  rows: (d) => Array.from(d.querySelectorAll('#LeftColumn .chat-list .ListItem')),
  rowKey: (r) => txt(r.querySelector('.fullName') || r.querySelector('h3')),
  rowUnread: (r) => {
    const b = r.querySelector('.ChatBadge.unread');
    if (!b || b.classList.contains('muted')) return 0; // মিউট করা চ্যাটে উত্তর যায় না
    const n = firstNumber(txt(b));
    return n > 0 ? n : 1;
  },
  clickRow: (r) => clickEl(r.querySelector('.ListItem-button') || r),
  openKey: (d) => txt(d.querySelector('#MiddleColumn .ChatInfo .fullName') || d.querySelector('#MiddleColumn .ChatInfo h3')),
  lastMessage: (d) => {
    const els = Array.from(d.querySelectorAll('#MiddleColumn .Message.message-list-item'));
    const e = els[els.length - 1];
    if (!e) return null;
    const id = e.getAttribute('data-message-id') || e.id || '';
    if (!id) return null;
    const own = e.classList.contains('own');
    const tc = e.querySelector('.text-content');
    let text = '';
    if (tc) {
      const c = tc.cloneNode(true);
      c.querySelectorAll('.MessageMeta, .message-time, .Reactions').forEach((x) => x.remove());
      text = String(c.textContent || '').trim();
    }
    // চ্যাটের ধরন: সদস্য-সংখ্যা = গ্রুপ, সাবস্ক্রাইবার = চ্যানেল; বোঝা না গেলে উত্তর নয়
    const info = d.querySelector('#MiddleColumn .ChatInfo');
    const status = txt(info && (info.querySelector('.group-status') || info.querySelector('.status')));
    const title = txt(info && (info.querySelector('.fullName') || info.querySelector('h3')));
    let isGroup = false;
    let skip = null;
    if (/subscriber/i.test(status)) skip = 'টেলিগ্রামের চ্যানেল, তাই বাদ';
    else if (/bot\s*$/i.test(title) || /^\s*bot\b/i.test(status)) skip = 'টেলিগ্রামের বট, তাই বাদ';
    else if (/member/i.test(status)) isGroup = true;
    else if (!status && !own) skip = 'চ্যাটের ধরন বোঝা যায়নি, তাই বাদ';
    return { id, own, text, isGroup, skip };
  },
  input: (d) => d.querySelector('#editable-message-text')
};

function siteFor(host) {
  if (/(^|\.)whatsapp\.com$/.test(host)) return whatsapp;
  if (/(^|\.)telegram\.org$/.test(host)) return telegram;
  return null;
}

function createCore(site, ipcr, doc) {
  const APP = site.app;
  const unread = new Map();  // চ্যাট -> শেষ জানা অপঠিত সংখ্যা
  const lastMid = new Map(); // চ্যাট -> শেষ দেখা মেসেজের পরিচয় (একই মেসেজে দুবার নয়)
  let started = false;
  let busy = false;
  let busySince = 0;
  let pending = null;
  let lastStatus = '';

  const send = (o) => ipcr.sendToHost('ar', Object.assign({ app: APP }, o));
  const status = (s) => { if (s !== lastStatus) { lastStatus = s; send({ t: 'status', s }); } };
  const finish = () => { pending = null; busy = false; };

  function handle(key, m) {
    if (m.skip) { send({ t: 'info', s: m.skip }); return; }
    if (!m.text) { send({ t: 'info', s: 'শুধু ছবি/ফাইল/স্টিকার, তাই বাদ' }); return; }
    busy = true;
    busySince = Date.now();
    pending = { key, mid: m.id };
    send({ t: 'msg', chat: key, mid: m.id, text: m.text, isGroup: m.isGroup });
  }

  async function openAndHandle(target) {
    busy = true;
    busySince = Date.now();
    try {
      site.clickRow(target.row);
      await sleep(900);
      let cur = '';
      let m = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        cur = site.openKey(doc);
        m = site.lastMessage(doc);
        if (cur === target.key && m) break;
        await sleep(300);
      }
      unread.set(target.key, 0);
      busy = false;
      if (!(cur === target.key && m)) { send({ t: 'info', s: 'চ্যাট খোলা যায়নি' }); return; }
      const prevId = lastMid.get(target.key);
      lastMid.set(target.key, m.id);
      if (m.own || prevId === m.id) return;
      handle(target.key, m);
    } catch (e) {
      busy = false;
      send({ t: 'info', s: 'ত্রুটি: ' + (e && e.message ? e.message : e) });
    }
  }

  async function tick() {
    if (busy) {
      if (Date.now() - busySince > 120000) finish(); else return;
    }
    if (!site.loggedIn(doc)) { status('লগইন প্রয়োজন (QR স্ক্যান বা নম্বর দিয়ে ঢুকুন)'); started = false; return; }
    status('চালু');
    const rows = site.rows(doc);
    let target = null;
    rows.forEach((r, i) => {
      const key = site.rowKey(r);
      if (!key) return;
      const n = site.rowUnread(r);
      const prev = unread.get(key);
      unread.set(key, n);
      if (!started || target) return;
      // নতুন মেসেজ = অপঠিত সংখ্যা বেড়েছে; তালিকায় প্রথমবার দেখা চ্যাট হলে শুধু ওপরের ৩টির মধ্যে থাকলে
      if (n > 0 && (prev === undefined ? i < 3 : n > prev)) target = { row: r, key, n };
    });
    const first = !started;
    started = true;
    if (target) { await openAndHandle(target); return; }
    // এই মুহূর্তে খোলা চ্যাটে নতুন মেসেজ এলে (অপঠিত চিহ্ন ওঠে না)
    const cur = site.openKey(doc);
    if (!cur) return;
    const m = site.lastMessage(doc);
    if (!m) return;
    const prevId = lastMid.get(cur);
    if (prevId === undefined) { lastMid.set(cur, m.id); return; }
    if (first || prevId === m.id) return;
    lastMid.set(cur, m.id);
    if (!m.own) handle(cur, m);
  }

  async function onCmd(c) {
    if (!pending) return;
    if (c.t === 'skip') { finish(); return; }
    if (c.t === 'reply') {
      if (site.openKey(doc) !== pending.key) {
        send({ t: 'result', ok: false, reason: 'চ্যাট বদলে গেছে, উত্তর পাঠানো হয়নি' });
        finish();
        return;
      }
      const inp = site.input(doc);
      if (!inp) { send({ t: 'result', ok: false, reason: 'লেখার ঘর পাওয়া যায়নি' }); finish(); return; }
      inp.focus();
      send({ t: 'type', text: c.text });
      return;
    }
    if (c.t === 'typed') {
      if (c.err) { send({ t: 'result', ok: false, reason: 'টাইপ করা যায়নি: ' + c.err }); finish(); return; }
      await sleep(1200);
      const m = site.lastMessage(doc);
      if (m && m.own) { lastMid.set(pending.key, m.id); send({ t: 'result', ok: true }); }
      else send({ t: 'result', ok: false, reason: 'পাঠানো হয়েছে কি না নিশ্চিত হওয়া যায়নি' });
      finish();
    }
  }

  return { tick, onCmd, state: () => ({ busy, started, unread, lastMid }) };
}

function start() {
  const site = siteFor(location.hostname);
  if (!site) return null;
  const core = createCore(site, ipc, document);
  ipc.on('ar-cmd', (_e, c) => { core.onCmd(c).catch(() => {}); });
  setInterval(() => { core.tick().catch(() => {}); }, 2500);
  return core;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createCore, whatsapp, telegram, siteFor, start };
}
if (!globalThis.__AR_TEST) start();
