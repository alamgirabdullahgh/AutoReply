'use strict';
// ওয়েব WhatsApp-এর কাল্পনিক (আমার ধারণা করা) HTML কাঠামোয় adapter-এর নিয়ন্ত্রণ-প্রবাহ পরীক্ষা: বাস্তব সাইটের নয়
globalThis.__AR_TEST = true;
const fakeIpc = { sendToHost() {}, on() {} };
globalThis.__AR_IPC = fakeIpc;
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { createCore, whatsapp, telegram } = require('../adapter');

function setup(rowsHtml) {
  const dom = new JSDOM('<body><div id="pane-side"><div role="grid">' + rowsHtml + '</div></div><div id="app-main"></div></body>');
  const doc = dom.window.document;
  const sent = [];
  const ipc = { sendToHost: (_c, o) => sent.push(o), on() {} };
  const core = createCore(whatsapp, ipc, doc);
  return { doc, sent, core };
}
const row = (name, n) =>
  '<div role="row"><div role="gridcell"><span title="' + name + '">' + name + '</span>' + (n ? '<span aria-label="' + n + ' unread messages">' + n + '</span>' : '') + '</div></div>';
function openChat(doc, title, msgs) {
  // বাস্তবের মতো: একই চ্যাট আবার খুললে আগের মেসেজ থাকে, আর অপঠিত চিহ্ন মুছে যায়
  doc.querySelectorAll('#pane-side span[aria-label]').forEach((x) => x.remove());
  const cur = doc.getElementById('main');
  if (cur && cur.querySelector('header span[title]').getAttribute('title') === title) return;
  const main = doc.createElement('div');
  main.id = 'main';
  main.innerHTML = '<header><span title="' + title + '">' + title + '</span></header><div id="msgs"></div><footer><div contenteditable="true"></div></footer>';
  const old = doc.getElementById('main');
  if (old) old.remove();
  doc.body.appendChild(main);
  const box = main.querySelector('#msgs');
  msgs.forEach(([id, text]) => {
    const m = doc.createElement('div');
    m.setAttribute('data-id', id);
    m.innerHTML = '<span class="selectable-text copyable-text"><span>' + text + '</span></span>';
    box.appendChild(m);
  });
}

test('প্রথম ঝলকে শুধু ভিত্তি ধরে, পুরনো অপঠিত চ্যাটে উত্তর যায় না', async () => {
  const { doc, sent, core } = setup(row('রহিম', 3) + row('করিম', 0));
  doc.querySelector('[role=gridcell]').addEventListener('click', () => openChat(doc, 'রহিম', [['false_8801@c.us_A1', 'আসসালামু আলাইকুম']]));
  await core.tick();
  await core.tick();
  assert.ok(!sent.some((x) => x.t === 'msg'));
  assert.ok(sent.some((x) => x.t === 'status' && x.s === 'চালু'));
});

test('অপঠিত সংখ্যা বাড়লে চ্যাট খোলে, মেসেজ পাঠায়, উত্তর টাইপ ও নিশ্চিত করে', async () => {
  const { doc, sent, core } = setup(row('রহিম', 0) + row('করিম', 0));
  await core.tick(); // ভিত্তি
  const cell = doc.querySelectorAll('[role=gridcell]')[0];
  cell.addEventListener('click', () => openChat(doc, 'রহিম', [['false_8801@c.us_A1', 'আসসালামু আলাইকুম']]));
  cell.parentElement.innerHTML = '<div role="gridcell"><span title="রহিম">রহিম</span><span aria-label="1 unread message">1</span></div>';
  doc.querySelectorAll('[role=gridcell]')[0].addEventListener('click', () => openChat(doc, 'রহিম', [['false_8801@c.us_A1', 'আসসালামু আলাইকুম']]));
  await core.tick();
  const m = sent.find((x) => x.t === 'msg');
  assert.ok(m, 'msg পাঠানো হয়নি: ' + JSON.stringify(sent));
  assert.strictEqual(m.text, 'আসসালামু আলাইকুম');
  assert.strictEqual(m.isGroup, false);
  assert.strictEqual(m.chat, 'রহিম');
  // ব্যস্ত থাকা অবস্থায় আর কিছু ধরে না
  await core.tick();
  assert.strictEqual(sent.filter((x) => x.t === 'msg').length, 1);
  // উত্তরের সিদ্ধান্ত এলো
  await core.onCmd({ t: 'reply', text: 'ওয়া আলাইকুম আসসালাম' });
  const ty = sent.find((x) => x.t === 'type');
  assert.ok(ty);
  // মূল প্রক্রিয়া টাইপ করল: নিজের মেসেজ যোগ হলো
  const msgs = doc.querySelector('#msgs');
  const own = doc.createElement('div');
  own.setAttribute('data-id', 'true_8801@c.us_B2');
  own.innerHTML = '<span class="selectable-text copyable-text">ওয়া আলাইকুম আসসালাম</span>';
  msgs.appendChild(own);
  await core.onCmd({ t: 'typed' });
  assert.ok(sent.some((x) => x.t === 'result' && x.ok === true));
  // একই মেসেজে আবার উত্তর নয়
  await core.tick();
  assert.strictEqual(sent.filter((x) => x.t === 'msg').length, 1);
});

test('গ্রুপ বার্তা isGroup=true, ব্রডকাস্ট বাদ, শেষ মেসেজ নিজের হলে চুপ', async () => {
  const g = setup(row('টিম', 0));
  await g.core.tick();
  g.doc.querySelector('[role=gridcell]').parentElement.innerHTML = '<div role="gridcell"><span title="টিম">টিম</span><span aria-label="2 unread messages">2</span></div>';
  g.doc.querySelector('[role=gridcell]').addEventListener('click', () => openChat(g.doc, 'টিম', [['false_1203@g.us_X_8801@c.us', 'hello']]));
  await g.core.tick();
  assert.strictEqual(g.sent.find((x) => x.t === 'msg').isGroup, true);

  const b = setup(row('Bcast', 0));
  await b.core.tick();
  b.doc.querySelector('[role=gridcell]').parentElement.innerHTML = '<div role="gridcell"><span title="Bcast">Bcast</span><span aria-label="1 unread message">1</span></div>';
  b.doc.querySelector('[role=gridcell]').addEventListener('click', () => openChat(b.doc, 'Bcast', [['false_status@broadcast_Z', 'x']]));
  await b.core.tick();
  assert.ok(!b.sent.some((x) => x.t === 'msg'));
  assert.ok(b.sent.some((x) => x.t === 'info'));

  const o = setup(row('Own', 0));
  await o.core.tick();
  o.doc.querySelector('[role=gridcell]').parentElement.innerHTML = '<div role="gridcell"><span title="Own">Own</span><span aria-label="1 unread message">1</span></div>';
  o.doc.querySelector('[role=gridcell]').addEventListener('click', () => openChat(o.doc, 'Own', [['false_1@c.us_A', 'q'], ['true_1@c.us_B', 'আগেই উত্তর দেওয়া']]));
  await o.core.tick();
  assert.ok(!o.sent.some((x) => x.t === 'msg'));
});

test('খোলা চ্যাটে নতুন মেসেজ এলে ধরে; ভিত্তির মেসেজে নয়', async () => {
  const { doc, sent, core } = setup(row('রহিম', 0));
  openChat(doc, 'রহিম', [['false_1@c.us_A', 'পুরনো']]);
  await core.tick();
  await core.tick();
  assert.ok(!sent.some((x) => x.t === 'msg'));
  const box = doc.querySelector('#msgs');
  const n = doc.createElement('div');
  n.setAttribute('data-id', 'false_1@c.us_C');
  n.innerHTML = '<span class="selectable-text copyable-text">নতুন প্রশ্ন</span>';
  box.appendChild(n);
  await core.tick();
  const m = sent.find((x) => x.t === 'msg');
  assert.ok(m);
  assert.strictEqual(m.text, 'নতুন প্রশ্ন');
});

test('ছবি-মাত্র মেসেজে উত্তর নয়; skip কমান্ডে ব্যস্ততা কাটে', async () => {
  const { doc, sent, core } = setup(row('রহিম', 0));
  openChat(doc, 'রহিম', [['false_1@c.us_A', 'পুরনো']]);
  await core.tick();
  const n = doc.createElement('div');
  n.setAttribute('data-id', 'false_1@c.us_IMG');
  n.innerHTML = '<img src="x">';
  doc.querySelector('#msgs').appendChild(n);
  await core.tick();
  assert.ok(!sent.some((x) => x.t === 'msg'));
  const t = doc.createElement('div');
  t.setAttribute('data-id', 'false_1@c.us_T');
  t.innerHTML = '<span class="selectable-text copyable-text">দাম কত?</span>';
  doc.querySelector('#msgs').appendChild(t);
  await core.tick();
  assert.strictEqual(sent.filter((x) => x.t === 'msg').length, 1);
  await core.onCmd({ t: 'skip' });
  await core.tick();
  assert.strictEqual(core.state().busy, false);
});

test('Telegram: গ্রুপ/চ্যানেল/বট শনাক্ত', () => {
  const dom = new JSDOM('<body><div id="MiddleColumn"><div class="ChatInfo"><h3 class="fullName">Group A</h3><span class="status">12 members</span></div><div class="Message message-list-item" data-message-id="5"><div class="text-content">hi <span class="MessageMeta">10:00</span></div></div></div></body>');
  const m = telegram.lastMessage(dom.window.document);
  assert.strictEqual(m.isGroup, true);
  assert.strictEqual(m.text, 'hi');
  assert.strictEqual(m.own, false);
  dom.window.document.querySelector('.status').textContent = '1,200 subscribers';
  assert.ok(telegram.lastMessage(dom.window.document).skip);
  dom.window.document.querySelector('.status').textContent = 'last seen recently';
  dom.window.document.querySelector('.fullName').textContent = 'My Helper Bot';
  assert.ok(telegram.lastMessage(dom.window.document).skip);
});
