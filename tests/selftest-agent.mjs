/* =============================================================================
 * tests/_agent.selftest.mjs  —  [agent] اختبار ذاتي لـ assets/js/agent.js
 *
 * يشغّل الوحدات الأساسية (constants/util/finance/store/ui/agent) في node عبر
 * new Function (بلا import/export) مع DOM مصغّر محلي، ثم يتحقق من:
 *   1) الأرقام المرجعية للبذرة (302 / 3,098 / 8,098 / 5,500 / 120)
 *   2) الأدوات الاثنتي عشرة Tool calling على الحالة الحقيقية
 *   3) المحرّك المحلي (localAnswer) لأسئلة عربية/ليبية حقيقية
 *   4) الملخصات summarize() والصوت speak()/listen()
 *   5) عميل DeepSeek بأخطاء 401/402/429/شبكة/مهلة + دورة tool_calls كاملة
 *   6) واجهة mount() في DOM مصغّر (وبلا innerHTML)
 *
 * التشغيل:  node tests/_agent.selftest.mjs
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');

/* ==========================================================================
 * DOM مصغّر — يكفي U.el / U.clear / classList / addEventListener
 * ======================================================================== */

class DomNode {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.parentNode = null;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.disabled = false;
    this.value = '';
    this._listeners = {};
    this._classList = {
      add: (c) => { const s = cls(this); s.add(c); this.className = [...s].join(' '); },
      remove: (c) => { const s = cls(this); s.delete(c); this.className = [...s].join(' '); },
      contains: (c) => cls(this).has(c),
      toggle: (c) => { const s = cls(this); if (s.has(c)) { s.delete(c); } else { s.add(c); } this.className = [...s].join(' '); }
    };
  }
  get classList() { return this._classList; }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(child) {
    if (!(child instanceof DomNode)) throw new Error('appendChild: ليست عقدة DOM');
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    if (!this.childNodes.length && this.nodeType === 1) this.textContent = '';
    return child;
  }
  insertBefore(child, ref) {
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) return this.appendChild(child);
    child.parentNode = this;
    this.childNodes.splice(i, 0, child);
    return child;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatch(type, ev) { (this._listeners[type] || []).slice().forEach((fn) => fn(ev || { type: type, preventDefault() {} })); }
  querySelector(sel) { return findFirst(this, sel); }
  querySelectorAll(sel) { return findAll(this, sel); }
  focus() { this.focused = true; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  // نمط الفحص: agent.js ممنوع يستخدم innerHTML (نرحّب ببناء العناصر بـ createElement)
  set innerHTML(v) { throw new Error('agent.js استخدم innerHTML — ممنوع (' + String(v).slice(0, 40) + ')'); }
  get innerHTML() { return ''; }
}
function cls(node) {
  return new Set(String(node.className || '').split(/\s+/).filter(Boolean));
}
function matches(node, sel) {
  const s = String(sel || '').trim();
  if (!s || node.nodeType !== 1) return false;
  const parts = s.split(/(?=[.#])|(?<=\])(?=[.#])/);
  return parts.every((p) => {
    if (p.startsWith('.')) return cls(node).has(p.slice(1));
    if (p.startsWith('#')) return node.attributes.id === p.slice(1);
    return node.tagName === p.toUpperCase();
  });
}
function findFirst(rootNode, sel) {
  for (const sel0 of String(sel).split(',')) {
    const stack = [rootNode];
    while (stack.length) {
      const n = stack.shift();
      for (const c of n.childNodes) {
        if (matches(c, sel0)) return c;
        stack.push(c);
      }
    }
  }
  return null;
}
function findAll(rootNode, sel) {
  const out = [];
  const stack = [rootNode];
  while (stack.length) {
    const n = stack.shift();
    for (const c of n.childNodes) {
      if (matches(c, sel)) out.push(c);
      stack.push(c);
    }
  }
  return out;
}
function byClass(rootNode, name) { return findAll(rootNode, '.' + name)[0] || null; }
function textOf(node) {
  if (!node) return '';
  return String(node.textContent || '') + node.childNodes.map(textOf).join('');
}

globalThis.Node = DomNode;
globalThis.window = globalThis;
globalThis.document = {
  readyState: 'complete',
  body: new DomNode('body'),
  documentElement: new DomNode('html'),
  createElement: (t) => new DomNode(t),
  createElementNS: (ns, t) => new DomNode(t),
  createTextNode: (t) => { const n = new DomNode('#text'); n.nodeType = 3; n.textContent = String(t); return n; },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

/* ==========================================================================
 * تحميل الوحدات (بترتيب index.html) + عدّاد النتائج
 * ======================================================================== */

function loadModule(file) {
  const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(code).call(globalThis);
}
for (const f of ['constants.js', 'icons.js', 'util.js', 'finance.js', 'store.js', 'ui.js', 'agent.js']) loadModule(f);

const Fin = globalThis.Fin;
const Store = Fin.Store, F = Fin.Finance, U = Fin.U, C = Fin.C, Agent = Fin.Agent;
const state = Store.load();
const TODAY = C.TODAY;

// نثبّت اليوم المرجعي للمحرّك المحلي على تاريخ البذرة حتى لا تتأثر الاختبارات بساعة الجهاز
if (typeof Agent.setReferenceDate === 'function') Agent.setReferenceDate(TODAY);

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else {
    failures.push(name + (extra ? ' — ' + extra : ''));
    console.log('  ❌ ' + name + (extra ? ' — ' + extra : ''));
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'المتوقع ' + JSON.stringify(expected) + ' والفعلي ' + JSON.stringify(actual));
}
function has(name, text, needle) {
  check(name, String(text).indexOf(needle) >= 0, '«' + needle + '» غير موجود في: ' + String(text).slice(0, 110).replace(/\n/g, ' | '));
}
function lacks(name, text, needle) {
  check(name, String(text).indexOf(needle) < 0, '«' + needle + '» موجود ولا يجب: ' + String(text).slice(0, 110).replace(/\n/g, ' | '));
}
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length))); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ==========================================================================
 * 0) عقد الواجهة Fin.Agent (ARCHITECTURE.md §4)
 * ======================================================================== */

section('0) عقد الواجهة Fin.Agent');

const API_SHAPE = {
  mount: 'function', ask: 'function', localAnswer: 'function', summarize: 'function',
  speak: 'function', listen: 'function', tools: 'object', isEnabled: 'function', hasVoice: 'function'
};
Object.keys(API_SHAPE).forEach((k) => check('Fin.Agent.' + k + ' → ' + API_SHAPE[k], typeof Agent[k] === API_SHAPE[k]));
check('isEnabled() ترجع boolean', typeof Agent.isEnabled() === 'boolean');
check('hasVoice() ترجع boolean', typeof Agent.hasVoice() === 'boolean');
check('listen() ترجع null بلا دعم (وليست undefined)', Agent.listen({}) === null);
check('ask() ترجع Promise', typeof Agent.ask('').then === 'function');
check('أدوات الوكيل كلها {desc,args,run}', Object.keys(Agent.tools).every((n) => {
  const t = Agent.tools[n];
  return t && typeof t.desc === 'string' && t.args && typeof t.args === 'object' && typeof t.run === 'function';
}));

/* ==========================================================================
 * 1) الأرقام المرجعية للبذرة
 * ======================================================================== */

section('1) أرقام البذرة المرجعية');

const day = F.daySummary(state, TODAY);
eq('دخل اليوم = 3,400', day.income, 3400);
eq('مصروف اليوم = 302', day.expense, 302);
eq('صافي اليوم = +3,098', day.net, 3098);
eq('رصيد الشنطة = 8,098', F.balanceOf(state, 'cash'), 8098);
eq('رصيد الادخار = 1,500', F.balanceOf(state, 'saving'), 1500);
eq('إجمالي الرصيد = 9,598', F.totalBalance(state), 9598);

const topToday = F.topExpenses(state, TODAY, TODAY, 1)[0];
check('أكبر بند مصروف اليوم = «أنبوب حديدي…» 120',
  !!topToday && topToday.amount === 120 && String(topToday.label).indexOf('أنبوب حديدي') === 0,
  topToday ? topToday.amount + ' / ' + topToday.label : 'لا يوجد');

const rec = F.receivables(state, TODAY);
eq('غير المحصَّل (المستحق لي) = 5,500', rec.total, 5500);
eq('عدد الاستحقاقات غير المحصَّلة = 3', rec.count, 3);
eq('المتأخر منها = 3,500', rec.overdueTotal, 3500);
const recByLoc = {};
rec.items.forEach((i) => { recByLoc[i.locationId] = i; });
eq('مستحق المحل = 1,500', recByLoc.shop && recByLoc.shop.remaining, 1500);
eq('مستحق الاستوديو (2026-Q4) = 2,000', recByLoc.studio && recByLoc.studio.remaining, 2000);
eq('مستحق حجرات العمال = 2,000', recByLoc.rooms && recByLoc.rooms.remaining, 2000);
eq('المحل متأخر 4 أيام', recByLoc.shop && recByLoc.shop.daysLate, 4);
eq('الاستوديو متأخر 4 أيام', recByLoc.studio && recByLoc.studio.daysLate, 4);
eq('الحجرات غير متأخرة (يوم 5 أكتوبر)', recByLoc.rooms && recByLoc.rooms.daysLate, 0);
check('الورشتان محصَّلتان اليوم (1,900 + 1,500 = 3,400)',
  F.chargePaid(state, 'c-2026-10-ws-paint') === 1900 && F.chargePaid(state, 'c-2026-10-ws-mech') === 1500,
  'paint=' + F.chargePaid(state, 'c-2026-10-ws-paint') + ' mech=' + F.chargePaid(state, 'c-2026-10-ws-mech'));
eq('لا ديون عليّ = 0', F.debts(state).total, 0);
eq('مصروفات مخطّطة = 1,680', U.round(F.obligations(state).total, 2), 1680);
eq('التزامات سنوية متبقية = 5,000', F.commitments(state).remainingTotal, 5000);

/* ==========================================================================
 * 2) الأدوات (Tool calling)
 * ======================================================================== */

section('2) الأدوات — Fin.Agent.tools');

const TOOL_NAMES = ['get_summary', 'get_expenses', 'get_income', 'get_receivables', 'get_balance',
  'get_debts', 'get_forecast', 'get_alerts', 'list_transactions', 'compare_periods', 'get_charges', 'get_savings'];
eq('عدد الأدوات = 12', Object.keys(Agent.tools).length, 12);
TOOL_NAMES.forEach((n) => {
  const t = Agent.tools[n];
  check('أداة ' + n + ' موجودة بالشكل {desc,args,run}',
    !!t && typeof t.desc === 'string' && t.desc.length > 5 && typeof t.args === 'object' && typeof t.run === 'function');
});

const bal = Agent.tools.get_balance.run(state, {});
eq('get_balance → total 9,598', bal.total, 9598);
eq('get_balance → cash 8,098', bal.cash, 8098);
eq('get_balance → saving 1,500', bal.saving, 1500);
check('get_balance → حسابات مسماة', Array.isArray(bal.accounts) && bal.accounts.length === 2 && !!bal.accounts[0].name);

const sumToday = Agent.tools.get_summary.run(state, { from: TODAY, to: TODAY });
eq('get_summary(today) → income 3,400', sumToday.income, 3400);
eq('get_summary(today) → expense 302', sumToday.expense, 302);
eq('get_summary(today) → net 3,098', sumToday.net, 3098);
check('get_summary → أكبر بند', Array.isArray(sumToday.topExpenses) && sumToday.topExpenses[0].amount === 120);

const exp = Agent.tools.get_expenses.run(state, { from: TODAY, to: TODAY });
eq('get_expenses(today) → total 302', exp.total, 302);
eq('get_expenses(today) → أكبر مصروف 120', exp.top[0].amount, 120);
has('get_expenses → وصف البند', exp.top[0].label, 'أنبوب حديدي');

const inc = Agent.tools.get_income.run(state, { from: TODAY, to: TODAY });
eq('get_income(today) → total 3,400', inc.total, 3400);
check('get_income → حسب المكان (ورشتان)', inc.byLocation.length === 2);

const recTool = Agent.tools.get_receivables.run(state, {});
eq('get_receivables → total 5,500', recTool.total, 5500);
eq('get_receivables → متأخر 3,500', recTool.overdueTotal, 3500);

const debtsTool = Agent.tools.get_debts.run(state, {});
eq('get_debts → لا ديون (0)', debtsTool.debtsTotal, 0);
eq('get_debts → hasDebts = false', debtsTool.hasDebts, false);
eq('get_debts → المصروفات المخطّطة 1,680', debtsTool.plannedTotal, 1680);
eq('get_debts → التزامات سنوية متبقية 5,000', debtsTool.annualRemainingTotal, 5000);
eq('get_debts → بعد دفع المخطّط', debtsTool.afterPayingAll, 7918);

const fc = Agent.tools.get_forecast.run(state, { days: 30 });
check('get_forecast → رصيد افتتاحي 9,598 + متوقع > 0', fc.openingBalance === 9598 && fc.totalExpected > 0);
check('get_forecast → رصيد ختامي أكبر', fc.closingBalance > fc.openingBalance);

const alerts = Agent.tools.get_alerts.run(state, {});
check('get_alerts → مصفوفة تنبيهات', Array.isArray(alerts.alerts) && alerts.alerts.length >= 2);

const txTool = Agent.tools.list_transactions.run(state, { from: TODAY, to: TODAY });
eq('list_transactions(today) → 7 حركات مدفوعة (2 دخل + 5 مصروف)', txTool.count, 7);

const cmp = Agent.tools.compare_periods.run(state, {});
eq('compare_periods → الفترة أ (هذا الشهر) 3,400', cmp.a.income, 3400);
check('compare_periods → فرق محسوب', typeof cmp.delta.net === 'number');

const chTool = Agent.tools.get_charges.run(state, {});
eq('get_charges → 5 استحقاقات', chTool.count, 5);
eq('get_charges → متبقي 5,500', chTool.totalRemaining, 5500);
eq('get_charges → محصَّل 3,400', chTool.totalPaid, 3400);

const sav = Agent.tools.get_savings.run(state, {});
eq('get_savings → رصيد الادخار 1,500', sav.savingBalance, 1500);
eq('get_savings → دخل الشهر 3,400', sav.income, 3400);

check('كل الأدوات تُرجع JSON صالح', TOOL_NAMES.every((n) => {
  try { JSON.parse(JSON.stringify(Agent.tools[n].run(state, {}))); return true; } catch (e) { return false; }
}));
check('runTool تتعامل مع أداة مجهولة بلطف', !!Agent.runTool('nope', {}, state).error);

const schemas = Agent.toolSchemas();
eq('مواصفات الأدوات للنموذج = 12', schemas.length, 12);
check('كل مواصفة type:function',
  schemas.every((s) => s.type === 'function' && s.function && typeof s.function.name === 'string' && s.function.parameters.type === 'object'));

/* ==========================================================================
 * 3) المحرّك المحلي
 * ======================================================================== */

section('3) المحرّك المحلي — localAnswer');

const CASES = [
  { q: 'كم صرفت اليوم؟', must: ['302'], label: 'صرف اليوم' },
  { q: 'شحال صرفت اليوم؟', must: ['302'], label: 'لهجة: شحال' },
  { q: 'كم صرفت أمس؟', must: ['0 د.ل', 'أمس'], label: 'صرف أمس (صفر)' },
  { q: 'كم صرفت هذا الأسبوع؟', must: ['302'], label: 'صرف الأسبوع' },
  { q: 'كم صرفت هذا الشهر؟', must: ['302'], label: 'صرف الشهر' },
  { q: 'كم دخل اليوم؟', must: ['3,400'], label: 'دخل اليوم' },
  { q: 'كم دخلت هذا الشهر؟', must: ['3,400'], label: 'دخل الشهر' },
  { q: 'كم عندي؟', must: ['9,598', '8,098'], label: 'كم عندي' },
  { q: 'رصيدي كم؟', must: ['9,598'], label: 'رصيدي' },
  { q: 'هل يكفي رصيدي؟', must: ['9,598', 'شهر'], label: 'هل يكفي رصيدي' },
  { q: 'ما الذي لم أحصّله؟', must: ['5,500', '3,500', 'المحل', 'الاستوديو', 'حجرات العمال'], label: 'غير المحصَّل' },
  { q: 'وين راحت الفلوس؟', must: ['302', '120'], label: 'وين راحت الفلوس' },
  { q: 'أكبر مصروف اليوم؟', must: ['120'], label: 'أكبر مصروف' },
  { q: 'كم مدخراتي؟', must: ['1,500'], label: 'المدخرات' },
  { q: 'كم الاستحقاقات؟', must: ['5,500', 'محصَّل'], label: 'الاستحقاقات' },
  { q: 'عندي ديون؟', must: ['لا ديون'], mustNot: ['5,180', '6,680'], label: 'الديون (لا ديون)' },
  { q: 'ما هي مصروفاتي المخطّطة؟', must: ['1,680'], label: 'المصروفات المخطّطة' },
  { q: 'قارن هذا الشهر بالماضي', must: ['3,400'], label: 'المقارنة' },
  { q: 'توقع الشهر الجاي', must: ['المتوقع', '9,598'], label: 'التوقع' },
  { q: 'كم صرفت على ورشة السمكرة؟', must: ['1,900'], label: 'فلترة المكان: السمكرة' },
  { q: 'شحال في الاستوديو؟', must: ['2,000'], label: 'فلترة المكان: الاستوديو' },
  { q: 'كم صرفت على المحل؟', must: ['1,500'], label: 'فلترة المكان: المحل' },
  { q: 'ملخص هذا الشهر', must: ['3,400', '302'], label: 'طلب ملخص' },
  { q: 'سلام عليكم', must: ['أهلاً', '9,598'], label: 'ترحيب' },
  { q: 'أعطيني نصيحة مالية', must: ['مفتاح', 'دخل'], label: 'نصيحة بلا مفتاح' },
  { q: 'زيبرا كلام غير مفهوم تماماً', must: ['9,598'], label: 'سؤال غير مفهوم → صدق بلا اختلاق' }
];

CASES.forEach((c) => {
  let ans;
  try { ans = Agent.localAnswer(c.q, state); } catch (e) { ans = 'THREW: ' + e.message; }
  check('سؤال «' + c.label + '» لا يرمي خطأ', typeof ans === 'string' && ans.indexOf('THREW') !== 0, String(ans).slice(0, 90));
  c.must.forEach((m) => has('«' + c.label + '» يذكر ' + m, ans, m));
  (c.mustNot || []).forEach((m) => lacks('«' + c.label + '» لا يذكر ' + m, ans, m));
  ['undefined', 'NaN', '[object Object]'].forEach((bad) => lacks('«' + c.label + '» بلا ' + bad, ans, bad));
  check('«' + c.label + '» إجابة موجزة (1–14 سطراً)', ans.split('\n').length >= 1 && ans.split('\n').length <= 14, ans.split('\n').length + ' سطر');
});

const recAns = Agent.localAnswer('ما الذي لم أحصّله؟', state);
has('جواب المستحق يذكر 5,500 تحديداً', recAns, '5,500');
lacks('جواب المستحق لا يذكر 6,400', recAns, '6,400');
lacks('جواب المستحق لا يذكر 7,400', recAns, '7,400');

/* ==========================================================================
 * 4) الملخصات
 * ======================================================================== */

section('4) الملخصات — summarize()');

const sToday = Agent.summarize('today');
has('summarize(today) → 3,400', sToday, '3,400');
has('summarize(today) → 302', sToday, '302');
has('summarize(today) → 3,098', sToday, '3,098');
const sMonth = Agent.summarize('2026-10');
has('summarize(2026-10) → 3,400', sMonth, '3,400');
has('summarize(2026-10) → الرصيد', sMonth, 'الرصيد');
const sQ = Agent.summarize('2026-Q4');
has('summarize(2026-Q4) → الربع', sQ, 'الربع');
has('summarize(2026-Q4) → 3,400', sQ, '3,400');
const sAll = Agent.summarize('all');
has('summarize(all) → 3,400', sAll, '3,400');
const sDef = Agent.summarize();
has('summarize() الافتراضي → ملخص شهر', sDef, 'ملخص');
['undefined', 'NaN'].forEach((bad) => lacks('summarize بلا ' + bad, sToday + sMonth + sQ + sAll, bad));

/* ==========================================================================
 * 5) الصوت
 * ======================================================================== */

section('5) الصوت — speak() / listen()');

check('hasVoice() = false بلا دعم المتصفح', Agent.hasVoice() === false);
let endInfo = null;
check('listen() ترجع null عند عدم الدعم', Agent.listen({ onEnd: (i) => { endInfo = i; } }) === null);
check('listen() تنادي onEnd بسبب unsupported', !!endInfo && endInfo.error === 'unsupported');
eq('speak() ترجع false بلا دعم', Agent.speak('مرحبا'), false);

const spoken = [];
globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; };
globalThis.speechSynthesis = {
  speak(u) { spoken.push(u); },
  cancel() {},
  getVoices() { return [{ lang: 'ar-LY', name: 'Arabic Test' }, { lang: 'en-US', name: 'English' }]; }
};
check('hasVoice() = true بعد توفّر speechSynthesis', Agent.hasVoice() === true);
eq('speak() ترجع true', Agent.speak('رصيدك 💵 9,598 د.ل\nسطر ثاني'), true);
check('speak() تنطق بالعربية ar-LY', spoken.length === 1 && spoken[0].lang === 'ar-LY');
check('speak() اختارت صوتاً عربياً', !!(spoken[0] && spoken[0].voice && spoken[0].voice.lang === 'ar-LY'));
lacks('speak() بلا إيموجي', spoken[0].text, '💵');
lacks('speak() بلا أسطر جديدة', spoken[0].text, '\n');
has('speak() تحفظ الأرقام', spoken[0].text, '9,598');

let srInstance = null, srResult = null, srEnd = null;
globalThis.SpeechRecognition = function () {
  srInstance = this;
  this.lang = ''; this.continuous = null; this.interimResults = null; this.maxAlternatives = null;
  this.start = () => {
    setTimeout(() => {
      this.onresult({ results: [[{ transcript: 'كم صرفت اليوم' }]] });
      this.onend();
    }, 5);
  };
  this.stop = () => {};
  this.abort = () => {};
};
const handle = Agent.listen({
  onResult: (t) => { srResult = t; },
  onEnd: (i) => { srEnd = i; }
});
check('listen() ترجع كائن فيه stop()', !!handle && typeof handle.stop === 'function');
eq('listen() تضبط ar-LY', srInstance && srInstance.lang, 'ar-LY');
await sleep(30);
eq('listen() تستقبل النص', srResult, 'كم صرفت اليوم');
check('listen() تنادي onEnd بنجاح', !!srEnd && srEnd.ok === true);

/* ==========================================================================
 * 6) عميل DeepSeek (fetch مزيّف — بلا شبكة حقيقية)
 * ======================================================================== */

section('6) عميل DeepSeek — الأدوات والأخطاء والمهلة');

const KEY = 'sk-selftest-DO-NOT-LEAK-1234567890';
const realFetch = globalThis.fetch;
const realWarn = console.warn;
const warns = [];
console.warn = (...a) => { warns.push(a.map((x) => String(x)).join(' ')); };
const jsonRes = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj) });
const httpBody = (status, message) => jsonRes({ error: { message: message, type: 'test_error' } }, status);

Store.updateSettings({ agent: { apiKey: KEY, model: 'deepseek-chat' } });
check('isEnabled() = true بعد حفظ المفتاح (في الذاكرة فقط)', Agent.isEnabled() === true);
eq('model() = deepseek-chat', Agent.model(), 'deepseek-chat');

// 401 — مفتاح خاطئ
globalThis.fetch = async () => httpBody(401, 'Authentication Fails, Your api key is invalid: ' + KEY);
let a401 = await Agent.ask('كم عندي؟');
has('401 → رسالة عربية واضحة', a401, '401');
has('401 → يرجع للمحرّك المحلي', a401, 'من المحرّك المحلي');
has('401 → أرقام حقيقية في البديل المحلي', a401, '9,598');
lacks('401 → لا يسرّب المفتاح', a401, 'sk-selftest');

// 402 — نفاد الرصيد
globalThis.fetch = async () => httpBody(402, 'Insufficient Balance');
const r402 = await Agent.apiCall([{ role: 'user', content: 'x' }], {}).then(() => 'OK', (e) => e.message);
has('402 → رسالة نفاد رصيد', r402, '402');
lacks('402 → لا يسرّب المفتاح', r402, 'sk-selftest');

// 429 — تجاوز الحد
globalThis.fetch = async () => httpBody(429, 'Rate limit reached');
const r429 = await Agent.apiCall([{ role: 'user', content: 'x' }], {}).then(() => 'OK', (e) => e.message);
has('429 → رسالة تجاوز الحد', r429, '429');

// اختبار المفتاح: العقد الذي تتوقعه شاشة الإعدادات {ok, error, message, model}
let lastBody = null;
globalThis.fetch = async (url, init) => {
  lastBody = JSON.parse(init.body);
  return jsonRes({ choices: [{ message: { role: 'assistant', content: 'جاهز' } }] });
};
const tkOK = await Agent.testKey('sk-typed-NOT-SAVED-xyz', 'deepseek-reasoner');
check('testKey(مفتاح,نموذج) → {ok:true, error:null}', tkOK.ok === true && tkOK.error === null);
has('testKey → رسالة نجاح واضحة', tkOK.message, '✅');
eq('testKey → model الممرَّر', tkOK.model, 'deepseek-reasoner');
eq('testKey → استُخدم النموذج الممرَّر في الطلب', lastBody && lastBody.model, 'deepseek-reasoner');
check('testKey لا يحفظ المفتاح الممرَّر في الإعدادات', Store.state.settings.agent.apiKey === KEY);
lacks('testKey لا يسرّب المفتاح الممرَّر', JSON.stringify(tkOK), 'sk-typed');
globalThis.fetch = async () => httpBody(401, 'Authentication Fails');
const tkFail = await Agent.testKey('sk-bad-key');
check('testKey عند 401 → {ok:false, error}', tkFail.ok === false && typeof tkFail.error === 'string' && tkFail.error.indexOf('401') >= 0);
lacks('testKey لا يسرّب المفتاح السيئ', JSON.stringify(tkFail), 'sk-bad-key');

// انقطاع الشبكة
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
let aNet = await Agent.ask('كم عندي؟');
has('انقطاع الشبكة → رسالة عربية', aNet, 'تعذّر الاتصال');
has('انقطاع الشبكة → بديل محلي', aNet, 'من المحرّك المحلي');

// المهلة (AbortController)
globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
  const sig = init && init.signal;
  if (!sig) return; // لن تنتهي — يجب أن تُقطع بالمهلة
  sig.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
});
const t0 = Date.now();
const rTimeout = await Agent.apiCall([{ role: 'user', content: 'x' }], { timeout: 60 }).then(() => 'OK', (e) => e.message);
has('المهلة → رسالة مهلة عربية', rTimeout, 'المهلة');
check('المهلة تُقطع فعلاً (< 3 ثوان)', Date.now() - t0 < 3000, (Date.now() - t0) + 'ms');

// دورة tool_calls كاملة: طلب أول فيه tools + tool_choice:auto ثم رسالة role:tool ثم إجابة نهائية
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  if (calls.length === 1) {
    return jsonRes({
      choices: [{
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_balance', arguments: '{}' } }]
        }
      }]
    });
  }
  return jsonRes({ choices: [{ message: { role: 'assistant', content: 'رصيدك 9,598 د.ل حسب الأداة.' } }] });
};
const toolAns = await Agent.ask('كم رصيدي بالضبط؟');
eq('دورة الأدوات → إجابة النموذج نهائياً', toolAns, 'رصيدك 9,598 د.ل حسب الأداة.');
eq('طلبان للنموذج (أداة ثم إجابة)', calls.length, 2);
eq('الرابط الصحيح', calls[0].url, 'https://api.deepseek.com/chat/completions');
eq('stream=false', calls[0].body.stream, false);
eq('temperature=0.3', calls[0].body.temperature, 0.3);
eq('model من الإعدادات', calls[0].body.model, 'deepseek-chat');
eq('tool_choice=auto في أول طلب', calls[0].body.tool_choice, 'auto');
check('tools ممرَّرة (12 دالة)', Array.isArray(calls[0].body.tools) && calls[0].body.tools.length === 12);
check('المفتاح في هيدر Authorization فقط',
  calls[0].init.headers.Authorization === 'Bearer ' + KEY && JSON.stringify(calls[0].body).indexOf(KEY) < 0);
const toolMsg = (calls[1].body.messages || []).filter((m) => m.role === 'tool');
check('رسالة role:tool مضافة بالنتيجة الحقيقية', toolMsg.length === 1 && toolMsg[0].content.indexOf('9598') >= 0, JSON.stringify(toolMsg).slice(0, 120));
check('رسالة role:tool مربوطة بـ tool_call_id', toolMsg.length === 1 && toolMsg[0].tool_call_id === 'call_1');
check('Agent.lastToolCalls سجّل get_balance', Array.isArray(Agent.lastToolCalls) && Agent.lastToolCalls[0].name === 'get_balance');
check('الأداة أُرجعت رصيداً حقيقياً', Agent.lastToolCalls[0].result.total === 9598);

// حد 4 جولات أدوات ثم إجابة نهائية (tool_choice لا يُمرَّر بعد الحد)
const rounds = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  rounds.push(body);
  if (body.tools) {
    return jsonRes({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c' + rounds.length, type: 'function', function: { name: 'get_balance', arguments: '{}' } }] } }] });
  }
  return jsonRes({ choices: [{ message: { role: 'assistant', content: 'إجابة نهائية بعد 4 جولات.' } }] });
};
const capAns = await Agent.ask('حلّل لي كل شي بالتفصيل');
eq('بعد 4 جولات أدوات → إجابة نهائية', capAns, 'إجابة نهائية بعد 4 جولات.');
eq('إجمالي الطلبات = 5 (4 أدوات + إجابة)', rounds.length, 5);
eq('آخر طلب بلا tools', rounds[4].tools === undefined, true);

// سؤال فارغ
eq('ask() بسؤال فارغ لا ينهار', await Agent.ask('   '), 'اكتب سؤالك أولاً 🙏');

// تنظيف المفتاح + العودة للمحرّك المحلي
Store.updateSettings({ agent: { apiKey: '' } });
check('isEnabled() = false بعد مسح المفتاح', Agent.isEnabled() === false);
const backLocal = await Agent.ask('كم عندي؟');
has('ask() بلا مفتاح → المحرّك المحلي', backLocal, '9,598');
lacks('ask() بلا مفتاح → لا نداء شبكة', backLocal, 'تعذّر الاتصال');

console.warn = realWarn;
globalThis.fetch = realFetch;
delete globalThis.SpeechRecognition;
check('لا شيء من رسائل console.warn يحوي المفتاح', warns.join(' ').indexOf('sk-selftest') < 0, warns.join(' | ').slice(0, 140));
check('المفتاح لا يُكتب في أي ملف: agent.js بلا localStorage', fs.readFileSync(path.join(JS_DIR, 'agent.js'), 'utf8').indexOf('localStorage') < 0);
const src = fs.readFileSync(path.join(JS_DIR, 'agent.js'), 'utf8');
lacks('agent.js بلا console.log', src, 'console.log');
check('agent.js بلا إسناد innerHTML', !/\.innerHTML\s*=/.test(src) && !/html\s*:/.test(src), 'استخدم U.el/text فقط');
lacks('agent.js بلا import/export', src, 'export ');
check('agent.js يذكر نقطة DeepSeek الرسمية', src.indexOf('https://api.deepseek.com/chat/completions') >= 0);

/* ==========================================================================
 * 7) الواجهة — mount()
 * ======================================================================== */

section('7) الواجهة — mount() في DOM مصغّر');

Store.clearChat();
const box = document.createElement('div');
const shell = Agent.mount(box);
check('mount() ترجع عنصر .agent-shell', !!shell && cls(shell).has('agent-shell'));
eq('mount() تبني داخل الحاوية', box.childNodes.length, 1);
eq('mount() تضبط dir=rtl', box.getAttribute('dir'), 'rtl');
check('رأس الدردشة موجود', !!byClass(box, 'agent-head'));
check('قائمة الرسائل موجودة', !!byClass(box, 'agent-msgs'));
check('صف الإدخال موجود', !!byClass(box, 'agent-input-row'));
check('6 أزرار اقتراحات', byClass(box, 'agent-suggest') && byClass(box, 'agent-suggest').childNodes.length === 6);
const headButtons = findAll(byClass(box, 'agent-actions'), 'button');
eq('رأس فيه 3 أزرار (اختبار المفتاح/الصوت/المسح)', headButtons.length, 3);
has('زر اختبار المفتاح موجود', textOf(headButtons[0]), 'اختبار المفتاح');
// النطق مُطفأ افتراضياً (منظومة تسجيل لا منظومة صوت) → أيقونة SVG حقيقية (volumeOff)
function hasSvgNode(node) {
  if (!node) return false;
  if (String(node.tagName || '').toLowerCase() === 'svg') return true;
  return (node.childNodes || []).some(hasSvgNode);
}
function svgClasses(node, out) {
  out = out || [];
  if (!node) return out;
  if (String(node.tagName || '').toLowerCase() === 'svg') out.push(String(node.className || ''));
  (node.childNodes || []).forEach((c) => svgClasses(c, out));
  return out;
}
const voiceSvgs = svgClasses(headButtons[1], []);
check('زر الصوت فيه أيقونة SVG (بلا إيموجي)', hasSvgNode(headButtons[1]) && String(textOf(headButtons[1])).trim() === '', JSON.stringify(voiceSvgs));
check('أيقونة الصوت تعكس حالة الإطفاء (volumeOff)', voiceSvgs.some((c) => c.indexOf('ic-volumeOff') >= 0), JSON.stringify(voiceSvgs));
check('زر الصوت عليه aria-pressed=false', headButtons[1].getAttribute('aria-pressed') === 'false', headButtons[1].getAttribute('aria-pressed'));
check('أيقونة زر اختبار المفتاح SVG', hasSvgNode(headButtons[0]), String(textOf(headButtons[0])).slice(0, 40));
check('أيقونة زر المسح SVG', hasSvgNode(headButtons[2]) && String(textOf(headButtons[2])).trim() === '', String(textOf(headButtons[2])));
check('النطق معطّل افتراضياً في الإعدادات', Agent.voiceEnabled() === false);
check('silence() متاحة لإيقاف أي نطق', typeof Agent.silence === 'function');
check('حقل الإدخال موجود', !!byClass(box, 'agent-field'));
check('زر الإرسال موجود', !!byClass(box, 'agent-send'));
check('زر المايك يظهر لأن الصوت مدعوم', !!byClass(box, 'agent-mic'));
check('شريط «لا يوجد مفتاح» ظاهر بلا مفتاح', byClass(box, 'agent-note') && byClass(box, 'agent-note').style.display === '');
eq('محادثة فارغة → رسالة ترحيب واحدة فقط', findAll(box, '.agent-msg').length, 1);
has('الترحيب يعرض الرصيد الحقيقي', textOf(byClass(box, 'agent-msgs')), '9,598');

Agent.submit('كم صرفت اليوم؟');
const typingDuring = byClass(box, 'typing');
check('مؤشر «يكتب…» يظهر أثناء الانتظار', !!typingDuring && textOf(typingDuring).indexOf('يكتب') >= 0);
await sleep(30);
check('مؤشر «يكتب…» يختفي بعد الرد', byClass(box, 'typing') === null);
eq('ask() يضيف رسالتين للمحادثة المحفوظة', state.agentChat.length, 2);
eq('عدد الفقاعات = 2', findAll(box, '.agent-msg').length, 2);
eq('فقاعة المستخدم واحدة', findAll(box, '.agent-msg-user').length, 1);
eq('فقاعة الوكيل واحدة', findAll(box, '.agent-msg-bot').length, 1);
eq('المستخدم يميناً (flex-start في RTL)', findAll(box, '.agent-msg-user')[0].style.alignItems, 'flex-start');
eq('الوكيل يساراً (flex-end في RTL)', findAll(box, '.agent-msg-bot')[0].style.alignItems, 'flex-end');
has('فقاعة المستخدم ظاهرة', textOf(byClass(box, 'agent-msgs')), 'كم صرفت اليوم؟');
has('رد الوكيل ظاهر بالأرقام', textOf(byClass(box, 'agent-msgs')), '302');

// زر «اختبار المفتاح» بلا مفتاح: يرجع {ok:false} ولا ينهار
headButtons[0].dispatch('click');
await sleep(30);
check('زر اختبار المفتاح يعمل بلا مفتاح (بلا انهيار)', Agent._busy === false);

check('mount(null) لا ينهار', Agent.mount(null) === null);
const box2 = document.createElement('div');
Agent.mount(box2);
check('إعادة mount() تبني من جديد', byClass(box2, 'agent-shell') !== null && box2.childNodes.length === 1);
Agent.unmount();
check('unmount() تنهي الاشتراك', Agent.isMounted() === false);

/* ==========================================================================
 * الخلاصة
 * ======================================================================== */

section('الخلاصة');
const total = passed + failures.length;
console.log('  رسائل المحادثة المحفوظة: ' + state.agentChat.length + ' | أدوات: ' + Object.keys(Agent.tools).length + ' | فحوص: ' + total);
console.log('  PASS: ' + passed + '   FAIL: ' + failures.length);
if (failures.length) {
  console.log('\n❌ FAIL — فحوص فاشلة:');
  failures.forEach((f, i) => console.log('   ' + (i + 1) + ') ' + f));
  process.exitCode = 1;
} else {
  console.log('\n✅ PASS — كل الفحوص نجحت (' + passed + '/' + total + ')');
}
