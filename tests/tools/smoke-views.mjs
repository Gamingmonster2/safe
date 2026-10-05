/* =============================================================================
 * tests/_views.smoke.mjs  — ملك views-dev
 * يتحقق من: صحّة الأرقام المرجعية عبر Fin.Finance + تسجيل الشاشات الأربع.
 * التشغيل:  node tests/_views.smoke.mjs
 * لا DOM هنا: نتحقق من المنطق المالي ووجود render كدالة فقط.
 * ========================================================================== */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..'); // هذا الملف داخل tests/tools/ فالجذر مستويان أعلى

/* ------------------------------------------------------------ بيئة وهمية */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; }
};
globalThis.window = globalThis;

/* ----------------------------------------------------------------- التحميل */

const FILES = [
  'assets/js/constants.js',
  'assets/js/util.js',
  // store.js يلتقط Fin.Finance عند التحميل (import-less)، لذا finance.js قبله
  'assets/js/finance.js',
  'assets/js/store.js',
  'assets/js/ui.js',
  'assets/js/views/expenses.js',
  'assets/js/views/income.js',
  'assets/js/views/accounts.js',
  'assets/js/views/reports.js'
];

for (const f of FILES) {
  const code = readFileSync(join(ROOT, f), 'utf8');
  // ننفّذ في النطاق العام (بلا import/export) كما يفعل المتصفح مع <script>
  new Function(code)();
}

const Fin = globalThis.Fin;
if (!Fin) { console.error('FAIL: Fin غير موجود بعد تحميل الملفات'); process.exit(1); }

const C = Fin.C, U = Fin.U, Store = Fin.Store, F = Fin.Finance, UI = Fin.UI;
const ASOF = C.TODAY; // 2026-10-05

/* ----------------------------------------------------------------- الأدوات */

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, actual, expected, tol = 0.01) {
  const good = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : actual === expected;
  ok(name + ' = ' + JSON.stringify(actual) + (typeof expected === 'number' && !good ? ' (المتوقع ' + expected + ')' : ''), good);
}
function eqMoney(name, actual, expected) { eq(name, Math.round(Number(actual) * 100) / 100, expected); }
function section(t) { console.log('\n' + t); }

/* --------------------------------------------------------------- التحميل */

const state = Store.load();
ok('Store.load() أعاد حالة', !!state);

/* --------------------------------------------------------- الأرقام المرجعية */

section('1) الأرصدة الافتتاحية واليوم');
eqMoney('الرصيد الافتتاحي للشنطة', state.accounts.find(a => a.id === 'cash').opening, 5000);
eqMoney('الرصيد الافتتاحي للادخار', state.accounts.find(a => a.id === 'saving').opening, 1500);

const day = F.daySummary(state, ASOF);
eqMoney('دخل اليوم 2026-10-05', day.income, 3400);
eqMoney('مصروف اليوم 2026-10-05', day.expense, 302);
eqMoney('صافي اليوم', day.net, 3098);

eqMoney('رصيد الشاشة (الشنطة)', F.cashBalance(state), 8098);
eqMoney('رصيد الادخار', F.savingsBalance(state), 1500);
eqMoney('إجمالي الثروة', F.totalBalance(state), 9598);

/* ------------------------------------------------------------ المستحق لي */

section('2) المستحق لي ولم يُحصَّل');
const rec = F.receivables(state, ASOF);
/* البذرة حصّلت 3,400 اليوم (ورشة السمكرة 1,900 + الميكانيكا 1,500) وربطتها
   باستحقاقي شهر أكتوبر، فالمتبقي غير المحصَّل = المحل 1,500 + الاستوديو 2,000
   (ربع كامل) + الحجرات 2,000 = 5,500. ولذلك: 5,500 + 3,400 المحصَّل اليوم = 8,900
   ولا يساوي 6,400 — انظر قسم «انحرافات» في التقرير. */
eqMoney('إجمالي المستحق (غير محصَّل فعلاً)', rec.total, 5500);
eq('عدد الاستحقاقات غير المحصَّلة', rec.count, 3);

const byTpl = Object.fromEntries(rec.items.map(i => [i.templateId, i.remaining]));
eqMoney('المحل', byTpl['t-shop-rent'] || 0, 1500);
eqMoney('الاستوديو (ربع كامل)', byTpl['t-studio-rent'] || 0, 2000);
eqMoney('حجرات العمال', byTpl['t-rooms'] || 0, 2000);
eqMoney('ورشة السمكرة محصَّلة اليوم (لا متبقٍ)', byTpl['t-ws-paint'] || 0, 0);
eqMoney('الورشة الميكانيكية محصَّلة اليوم (لا متبقٍ)', byTpl['t-ws-mech'] || 0, 0);
eqMoney('المحصَّل اليوم مربوط بالاستحقاقين', F.chargePaid(state, 'c-2026-10-ws-paint') + F.chargePaid(state, 'c-2026-10-ws-mech'), 3400);

const studio = rec.items.find(i => i.templateId === 't-studio-rent');
ok('فترة الاستوديو ربعية 2026-Q4', studio && studio.period === '2026-Q4', studio && studio.period);
eq('لا يوجد استحقاق للاستوديو قبل الربع الرابع',
  state.charges.filter(c => c.templateId === 't-studio-rent').length, 1);

/* ------------------------------------------------------- الديون والالتزامات */

section('3) الديون والالتزامات');
const ob = F.obligations(state);
eqMoney('ديون عليّ (debt:true)', ob.debtTotal, 5180);
/* ملاحظة مهمة: F.obligations.plannedTotal يجمع البنود التي planned:true (وهي هنا
   بنود الدين نفسها = 1,500)، لذلك الالتزامات القادمة = الإجمالي − الديون = 1,500. */
eqMoney('plannedTotal (تعريف الدالة)', ob.plannedTotal, 1500);
eqMoney('إجمالي الالتزامات', ob.total, 6680);
eqMoney('الالتزامات القادمة (غير ديون) = الإجمالي − الديون', ob.total - ob.debtTotal, 1500);
eqMoney('نطاق 180 + بقية رسوم المدرسة 5,000',
  U.sum(ob.items.filter(t => t.debt), t => t.amount), 5180);
eqMoney('كتب 950 + زي 450 + بنزين 100',
  U.sum(ob.items.filter(t => !t.debt), t => t.amount), 1500);

/* ----------------------------------------------------------- أخرى مالية */

section('4) اشتقاقات إضافية');
const ms = F.monthSummary(state, U.monthKey(ASOF), ASOF);
eqMoney('دخل شهر أكتوبر حتى اليوم', ms.income, 3400);
eqMoney('مصروف أكتوبر حتى اليوم', ms.expense, 302);

const sav = F.savingsStats(state, U.monthKey(ASOF), ASOF);
eqMoney('رصيد الادخار في savingsStats', sav.savingBalance, 1500);
ok('نسبة الادخار محسوبة', typeof sav.rate === 'number' && isFinite(sav.rate));
ok('عدد أشهر التغطية محسوب', typeof sav.monthsCovered === 'number');

const series = F.monthlySeries(state, 6, ASOF, ASOF);
eq('monthlySeries يعيد 6 أشهر', series.length, 6);
eqMoney('دخل الشهر الأخير في السلسلة', series[series.length - 1].income, 3400);

const cats = F.expenseByCategory(state, ms.from, ms.to);
eqMoney('مجموع الفئات = مصروف الشهر', U.sum(cats, c => c.amount), 302);

const fc = F.cashFlowForecast(state, ASOF, 60);
ok('التنبؤ يحوي سلسلة أيام', Array.isArray(fc.series) && fc.series.length >= 60, 'length=' + (fc.series || []).length);
eqMoney('رصيد بداية التنبؤ', fc.openingBalance, 9598);
ok('التنبؤ يحوي أحداثاً (استحقاقات)', fc.events.length >= 4, 'events=' + fc.events.length);

const cmp = F.compareRanges(state, { from: ms.from, to: ms.to, label: 'أكتوبر' }, { from: '2026-09-01', to: '2026-09-30', label: 'سبتمبر' });
eqMoney('فرق الدخل بالمقارنة', cmp.delta.income, 3400);

const top = F.topExpenses(state, ms.from, ms.to, 10);
eq('أهم المصروفات = 5 بنود اليوم', top.length, 5);
eqMoney('أكبر مصروف', top[0].amount, 120);

const alerts = F.alerts(state, ASOF);
ok('التنبيهات فيها مستحق لي', alerts.some(a => /مستحق/.test(a.title)));
ok('التنبيهات فيها ديون عليّ', alerts.some(a => /ديون عليّ/.test(a.title)));

/* ---------------------------------------------------------- البذرة الأصلية */

section('5) مطابقة البذرة (C)');
eqMoney('C.DAILY_EXPENSES_TOTAL', C.DAILY_EXPENSES_TOTAL, 302);
eqMoney('C.RECEIVED_TODAY_TOTAL', C.RECEIVED_TODAY_TOTAL, 3400);
eqMoney('C.OBLIGATIONS_DEBT_ONLY', C.OBLIGATIONS_DEBT_ONLY, 5180);
eq('C.QUICK_ADD يحوي 8 فئات', C.QUICK_ADD.length, 8);
eq('القوالب خمسة', state.templates.length, 5);

/* ------------------------------------------------------ الشاشات الأربع */

section('6) تسجيل الشاشات وعقد Fin.Views');
const expectedViews = {
  expenses: { order: 2, title: 'المصروفات', icon: '💸' },
  income: { order: 3, title: 'الإيرادات', icon: '💰' },
  accounts: { order: 4, title: 'الحسابات', icon: '🏦' },
  reports: { order: 5, title: 'التقارير', icon: '📊' }
};
for (const [id, meta] of Object.entries(expectedViews)) {
  const v = Fin.Views && Fin.Views[id];
  ok('Fin.Views.' + id + ' مسجَّل', !!v);
  if (!v) continue;
  ok('  ' + id + '.render دالة', typeof v.render === 'function');
  ok('  ' + id + '.destroy دالة', typeof v.destroy === 'function');
  eq('  ' + id + '.id', v.id, id);
  eq('  ' + id + '.title', v.title, meta.title);
  eq('  ' + id + '.icon', v.icon, meta.icon);
  eq('  ' + id + '.order', v.order, meta.order);
}

section('7) توافق الواجهات المستخدمة في الشاشات');
[
  ['UI.rangeTabs', UI.rangeTabs], ['UI.standardRanges', UI.standardRanges],
  ['UI.donut', UI.donut], ['UI.bars', UI.bars], ['UI.sparkline', UI.sparkline],
  ['UI.legend', UI.legend], ['UI.chargeRow', UI.chargeRow], ['UI.txRow', UI.txRow],
  ['UI.modal', UI.modal], ['UI.form', UI.form], ['UI.confirm', UI.confirm],
  ['UI.kv', UI.kv], ['UI.stat', UI.stat], ['UI.statGrid', UI.statGrid],
  ['UI.progress', UI.progress], ['UI.hbar', UI.hbar], ['UI.list', UI.list],
  ['UI.card', UI.card], ['UI.section', UI.section], ['UI.btn', UI.btn],
  ['UI.badge', UI.badge], ['UI.emptyState', UI.emptyState], ['UI.toast', UI.toast],
  ['UI.money', UI.money], ['UI.alertBox', UI.alertBox],
  ['Store.recordReceipt', Store.recordReceipt], ['Store.updateTemplate', Store.updateTemplate],
  ['Store.updateAccount', Store.updateAccount], ['Store.updateTransaction', Store.updateTransaction],
  ['Store.transfer', Store.transfer], ['Store.exportCSV', Store.exportCSV],
  ['U.download', U.download], ['U.periodLabel', U.periodLabel], ['U.escapeHtml', U.escapeHtml]
].forEach(([name, fn]) => ok(name + ' متاح', typeof fn === 'function'));

/* --------------------------------------------- سلوك التحصيل (تدفق حقيقي) */

section('8) تدفق التحصيل على نسخة معزولة (لا يمسّ البيانات المحفوظة)');
{
  const clone = JSON.parse(JSON.stringify(state));
  const before = F.receivables(clone, ASOF).total;
  const target = clone.charges.find(c => c.id === 'c-2026-10-Q4-t-studio-rent') || clone.charges.find(c => c.templateId === 't-studio-rent');
  ok('استحقاق الاستوديو موجود', !!target);
  // تحصيل جزئي 500 ثم الباقي
  Store.silent(() => {
    const saved = Store.state;
    // نستعمل نفس منطق Store.recordReceipt على نسخة مؤقتة عبر استبدال الحالة غير ممكن —
    // لذلك نتحقق من الأثر الحسابي مباشرة عبر Finance (نفس الدالة التي يستخدمها Store).
    const paid = F.chargePaid(clone, target.id);
    eqMoney('لا مدفوعات سابقة على الاستوديو', paid, 0);
    clone.receipts.push({ id: 'rc-test', chargeId: target.id, date: ASOF, amount: 500, accountId: 'cash' });
    eqMoney('بعد سند 500 يصبح المتبقي 1500', U.round(Number(target.amount) - F.chargePaid(clone, target.id)), 1500);
    eq('الحالة تصبح جزئية', F.chargeStatus(clone, target), 'partial');
    clone.receipts.push({ id: 'rc-test2', chargeId: target.id, date: ASOF, amount: 1500, accountId: 'cash' });
    eq('الحالة تصبح مسدَّد', F.chargeStatus(clone, target), 'paid');
    eqMoney('إجمالي المستحق ينقص 2000', F.receivables(clone, ASOF).total, before - 2000);
    void saved;
  });
}

/* ------------------------------------------------- سلامة ملفات الشاشات */

section('9) سلامة ملفات الشاشات (ترميز UTF-8 + أصناف CSS المطلوبة)');
{
  const fs = await import('node:fs');
  const viewFiles = ['expenses', 'income', 'accounts', 'reports'];
  for (const f of viewFiles) {
    const src = readFileSync(join(ROOT, 'assets/js/views/' + f + '.js'), 'utf8');
    ok(f + '.js عربي سليم (لا تشويه ترميز)', !/ط§ظ„|ط¸â€|Ø§Ù„/.test(src) && /[\u0600-\u06FF]/.test(src));
    ok(f + '.js بلا import/export وبلا innerHTML لمحتوى المستخدم',
      !/^\s*(import|export)\s/m.test(src) && !/innerHTML/.test(src));
    ok(f + '.js يستعمل U.el', /U\.el\(/.test(src));
  }
  const css = readFileSync(join(ROOT, 'assets/css/app.css'), 'utf8');
  const need = ['app-shell', 'nav', 'nav-item', 'view', 'section-head', 'card', 'stat-grid',
    'tx-row', 'badge', 'chip', 'tabs', 'tab', 'btn', 'input', 'switch-track', 'progress-bar',
    'hbar-fill', 'modal-overlay', 'toast', 'alert', 'empty', 'kv', 'legend', 'svg-chart',
    'svg-donut', 'charge-row', 'quick-grid', 'quick-btn', 'range-row', 'summary-strip',
    'divider', 'agent-shell', 'agent-msg', 'agent-input-row', 'typing', 'skip-link',
    'boot-spinner', 'nav-badge-host', '@media print', 'prefers-reduced-motion'];
  const missing = need.filter(c => !css.includes(c));
  ok('app.css يحوي كل الأصناف المطلوبة (' + need.length + ')', missing.length === 0, missing.join(', '));
  const hex = (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  ok('app.css بلا ألوان hex ثابتة', hex.length === 0, hex.join(', '));
  const braces = (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length;
  ok('app.css أقواس متوازنة', braces);
  void fs;
}

/* --------------------------------------------------------------- النتيجة */

console.log('\n' + '─'.repeat(52));
if (fail === 0) {
  console.log('PASS ✅  ' + pass + ' تحقّق ناجح، 0 فشل');
  process.exit(0);
} else {
  console.log('FAIL ❌  ' + pass + ' ناجح، ' + fail + ' فاشل');
  failures.forEach(f => console.log('   - ' + f));
  process.exit(1);
}
