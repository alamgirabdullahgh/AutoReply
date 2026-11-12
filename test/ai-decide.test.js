'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createAi, detect, eff, configured } = require('../ai');
const { createDecider } = require('../decide');
const E = require('../engine');

function resp(status, obj) {
  return { status, text: async () => JSON.stringify(obj) };
}

test('চাবি দেখে প্রোভাইডার চেনা', () => {
  assert.strictEqual(detect('AIzaXXXX').id, 'gemini');
  assert.strictEqual(detect('sk-ant-abc').id, 'claude');
  assert.strictEqual(detect('gsk_abc').label, 'Groq');
  assert.strictEqual(detect('sk-abc').label, 'OpenAI');
  assert.strictEqual(detect('zzz'), null);
  assert.strictEqual(eff({ key: 'zzz', prov: 'claude', model: '' }).model, 'claude-haiku-5-5');
  assert.strictEqual(configured({ key: 'sk-ant-1', prov: 'auto', info: '', cmd: '' }), false);
  assert.strictEqual(configured({ key: 'sk-ant-1', prov: 'auto', info: 'x', cmd: '' }), true);
});

test('Claude: উত্তর পড়ে ও ইতিহাস মনে রাখে', async () => {
  const calls = [];
  const ai = createAi({ fetch: async (url, o) => { calls.push({ url, body: JSON.parse(o.body), h: o.headers }); return resp(200, { content: [{ type: 'text', text: ' ওয়াদা ' }] }); } });
  const g = { key: 'sk-ant-1', prov: 'auto', model: '', base: '', info: 'আমরা ওষুধ বেচি', cmd: '' };
  const r1 = await ai.answer(g, 'c1', 'দাম কত?');
  assert.strictEqual(r1.text, 'ওয়াদা');
  assert.strictEqual(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(calls[0].h['x-api-key'], 'sk-ant-1');
  await ai.answer(g, 'c1', 'আর কিছু?');
  assert.strictEqual(calls[1].body.messages.length, 3); // আগের প্রশ্ন-উত্তর + নতুন প্রশ্ন
});

test('AI: ঘণ্টায় ৮টির বেশি নয়', async () => {
  const ai = createAi({ fetch: async () => resp(200, { content: [{ type: 'text', text: 'ok' }] }) });
  const g = { key: 'sk-ant-1', prov: 'auto', model: '', base: '', info: 'x', cmd: '' };
  for (let i = 0; i < 8; i++) assert.ok((await ai.answer(g, 'c', 'q' + i)).text);
  const r = await ai.answer(g, 'c', 'q9');
  assert.strictEqual(r.text, null);
  assert.match(r.error, /ঘণ্টায়/);
});

test('Gemini: ১ম মডেলে 429 হলে পরের মডেলে যায়', async () => {
  const urls = [];
  const ai = createAi({
    fetch: async (url) => {
      urls.push(url);
      if (url.includes('models/gemini-flash-latest:')) return resp(429, { error: { message: 'quota' } });
      return resp(200, { candidates: [{ content: { parts: [{ text: 'হ্যাঁ' }] } }] });
    }
  });
  const g = { key: 'AIzaXX', prov: 'auto', model: '', base: '', info: 'x', cmd: '' };
  const r = await ai.answer(g, 'c', 'প্রশ্ন');
  assert.strictEqual(r.text, 'হ্যাঁ');
  assert.ok(urls.some((u) => u.includes('gemini-flash-lite-latest')));
});

test('ত্রুটি বার্তা ফেরে (HTTP 401)', async () => {
  const ai = createAi({ fetch: async () => resp(401, { error: { message: 'bad key' } }) });
  const r = await ai.test({ key: 'sk-ant-1', prov: 'auto', model: '', base: '', info: 'x', cmd: '' }, 'q');
  assert.strictEqual(r.text, null);
  assert.match(r.error, /HTTP 401 bad key/);
});

function mk(settings, aiFetch) {
  const ai = createAi({ fetch: aiFetch || (async () => resp(200, { content: [{ type: 'text', text: 'AI-উত্তর' }] })) });
  let t = 1000;
  const d = createDecider({ getSettings: () => settings, ai, now: () => t });
  return { d, tick: (ms) => { t += ms; } };
}
const base = () => ({ enabled: true, apps: { WhatsApp: true, Telegram: false }, rules: E.defaultRules(), ai: { on: false, prov: 'auto', key: '', model: '', base: '', info: '', cmd: '' } });

test('decide: সুইচ, নিয়ম, গ্রুপ, AI ফলব্যাক', async () => {
  const s = base();
  const { d } = mk(s);
  assert.deepStrictEqual(await d.decide({ app: 'WhatsApp', isGroup: false, text: 'আসসালামু আলাইকুম', conv: 'a' }), { reply: 'ওয়া আলাইকুম আসসালাম', via: 'rule' });
  assert.match((await d.decide({ app: 'Telegram', isGroup: false, text: 'hi', conv: 'a' })).reason, /বন্ধ/);
  assert.match((await d.decide({ app: 'WhatsApp', isGroup: true, text: 'hello', conv: 'g' })).reason, /গ্রুপ/);
  assert.match((await d.decide({ app: 'WhatsApp', isGroup: false, text: 'দাম কত', conv: 'a' })).reason, /নিয়ম মেলেনি/);
  s.ai = { on: true, prov: 'auto', key: 'sk-ant-1', model: '', base: '', info: 'তথ্য', cmd: '' };
  assert.deepStrictEqual(await d.decide({ app: 'WhatsApp', isGroup: false, text: 'দাম কত', conv: 'a' }), { reply: 'AI-উত্তর', via: 'ai' });
  assert.match((await d.decide({ app: 'WhatsApp', isGroup: true, text: 'দাম কত', conv: 'g' })).reason, /গ্রুপ/); // গ্রুপে AI নয়
  s.enabled = false;
  assert.match((await d.decide({ app: 'WhatsApp', isGroup: false, text: 'hi', conv: 'a' })).reason, /মূল সুইচ/);
});

test('decide: একই চ্যাটে ঘণ্টায় ১০টির বেশি নয়, ঘণ্টা পরে আবার চলে', async () => {
  const { d, tick } = mk(base());
  for (let i = 0; i < 10; i++) assert.ok((await d.decide({ app: 'WhatsApp', isGroup: false, text: 'hi', conv: 'loop' })).reply);
  assert.match((await d.decide({ app: 'WhatsApp', isGroup: false, text: 'hi', conv: 'loop' })).reason, /চক্র/);
  assert.ok((await d.decide({ app: 'WhatsApp', isGroup: false, text: 'hi', conv: 'other' })).reply);
  tick(3700000);
  assert.ok((await d.decide({ app: 'WhatsApp', isGroup: false, text: 'hi', conv: 'loop' })).reply);
});

test('decide: ভেরিয়েন্ট বন্ধ থাকলে (দল চালু থাকলেও) উত্তর যায় না', async () => {
  const s = base();
  s.variants = { wa: true, wab: false };
  const { d } = mk(s);
  assert.match((await d.decide({ app: 'WhatsApp', variant: 'wab', isGroup: false, text: 'hi', conv: 'b' })).reason, /ভেরিয়েন্ট বন্ধ/);
  assert.strictEqual((await d.decide({ app: 'WhatsApp', variant: 'wa', isGroup: false, text: 'hi', conv: 'a' })).via, 'rule');
});
