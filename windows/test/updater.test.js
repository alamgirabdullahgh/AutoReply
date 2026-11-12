'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../updater');

const FEED = `<feed>
<entry><link rel="alternate" href="https://github.com/alamgirabdullahgh/AutoReply/releases/tag/v1.0.222"/></entry>
<entry><link rel="alternate" href="https://github.com/alamgirabdullahgh/AutoReply/releases/tag/windows-v1.0.9"/></entry>
<entry><link rel="alternate" href="https://github.com/alamgirabdullahgh/AutoReply/releases/tag/windows-v1.0.12"/></entry>
<entry><link rel="alternate" href="https://github.com/alamgirabdullahgh/AutoReply/releases/tag/windows-v1.0.3"/></entry>
</feed>`;

test('সংস্করণ নম্বর: শেষ সংখ্যা', () => {
  assert.strictEqual(U.verNum('1.0.37'), 37);
  assert.strictEqual(U.verNum('1.0.0'), 0);
  assert.strictEqual(U.verNum('abc'), 0);
});

test('ফিড থেকে সবচেয়ে বড় windows ট্যাগ (সংখ্যা হিসেবে, Android ট্যাগ বাদ)', () => {
  const i = U.pickLatest(FEED);
  assert.strictEqual(i.n, 12);
  assert.strictEqual(i.tag, 'windows-v1.0.12');
  assert.strictEqual(i.url, 'https://github.com/alamgirabdullahgh/AutoReply/releases/download/windows-v1.0.12/AutoReply-Setup-1.0.12.exe');
});

test('windows ট্যাগ না থাকলে null', () => {
  assert.strictEqual(U.pickLatest('<feed>releases/tag/v1.0.5</feed>'), null);
  assert.strictEqual(U.pickLatest(''), null);
});

test('নতুন কি না', () => {
  const i = U.pickLatest(FEED);
  assert.strictEqual(U.isNewer(i, '1.0.11'), true);
  assert.strictEqual(U.isNewer(i, '1.0.12'), false);
  assert.strictEqual(U.isNewer(i, '1.0.13'), false);
  assert.strictEqual(U.isNewer(null, '1.0.1'), false);
});

function serve(handler) {
  return new Promise((res) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

test('checkLatest: ফিড পড়ে (রিডাইরেক্ট সহ)', async () => {
  const { s, port } = await serve((req, res) => {
    if (req.url === '/go') { res.writeHead(302, { Location: '/feed' }); res.end(); return; }
    res.writeHead(200); res.end(FEED);
  });
  try {
    const i = await U.checkLatest({ lib: http, feedUrl: 'http://127.0.0.1:' + port + '/go' });
    assert.strictEqual(i.n, 12);
  } finally { s.close(); }
});

test('download: শতাংশ জানায়, রিডাইরেক্ট মানে, ফাইল সংরক্ষণ করে', async () => {
  const body = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200000, 7)]);
  const { s, port } = await serve((req, res) => {
    if (req.url === '/a') { res.writeHead(302, { Location: '/b' }); res.end(); return; }
    res.writeHead(200, { 'Content-Length': body.length });
    res.write(body.subarray(0, 100000));
    setTimeout(() => res.end(body.subarray(100000)), 20);
  });
  const dest = path.join(os.tmpdir(), 'ar-test-' + Date.now(), 'x.exe');
  const pcts = [];
  try {
    await U.download('http://127.0.0.1:' + port + '/a', dest, (p) => pcts.push(p), { lib: http });
    assert.strictEqual(fs.statSync(dest).size, body.length);
    assert.strictEqual(pcts[pcts.length - 1], 100);
    assert.ok(pcts.length >= 2);
    for (let k = 1; k < pcts.length; k++) assert.ok(pcts[k] >= pcts[k - 1]);
  } finally { s.close(); }
});

test('download: exe নয় এমন ফাইল বাতিল, মুছে যায়', async () => {
  const { s, port } = await serve((req, res) => { res.writeHead(200, { 'Content-Length': 5 }); res.end('hello'); });
  const dest = path.join(os.tmpdir(), 'ar-test-' + Date.now() + 'b', 'y.exe');
  try {
    await assert.rejects(U.download('http://127.0.0.1:' + port + '/', dest, () => {}, { lib: http }), /ইনস্টলার নয়/);
    assert.strictEqual(fs.existsSync(dest), false);
  } finally { s.close(); }
});

test('download: HTTP ত্রুটিতে ব্যর্থ', async () => {
  const { s, port } = await serve((req, res) => { res.writeHead(404); res.end(); });
  try {
    await assert.rejects(U.download('http://127.0.0.1:' + port + '/', path.join(os.tmpdir(), 'ar-z.exe'), () => {}, { lib: http }), /HTTP 404/);
  } finally { s.close(); }
});
