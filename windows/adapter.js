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
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const E = (t.startsWith('pointer') && w.PointerEvent) ? w.PointerEvent : w.MouseEvent;
    try { el.dispatchEvent(new E(t, { bubbles: true, cancelable: true, view: w, button: 0 })); } catch (e) { /* ignore */ }
  }
}

// চ্যাটের নাম মেলানো: ফাঁকা জায়গা, অদৃশ্য দিক-চিহ্ন, বিরামচিহ্ন, বড়/ছোট হাতের তফাত উপেক্ষা (নম্বরের ফরম্যাট তালিকা ও হেডারে আলাদা হতে পারে)
function normKey(s) {
  try { return String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); } catch (e) { return String(s || '').trim().toLowerCase(); }
}
function sameKey(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = normKey(a);
  const y = normKey(b);
  return x !== '' && x === y;
}

// ---------------- WhatsApp Web ----------------
// খোলা চ্যাটের প্যানেল: আগে #main; না পেলে চ্যাট-প্যানেলের বিকল্প
function waRoot(d) {
  return d.querySelector('#main') || d.querySelector('[data-testid="conversation-panel-wrapper"]') || d.querySelector('div[role="application"]');
}
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
    for (const sel of ['#main header span[title]', '#main header span[dir="auto"]', '#main header [dir="auto"]']) {
      const e = d.querySelector(sel);
      const v = e ? (e.getAttribute('title') || txt(e)).trim() : '';
      if (v) return v;
    }
    // ফলব্যাক: #main না থাকলেও চ্যাট প্যানেলের হেডারের প্রথম লেখা
    const root = waRoot(d);
    const h = root && root.querySelector('header');
    if (h) {
      const t = h.querySelector('[title]');
      const tv = t ? (t.getAttribute('title') || '').trim() : '';
      if (tv) return tv;
      const line = String(h.innerText || h.textContent || '').split('\n').map((x) => x.trim()).filter(Boolean)[0];
      if (line) return line;
    }
    return '';
  },
  // তালিকায় যে চ্যাটটা এখন নির্বাচিত (হেডারের নাম না পড়া গেলে এটা দিয়ে চেনা হয়)
  selectedKey: (d) => {
    const r = whatsapp.rows(d).find((x) => x.getAttribute('aria-selected') === 'true' || x.querySelector('[aria-selected="true"]'));
    return r ? whatsapp.rowKey(r) : '';
  },
  diag: (d) => 'main:' + (d.querySelector('#main') ? 'আছে' : 'নেই') + ' হেডার:' + ((waRoot(d) && waRoot(d).querySelector('header')) ? 'আছে' : 'নেই') +
    ' মেসেজ:' + d.querySelectorAll('[data-id]').length,
  lastMessage: (d) => {
    let els = Array.from(d.querySelectorAll('#main div[data-id]')).filter((e) => /^(true|false)_/.test(e.getAttribute('data-id')));
    // ফলব্যাক: WhatsApp Web-এর ভেতরের গঠন বদলালে message-in/out ক্লাস দিয়ে ধরা
    if (!els.length) els = Array.from(d.querySelectorAll('#main .message-in, #main .message-out'));
    if (!els.length) {
      const root = waRoot(d);
      if (root) {
        els = Array.from(root.querySelectorAll('div[data-id]')).filter((e) => /^(true|false)_/.test(e.getAttribute('data-id')));
        if (!els.length) els = Array.from(root.querySelectorAll('.message-in, .message-out'));
      }
    }
    const e = els[els.length - 1];
    if (!e) return null;
    const inner = e.getAttribute('data-id') ? e : e.querySelector('[data-id]');
    const meta = e.querySelector('[data-pre-plain-text]');
    const msgOut = !!(e.classList && e.classList.contains('message-out')) || !!(e.closest && e.closest('.message-out'));
    let id = (inner && inner.getAttribute('data-id')) || '';
    const own = id ? id.startsWith('true_') : msgOut;
    let spans = Array.from(e.querySelectorAll('span.selectable-text.copyable-text'));
    if (!spans.length) spans = Array.from(e.querySelectorAll('span.selectable-text'));
    if (!spans.length) spans = Array.from(e.querySelectorAll('[data-testid="selectable-text"], .copyable-text span'));
    const text = spans.map((s) => String(s.innerText || s.textContent || '').trim()).filter(Boolean).join('\n');
    if (!id) {
      // পরিচয় না পেলে সময়-চিহ্ন + লেখা দিয়ে বানানো, যাতে একই মেসেজে দুবার উত্তর না যায়
      id = (own ? 'true_' : 'false_') + 'syn_' + (meta ? meta.getAttribute('data-pre-plain-text') : '') + '|' + text.length + '|' + text.slice(0, 40) + '|' + els.length;
    }
    let skip = null;
    if (/@(broadcast|newsletter)/.test(id) || /status@broadcast/.test(id)) skip = 'ব্রডকাস্ট/চ্যানেল/স্ট্যাটাস, তাই বাদ';
    return { id, own, text, isGroup: /@g\.us/.test(id), skip };
  },
  input: (d) => {
    let l = Array.from(d.querySelectorAll('#main footer div[contenteditable="true"]'));
    if (!l.length) { const root = waRoot(d); if (root) l = Array.from(root.querySelectorAll('footer div[contenteditable="true"]')); }
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
  // খোলা চ্যাটের নাম: হেডার থেকে; না পড়া গেলে তালিকায় নির্বাচিত চ্যাট থেকে
  const curKey = () => site.openKey(doc) || (site.selectedKey ? site.selectedKey(doc) : '');

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
      // কৃত্রিম ক্লিকে চ্যাট না খুললে আসল মাউস-ক্লিক (অ্যাপের মূল প্রক্রিয়া দিয়ে) একবার পাঠানো
      if (!sameKey(curKey(), target.key) && target.row.getBoundingClientRect) {
        const rc = target.row.getBoundingClientRect();
        if (rc.width > 0 && rc.height > 0) {
          send({ t: 'click', x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) });
          await sleep(1200);
        }
      }
      let cur = '';
      let m = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        cur = curKey();
        m = site.lastMessage(doc);
        if (sameKey(cur, target.key) && m) break;
        await sleep(300);
      }
      unread.set(target.key, 0);
      busy = false;
      if (!(sameKey(cur, target.key) && m)) {
        const why = !cur ? 'খোলা চ্যাটের নাম পড়া যায়নি'
          : !sameKey(cur, target.key) ? 'খোলা চ্যাটের নাম তালিকার নামের সাথে মেলেনি'
            : 'চ্যাটের শেষ মেসেজ পড়া যায়নি';
        send({ t: 'info', s: 'চ্যাট খোলা যায়নি (' + why + ')' + (site.diag ? ' [' + site.diag(doc) + ']' : '') });
        return;
      }
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
    const cur = curKey();
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
      if (!sameKey(curKey(), pending.key)) {
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
