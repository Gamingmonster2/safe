/* =============================================================================
 * مصروفي — tests/dom-smoke.mjs  (اختبار اللياد: رسم الشاشات بلا متصفح)
 * DOM مصغّر يكفي لمكوّنات ui.js، ثم يرسم كل شاشة ويتحقق من ظهور الأرقام الحقيقية.
 * التشغيل:  node tests/dom-smoke.mjs
 * ========================================================================== */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name + ' = ' + JSON.stringify(expected), actual === expected, 'الفعلي: ' + JSON.stringify(actual));
}

/* ------------------------------------------------------- DOM مصغّر */
class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); this._sync(); }
  _sync() { this.node._class = [...this.set].join(' '); }
}
class Node2 {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.childNodes = this.children;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this._text = '';
    this._listeners = {};
    this.classList = new ClassList(this);
    this._class = '';
    this.parentNode = null;
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.files = null;
    this.type = '';
    this.disabled = false;
  }
  get className() { return this._class; }
  set className(v) { this._class = String(v || ''); this.classList.set = new Set(this._class.split(/\s+/).filter(Boolean)); }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this.children.forEach((c) => (c.parentNode = null)); this.children.length = 0; this._text = String(v == null ? '' : v); }
  set innerHTML(v) { this._html = String(v || ''); this._text = String(v || '').replace(/<[^>]*>/g, ' '); }
  get innerHTML() { return this._html || ''; }
  appendChild(child) {
    if (!child) return child;
    if (child.__fragment) { child.children.slice().forEach((c) => this.appendChild(c)); child.children.length = 0; return child; }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    const i = this.children.indexOf(ref);
    child.parentNode = this;
    if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    return child;
  }
  removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; if (k === 'id') this.id = v; }
  getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return this.attributes[k] !== undefined; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
  dispatch(type, ev) { (this._listeners[type] || []).forEach((f) => f(Object.assign({ target: this, stopPropagation() {}, preventDefault() {} }, ev))); }
  click() { this.dispatch('click'); }
  focus() {}
  select() {}
  setSelectionRange() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const match = (n) => {
      const s = String(sel).trim();
      if (s.startsWith('.')) return n.classList.contains(s.slice(1));
      if (s.startsWith('#')) return n.id === s.slice(1);
      if (s.includes(',')) return s.split(',').some((part) => match2(n, part.trim()));
      return n.tagName === s.toUpperCase();
    };
    const match2 = (n, s) => (s.startsWith('.') ? n.classList.contains(s.slice(1)) : s.startsWith('#') ? n.id === s.slice(1) : n.tagName === s.toUpperCase());
    const walk = (n) => n.children.forEach((c) => { if (match(c)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  get outerHTML() { return this.innerHTML; }
}
class TextNode extends Node2 {
  constructor(t) { super('#text'); this._text = String(t); }
}
const documentStub = {
  readyState: 'complete',
  documentElement: new Node2('html'),
  body: new Node2('body'),
  head: new Node2('head'),
  createElement(tag) {
    const n = new Node2(tag);
    if (tag === 'input') n.tagName = 'INPUT';
    return n;
  },
  createElementNS(ns, tag) { return new Node2(tag); },
  createTextNode(t) { return new TextNode(t); },
  createDocumentFragment() { const f = new Node2('#fragment'); f.__fragment = true; return f; },
  getElementById(id) { return this.body.querySelector('#' + id) || this.documentElement.querySelector('#' + id); },
  querySelector(sel) { return this.body.querySelector(sel) || this.documentElement.querySelector(sel); },
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
  addEventListener() {},
  removeEventListener() {}
};
documentStub.documentElement.ownerDocument = documentStub;
documentStub.body.ownerDocument = documentStub;

const windowStub = {
  document: documentStub,
  location: { hash: '#/dashboard', protocol: 'http:', replace() {}, href: 'http://localhost/' },
  navigator: { userAgent: 'node', clipboard: null, serviceWorker: undefined },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  scrollTo() {},
  addEventListener() {},
  setTimeout,
  clearTimeout,
  Intl, Date, Math, JSON, console,
  localStorage: undefined
};
windowStub.window = windowStub;

const sandbox = {
  window: windowStub,
  document: documentStub,
  navigator: windowStub.navigator,
  location: windowStub.location,
  matchMedia: windowStub.matchMedia,
  requestAnimationFrame: windowStub.requestAnimationFrame,
  scrollTo: windowStub.scrollTo,
  setTimeout, clearTimeout, setInterval, clearInterval,
  console, Intl, Date, Math, JSON, Promise, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, parseFloat, parseInt,
  Node: Node2,
  Blob: class Blob { constructor(p) { this.parts = p; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: class { readAsText() {} },
  localStorage: undefined
};
sandbox.globalThis = sandbox;

/* ------------------------------------------------------- تحميل الملفات */
const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
const ctx = vm.createContext(sandbox);

console.log('\n=== 1) تحميل الوحدات في بيئة DOM مصغّرة ===');
const files = [
  'assets/js/constants.js', 'assets/js/util.js', 'assets/js/finance.js',
  'assets/js/store.js', 'assets/js/ui.js'
];
files.forEach((f) => { load(f); ok('حُمّل ' + f, true); });

const Fin = vm.runInContext('globalThis.Fin', ctx);
ok('Fin.C موجود', !!Fin.C);
ok('Fin.U موجود', !!Fin.U);
ok('Fin.Store موجود', !!Fin.Store);
ok('Fin.Finance موجود', !!Fin.Finance);
ok('Fin.UI موجود', !!Fin.UI);

console.log('\n=== 2) تحميل الشاشات + الوكيل + الراوتر ===');
// عناصر الهيكل التي يبحث عنها app.js عند الإقلاع
['view', 'nav', 'app-title', 'app-date', 'nav-badge', 'theme-toggle', 'quick-add-btn', 'nav-badge-btn', 'toasts'].forEach((id) => {
  const n = documentStub.createElement(id === 'view' ? 'main' : 'div');
  n.id = id;
  documentStub.body.appendChild(n);
});
const viewFiles = [
  'assets/js/views/dashboard.js', 'assets/js/views/expenses.js', 'assets/js/views/income.js',
  'assets/js/views/accounts.js', 'assets/js/views/reports.js', 'assets/js/views/domains.js',
  'assets/js/views/settings.js', 'assets/js/views/agent.js', 'assets/js/views/lock.js'
];
for (const f of viewFiles) {
  try { load(f); ok('حُمّل ' + f, true); }
  catch (e) { ok('حُمّل ' + f, false, String(e && e.message || e)); }
}
for (const f of ['assets/js/agent.js', 'assets/js/app.js']) {
  if (!fs.existsSync(path.join(ROOT, f))) { ok('موجود ' + f, false, 'الملف غير موجود بعد'); continue; }
  try { load(f); ok('حُمّل ' + f, true); }
  catch (e) { ok('حُمّل ' + f, false, String(e && e.message || e)); }
}

console.log('\n=== 3) الأرقام الحقيقية من البذرة ===');
const Store = Fin.Store, F = Fin.Finance, U = Fin.U, C = Fin.C;
// لا خزنة في هذه البيئة ⇒ نتحقق من المسار غير المشفّر (الوضع القديم)
let st = Store.load();
if (!st) { // احتياط: لو حُمّل vault.js وأُنشئت خزنة في بيئة الاختبار
  ok('الخزنة غير مقيّدة في بيئة الاختبار', false, 'Store.load() أعاد null');
  st = Store.reset();
}
const TODAY = '2026-10-05';
const day = F.daySummary(st, TODAY);
eq('دخل اليوم', day.income, 3400);
eq('مصروف اليوم', day.expense, 302);
eq('صافي اليوم', day.net, 3098);
eq('رصيد الشاشة', F.balanceOf(st, 'cash'), 8098);
eq('رصيد الادخار', F.balanceOf(st, 'saving'), 1500);
eq('إجمالي الحسابات', F.totalBalance(st), 9598);
eq('مستحق لي (غير محصَّل)', F.receivables(st, TODAY).total, 5500);
eq('لا ديون عليّ', F.obligations(st).total === 0 ? 0 : F.debts(st).total, 0);
eq('مصروفات مخطّطة', F.obligations(st).total, 1680);
eq('التزامات سنوية متبقية', F.commitments(st).remainingTotal, 5000);
eq('الأموال المجمّعة', F.accumulatedFunds(st).total, 8098);
eq('رصيد الصندوق قبل اليوم', F.accumulatedFunds(st).opening, 5000);
eq('التزامات قادمة (مخطّطة)', F.obligations(st).plannedTotal, 1680);
eq('إجمالي المصروفات المخطّطة', F.obligations(st).total, 1680);

console.log('\n=== 3ب) النطاقات (القائمة التي أدخلها المستخدم) ===');
const dom = F.domainStats(st, TODAY);
eq('عدد النطاقات', dom.total, 8);
eq('نطاقات تحتاج تجديداً فورياً', dom.criticalCount, 1);
eq('نطاقات تنتهي خلال 45 يوماً', dom.soonCount, 3);
eq('تكلفة التجديد القريبة', dom.renewNowCost, 225);
eq('التكلفة السنوية للنطاقات', dom.yearCost, 450);
eq('أقرب نطاق للانتهاء', dom.next.domain, 'toolseer.com');
eq('الأيام المتبقية لأقرب نطاق', dom.next.daysLeft, 7);
eq('حالة أقرب نطاق', dom.next.status, 'critical');
ok('تنبيه النطاقات العاجل موجود', F.domainAlerts(st, TODAY).some((a) => a.level === 'danger' && a.title.includes('7')));
const htmlDom = dom.list.filter((x) => x.domain === 'html.com.ly')[0];
eq('html.com.ly في نطاق «قريب»', htmlDom.status, 'soon');
eq('سعر .com.ly', htmlDom.price, 15);

console.log('\n=== 4) رسم كل شاشة داخل DOM مصغّر ===');
const App = Fin.App;
if (App) {
  App.container = documentStub.getElementById('view');
  App.navEl = documentStub.getElementById('nav');
  App.headerEl = documentStub.getElementById('app-title');
}
const ctxObj = { state: st, asOf: TODAY, today: TODAY, refresh() {}, go() {}, store: Store, finance: F };

const expected = {
  dashboard: ['3,098', '8,098', '5,500', '302', 'toolseer.com'],
  expenses: ['302'],
  income: ['5,500', '3,400'],
  accounts: ['8,098', '1,500', '1,680'],
  reports: ['3,400'],
  domains: ['toolseer.com', '450', 'html.com.ly'],
  settings: ['مصروفي'],
  agent: []
};

for (const [id, needles] of Object.entries(expected)) {
  const view = Fin.Views[id];
  if (!view) { ok('شاشة ' + id + ' مسجّلة', false, 'Fin.Views.' + id + ' غير موجود'); continue; }
  ok('شاشة ' + id + ' مسجّلة', typeof view.render === 'function');
  const host = documentStub.createElement('div');
  try {
    view.render(host, ctxObj);
    ok('رسم ' + id + ' بلا استثناء', true);
    const text = host.textContent;
    ok('محتوى ' + id + ' غير فارغ', text.trim().length > 30, 'طول النص: ' + text.trim().length);
    needles.forEach((n) => ok('  ' + id + ' يعرض «' + n + '»', text.includes(n), 'غير موجود في النص'));
  } catch (e) {
    ok('رسم ' + id + ' بلا استثناء', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
}

console.log('\n=== 5) الدوال المساعدة في UI لا ترمي استثناء ===');
try {
  Fin.UI.sparkline([1, 5, 3, 8], {});
  Fin.UI.bars([{ label: 'أكتوبر', income: 3400, expense: 302 }], {});
  Fin.UI.donut([{ label: 'خضار', amount: 85, color: '#0f0' }], { centerValue: '85', centerLabel: 'خضار' });
  Fin.UI.legend([{ label: 'خضار', amount: 85 }]);
  Fin.UI.progress(50);
  Fin.UI.badge('تم', 'success');
  Fin.UI.kv('مفتاح', 'قيمة');
  Fin.UI.emptyState('📭', 'فراغ');
  Fin.UI.txRow(st.transactions[0], {});
  ok('مكوّنات UI والرسوم تعمل', true);
} catch (e) {
  ok('مكوّنات UI والرسوم تعمل', false, String(e && e.message || e));
}

console.log('\n=== 6) الوكيل المحلي (إن وُجد) ===');
const Agent = Fin.Agent;
if (!Agent) {
  ok('unit agent.js موجود', false, 'الملف غير موجود بعد');
} else {
  ok('Fin.Agent.mount دالة', typeof Agent.mount === 'function');
  ok('Fin.Agent.ask دالة', typeof Agent.ask === 'function');
  ok('Fin.Agent.localAnswer دالة', typeof Agent.localAnswer === 'function');
  const questions = [
    ['كم صرفت اليوم؟', '302'],
    ['كم رصيدي؟', '9,598'],
    ['ما الذي لم أحصّله؟', '5,500'],
    ['كم دخل اليوم؟', '3,400']
  ];
  questions.forEach(([q, needle]) => {
    try {
      // اليوم المرجعي ثابت (2026-10-05) حتى لا يتأثر الاختبار بساعة الجهاز
      const a = String(Agent.localAnswer(q, st, TODAY) || '');
      ok('سؤال «' + q + '» يذكر ' + needle, a.includes(needle), 'الجواب: ' + a.slice(0, 120).replace(/\n/g, ' '));
    } catch (e) {
      ok('سؤال «' + q + '»', false, String(e && e.message || e));
    }
  });
}

console.log('\n=== 7) الراوتر يتبنّى Fin.Views تلقائياً (بلا تسجيل يدوي) ===');
if (App && App.adoptViews) {
  const before = App.list().length;
  const adopted = App.adoptViews(); // يجب أن تكون idempotent: صفر جديد لأن init تبنّاها
  const list = App.list().map((v) => v.id);
  ok('الراوتر تبنّى ' + before + ' شاشة تلقائياً عند الإقلاع (وإعادة الاستدعاء أضافت ' + adopted + ')', before >= 6 && adopted === 0, 'قبل: ' + before + ' إضافة: ' + adopted);
  const navIds = App.list().map((v) => v.id);
  ok('الشاشات في الراوتر: ' + navIds.join(' ← '), navIds.length >= 6, 'عدد: ' + navIds.length);
  // الترتيب التصاعدي يُفحص على الشاشات الظاهرة فقط (شاشة الدخول مخفيّة order 0)
  const visibleOrders = App.list().filter((v) => !v.hidden).map((v) => v.order);
  ok('ترتيب الشاشات الظاهرة تصاعدي', visibleOrders.every((o, i) => i === 0 || visibleOrders[i - 1] <= o), JSON.stringify(visibleOrders));
  // شاشة الدخول مخفيّة (order 0) فلا تُحسب تبويباً
  const tabs = App.tabIds();
  ok('لوحة اليوم أولاً في التبويبات', tabs[0] === 'dashboard', 'الأول: ' + tabs[0]);
  const missing = C.NAV.map((n) => n.id).filter((id) => !navIds.includes(id));
  ok('كل تبويبات C.NAV لها شاشة' + (missing.length ? ' — الناقص: ' + missing.join(', ') : ''), missing.length === 0);
  ok('تبويبات الشريط السفلي = C.NAV_ORDER', JSON.stringify(tabs) === JSON.stringify(C.NAV_ORDER), JSON.stringify(tabs));
  ok('المساعد ليس تبويباً لكنه متاح', tabs.indexOf('agent') < 0 && !!Fin.Views.agent);
  ok('شاشة الدخول مسجّلة ومخفيّة عن التبويبات', !!Fin.Views.lock && Fin.Views.lock.hidden === true && tabs.indexOf('lock') < 0);
}

console.log('\n=== 8) ثبات الأرقام بعد عملية تحصيل (اختبار حقيقي على الحالة) ===');
try {
  const before = F.totalBalance(st);
  const rec = F.receivables(st, TODAY);
  const shop = rec.items.filter((i) => i.templateId === 't-shop-rent')[0];
  ok('استحقاق المحل موجود', !!shop);
  const r1 = Store.recordReceipt(shop.chargeId, 1500, { date: TODAY });
  eq('بعد تحصيل المحل: الرصيد', F.totalBalance(st), before + 1500);
  eq('بعد تحصيل المحل: المستحق', F.receivables(st, TODAY).total, 4000);
  const studio = F.receivables(st, TODAY).items.filter((i) => i.templateId === 't-studio-rent')[0];
  Store.recordReceipt(studio.chargeId, 500, { date: TODAY });
  eq('بعد تحصيل جزئي 500 من الاستوديو: المستحق', F.receivables(st, TODAY).total, 3500);
  eq('حالة الاستوديو جزئي', F.receivables(st, TODAY).items.filter((i) => i.templateId === 't-studio-rent')[0].status, 'partial');
  eq('بعد التحصيلين: النقد', F.balanceOf(st, 'cash'), 8098 + 2000);
  // دورة تصدير/استيراد
  const json = Store.exportJSON();
  const balanceNow = F.totalBalance(st);
  const txsNow = st.transactions.length;
  const res = Store.importJSON(json);
  ok('استيراد النسخة نجح', res.ok === true, res.error || '');
  ok('الرصيد ثابت بعد export→import', F.totalBalance(Store.state), balanceNow);
  eq('عدد الحركات ثابت بعد export→import', Store.state.transactions.length, txsNow);
  st = Store.state; // الاستيراد يستبدل كائن الحالة — نُحدّث المرجع للاختبارات التالية
} catch (e) {
  ok('عمليات التحصيل والنسخ', false, String(e && e.message || e));
}

console.log('\n=== 9) تجديد نطاق يسجّل المصروف ويمدّد التاريخ ===');
try {
  const before = F.totalBalance(st);
  const target = F.domainStats(st, TODAY).list.filter((d) => d.domain === 'toolseer.com')[0];
  const res = Store.renewDomain(target.id, { years: 1, amount: 180, date: TODAY });
  ok('تجديد النطاق نجح', res.ok === true, res.error || '');
  eq('التاريخ الجديد بعد سنة', res.expiry, '2027-10-12');
  eq('الرصيد نقص 180', F.totalBalance(st), before - 180);
  eq('حالة النطاق صارت بعيدة', F.domainStats(st, TODAY).list.filter((d) => d.domain === 'toolseer.com')[0].status, 'ok');
  eq('مصروف النطاقات المسجّل', F.domainSpend(st, '2026-01-01', '2026-12-31').total, 180);
  ok('عدد النطاقات لم يتغيّر', F.domainStats(st, TODAY).total === 8);
} catch (e) {
  ok('تجديد النطاق', false, String(e && e.message || e));
}

console.log('\n────────────────────────────────────────');
console.log(`PASS ${pass} / FAIL ${fail}`);
if (failures.length) {
  console.log('\nالإخفاقات:');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exitCode = fail ? 1 : 0;
