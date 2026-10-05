/* =============================================================================
 * tests/tools/render-audit.mjs
 * تحقق بصري وقياسي حقيقي عبر بروتوكول Chrome DevTools (بلا أي مكتبة خارجية).
 * يشغّل Edge/Chrome بلا واجهة، يفحص كل شاشة، ويطبع:
 *   - عرض المستند مقابل عرض الشاشة (كشف الانزلاق الأفقي)
 *   - أخطاء الـ console وأخطاء الصفحة
 *   - صورة PNG لكل شاشة في tests/screenshots/
 * الاستخدام:  node tests/tools/render-audit.mjs [--port 9333]
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', 'screenshots');
const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i > 0 ? Number(process.argv[i + 1]) : 9333;
})();
const WIDTH = 390, HEIGHT = 844;

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const browser = BROWSERS.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('❌ لم يُعثر على Edge أو Chrome. ثبّت أحدهما أو شغّل الاختبارات الأخرى.');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const userDir = path.join(process.env.TEMP || '/tmp', 'masrofi-audit-' + Date.now());
const url = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const child = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars', '--mute-audio',
  `--user-data-dir=${userDir}`,
  `--remote-debugging-port=${PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('مهلة: ' + method)); } }, 30000);
  });
}

async function main() {
  // 1) انتظر جهوزية المتصفح
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      version = await res.json();
      break;
    } catch { await delay(250); }
  }
  if (!version) throw new Error('لم يستجب المتصفح على المنفذ ' + PORT);
  console.log('🌐 المتصفح: ' + version['Browser']);

  // 2) افتح تبويباً واتصل بـ WebSocket
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let sessionId = null;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleErrors.push(msg.params.type + ': ' + (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push((msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '').split('\n')[0]);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => {});
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true
  });
  await send('Page.navigate', { url });
  await delay(2500);

  const views = ['dashboard', 'expenses', 'income', 'accounts', 'reports', 'domains', 'settings', 'agent'];
  const report = [];
  let failures = 0;

  for (const id of views) {
    await send('Runtime.evaluate', {
      expression: `(function(){ if (Fin.App && Fin.App.go) { Fin.App.go('${id}', {force:true, replace:true}); return 'ok'; } return 'no-app'; })()`,
      returnByValue: true
    });
    await delay(700);

    // قياس فعلي داخل الصفحة
    const measured = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(function(){
        var d = document.documentElement;
        var host = document.querySelector('.app-shell');
        var view = document.getElementById('view');
        var nav = document.getElementById('nav');
        function overflowing(scope){
          var out = [], all = scope.querySelectorAll('*');
          for (var i=0;i<all.length;i++){
            var el = all[i], r = el.getBoundingClientRect();
            if (r.width < 1 && r.height < 1) continue;
            if (r.right > window.innerWidth + 1 || r.left < -1 || r.width > window.innerWidth + 1){
              out.push(el.tagName.toLowerCase() + '.' + String(el.className||'').split(' ').slice(0,2).join('.') + ' w=' + Math.round(r.width));
            }
          }
          return out.slice(0, 6);
        }
        return {
          view: '${id}',
          innerWidth: window.innerWidth,
          docScrollWidth: d.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          shellWidth: host ? Math.round(host.getBoundingClientRect().width) : null,
          shellScrollWidth: host ? host.scrollWidth : null,
          navScrollWidth: nav ? nav.scrollWidth : null,
          navItems: nav ? nav.children.length : 0,
          viewHeight: view ? Math.round(view.getBoundingClientRect().height) : 0,
          navItemsVisible: nav ? Array.prototype.filter.call(nav.children, function(c){ var r=c.getBoundingClientRect(); return r.width>0 && r.height>0; }).length : 0,
          textLength: view ? (view.textContent||'').trim().length : 0,
          overflowing: host ? overflowing(host) : [],
          mode: document.documentElement.getAttribute('data-theme')
        };
      })()`
    });
    const m = measured.result.value;

    // صورة الشاشة
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const name = id + '-' + m.mode + '.png';
    fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));

    const overflow = m.docScrollWidth > m.innerWidth + 1;
    if (overflow) failures++;
    report.push({ ...m, overflow, shot: name });
  }

  // مفتاح الوضع النهاري + لقطة
  await send('Runtime.evaluate', { expression: `Fin.UI.theme.set('light')` });
  await delay(500);
  const lightShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'dashboard-light.png'), Buffer.from(lightShot.data, 'base64'));
  const lightMode = await send('Runtime.evaluate', { returnByValue: true, expression: `document.documentElement.getAttribute('data-theme')` });
  await send('Runtime.evaluate', { expression: `Fin.UI.theme.set('dark')` });

  /* ------------------------------- التقرير ------------------------------- */
  console.log('\n' + '═'.repeat(78));
  console.log(`قياس حقيقي: عرض الشاشة ${WIDTH}px (جوال) — الوضع الليلي`);
  console.log('═'.repeat(78));
  for (const r of report) {
    const flag = r.overflow ? '❌ انزلاق' : '✅';
    console.log(
      `${flag} ${r.view.padEnd(10)} doc=${String(r.docScrollWidth).padStart(4)} shell=${String(r.shellWidth).padStart(4)}` +
      ` nav=${String(r.navScrollWidth).padStart(4)}/${r.navItems} tabs visible=${r.navItemsVisible}` +
      ` content=${String(r.textLength).padStart(5)}ch  → ${r.shot}`
    );
    if (r.overflowing.length) r.overflowing.forEach((o) => console.log('        ↳ متجاوز: ' + o));
  }
  console.log('─'.repeat(78));
  console.log('المظهر بعد التبديل للنهاري: ' + lightMode.result.value + ' (لقطة: dashboard-light.png)');
  console.log('أخطاء console: ' + (consoleErrors.length ? consoleErrors.length + ' ❌' : '0 ✅'));
  consoleErrors.slice(0, 10).forEach((e) => console.log('   ! ' + e));
  console.log('أخطاء صفحات (استثناءات): ' + (pageErrors.length ? pageErrors.length + ' ❌' : '0 ✅'));
  pageErrors.slice(0, 10).forEach((e) => console.log('   ! ' + e));
  console.log('─'.repeat(78));
  console.log(failures === 0 && pageErrors.length === 0
    ? '✅ PASS — لا انزلاق أفقي ولا أخطاء وقت تشغيل في أي شاشة'
    : `❌ FAIL — ${failures} شاشة فيها انزلاق، ${pageErrors.length} استثناء`);

  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => {
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
    process.exit(failures === 0 && pageErrors.length === 0 ? 0 : 1);
  }, 400);
}

main().catch((e) => {
  console.error('❌ فشل التحقق البصري: ' + e.message);
  try { ws && ws.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(1), 300);
});
