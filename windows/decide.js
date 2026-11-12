'use strict';
// কোন মেসেজে কী উত্তর যাবে তার সিদ্ধান্ত: আগে নিয়ম, না মিললে (এবং AI চালু ও সাজানো থাকলে) AI
const { match } = require('./engine');

const MAX_REPLIES_PER_CONV_HOUR = 10; // একই চ্যাটে ঘণ্টায় সর্বোচ্চ উত্তর (দুই অটো-রিপ্লাই বটের অসীম চক্র ঠেকাতে)

function createDecider(deps) {
  const getSettings = deps.getSettings;
  const ai = deps.ai;
  const now = deps.now || (() => Date.now());
  const times = new Map();

  function recent(conv) {
    const t = now();
    const l = (times.get(conv) || []).filter((x) => t - x < 3600000);
    times.set(conv, l);
    return l;
  }
  function record(conv) {
    const l = recent(conv);
    l.push(now());
    times.set(conv, l);
    if (times.size > 500) times.delete(times.keys().next().value);
  }

  // { reply, via, reason }
  async function decide(p) {
    const s = getSettings();
    const app = p.app;
    const text = String(p.text || '');
    if (!s.enabled) return { reply: null, reason: 'মূল সুইচ বন্ধ' };
    if (!s.apps || !s.apps[app]) return { reply: null, reason: 'এই অ্যাপ বন্ধ করা আছে' };
    if (!text.trim()) return { reply: null, reason: 'মেসেজে লেখা নেই' };
    if (recent(p.conv).length >= MAX_REPLIES_PER_CONV_HOUR) {
      return { reply: null, reason: 'এই চ্যাটে ঘণ্টায় ' + MAX_REPLIES_PER_CONV_HOUR + 'টার বেশি উত্তর যায় না (চক্র ঠেকাতে), তাই বাদ' };
    }
    const r = match(s.rules || [], text, !!p.isGroup);
    if (r !== null) { record(p.conv); return { reply: r, via: 'rule' }; }
    if (p.isGroup) return { reply: null, reason: 'গ্রুপ ধরা হয়েছে, তাই বাদ (কোনো নিয়মে গ্রুপ সুইচ চালু নেই)' };
    if (!(s.ai && s.ai.on && ai.configured(s.ai))) return { reply: null, reason: 'কোনো নিয়ম মেলেনি' };
    const a = await ai.answer(s.ai, p.conv, text);
    if (!a.text) return { reply: null, reason: 'AI ব্যর্থ: ' + a.error };
    record(p.conv);
    return { reply: a.text, via: 'ai' };
  }

  return { decide };
}

module.exports = { createDecider, MAX_REPLIES_PER_CONV_HOUR };
