/* tests/_dom.check.mjs — تحقق حقيقي من رسم الشاشات في Chrome بلا مكتبات
   يبني سيرفراً محلياً بلا مكتبات + يفتح Chrome headless عبر بروتوكول CDP
   ويمرّ على الشاشات السبع ويلتقط أخطاء console/الاستثناءات. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = 8099;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('404');
  }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = mkdtempSync(join(tmpdir(), 'domchk-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9333', '--user-data-dir=' + profile, '--window-size=430,900',
  'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* نطلب صفحة جديدة تماماً عبر Browser endpoint لتفادي الالتصاق بتبويب قائم */
let version = null;
for (let i = 0; i < 40 && !version; i++) {
  await sleep(400);
  try {
    const r = await fetch('http://127.0.0.1:9333/json/version');
    version = await r.json();
  } catch { /* لم يجهز بعد */ }
}
if (!version) { console.log('FAIL: تعذّر تشغيل المتصفح'); chrome.kill(); server.close(); process.exit(1); }

const bws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
let bid = 0;
const bpending = new Map();
bws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && bpending.has(msg.id)) { bpending.get(msg.id)(msg); bpending.delete(msg.id); }
};
function bsend(method, params) {
  const mid = ++bid;
  return new Promise((resolve, reject) => {
    bpending.set(mid, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    bws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
const created = await bsend('Target.createTarget', { url: 'about:blank' });
const target = { id: created.targetId };
const ws = new WebSocket(`ws://127.0.0.1:9333/devtools/page/${target.id}`);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
function send(method, params) {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(4000);

/* لو لم يُقلع الراوتر تلقائياً نُقلعه يدوياً (نُسجّل ذلك كتشخيص) */
const booted = await evaluate(`(window.Fin && window.Fin.App && window.Fin.App.currentId && window.Fin.App.currentId()) || null`);
if (!booted) {
  console.log('BOOT: الراوتر لم يُقلع تلقائياً — أُقلعه يدوياً للتشخيص');
  console.log('BOOT manual: ' + JSON.stringify(await evaluate(`(() => {
    try { window.Fin.App.init(); return { ok: true, id: window.Fin.App.currentId(), nav: document.getElementById('nav').children.length }; }
    catch (e) { return { ok: false, err: String(e && e.stack || e) }; }
  })()`)));
  await sleep(600);
}

/* طبع أي خطأ حصل أثناء الإقلاع (قبل التنقل بين الشاشات) */
for (const e of events.splice(0, events.length)) {
  if (e.method === 'Runtime.exceptionThrown') {
    const d = e.params.exceptionDetails;
    console.log('BOOT EXCEPTION: ' + (d.exception?.description || d.text) +
      ' @ ' + (d.url || '?') + ':' + d.lineNumber);
  } else if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) {
    console.log('BOOT ' + e.params.type.toUpperCase() + ': ' + e.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  } else if (e.method === 'Log.entryAdded') {
    const en = e.params.entry;
    console.log('BOOT LOG-' + en.level + ': ' + en.text + (en.url ? ' @ ' + en.url + ':' + en.lineNumber : ''));
  } else if (e.method === 'Network.loadingFailed') {
    console.log('BOOT NET-FAIL: ' + e.params.errorText + ' ' + (e.params.requestId || ''));
  }
}
const bootInfo = await evaluate(`({
  readyState: document.readyState,
  views: Object.keys((window.Fin && window.Fin.Views) || {}),
  hasApp: !!(window.Fin && window.Fin.App),
  hasStore: !!(window.Fin && window.Fin.Store && window.Fin.Store.state),
  currentId: window.Fin && window.Fin.App && window.Fin.App.currentId && window.Fin.App.currentId(),
  navChildren: document.getElementById('nav').children.length
})`);
console.log('BOOT STATE: ' + JSON.stringify(bootInfo));

function drain() {
  const out = events.splice(0, events.length);
  const errs = [];
  for (const e of out) {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      errs.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text));
    } else if (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type)) {
      errs.push(e.params.type.toUpperCase() + ': ' + e.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level)) {
      errs.push('LOG-' + e.params.entry.level.toUpperCase() + ': ' + e.params.entry.text);
    }
  }
  return errs;
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

const VIEWS = ['dashboard', 'expenses', 'income', 'accounts', 'reports', 'agent', 'settings'];
let fails = 0;
const report = [];

for (const v of VIEWS) {
  events.length = 0;
  await evaluate(`location.hash = '#/${v}'`);
  await sleep(900);
  const info = await evaluate(`(() => {
    const el = document.getElementById('view');
    const nav = document.getElementById('nav');
    const txt = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    return {
      navItems: nav.querySelectorAll('.nav-item').length,
      navBadge: (document.getElementById('nav-badge') || {}).textContent || '',
      len: txt.length,
      sample: txt.slice(0, 260),
      cards: el.querySelectorAll('.card').length,
      stats: el.querySelectorAll('.stat').length,
      rows: el.querySelectorAll('.tx-row, .list-item, .charge-row').length,
      svgs: el.querySelectorAll('svg').length,
      quick: el.querySelectorAll('.quick-btn').length,
      titles: Array.from(el.querySelectorAll('.section-title')).map(n => n.textContent),
      theme: document.documentElement.getAttribute('data-theme')
    };
  })()`);
  const errs = drain();
  const ok = info.len > 120 && !errs.length;
  if (!ok) fails++;
  report.push({ view: v, ok, ...info, errs });
  console.log(`${ok ? '✓' : '✗'} ${v}: نص=${info.len} بطاقات=${info.cards} أرقام=${info.stats} صفوف=${info.rows} svg=${info.svgs} أزرار-سريعة=${info.quick} شريط=${info.navItems} شارة=${info.navBadge || '-'}`);
  if (info.titles.length) console.log('   الأقسام: ' + info.titles.join(' | '));
  if (info.sample) console.log('   بداية النص: ' + info.sample.slice(0, 200));
  errs.forEach(e => console.log('   ⚠ ' + e));
}

/* وضع نهاري + لقطات */
await evaluate(`document.documentElement.setAttribute('data-theme','light')`);
await sleep(200);
await evaluate(`location.hash = '#/reports'`);
await sleep(900);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('tests/_shot-reports.png', Buffer.from(shot.data, 'base64'));
await evaluate(`location.hash = '#/expenses'`);
await sleep(800);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('tests/_shot-expenses.png', Buffer.from(shot2.data, 'base64'));

/* ============ اختبار تفاعلي حقيقي: الضغطة الواحدة + التحصيل + التحويل ============ */

console.log('\n=== تفاعلي: «بضغطة زايد خضار» + تحصيل + تحويل للادخار ===');

async function waitFor(expr, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(`!!(${expr})`)) return true;
    await sleep(120);
  }
  return false;
}
async function clickByText(selector, needle) {
  return evaluate(`(() => {
    const n = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find(e => (e.textContent || '').includes(${JSON.stringify(needle)}));
    if (!n) return false;
    n.click();
    return true;
  })()`);
}
let fails2 = 0;
const t = (name, cond, extra) => { if (!cond) fails2++; console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

/* نبدأ بشاشة المصروفات من حالة بذرة نظيفة (حتمي بغضّ النظر عن أي بقايا) */
await evaluate(`(() => { window.Fin.Store.reset(); window.Fin.App.go('expenses', { force: true }); return true; })()`);
await sleep(900);

const before = await evaluate(`({ bal: window.Fin.Finance.cashBalance(window.Fin.Store.state), n: window.Fin.Store.state.transactions.length })`);

/* 1) الضغط على «خضار وفواكه» في شبكة الإضافة السريعة */
const clicked = await clickByText('.quick-btn', 'خضار');
t('زر «خضار وفواكه» موجود في .quick-grid', clicked);
const modalUp = await waitFor(`document.querySelector('.modal-overlay.is-open')`);
t('نافذة الإضافة السريعة انفتحت', modalUp);
const prefilled = await evaluate(`(() => { const i = document.querySelector('.modal input.input-money'); return i ? i.value : null; })()`);
t('المبلغ مقترح مسبقاً = 85', String(prefilled) === '85', 'القيمة: ' + prefilled);
const actions = await evaluate(`Array.from(document.querySelectorAll('.modal-actions .btn')).map(b => b.textContent).join('|')`);
t('زر واحد للحفظ («إضافة»)', /إضافة/.test(actions), actions);

/* 2) تنفيذ الإضافة بضغطة واحدة */
await clickByText('.modal-actions .btn', 'إضافة');
await sleep(800);
const after = await evaluate(`({ bal: window.Fin.Finance.cashBalance(window.Fin.Store.state), n: window.Fin.Store.state.transactions.length })`);
t('أُضيفت معاملة واحدة بالضغطة', after.n === before.n + 1, before.n + ' → ' + after.n);
t('خُصم 85 من رصيد النقد', Math.abs((before.bal - after.bal) - 85) < 0.001, before.bal + ' → ' + after.bal);
t('أُغلقت النافذة بعد الحفظ', await evaluate(`!document.querySelector('.modal-overlay')`));

/* 3) تحصيل استحقاق من شاشة الإيرادات */
await evaluate(`location.hash = '#/income'; window.Fin.App.go('income', { force: true })`);
await sleep(800);
const recBefore = await evaluate(`window.Fin.Finance.receivables(window.Fin.Store.state, window.Fin.U.todayISO()).total`);
t('زر «تحصيل» موجود في صف الاستحقاق', await clickByText('.charge-row .btn', 'تحصيل'));
await waitFor(`document.querySelector('.modal-overlay.is-open')`);
const collectDefault = await evaluate(`(() => { const i = document.querySelector('.modal input.input-money'); return i ? i.value : null; })()`);
t('المبلغ افتراضياً = المتبقي بالكامل', String(collectDefault) === '2,000', 'القيمة: ' + collectDefault);
await clickByText('.modal-actions .btn', 'تسجيل التحصيل');
await sleep(900);
const recAfter = await evaluate(`window.Fin.Finance.receivables(window.Fin.Store.state, window.Fin.U.todayISO()).total`);
t('المستحق نقص بمقدار التحصيل', Math.abs((recBefore - recAfter) - 2000) < 0.001, recBefore + ' → ' + recAfter);

/* 4) تحويل إلى الادخار من شاشة الحسابات */
await evaluate(`location.hash = '#/accounts'; window.Fin.App.go('accounts', { force: true })`);
await sleep(800);
const cashBeforeTransfer = await evaluate(`window.Fin.Finance.cashBalance(window.Fin.Store.state)`);
const savingBeforeTransfer = await evaluate(`window.Fin.Finance.savingsBalance(window.Fin.Store.state)`);
t('زر «حوّل إلى الادخار» موجود', await clickByText('.btn', 'حوّل إلى الادخار'));
await waitFor(`document.querySelector('.modal-overlay.is-open')`);
const setAmount = await evaluate(`(() => {
  const inp = document.querySelector('.modal input.input-money');
  if (!inp) return false;
  inp.value = '300';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
t('حقل المبلغ في نافذة التحويل متاح', setAmount);
await clickByText('.modal-actions .btn', 'حوّل');
await sleep(900);
const balances = await evaluate(`({ cash: window.Fin.Finance.cashBalance(window.Fin.Store.state), saving: window.Fin.Finance.savingsBalance(window.Fin.Store.state), total: window.Fin.Finance.totalBalance(window.Fin.Store.state) })`);
t('الادخار زاد 300', Math.abs(balances.saving - (savingBeforeTransfer + 300)) < 0.001, savingBeforeTransfer + ' → ' + balances.saving);
t('النقد نقص 300', Math.abs(balances.cash - (cashBeforeTransfer - 300)) < 0.001, cashBeforeTransfer + ' → ' + balances.cash);
t('إجمالي الثروة لم يتغيّر بالتحويل', Math.abs(balances.total - (cashBeforeTransfer + savingBeforeTransfer)) < 0.001, 'الإجمالي=' + balances.total);

if (fails2) fails += fails2;

/* ============ قياسات تخطيط على مقاسات جوال حقيقية (لا انزلاق أفقي) ============ */

console.log('\n=== التخطيط: لا انزلاق أفقي على مقاسات الجوال ===');
for (const width of [360, 390, 430]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
  for (const view of ['dashboard', 'expenses', 'income', 'accounts', 'reports']) {
    await evaluate(`location.hash = '#/${view}'`);
    await sleep(600);
    const m = await evaluate(`(() => {
      const doc = document.documentElement;
      const nav = document.getElementById('nav');
      return {
        docScroll: doc.scrollWidth,
        client: doc.clientWidth,
        navScroll: nav.scrollWidth,
        navClient: nav.clientWidth,
        navItems: nav.querySelectorAll('.nav-item').length,
        navMinItem: Math.min(...Array.from(nav.querySelectorAll('.nav-item')).map(n => Math.round(n.getBoundingClientRect().width))),
        cut: Array.from(document.querySelectorAll('#view .card-value, #view .stat-value, #view .section-title'))
          .filter(n => n.getBoundingClientRect().right > doc.clientWidth + 1 || n.getBoundingClientRect().left < -1).length
      };
    })()`);
    const good = m.docScroll <= m.client + 1 && m.navScroll <= m.navClient + 1 && m.cut === 0;
    if (!good) fails++;
    console.log(`${good ? '✓' : '✗'} ${width}px ${view}: doc=${m.docScroll}/${m.client} nav=${m.navScroll}/${m.navClient} عناصر=${m.navItems} أدنى-تبويب=${m.navMinItem}px مقصوص=${m.cut}`);
  }
}

/* --------------------------------------------------------------- النتيجة */

console.log('\n' + '─'.repeat(52));
console.log(fails === 0 ? 'PASS ✅ كل الشاشات رُسمت بلا أخطاء console + كل التفاعلات نجحت' : `FAIL ❌ ${fails} مشكلة`);

ws.close();
chrome.kill();
server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fails === 0 ? 0 : 1);
