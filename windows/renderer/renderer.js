'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const URLS = {
    WhatsApp: 'https://web.whatsapp.com/',
    Telegram: 'https://web.telegram.org/a/',
    Messenger: 'https://www.messenger.com/'
  };
  const PART = { WhatsApp: 'persist:whatsapp', Telegram: 'persist:telegram', Messenger: 'persist:messenger' };
  const AUTO_APPS = ['WhatsApp', 'Telegram'];
  const MODES = [
    [0, 'শব্দ থাকলেই (Contains)'],
    [1, 'হুবহু এক (Exact)'],
    [2, 'প্রায় এক (Similar)'],
    [3, 'প্যাটার্ন (* চিহ্ন)'],
    [4, 'Regex']
  ];

  let S = null;
  const views = {};
  const status = {};
  const logs = [];
  let saveTimer = null;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- লগ ----------
  function addLog(app, msg) {
    const t = new Date().toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logs.unshift(t + ' — ' + app + ' — ' + msg);
    if (logs.length > 60) logs.pop();
    $('#log').innerHTML = logs.map((l) => '<div>' + esc(l) + '</div>').join('');
  }

  // ---------- ট্যাব ----------
  function showTab(name) {
    document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    const isView = !!URLS[name];
    if (isView) ensureView(name);
    Object.keys(views).forEach((k) => views[k].classList.toggle('active', k === name));
    document.body.classList.toggle('viewing', isView);
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
      $('#st-' + a).textContent = s;
      const dot = $('#dot-' + a);
      dot.className = 'dot' + (s === 'চালু' ? ' ok' : (views[a] ? ' bad' : ''));
    });
  }

  // ---------- সেটিংস সংরক্ষণ ----------
  function save(patch) {
    return window.ar.setSettings(patch).then((s) => { S = s; return s; });
  }
  function saveDebounced(patch) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(patch), 400);
  }

  // ---------- হোম ----------
  function initHome() {
    $('#sw-enabled').checked = !!S.enabled;
    $('#sw-enabled').onchange = (e) => save({ enabled: e.target.checked });
    AUTO_APPS.forEach((a) => {
      const el = $('#sw-' + a);
      el.checked = !!S.apps[a];
      el.onchange = async (e) => {
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
  }

  // ---------- নিয়ম ----------
  function renderRules() {
    const box = $('#rules');
    box.innerHTML = '';
    S.rules.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'rule' + (r.on ? '' : ' off');
      d.innerHTML =
        '<label class="l">কী শব্দ/বাক্য (কমা বা নতুন লাইন দিয়ে আলাদা; Regex হলে প্রতি লাইনে একটা)</label>' +
        '<textarea class="k" rows="2"></textarea>' +
        '<label class="l">উত্তর</label>' +
        '<textarea class="r" rows="2"></textarea>' +
        '<div class="opts">' +
        '<label><input type="checkbox" class="on"> চালু</label>' +
        '<label><input type="checkbox" class="person"> ব্যক্তির চ্যাটে</label>' +
        '<label><input type="checkbox" class="group"> গ্রুপে</label>' +
        '<select class="mode"></select>' +
        '</div>' +
        '<div class="btns"><button class="btn ghost up">↑</button><button class="btn ghost down">↓</button><button class="btn danger del">মুছুন</button></div>';
      d.querySelector('.k').value = r.keys;
      d.querySelector('.r').value = r.reply;
      d.querySelector('.on').checked = !!r.on;
      d.querySelector('.person').checked = !!r.person;
      d.querySelector('.group').checked = !!r.group;
      const sel = d.querySelector('.mode');
      MODES.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
      sel.value = String(r.mode);
      const upd = () => {
        r.keys = d.querySelector('.k').value;
        r.reply = d.querySelector('.r').value;
        r.on = d.querySelector('.on').checked;
        r.person = d.querySelector('.person').checked;
        r.group = d.querySelector('.group').checked;
        r.mode = Number(sel.value);
        d.classList.toggle('off', !r.on);
        saveDebounced({ rules: S.rules });
      };
      d.querySelectorAll('textarea, input, select').forEach((el) => { el.addEventListener('input', upd); el.addEventListener('change', upd); });
      d.querySelector('.up').onclick = () => { if (i > 0) { S.rules.splice(i - 1, 0, S.rules.splice(i, 1)[0]); save({ rules: S.rules }); renderRules(); } };
      d.querySelector('.down').onclick = () => { if (i < S.rules.length - 1) { S.rules.splice(i + 1, 0, S.rules.splice(i, 1)[0]); save({ rules: S.rules }); renderRules(); } };
      d.querySelector('.del').onclick = () => { if (confirm('এই নিয়মটা মুছবেন?')) { S.rules.splice(i, 1); save({ rules: S.rules }); renderRules(); } };
      box.appendChild(d);
    });
    if (!S.rules.length) box.innerHTML = '<p class="hint">কোনো নিয়ম নেই।</p>';
  }

  function initRules() {
    renderRules();
    $('#add-rule').onclick = () => {
      S.rules.push({ keys: '', reply: '', on: true, group: false, person: true, mode: 0 });
      save({ rules: S.rules });
      renderRules();
    };
  }

  // ---------- AI ----------
  function aiCfg() {
    return {
      on: $('#ai-on').checked,
      key: $('#ai-key').value.trim(),
      cmd: $('#ai-cmd').value,
      info: $('#ai-info').value,
      prov: $('#ai-prov').value,
      model: $('#ai-model').value.trim(),
      base: $('#ai-base').value.trim()
    };
  }

  function detectLabel(k) {
    if (!k) return '';
    if (k.startsWith('AQ.') || k.startsWith('AIza')) return 'চাবি চেনা গেছে: Gemini';
    if (k.startsWith('sk-ant-')) return 'চাবি চেনা গেছে: Claude';
    if (k.startsWith('sk-or-')) return 'চাবি চেনা গেছে: OpenRouter';
    if (k.startsWith('gsk_')) return 'চাবি চেনা গেছে: Groq';
    if (k.startsWith('xai-')) return 'চাবি চেনা গেছে: xAI';
    if (k.startsWith('sk-')) return 'চাবি চেনা গেছে: OpenAI';
    return 'চাবির ধরন চেনা যায়নি; "উন্নত" থেকে প্রোভাইডার বেছে নিন';
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
    const upd = () => {
      $('#ai-detect').textContent = detectLabel($('#ai-key').value.trim());
      saveDebounced({ ai: aiCfg() });
    };
    ['#ai-on', '#ai-key', '#ai-cmd', '#ai-info', '#ai-prov', '#ai-model', '#ai-base'].forEach((s) => {
      $(s).addEventListener('input', upd);
      $(s).addEventListener('change', upd);
    });
    $('#ai-test').onclick = async () => {
      $('#ai-result').textContent = 'পরীক্ষা চলছে…';
      const r = await window.ar.aiTest(aiCfg());
      $('#ai-result').textContent = r.text ? 'সফল। নমুনা উত্তর: ' + r.text.slice(0, 200) : 'ব্যর্থ: ' + r.error;
    };
  }

  // ---------- শুরু ----------
  async function init() {
    S = await window.ar.getSettings();
    document.querySelectorAll('.navbtn').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
    initHome();
    initRules();
    initAi();
    AUTO_APPS.forEach((a) => { if (S.apps[a]) ensureView(a); });
    renderStatus();
  }
  init();
})();
