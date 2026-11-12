'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const URLS = { WhatsApp: 'https://web.whatsapp.com/', Telegram: 'https://web.telegram.org/a/', Messenger: 'https://www.messenger.com/' };
  const PART = { WhatsApp: 'persist:whatsapp', Telegram: 'persist:telegram', Messenger: 'persist:messenger' };
  const AUTO_APPS = ['WhatsApp', 'Telegram'];
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

  // ---------- মেনু ----------
  function openMenu() { $('#side').classList.add('show'); $('#scrim').classList.add('show'); }
  function closeMenu() { $('#side').classList.remove('show'); $('#scrim').classList.remove('show'); }

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
    wv.setAttribute('partition', PART[app]);
    wv.setAttribute('src', URLS[app]);
    wv.addEventListener('ipc-message', (e) => {
      if (e.channel === 'ar' && e.args && e.args[0]) onAdapter(app, wv, e.args[0]).catch((x) => addLog(app, 'ত্রুটি: ' + (x && x.message || x)));
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
    closeMenu();
    $('#vw-title').textContent = app;
    $('#viewer').classList.remove('hidden');
    Object.keys(views).forEach((k) => views[k].classList.toggle('active', k === app));
    document.body.classList.add('viewing');
  }
  function closeViewer() {
    $('#viewer').classList.add('hidden');
    document.body.classList.remove('viewing');
    Object.keys(views).forEach((k) => views[k].classList.remove('active'));
    // অটো-রিপ্লের অ্যাপ বন্ধ থাকলে ট্যাবটা আবার বাদ
    AUTO_APPS.forEach((a) => { if (!S.apps[a]) dropView(a); });
    if (views.Messenger) dropView('Messenger');
  }

  function randDelay() {
    const a = Math.max(0, Number(S.delayMin) || 0);
    const b = Math.max(a, Number(S.delayMax) || a);
    return (a + Math.random() * (b - a)) * 1000;
  }

  async function onAdapter(app, wv, m) {
    if (m.t === 'status') { status[app] = m.s; renderStatus(); return; }
    if (m.t === 'info') { addLog(app, m.s); return; }
    if (m.t === 'result') { addLog(app, m.ok ? 'মেসেজ গিয়েছে' : 'পাঠাতে ব্যর্থ: ' + m.reason); return; }
    if (m.t === 'msg') {
      const d = await window.ar.decide({ app, isGroup: !!m.isGroup, text: m.text, conv: app + '|' + m.chat });
      if (d.reply) {
        addLog(app, 'উত্তর তৈরি (' + (d.via === 'ai' ? 'AI' : 'নিয়ম') + '), পাঠানো হচ্ছে…');
        await sleep(randDelay());
        wv.send('ar-cmd', { t: 'reply', text: d.reply });
      } else {
        addLog(app, d.reason);
        wv.send('ar-cmd', { t: 'skip' });
      }
      return;
    }
    if (m.t === 'type') {
      const r = await window.ar.type(wv.getWebContentsId(), m.text);
      wv.send('ar-cmd', r.ok ? { t: 'typed' } : { t: 'typed', err: r.err });
    }
  }

  function renderStatus() {
    AUTO_APPS.forEach((a) => {
      const s = status[a] || 'বন্ধ';
      $('#st-' + a).textContent = s === 'চালু' ? '✔ সংযুক্ত — মেসেজের অপেক্ষায়' : (views[a] ? s + ' (প্রথমবার \"খুলুন\" চেপে লগইন করুন)' : 'বন্ধ');
    });
  }

  // ---------- নিয়মের তালিকা (মূল পাতা) ----------
  function renderRules() {
    const box = $('#rules');
    box.textContent = '';
    if (!S.rules.length) { box.appendChild(el('div', 'empty', 'কোনো নিয়ম নেই। নিচে ডানের + চেপে যোগ করুন।')); return; }
    S.rules.forEach((r) => {
      const card = el('div', 'rule' + (r.on ? ' on' : ''));
      const col = el('div', 'col');
      col.appendChild(el('div', 'rcv', 'Receive:  ' + r.keys));
      col.appendChild(el('div', 'ln'));
      col.appendChild(el('div', 'snd', 'Send:  ' + r.reply));
      col.onclick = () => openEditor(r);
      const sw = el('label', 'pill');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!r.on;
      cb.onchange = () => { r.on = cb.checked; card.classList.toggle('on', r.on); save({ rules: S.rules }); };
      sw.appendChild(cb);
      sw.appendChild(document.createElement('span'));
      card.appendChild(col);
      card.appendChild(sw);
      box.appendChild(card);
    });
  }

  // ---------- নিয়ম সম্পাদক ----------
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

  function openEditor(r) {
    ed = { rule: r || null, mode: r ? r.mode : 1, orig: r ? { keys: r.keys, reply: r.reply, person: !!r.person, group: !!r.group, mode: r.mode } : { keys: '', reply: '', person: true, group: false, mode: 1 } };
    const num = r ? S.rules.indexOf(r) + 1 : S.rules.length + 1;
    $('#ed-title').textContent = r ? 'Rule ' + num : 'New rule';
    $('#ed-more').classList.toggle('hidden', !r);
    $('#ed-menu').classList.add('hidden');
    $('#ed-keys').value = ed.orig.keys;
    $('#ed-reply').value = ed.orig.reply;
    $('#ed-person').checked = ed.orig.person;
    $('#ed-group').checked = ed.orig.group;
    renderModes();
    $('#editor').classList.remove('hidden');
  }

  function editorDirty() {
    return $('#ed-keys').value.trim() !== ed.orig.keys || $('#ed-reply').value.trim() !== ed.orig.reply ||
      $('#ed-person').checked !== ed.orig.person || $('#ed-group').checked !== ed.orig.group || ed.mode !== ed.orig.mode;
  }

  function closeEditor() { $('#editor').classList.add('hidden'); $('#ed-menu').classList.add('hidden'); ed = null; renderRules(); }

  async function backEditor() {
    if (ed && editorDirty()) {
      const v = await dialog('Discard changes?', 'আপনার পরিবর্তন সংরক্ষণ করা হয়নি।', [['Keep editing', 0], ['Discard', 1]]);
      if (!v) return;
    }
    closeEditor();
  }

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
    $('#ed-menu').classList.add('hidden');
    const v = await dialog('Delete rule', 'Delete this rule?', [['Cancel', 0], ['Delete', 1]]);
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
    };
    ['#ai-key', '#ai-cmd', '#ai-info', '#ai-prov', '#ai-model', '#ai-base'].forEach((s) => { $(s).addEventListener('input', onChange); $(s).addEventListener('change', onChange); });
    $('#ai-on').onchange = () => {
      const c = aiCfg();
      if (c.on && !c.key) { toast('আগে "সেটিংস"-এ API কী এবং নির্দেশ বা তথ্য দিন'); }
      save({ ai: c });
    };
    $('#ai-open').onclick = () => { closeMenu(); $('#aipage').classList.remove('hidden'); };
    $('#ai-back').onclick = () => $('#aipage').classList.add('hidden');
    $('#ai-test').onclick = async () => {
      $('#ai-result').textContent = 'অপেক্ষা করুন…';
      const r = await window.ar.aiTest(aiCfg());
      $('#ai-result').textContent = r.text ? 'সফল। নমুনা উত্তর: ' + r.text.slice(0, 200) : 'ব্যর্থ: ' + r.error;
    };
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
    $('#menu-btn').onclick = () => ($('#side').classList.contains('show') ? closeMenu() : openMenu());
    $('#side-x').onclick = closeMenu;
    $('#scrim').onclick = closeMenu;
    $('#fab').onclick = () => openEditor(null);
    $('#ed-back').onclick = backEditor;
    $('#ed-save').onclick = saveEditor;
    $('#ed-more').onclick = () => $('#ed-menu').classList.toggle('hidden');
    $('#ed-del').onclick = deleteRule;
    $('#vw-back').onclick = closeViewer;
    document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openViewer(b.dataset.open); });

    $('#sw-enabled').checked = !!S.enabled;
    $('#sw-enabled').onchange = (e) => save({ enabled: e.target.checked });
    AUTO_APPS.forEach((a) => {
      const c = $('#sw-' + a);
      c.checked = !!S.apps[a];
      c.onchange = async (e) => {
        await save({ apps: { [a]: e.target.checked } });
        if (e.target.checked) ensureView(a); else dropView(a);
        renderStatus();
      };
    });
    $('#sw-autostart').checked = !!S.autostart;
    $('#sw-autostart').onchange = (e) => save({ autostart: e.target.checked });
    $('#delay-min').value = S.delayMin;
    $('#delay-max').value = S.delayMax;
    const dl = () => saveDebounced({ delayMin: Number($('#delay-min').value) || 0, delayMax: Number($('#delay-max').value) || 0 });
    $('#delay-min').oninput = dl;
    $('#delay-max').oninput = dl;

    renderRules();
    renderLog();
    initAi();
    AUTO_APPS.forEach((a) => { if (S.apps[a]) ensureView(a); });
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
