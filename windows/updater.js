'use strict';
// Windows-এ স্বয়ংক্রিয় আপডেট (Android অ্যাপের Updater.kt-এর মতো): GitHub Releases থেকে নতুন ইনস্টলার খোঁজে, নামায়, নীরবে ইনস্টল করে আবার চালু করে।
// রিলিজের তালিকা পড়া হয় releases.atom ফিড থেকে (API নয়, তাই রেট লিমিট নেই)। শুধু "windows-v1.0.N" ট্যাগ গোনা হয়; Android-এর "v1.0.N" ট্যাগ বাদ।
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'alamgirabdullahgh/AutoReply';
const TAG_RE = /releases\/tag\/(windows-v(\d+)\.(\d+)\.(\d+))/g;

// "1.0.37" -> 37 (শেষ সংখ্যাই সংস্করণ নম্বর)
function verNum(v) {
  const n = parseInt(String(v).split('.').pop(), 10);
  return Number.isFinite(n) ? n : 0;
}

// ফিডের লেখা থেকে সবচেয়ে বড় windows-vX.Y.N বের করে; না পেলে null
function pickLatest(feedText) {
  let best = null;
  const s = String(feedText || '');
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s)) !== null) {
    const n = Number(m[4]);
    if (!best || n > best.n) best = { tag: m[1], n, version: m[2] + '.' + m[3] + '.' + m[4] };
  }
  if (!best) return null;
  return {
    n: best.n,
    version: best.version,
    tag: best.tag,
    url: 'https://github.com/' + REPO + '/releases/download/' + best.tag + '/AutoReply-Setup-' + best.version + '.exe'
  };
}

function isNewer(info, currentVersion) {
  return !!info && info.n > verNum(currentVersion);
}

function getText(url, opts, depth) {
  const lib = (opts && opts.lib) || https;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers: { 'User-Agent': 'AutoReply-Windows' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (depth || 0) < 5) {
        res.resume();
        resolve(getText(new URL(res.headers.location, url).toString(), opts, (depth || 0) + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('সময় শেষ')));
    req.on('error', reject);
  });
}

// নেটওয়ার্কে নতুন সংস্করণ আছে কি না দেখে: { n, version, url } অথবা null
async function checkLatest(opts) {
  const base = (opts && opts.feedUrl) || ('https://github.com/' + REPO + '/releases.atom');
  const text = await getText(base, opts);
  return pickLatest(text);
}

// ইনস্টলার নামায়; onPct(0..100) ডাকে। শেষে ফাইলের আকার ও "MZ" (exe) শুরু যাচাই করে।
function download(url, dest, onPct, opts, depth) {
  const lib = (opts && opts.lib) || https;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers: { 'User-Agent': 'AutoReply-Windows' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (depth || 0) < 5) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).toString(), dest, onPct, opts, (depth || 0) + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const total = Number(res.headers['content-length']) || 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      let done = 0;
      let last = -1;
      res.on('data', (c) => {
        done += c.length;
        if (total > 0) {
          const pct = Math.min(100, Math.floor(done * 100 / total));
          if (pct !== last) { last = pct; try { onPct(pct); } catch (e) { /* ignore */ } }
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try {
            const st = fs.statSync(dest);
            if (total > 0 && st.size !== total) throw new Error('ফাইল অসম্পূর্ণ');
            const fd = fs.openSync(dest, 'r');
            const b = Buffer.alloc(2);
            fs.readSync(fd, b, 0, 2, 0);
            fs.closeSync(fd);
            if (b.toString('latin1') !== 'MZ') throw new Error('ফাইলটা ইনস্টলার নয়');
            resolve(dest);
          } catch (e) { try { fs.unlinkSync(dest); } catch (x) { /* ignore */ } reject(e); }
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('সময় শেষ')));
    req.on('error', reject);
  });
}

function tmpInstallerPath(version) {
  return path.join(os.tmpdir(), 'AutoReply-update', 'AutoReply-Setup-' + version + '.exe');
}

module.exports = { REPO, verNum, pickLatest, isNewer, checkLatest, download, tmpInstallerPath };
