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

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 10));

test('+ নতুন নিয়ম: ডান পাশে সম্পাদক খোলে; খালি থাকলে সংরক্ষণ হয় না, ভরলে হয় (Exact ডিফল্ট)', async () => {
  const { d, calls } = await boot();
  assert.ok(d.querySelector('#panel').classList.contains('hidden'));
  d.querySelector('#add-rule').click();
  await tick();
  assert.ok(!d.querySelector('#panel').classList.contains('hidden'));
  assert.ok(!d.querySelector('#editor').classList.contains('hidden'));
  assert.strictEqual(d.querySelector('#ed-title').textContent, 'New rule');
  assert.ok(d.querySelector('.mode.sel').textContent.includes('Exact match'));
  d.querySelector('#ed-save').click();
  await tick();
  assert.strictEqual(calls.saved.length, 0);
  d.querySelector('#ed-keys').value = 'দাম কত';
  d.querySelector('#ed-reply').value = '৫০০ টাকা';
  d.querySelector('#ed-save').click();
  await tick();
  const r = calls.saved.at(-1).rules.at(-1);
  assert.deepStrictEqual([r.keys, r.reply, r.mode, r.person, r.group, r.on], ['দাম কত', '৫০০ টাকা', 1, true, false, true]);
  assert.strictEqual(d.querySelectorAll('#rules .rule').length, 3);
  assert.ok(d.querySelector('#panel').classList.contains('hidden'));
});

test('নিয়মে চাপলে সম্পাদনা (কার্ড চিহ্নিত), মিলের ধরন বদল', async () => {
  const { d, calls } = await boot();
  d.querySelector('#rules .rule .col').click();
  await tick();
  assert.strictEqual(d.querySelector('#ed-title').textContent, 'Rule 1');
  assert.ok(d.querySelector('#rules .rule').classList.contains('sel'));
  d.querySelectorAll('.mode')[3].click(); // RegEx
  assert.match(d.querySelector('#ed-keys').placeholder, /RegEx/);
  d.querySelector('#ed-keys').value = '^হ[াি]ই$';
  d.querySelector('#ed-save').click();
  await tick();
  assert.strictEqual(calls.saved.at(-1).rules[0].mode, 4);
});

test('ভুল RegEx সংরক্ষণ হয় না', async () => {
  const { d, calls } = await boot();
  d.querySelector('#rules .rule .col').click();
  await tick();
  d.querySelectorAll('.mode')[3].click();
  d.querySelector('#ed-keys').value = '([';
  d.querySelector('#ed-save').click();
  await tick();
  assert.strictEqual(calls.saved.length, 0);
});

test('নিয়ম মোছা (নিশ্চিত করার পর)', async () => {
  const { d, calls } = await boot();
  d.querySelector('#rules .rule .col').click();
  await tick();
  d.querySelector('#ed-del').click();
  await tick(5);
  [...d.querySelectorAll('.dialog button')].find((b) => b.textContent === 'মুছুন').click();
  await tick();
  assert.strictEqual(calls.saved.at(-1).rules.length, 1);
});

test('অসংরক্ষিত পরিবর্তন নিয়ে অন্য নিয়মে গেলে জিজ্ঞেস করে; "থাকুন"-এ আগেরটাই থাকে', async () => {
  const { d } = await boot();
  d.querySelector('#rules .rule .col').click();
  await tick();
  d.querySelector('#ed-reply').value = 'বদলানো উত্তর';
  d.querySelectorAll('#rules .rule .col')[1].click();
  await tick(5);
  [...d.querySelectorAll('.dialog button')].find((b) => b.textContent === 'থাকুন').click();
  await tick();
  assert.strictEqual(d.querySelector('#ed-title').textContent, 'Rule 1');
  assert.strictEqual(d.querySelector('#ed-reply').value, 'বদলানো উত্তর');
});

test('▲▼ দিয়ে ক্রম বদল ও সংরক্ষণ; প্রথমটার ▲ বন্ধ', async () => {
  const { d, calls } = await boot();
  const first = d.querySelectorAll('#rules .rule')[0];
  assert.ok(first.querySelectorAll('.mv button')[0].disabled);
  first.querySelectorAll('.mv button')[1].click();
  await tick();
  const rules = calls.saved.at(-1).rules;
  assert.match(rules[0].keys, /হাই/);
  assert.match(rules[1].keys, /আসসালামু/);
});

test('সাইডবার সবসময় খোলা; মূল সুইচ ও অবস্থা লেখা', async () => {
  const { d } = await boot();
  assert.ok(!d.querySelector('#side').classList.contains('hidden'));
  assert.match(d.querySelector('#master-state').textContent, /চালু/);
  const cb = d.querySelector('#sw-enabled');
  cb.checked = false; cb.dispatchEvent(new d.defaultView.Event('change'));
  await tick();
  assert.match(d.querySelector('#master-state').textContent, /বন্ধ/);
});

test('AI চ্যাট: সাইডবার থেকে ডান পাশে সেটিংস খোলে ও আবার চাপলে বন্ধ', async () => {
  const { d } = await boot();
  d.querySelector('#nav-ai').click();
  await tick();
  assert.ok(!d.querySelector('#aipage').classList.contains('hidden'));
  assert.ok(d.querySelector('#editor').classList.contains('hidden'));
  d.querySelector('#nav-ai').click();
  await tick();
  assert.ok(d.querySelector('#panel').classList.contains('hidden'));
});

test('অ্যাপে চাপলে মাঝের অংশে ওয়েব খোলে, "নিয়ম"-এ চাপলে ফেরে', async () => {
  const { d } = await boot();
  d.querySelector('[data-open="Telegram"]').click(); // এক ভেরিয়েন্টের দল: সরাসরি খোলে
  assert.ok(d.body.classList.contains('viewing'));
  assert.ok(d.querySelector('webview.view.active'));
  d.querySelector('#nav-rules').click();
  assert.ok(!d.body.classList.contains('viewing'));
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

test('সাইডবারে মোবাইলের মতো তিনটা দল: WhatsApp, Telegram, Facebook (Facebook-এ সুইচ নেই)', async () => {
  const { d } = await boot();
  const names = Array.from(d.querySelectorAll('#apps .app b')).map((b) => b.textContent);
  assert.deepStrictEqual(names, ['WhatsApp', 'Telegram', 'Facebook']);
  assert.ok(d.querySelector('#sw-WhatsApp'));
  assert.ok(d.querySelector('#sw-Telegram'));
  assert.strictEqual(d.querySelector('#sw-Facebook'), null);
  assert.match(d.querySelector('#st-Facebook').textContent, /Messenger, Meta Business Suite/);
});

test('WhatsApp-এ চাপলে তার সব ভেরিয়েন্ট আলাদা সুইচসহ দেখায়; সুইচ বদলালে variants সংরক্ষণ হয়', async () => {
  const { d, calls } = await boot();
  d.querySelector('[data-open="WhatsApp"]').click();
  await tick();
  const labels = Array.from(d.querySelectorAll('.dialog .vrow b')).map((b) => b.textContent);
  assert.deepStrictEqual(labels, ['WhatsApp', 'WhatsApp Business']);
  const cb = d.querySelector('.dialog input[data-variant="wab"]');
  assert.strictEqual(cb.checked, false);
  cb.checked = true; cb.dispatchEvent(new d.defaultView.Event('change'));
  await tick();
  assert.strictEqual(JSON.stringify(calls.saved.at(-1)), JSON.stringify({ variants: { wab: true } }));
});

test('Facebook-এ চাপলে Messenger ও Meta Business Suite দেখায়, কোনো সুইচ নয়, শুধু খুলুন', async () => {
  const { d } = await boot();
  d.querySelector('[data-open="Facebook"]').click();
  await tick();
  const labels = Array.from(d.querySelectorAll('.dialog .vrow b')).map((b) => b.textContent);
  assert.deepStrictEqual(labels, ['Messenger', 'Meta Business Suite']);
  assert.strictEqual(d.querySelectorAll('.dialog input[type=checkbox]').length, 0);
});

test('দলের সুইচ বদলালে apps সংরক্ষণ হয়', async () => {
  const { d, calls } = await boot();
  const cb = d.querySelector('#sw-Telegram');
  cb.checked = false; cb.dispatchEvent(new d.defaultView.Event('change'));
  await tick();
  assert.strictEqual(JSON.stringify(calls.saved.at(-1)), JSON.stringify({ apps: { Telegram: false } }));
});
