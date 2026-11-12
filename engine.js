'use strict';
// নিয়ম মেলানোর যুক্তি: Android অ্যাপের Store.kt-এর হুবহু আচরণ

const M_CONTAINS = 0; // মেসেজে শব্দ থাকলেই
const M_EXACT = 1;    // পুরো মেসেজ হুবহু এক (বড়-ছোট হাতের অক্ষর, ফাঁকা ও চিহ্ন বাদ)
const M_SIMILAR = 2;  // পুরো মেসেজ প্রায় এক (বানান ভুল সহ্য করে)
const M_PATTERN = 3;  // * চিহ্ন দিয়ে প্যাটার্ন
const M_REGEX = 4;    // রেগুলার এক্সপ্রেশন

function newRule(o) {
  return Object.assign({ keys: '', reply: '', on: true, group: false, person: true, mode: M_CONTAINS }, o || {});
}

// ডিফল্ট নিয়ম ১: সালামের নানা রূপে "ওয়া আলাইকুম আসসালাম"
function defaultSalam() {
  return newRule({
    keys: 'আসসালামু আলাইকুম, আসসালামুয়ালাইকুম, Assalamu Alaikum, Assalamualaikum',
    reply: 'ওয়া আলাইকুম আসসালাম',
    mode: M_EXACT
  });
}

// ডিফল্ট নিয়ম ২: হাই/হ্যালো এলে "আসসালামু আলাইকুম"
function defaultGreet() {
  return newRule({ keys: 'হাই, হ্যালো, Hi, Hello', reply: 'আসসালামু আলাইকুম', mode: M_EXACT });
}

function defaultRules() {
  return [defaultSalam(), defaultGreet()];
}

const PUNCT = /[\p{P}\p{S}]+/gu;
const SPACES = /\s+/g;

// তুলনার জন্য: ছোট হাতের, যতিচিহ্ন/ইমোজি বাদ, একাধিক ফাঁকা এক
function norm(s) {
  return String(s).toLowerCase().replace(PUNCT, ' ').replace(SPACES, ' ').trim();
}

// দুই লেখার মিল ০..১ (এডিট দূরত্ব দিয়ে)
function sim(a, b) {
  if (a === b) return 1.0;
  const m = Math.max(a.length, b.length);
  if (m === 0 || Math.abs(a.length - b.length) > m * 0.25) return 0.0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1.0 - prev[b.length] / m;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitKeys(keys) {
  return String(keys).split(/[,،\n]/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0);
}

// একটা নিয়ম এই মেসেজের সাথে মেলে কি না, নিয়মের "ধরন" অনুযায়ী
function matches(r, text) {
  if (r.mode === M_REGEX) {
    return String(r.keys).split('\n').map((x) => x.trim()).filter((x) => x.length > 0).some((k) => {
      try { return new RegExp(k, 'i').test(text); } catch (e) { return false; }
    });
  }
  const t = String(text).toLowerCase();
  const ks = splitKeys(r.keys);
  const n = norm(text);
  switch (r.mode) {
    case M_EXACT:
      return n.length > 0 && ks.some((k) => norm(k) === n);
    case M_SIMILAR:
      return n.length > 0 && ks.some((k) => { const nk = norm(k); return nk.length > 0 && sim(n, nk) >= 0.8; });
    case M_PATTERN:
      return n.length > 0 && ks.some((k) => {
        const re = new RegExp('^' + k.split('*').map((p) => escapeRe(norm(p))).join('.*') + '$', 's');
        return re.test(n);
      });
    default:
      return ks.some((k) => {
        if (k.length <= 5 && /^[a-z]+$/.test(k)) {
          return new RegExp('(^|[^a-z])' + k + '($|[^a-z])').test(t);
        }
        return t.includes(k);
      });
  }
}

// ওপরের নিয়ম আগে মেলে। group=true হলে শুধু "গ্রুপ" চালু নিয়ম, নইলে শুধু "ব্যক্তি" চালু নিয়ম
function match(rules, text, group) {
  for (const r of rules) {
    if (!r.on) continue;
    if (group && !r.group) continue;
    if (!group && !r.person) continue;
    if (matches(r, text)) return r.reply;
  }
  return null;
}

module.exports = {
  M_CONTAINS, M_EXACT, M_SIMILAR, M_PATTERN, M_REGEX,
  newRule, defaultRules, defaultSalam, defaultGreet, norm, sim, matches, match
};
