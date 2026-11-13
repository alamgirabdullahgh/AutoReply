'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  // মোবাইলের মতো তিনটা দল: প্রতিটার মূল সুইচ, আর ভেতরে প্রতিটা ভেরিয়েন্টের আলাদা সুইচ (কার্যকর = দল চালু এবং ভেরিয়েন্ট চালু)
  // auto: স্বয়ংক্রিয় উত্তর চালানো যায় কিনা। Facebook-এর ওয়েব পাতার জন্য এখনো স্বয়ংক্রিয় উত্তরের অংশ নেই, তাই শুধু দেখা যায়।
  const WA = 'https://web.whatsapp.com/';
  const GROUPS = [
    { name: 'WhatsApp', auto: true, variants: [
      { id: 'wa', label: 'WhatsApp', url: WA, part: 'persist:whatsapp' },
      { id: 'wab', label: 'WhatsApp Business', url: WA, part: 'persist:whatsapp-business' }
    ] },
    { name: 'Telegram', auto: true, variants: [
      { id: 'tg', label: 'Telegram', url: 'https://web.telegram.org/a/', part: 'persist:telegram' }
    ] },
    { name: 'Facebook', auto: false, variants: [
      { id: 'fbm', label: 'Messenger', url: 'https://www.facebook.com/messages/', part: 'persist:messenger' },
      { id: 'fbb', label: 'Meta Business Suite', url: 'https://business.facebook.com/latest/inbox/all', part: 'persist:fb-business' }
    ] }
  ];
  const VAR = {};
  GROUPS.forEach((g) => g.variants.forEach((v) => { v.group = g.name; v.auto = g.auto; VAR[v.id] = v; }));
  // মোবাইল অ্যাপের হুবহু মিলের ধরন ও ব্যাখ্যা
  const MODES = [
    [1, 'Exact match', 'পুরো মেসেজটা আপনার লেখা মেসেজগুলোর কোনো একটার সাথে হুবহু এক হতে হবে। বড়-ছোট হাতের অক্ষর, বাড়তি ফাঁকা এবং চিহ্ন (! ? । .) ধরা হয় না।\n\nউদাহরণ: "assalamu alaikum" লিখলে "Assalamu Alaikum!" মিলবে, কিন্তু "করিম রহিমকে assalamu alaikum বলেছে" মিলবে না।'],
    [2, 'Similarity match', 'পুরো মেসেজটা আপনার লেখা কোনো মেসেজের সাথে প্রায় ৮০% মিললেই হবে, তাই ছোটখাটো বানান ভুল থাকলেও মিলে যাবে।\n\nউদাহরণ: "assalamualaikum" লিখলে "assalamu alaikum" মিলবে।'],
    [3, 'Pattern matching', 'যেকোনো লেখার জায়গায় * ব্যবহার করুন। পুরো মেসেজটা প্যাটার্নের সাথে মিলতে হবে।\n\n"hello*" লিখলে যে মেসেজ hello দিয়ে শুরু হয় সেটা মিলবে।\n"*price*" লিখলে যে মেসেজে price শব্দটা আছে সেটা মিলবে।'],
    [4, 'RegEx', 'রেগুলার এক্সপ্রেশন (RegEx) লিখুন, প্রতি লাইনে একটি। মেসেজের যেকোনো জায়গায় মিললেই কাজ করবে; পুরো মেসেজ মেলাতে চাইলে ^ ও $ ব্যবহার করুন।'],
    [0, 'Contains', 'মেসেজের যেকোনো জায়গায় আপনার লেখা কোনো শব্দ থাকলেই মিলবে। "hi"-এর মতো ছোট ইংরেজি শব্দ আলাদা শব্দ হিসেবে থাকতে হবে।']
  ];
  const HINTS = {
    4: 'রেজেক্স (RegEx) লিখুন (প্রতি লাইনে একটি)',
    3: 'প্যাটার্ন লিখুন, যেকোনো লেখার জায়গায় * দিন (কমা দিয়ে আলাদা করুন)',
    def: 'মেসেজ লিখুন (একাধিক রকম হলে কমা দিয়ে আলাদা করুন)'
  };

  let S = null;
  const views = {};
  const status = {};
  const logs = [];
  let saveTimer = null;
  let upd = { cur: '', latest: null, busy: false };
  let ed = null; // চলতি সম্পাদনা: { rule|null, mode, orig }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function toast(msg) {
    const t = el('div', 'toast', msg);
    $('#app').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function dialog(title, msg, buttons) {
    return new Promise((resolve) => {
      const d = el('div', 'dialog');
      const box = el('div', 'box');
      box.appendChild(el('h4', '', title));
      box.appendChild(el('p', '', msg));
      const bs = el('div', 'btns');
      buttons.forEach(([label, val]) => {
        const b = el('button', 'ghost', label);
        b.onclick = () => { d.remove(); resolve(val); };
        bs.appendChild(b);
      });
      box.appendChild(bs);
      d.appendChild(box);
      $('#app').appendChild(d);
    });
  }

  // ---------- সেটিংস সংরক্ষণ ----------
  function save(patch) { return window.ar.setSettings(patch).then((s) => { S = s; return s; }); }
  function saveDebounced(patch) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(patch), 400); }

  // ---------- অংশ (ডানের প্যানেল) ----------
  function showPane(name) {
    ['editor', 'aipage'].forEach((p) => $('#' + p).classList.toggle('hidden', p !== name));
    $('#panel').classList.toggle('hidden', !name);
    $('#nav-ai').classList.toggle('active', name === 'aipage');
    if (name !== 'editor') document.querySelectorAll('.rule.sel').forEach((c) => c.classList.remove('sel'));
  }
  function openPane() { return !$('#editor').classList.contains('hidden') ? 'editor' : (!$('#aipage').classList.contains('hidden') ? 'aipage' : null); }

  // ---------- লগ (সর্বশেষ কার্যকলাপ) ----------
  function addLog(app, msg) {
    const t = new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' });
    logs.unshift({ text: '● ' + app + ' · ' + t + ' · ' + msg, done: /গিয়েছে$/.test(msg) });
    if (logs.length > 40) logs.pop();
    renderLog();
  }
  function renderLog() {
    const box = $('#log');
    box.textContent = '';
    if (!logs.length) { box.textContent = 'এখনো কোনো মেসেজ আসেনি'; return; }
    logs.forEach((l) => box.appendChild(el('div', l.done ? 'done' : '', l.text)));
  }

  // ---------- ওয়েব ট্যাব ----------
  function ensureView(app) {
    if (views[app]) return;
    const wv = document.createElement('webview');
    wv.className = 'view';
    wv.setAttribute('partition', VAR[app].part);
    wv.setAttribute('src', VAR[app].url);
    wv.addEventListener('ipc-message', (e) => {
      if (e.channel === 'ar' && e.args && e.args[0]) onAdapter(app, wv, e.args[0]).catch((x) => addLog(VAR[app].label, 'ত্রুটি: ' + (x && x.message || x)));
    });
    $('#views').appendChild(wv);
    views[app] = wv;
  }
  function dropView(app) {
    if (!views[app]) return;
    views[app].remove();
    delete views[app];
    status[app] = 'বন্ধ';
    renderStatus();
  }
  function openViewer(app) {
    ensureView(app);
    Object.keys(views).forEach((k) => views[k].classList.toggle('active', k === app));
    document.body.classList.add('viewing');
    document.querySelectorAll('.app').forEach((b) => b.classList.toggle('active', b.dataset.open === VAR[app].group));
    $('#nav-rules').classList.remove('active');
    $('#nav-ai').classList.remove('active');
  }
  function closeViewer() {
    document.body.classList.remove('viewing');
    Object.keys(views).forEach((k) => views[k].classList.remove('active'));
    document.querySelectorAll('.app').forEach((b) => b.classList.remove('active'));
    $('#nav-rules').classList.add('active');
    $('#nav-ai').classList.toggle('active', openPane() === 'aipage');
    // অটো-রিপ্লের অ্যাপ বন্ধ থাকলে ট্যাবটা আবার বাদ
    Object.keys(VAR).forEach((id) => { if (!varEnabled(VAR[id])) dropView(id); });
  }

  function randDelay() {
    const a = Math.max(0, Number(S.delayMin) || 0);
    const b = Math.max(a, Number(S.delayMax) || a);
    return (a + Math.random() * (b - a)) * 1000;
  }

  async function onAdapter(id, wv, m) {
    const V = VAR[id];
    const lbl = V.label;
    if (m.t === 'status') { status[id] = m.s; renderStatus(); return; }
    if (m.t === 'info') { addLog(lbl, m.s); return; }
    if (m.t === 'result') { addLog(lbl, m.ok ? 'মেসেজ গিয়েছে' : 'পাঠাতে ব্যর্থ: ' + m.reason); return; }
    if (m.t === 'msg') {
      const d = await window.ar.decide({ app: V.group, variant: id, isGroup: !!m.isGroup, text: m.text, conv: id + '|' + m.chat });
      if (d.reply) {
        addLog(lbl, 'উত্তর তৈরি (' + (d.via === 'ai' ? 'AI' : 'নিয়ম') + '), পাঠানো হচ্ছে…');
        await sleep(randDelay());
        wv.send('ar-cmd', { t: 'reply', text: d.reply });
      } else {
        addLog(lbl, d.reason);
        wv.send('ar-cmd', { t: 'skip' });
      }
      return;
    }
    if (m.t === 'click') {
      await window.ar.click(wv.getWebContentsId(), m.x, m.y);
      return;
    }
    if (m.t === 'type') {
      const r = await window.ar.type(wv.getWebContentsId(), m.text);
      wv.send('ar-cmd', r.ok ? { t: 'typed' } : { t: 'typed', err: r.err });
    }
  }

  // কার্যকর = দলের সুইচ চালু এবং ভেরিয়েন্টের সুইচ চালু (মোবাইলের instOn-এর মতো)
  function varEnabled(v) { return !!(v.auto && S.apps[v.group] && S.variants && S.variants[v.id]); }
  function syncViews() {
    Object.keys(VAR).forEach((id) => {
      if (varEnabled(VAR[id])) { ensureView(id); return; }
      const beingViewed = views[id] && views[id].classList.contains('active');
      if (!beingViewed) dropView(id);
    });
  }

  function renderStatus() {
    GROUPS.forEach((g) => {
      const e = $('#st-' + g.name);
      if (!e) return;
      if (!g.auto) { e.textContent = 'শুধু দেখার জন্য — ' + g.variants.map((v) => v.label).join(', '); return; }
      const on = g.variants.filter((v) => varEnabled(v));
      if (!S.apps[g.name] || !on.length) { e.textContent = 'বন্ধ'; return; }
      const ok = on.filter((v) => status[v.id] === 'চালু').length;
      e.textContent = ok ? '✔ সংযুক্ত — মেসেজের অপেক্ষায়' + (on.length > 1 ? ' (' + ok + '/' + on.length + ')' : '') : 'লগইন করুন';
    });
  }

  // সাইডবারের "কোন অ্যাপে চলবে" তালিকা
  function buildApps() {
    const box = $('#apps');
    box.textContent = '';
    GROUPS.forEach((g) => {
      const cell = el('div', 'cell');
      const b = el('button', 'app');
      b.dataset.open = g.name;
      b.appendChild(el('b', '', g.name));
      const sub = el('span', 'sub', 'বন্ধ');
      sub.id = 'st-' + g.name;
      b.appendChild(sub);
      b.onclick = () => { if (g.variants.length > 1) variantsDialog(g); else openViewer(g.variants[0].id); };
      cell.appendChild(b);
      if (g.auto) {
        const sw = el('label', 'pill');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'sw-' + g.name;
        cb.checked = !!S.apps[g.name];
        cb.onchange = async () => { await save({ apps: { [g.name]: cb.checked } }); syncViews(); renderStatus(); };
        sw.appendChild(cb);
        sw.appendChild(document.createElement('span'));
        cell.appendChild(sw);
      }
      box.appendChild(cell);
    });
  }

  // দলের নামে চাপলে খোলে: ওই দলের প্রতিটি ভেরিয়েন্ট, পাশে আলাদা সুইচ ও "খুলুন" (মোবাইলের variantsDialog-এর মতো)
  function variantsDialog(g) {
    const d = el('div', 'dialog');
    const box = el('div', 'box');
    box.appendChild(el('h4', '', g.name));
    box.appendChild(el('p', '', g.auto
      ? 'প্রতিটার আলাদা সুইচ। দল ও ভেরিয়েন্ট দুটোই চালু থাকলে তবেই উত্তর যায়। প্রথমবার "খুলুন" চেপে লগইন করুন।'
      : 'এগুলো এখানে খুলে দেখা যায়। Facebook-এর ওয়েবে স্বয়ংক্রিয় উত্তর এখনো যোগ হয়নি।'));
    g.variants.forEach((v) => {
      const row = el('div', 'cell vrow');
      const info = el('div', 'grow');
      info.appendChild(el('b', '', v.label));
      row.appendChild(info);
      const open = el('button', 'ghost', 'খুলুন');
      open.onclick = () => { d.remove(); openViewer(v.id); };
      row.appendChild(open);
      if (g.auto) {
        const sw = el('label', 'pill');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.variant = v.id;
        cb.checked = !!(S.variants && S.variants[v.id]);
        cb.onchange = async () => { await save({ variants: { [v.id]: cb.checked } }); syncViews(); renderStatus(); };
        sw.appendChild(cb);
        sw.appendChild(document.createElement('span'));
        row.appendChild(sw);
      }
      box.appendChild(row);
    });
    const bs = el('div', 'btns');
    const close = el('button', 'ghost', 'বন্ধ');
    close.onclick = () => d.remove();
    bs.appendChild(close);
    box.appendChild(bs);
    d.appendChild(box);
    $('#app').appendChild(d);
  }

  // ---------- নিয়মের তালিকা ----------
  function modeLabel(v) { const m = MODES.find((x) => x[0] === v); return m ? m[1] : 'Contains'; }

  function renderMaster() {
    const st = $('#master-state');
    st.textContent = S.enabled ? 'চালু — উত্তর যাচ্ছে' : 'বন্ধ — কোনো অ্যাপে উত্তর যাবে না';
    st.className = 'state ' + (S.enabled ? 'ok' : 'off');
    $('#ai-tag').textContent = S.ai && S.ai.on ? 'চালু' : '';
  }

  async function moveRule(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= S.rules.length) return;
    const r = S.rules[i];
    S.rules.splice(i, 1);
    S.rules.splice(j, 0, r);
    await save({ rules: S.rules });
    renderRules();
  }

  function renderRules() {
    const box = $('#rules');
    box.textContent = '';
    if (!S.rules.length) { box.appendChild(el('div', 'empty', 'কোনো নিয়ম নেই। ওপরের "+ নতুন নিয়ম" চেপে যোগ করুন।')); return; }
    S.rules.forEach((r, i) => {
      const card = el('div', 'rule' + (r.on ? ' on' : '') + (ed && ed.rule === r ? ' sel' : ''));
      const col = el('div', 'col');
      col.appendChild(el('div', 'rcv', 'Receive:  ' + r.keys));
      col.appendChild(el('div', 'ln'));
      col.appendChild(el('div', 'snd', 'Send:  ' + r.reply));
      col.appendChild(el('div', 'meta', modeLabel(r.mode) + ' · ' + [r.person ? 'People' : '', r.group ? 'Groups' : ''].filter(Boolean).join(' + ')));
      col.onclick = () => openEditor(r);
      const mv = el('div', 'mv');
      const up = el('button', '', '▲'); up.title = 'ওপরে (আগে মিলবে)'; up.disabled = i === 0; up.onclick = () => moveRule(i, -1);
      const dn = el('button', '', '▼'); dn.title = 'নিচে'; dn.disabled = i === S.rules.length - 1; dn.onclick = () => moveRule(i, 1);
      mv.appendChild(up); mv.appendChild(dn);
      const sw = el('label', 'pill');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!r.on;
      cb.onchange = () => { r.on = cb.checked; card.classList.toggle('on', r.on); save({ rules: S.rules }); };
      sw.appendChild(cb);
      sw.appendChild(document.createElement('span'));
      card.appendChild(col);
      card.appendChild(mv);
      card.appendChild(sw);
      box.appendChild(card);
    });
  }

  // ---------- নিয়ম সম্পাদক (ডান পাশে) ----------
  function renderModes() {
    const box = $('#ed-modes');
    box.textContent = '';
    MODES.forEach(([v, label, info]) => {
      const row = el('div', 'mode' + (ed.mode === v ? ' sel' : ''));
      row.appendChild(el('div', 'radio'));
      row.appendChild(el('div', 'grow', label));
      const i = el('div', 'info', 'i');
      i.onclick = (e) => { e.stopPropagation(); dialog(label, info, [['ঠিক আছে', 1]]); };
      row.appendChild(i);
      row.onclick = () => { ed.mode = v; renderModes(); };
      box.appendChild(row);
    });
    $('#ed-keys').placeholder = HINTS[ed.mode] || HINTS.def;
  }

  function editorDirty() {
    if (!ed) return false;
    return $('#ed-keys').value.trim() !== ed.orig.keys || $('#ed-reply').value.trim() !== ed.orig.reply ||
      $('#ed-person').checked !== ed.orig.person || $('#ed-group').checked !== ed.orig.group || ed.mode !== ed.orig.mode;
  }

  // অসংরক্ষিত পরিবর্তন থাকলে জিজ্ঞেস করে; true মানে এগোনো যাবে
  async function okToLeave() {
    if (openPane() === 'editor' && editorDirty()) {
      const v = await dialog('পরিবর্তন সংরক্ষণ হয়নি', 'সংরক্ষণ না করে ছেড়ে গেলে পরিবর্তন হারাবে।', [['থাকুন', 0], ['বাদ দিন', 1]]);
      return !!v;
    }
    return true;
  }

  async function openEditor(r) {
    if (!(await okToLeave())) return;
    ed = { rule: r || null, mode: r ? r.mode : 1, orig: r ? { keys: r.keys, reply: r.reply, person: !!r.person, group: !!r.group, mode: r.mode } : { keys: '', reply: '', person: true, group: false, mode: 1 } };
    const num = r ? S.rules.indexOf(r) + 1 : S.rules.length + 1;
    $('#ed-title').textContent = r ? 'Rule ' + num : 'New rule';
    $('#ed-del').classList.toggle('hidden', !r);
    $('#ed-keys').value = ed.orig.keys;
    $('#ed-reply').value = ed.orig.reply;
    $('#ed-person').checked = ed.orig.person;
    $('#ed-group').checked = ed.orig.group;
    renderModes();
    if (document.body.classList.contains('viewing')) closeViewer();
    showPane('editor');
    renderRules();
    $('#ed-keys').focus();
  }

  function closeEditor() { ed = null; showPane(null); renderRules(); }

  async function cancelEditor() { if (await okToLeave()) closeEditor(); }

  async function saveEditor() {
    const keys = $('#ed-keys').value.trim();
    const reply = $('#ed-reply').value.trim();
    if (!keys) { toast('আগে Received message লিখুন'); return; }
    if (!reply) { toast('আগে উত্তর লিখুন'); return; }
    const person = $('#ed-person').checked;
    const group = $('#ed-group').checked;
    if (!person && !group) { toast('People বা Groups-এর অন্তত একটা চালু রাখুন'); return; }
    if (ed.mode === 4) {
      for (const k of keys.split('\n').map((x) => x.trim()).filter(Boolean)) {
        try { new RegExp(k, 'i'); } catch (e) { toast('RegEx ভুল: ' + k); return; }
      }
    }
    if (ed.rule) Object.assign(ed.rule, { keys, reply, person, group, mode: ed.mode });
    else S.rules.push({ keys, reply, on: true, person, group, mode: ed.mode });
    await save({ rules: S.rules });
    closeEditor();
  }

  async function deleteRule() {
    const v = await dialog('নিয়ম মুছবেন?', 'এই নিয়মটা মুছে যাবে।', [['বাতিল', 0], ['মুছুন', 1]]);
    if (!v || !ed || !ed.rule) return;
    S.rules.splice(S.rules.indexOf(ed.rule), 1);
    await save({ rules: S.rules });
    closeEditor();
  }

  // ---------- AI ----------
  function aiCfg() {
    return {
      on: $('#ai-on').checked, key: $('#ai-key').value.trim(), cmd: $('#ai-cmd').value, info: $('#ai-info').value,
      prov: $('#ai-prov').value, model: $('#ai-model').value.trim(), base: $('#ai-base').value.trim()
    };
  }
  function detectLabel(k) {
    if (!k) return '';
    if (k.startsWith('AQ.') || k.startsWith('AIza')) return '✔ Gemini';
    if (k.startsWith('sk-ant-')) return '✔ Claude';
    if (k.startsWith('sk-or-')) return '✔ OpenRouter';
    if (k.startsWith('gsk_')) return '✔ Groq';
    if (k.startsWith('xai-')) return '✔ xAI';
    if (k.startsWith('sk-')) return '✔ OpenAI';
    return 'চেনা যায়নি; "উন্নত সেটিংস" থেকে প্রোভাইডার বেছে নিন';
  }
  function initAi() {
    const a = S.ai;
    $('#ai-on').checked = !!a.on;
    $('#ai-key').value = a.key || '';
    $('#ai-cmd').value = a.cmd || '';
    $('#ai-info').value = a.info || '';
    $('#ai-prov').value = a.prov || 'auto';
    $('#ai-model').value = a.model || '';
    $('#ai-base').value = a.base || '';
    $('#ai-detect').textContent = detectLabel(a.key || '');
    const onChange = () => {
      $('#ai-detect').textContent = detectLabel($('#ai-key').value.trim());
      saveDebounced({ ai: aiCfg() });
      setTimeout(renderMaster, 450);
    };
    ['#ai-key', '#ai-cmd', '#ai-info', '#ai-prov', '#ai-model', '#ai-base'].forEach((s) => { $(s).addEventListener('input', onChange); $(s).addEventListener('change', onChange); });
    $('#ai-on').onchange = () => {
      const c = aiCfg();
      if (c.on && !c.key) { toast('আগে API কী এবং নির্দেশ বা তথ্য দিন'); }
      save({ ai: c }).then(renderMaster);
    };
    $('#nav-ai').onclick = async () => {
      if (openPane() === 'aipage') { showPane(null); return; }
      if (!(await okToLeave())) return;
      ed = null;
      if (document.body.classList.contains('viewing')) closeViewer();
      showPane('aipage');
      renderRules();
    };
    $('#ai-close').onclick = () => showPane(null);
    const runTest = async () => {
      const q = $('#ai-testq').value.trim();
      if (!q) return;
      const out = $('#ai-result');
      out.hidden = false; out.className = 'aiout'; out.textContent = 'অপেক্ষা করুন…';
      const r = await window.ar.aiTest(aiCfg(), q);
      if (r.text) {
        out.textContent = 'প্রশ্ন: ' + q + '\n\n' + r.text;
        // উত্তর এলে ঘর খালি হয় (নতুন প্রশ্ন লেখার জন্য); ব্যর্থ হলে প্রশ্ন থাকে, যেন আবার চেষ্টা করা যায়
        if ($('#ai-testq').value.trim() === q) $('#ai-testq').value = '';
      } else {
        out.className = 'aiout err'; out.textContent = 'ব্যর্থ: ' + r.error;
      }
    };
    $('#ai-test').onclick = runTest;
    $('#ai-testq').addEventListener('keydown', (e) => { if (e.key === 'Enter') runTest(); });
  }

  // ---------- আপডেট ----------
  function renderUpdate() {
    $('#ver').textContent = 'AutoReply v' + (upd.cur || '');
    const b = $('#update-btn');
    if (!upd.latest) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    if (!upd.busy) {
      b.classList.remove('busy');
      b.querySelector('.fill').style.width = '100%';
      b.querySelector('.pct').textContent = '';
    }
  }
  function setProgress(pct, installing) {
    const b = $('#update-btn');
    b.classList.add('busy');
    b.querySelector('.fill').style.width = pct + '%';
    b.querySelector('.pct').textContent = installing ? 'Installing…' : pct + '%';
  }
  async function startUpdate() {
    if (upd.busy || !upd.latest) return;
    upd.busy = true;
    setProgress(0, false);
    const r = await window.ar.updateInstall();
    if (!r.ok) { upd.busy = false; renderUpdate(); toast('আপডেট শুরু করা গেল না: ' + r.err); }
  }
  async function checkUpdateNow() {
    $('#check-upd').textContent = 'খোঁজা হচ্ছে…';
    const r = await window.ar.updateCheck();
    $('#check-upd').textContent = 'আপডেট খুঁজুন';
    upd.cur = r.cur; upd.latest = r.latest;
    renderUpdate();
    toast(r.latest ? 'নতুন সংস্করণ এসেছে: v' + r.latest.version : 'আপনার অ্যাপ সর্বশেষ সংস্করণে আছে');
  }

  // ---------- শুরু ----------
  async function init() {
    S = await window.ar.getSettings();
    $('#add-rule').onclick = () => openEditor(null);
    $('#ed-cancel').onclick = cancelEditor;
    $('#ed-close').onclick = cancelEditor;
    $('#ed-save').onclick = saveEditor;
    $('#ed-del').onclick = deleteRule;
    $('#nav-rules').onclick = () => { if (document.body.classList.contains('viewing')) closeViewer(); };
    buildApps();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('.dialog')) return;
      if (openPane() === 'editor') cancelEditor(); else if (openPane() === 'aipage') showPane(null);
    });

    $('#sw-enabled').checked = !!S.enabled;
    $('#sw-enabled').onchange = (e) => save({ enabled: e.target.checked }).then(renderMaster);
    $('#sw-autostart').checked = !!S.autostart;
    $('#sw-autostart').onchange = (e) => save({ autostart: e.target.checked });
    $('#delay-min').value = S.delayMin;
    $('#delay-max').value = S.delayMax;
    const dl = () => saveDebounced({ delayMin: Number($('#delay-min').value) || 0, delayMax: Number($('#delay-max').value) || 0 });
    $('#delay-min').oninput = dl;
    $('#delay-max').oninput = dl;

    renderRules();
    renderMaster();
    renderLog();
    initAi();
    syncViews();
    renderStatus();

    $('#update-btn').onclick = startUpdate;
    $('#check-upd').onclick = checkUpdateNow;
    window.ar.onUpdate((kind, v) => {
      if (kind === 'state') { upd.cur = v.cur; upd.latest = v.latest; renderUpdate(); }
      else if (kind === 'progress') { upd.busy = true; setProgress(v.pct, !!v.installing); }
      else if (kind === 'fail') { upd.busy = false; renderUpdate(); toast('আপডেট ব্যর্থ: ' + v.err); }
    });
    const st = await window.ar.updateState();
    upd.cur = st.cur; upd.latest = st.latest;
    renderUpdate();
  }
  init();
})();
