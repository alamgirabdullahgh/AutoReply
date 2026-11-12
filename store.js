'use strict';
// সেটিংস ফাইলে সংরক্ষণ (userData/settings.json)। API কী সম্ভব হলে Windows-এর নিজস্ব এনক্রিপশনে (safeStorage) রাখা হয়।
const fs = require('fs');
const path = require('path');
const { defaultRules } = require('./engine');

function defaults() {
  return {
    enabled: true,
    apps: { WhatsApp: true, Telegram: true },
    variants: { wa: true, wab: false, tg: true }, // দলের ভেতরে প্রতিটা ভেরিয়েন্টের সুইচ (WhatsApp Business আলাদা লগইন, তাই ডিফল্টে বন্ধ)
    rules: defaultRules(),
    ai: { on: false, prov: 'auto', key: '', model: '', base: '', info: '', cmd: '' },
    autostart: false,
    delayMin: 2, // উত্তর পাঠানোর আগে অপেক্ষা (সেকেন্ড, এলোমেলো), মানুষের মতো দেখাতে
    delayMax: 5
  };
}

function createStore(opts) {
  const file = path.join(opts.dir, 'settings.json');
  const safe = opts.safe || null;
  let cur = defaults();

  function canEncrypt() {
    try { return !!(safe && safe.isEncryptionAvailable()); } catch (e) { return false; }
  }

  function load() {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { raw = null; }
    const d = defaults();
    if (raw && typeof raw === 'object') {
      if (typeof raw.enabled === 'boolean') d.enabled = raw.enabled;
      if (raw.apps && typeof raw.apps === 'object') d.apps = Object.assign(d.apps, raw.apps);
      if (raw.variants && typeof raw.variants === 'object') d.variants = Object.assign(d.variants, raw.variants);
      if (Array.isArray(raw.rules)) d.rules = raw.rules;
      if (raw.ai && typeof raw.ai === 'object') {
        d.ai = Object.assign(d.ai, raw.ai);
        if (raw.ai.keyEnc && canEncrypt()) {
          try { d.ai.key = safe.decryptString(Buffer.from(raw.ai.keyEnc, 'base64')); } catch (e) { d.ai.key = ''; }
        }
        delete d.ai.keyEnc;
      }
      if (typeof raw.autostart === 'boolean') d.autostart = raw.autostart;
      if (typeof raw.delayMin === 'number') d.delayMin = raw.delayMin;
      if (typeof raw.delayMax === 'number') d.delayMax = raw.delayMax;
    }
    cur = d;
    return cur;
  }

  function save() {
    const out = JSON.parse(JSON.stringify(cur));
    if (out.ai.key && canEncrypt()) {
      out.ai.keyEnc = safe.encryptString(out.ai.key).toString('base64');
      out.ai.key = '';
    }
    fs.mkdirSync(opts.dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  function get() { return cur; }

  // কিছু উপরের স্তরের কী বদলান
  function set(patch) {
    const p = patch || {};
    if (typeof p.enabled === 'boolean') cur.enabled = p.enabled;
    if (p.apps && typeof p.apps === 'object') cur.apps = Object.assign({}, cur.apps, p.apps);
    if (p.variants && typeof p.variants === 'object') cur.variants = Object.assign({}, cur.variants, p.variants);
    if (Array.isArray(p.rules)) cur.rules = p.rules;
    if (p.ai && typeof p.ai === 'object') cur.ai = Object.assign({}, cur.ai, p.ai);
    if (typeof p.autostart === 'boolean') cur.autostart = p.autostart;
    if (typeof p.delayMin === 'number') cur.delayMin = p.delayMin;
    if (typeof p.delayMax === 'number') cur.delayMax = p.delayMax;
    save();
    return cur;
  }

  load();
  return { get, set, load, file };
}

module.exports = { createStore, defaults };
