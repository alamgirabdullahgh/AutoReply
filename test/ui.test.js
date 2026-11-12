'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { defaults } = require('../store');

async function boot(extra) {
  const dir = path.join(__dirname, '..', 'renderer');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('<script src="renderer.js"></script>', '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  let S = defaults();
  const calls = { saved: [], installed: 0 };
  let uListener = null;
  w.ar = {
    getSettings: async () => S,
    setSettings: async (p) => { calls.saved.push(p); if (p.rules) S.rules = p.rules; if (p.enabled !== undefined) S.enabled = p.enabled; return S; },
    decide: async () => ({}), type: async () => ({ ok: true }), aiTest: async () => ({ text: 'ok' }),
    updateState: async () => (extra && extra.state) || { cur: '1.0.5', latest: null },
    updateCheck: async () => ({ cur: '1.0.5', latest: null }),
    updateInstall: async () => { calls.installed++; return { ok: true }; },
    onUpdate: (cb) => { uListener = cb; }
  };
  w.eval(fs.readFileSync(path.join(dir, 'renderer.js'), 'utf8'));
  await new Promise((r) => setTimeout(r, 30));
  return { w, d: w.document, calls, emit: (k, v) => uListener(k, v), get S() { return S; } };
}

test('শুরুতেই দুটো ডিফল্ট নিয়ম মোবাইলের মতো কার্ডে দেখায়', async () => {
  const { d } = await boot();
  const cards = d.querySelectorAll('#rules .rule');
  assert.strictEqual(cards.length, 2);
  assert.match(cards[0].querySelector('.rcv').textContent, /^Receive:\s+আসসালামু আলাইকুম/);
  assert.match(cards[0].querySelector('.snd').textContent, /Send:\s+ওয়া আলাইকুম আসসালাম/);
  assert.match(cards[1].querySelector('.rcv').textContent, /হাই, হ্যালো/);
});

test('নিয়মের সুইচ বদলালে সংরক্ষণ হয়', async () => {
  const { d, calls } = await boot();
  const cb = d.querySelector('#rules .rule input');
  cb.checked = false; cb.dispatchEvent(new d.defaultView.Event('change'));
  assert.strictEqual(calls.saved.at(-1).rules[0].on, false);
});

test('মূল সুইচ', async () => {
  const { d, calls } = await boot();
  const cb = d.querySelector('#sw-enabled');
  cb.checked = false; cb.dispatchEvent(new d.defaultView.Event('change'));
  assert.strictEqual(calls.saved.at(-1).enabled, false);
});

test('+ চেপে নতুন নিয়ম: খালি থাকলে সংরক্ষণ হয় না, ভরলে হয় (Exact ডিফল্ট)', async () => {
  const { d, calls, S } = await boot();
  d.querySelector('#fab').click();
  assert.ok(!d.querySelector('#editor').classList.contains('hidden'));
  assert.strictEqual(d.querySelector('#ed-title').textContent, 'New rule');
  assert.ok(d.querySelector('.mode.sel').textContent.includes('Exact match'));
  d.querySelector('#ed-save').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(calls.saved.length, 0);
  d.querySelector('#ed-keys').value = 'দাম কত';
  d.querySelector('#ed-reply').value = '৫০০ টাকা';
  d.querySelector('#ed-save').click();
  await new Promise((r) => setTimeout(r, 10));
  const r = calls.saved.at(-1).rules.at(-1);
  assert.deepStrictEqual([r.keys, r.reply, r.mode, r.person, r.group, r.on], ['দাম কত', '৫০০ টাকা', 1, true, false, true]);
  assert.strictEqual(d.querySelectorAll('#rules .rule').length, 3);
  assert.ok(d.querySelector('#editor').classList.contains('hidden'));
});

test('নিয়মে চেপে সম্পাদনা ও মিলের ধরন বদল', async () => {
  const { d, calls } = await boot();
  d.querySelector('#rules .rule .col').click();
  assert.strictEqual(d.querySelector('#ed-title').textContent, 'Rule 1');
  const modes = d.querySelectorAll('.mode');
  modes[3].click(); // RegEx
  assert.match(d.querySelector('#ed-keys').placeholder, /RegEx/);
  d.querySelector('#ed-keys').value = '^হ[াি]ই$';
  d.querySelector('#ed-save').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(calls.saved.at(-1).rules[0].mode, 4);
});

test('ভুল RegEx সংরক্ষণ হয় না', async () => {
  const { d, calls } = await boot();
  d.querySelector('#rules .rule .col').click();
  d.querySelectorAll('.mode')[3].click();
  d.querySelector('#ed-keys').value = '([';
  d.querySelector('#ed-save').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(calls.saved.length, 0);
});

test('নিয়ম মোছা (নিশ্চিত করার পর)', async () => {
  const { d, calls } = await boot();
  d.querySelector('#rules .rule .col').click();
  d.querySelector('#ed-del').click();
  await new Promise((r) => setTimeout(r, 5));
  [...d.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Delete').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(calls.saved.at(-1).rules.length, 1);
});

test('মেনু খোলে/বন্ধ হয়', async () => {
  const { d } = await boot();
  d.querySelector('#menu-btn').click();
  assert.ok(d.querySelector('#side').classList.contains('show'));
  d.querySelector('#scrim').click();
  assert.ok(!d.querySelector('#side').classList.contains('show'));
});

test('আপডেট না থাকলে বোতাম লুকানো, সংস্করণ দেখায়', async () => {
  const { d } = await boot();
  assert.ok(d.querySelector('#update-btn').classList.contains('hidden'));
  assert.strictEqual(d.querySelector('#ver').textContent, 'AutoReply v1.0.5');
});

test('আপডেট থাকলে "Update" বোতাম; চাপলে শতাংশ ও Installing…', async () => {
  const { d, calls, emit } = await boot({ state: { cur: '1.0.5', latest: { n: 6, version: '1.0.6', url: 'x' } } });
  const b = d.querySelector('#update-btn');
  assert.ok(!b.classList.contains('hidden'));
  assert.strictEqual(b.querySelector('.lbl').textContent, 'Update');
  b.click();
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(calls.installed, 1);
  assert.ok(b.classList.contains('busy'));
  emit('progress', { pct: 37 });
  assert.strictEqual(b.querySelector('.pct').textContent, '37%');
  assert.strictEqual(b.querySelector('.fill').style.width, '37%');
  emit('progress', { pct: 100, installing: true });
  assert.strictEqual(b.querySelector('.pct').textContent, 'Installing…');
  emit('fail', { err: 'HTTP 404' });
  assert.ok(!b.classList.contains('busy'));
});
