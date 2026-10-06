/* =============================================================================
 * مصروفي — الاختبار الرسمي للأرقام المالية
 * tests/check.mjs
 *
 * التشغيل (من جذر المشروع C:\vpn\safe):
 *     node tests/check.mjs
 *
 * مبادئ هذا الملف:
 *  - لا مكتبات خارجية، لا npm، لا تعديل لأي ملف، لا كتابة على القرص إطلاقاً.
 *  - يقرأ ملفات المشروع من القرص ويقيّمها في globalThis (نفس ما يفعله المتصفح).
 *  - لا يثق بأي تقرير: كل رقم يُحسب من المحرّك الفعلي ويُقارَن بالمرجع الملزم.
 *  - `localStorage` غير معرّف في node → البذرة (seed) هي المستخدمة.
 * ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');

/* ترتيب التبعيات الحقيقي: finance.js يحتاج C و U فقط،
 * بينما store.js يلتقط Fin.Finance وقت التحميل → يجب أن يأتي finance قبله. */
const DEP_ORDER = ['constants.js', 'util.js', 'finance.js', 'store.js'];

/* ------------------------------------------------------------- سجل النتائج */

let pass = 0;
let fail = 0;
const failures = [];
const contractNotes = [];

const line = (s = '') => console.log(s);
const head = (t) => line('\n' + t);

function show(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** فحص منطقي عام */
function check(name, cond, actual, expected) {
  if (cond) {
    pass++;
    line(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push({ name, actual, expected });
    line(`  ❌ ${name}`);
    line(`       الفعلي : ${show(actual)}`);
    line(`       المتوقع: ${show(expected)}`);
  }
}

/** تساوٍ دقيق (أرقام الأنواع نفسها) */
function eq(name, actual, expected) {
  check(name, actual === expected, actual, expected);
}

/** تساوٍ رقمي مع هامش C.BALANCE_TOLERANCE */
function near(name, actual, expected, tol = 0.01) {
  check(name, Math.abs(Number(actual) - Number(expected)) <= tol, actual, expected);
}

/** ملاحظة عقد غير محسوبة في PASS/FAIL */
function contractNote(text) {
  contractNotes.push(text);
  line(`  ⚠️  ${text}`);
}

/** تنفيذ دالة والتأكد أنها لا ترمي استثناء */
function noThrow(name, fn) {
  try {
    const v = fn();
    pass++;
    line(`  ✅ ${name}`);
    return v;
  } catch (e) {
    fail++;
    failures.push({ name, actual: `${e.constructor.name}: ${e.message}`, expected: 'بلا استثناء' });
    line(`  ❌ ${name}`);
    line(`       الفعلي : ${e.constructor.name}: ${e.message}`);
    line('       المتوقع: بلا استثناء');
    return undefined;
  }
}

/* ============================================================ 0) البيئة */

head('══ 0) البيئة والملفات ══');

for (const f of DEP_ORDER) {
  const p = path.join(JS_DIR, f);
  check(`الملف موجود: assets/js/${f}`, fs.existsSync(p), fs.existsSync(p), true);
}

/* تقييم الملفات في globalThis — نفس طريقة المتصفح (IIFE تعتمد على globalThis.Fin) */
let loadError = null;
try {
  for (const f of DEP_ORDER) {
    const code = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    vm.runInThisContext(code, { filename: `assets/js/${f}` });
  }
} catch (e) {
  loadError = e;
}

check('تقييم الملفات الأربعة بلا استثناء', !loadError, loadError ? `${loadError.constructor.name}: ${loadError.message}` : 'ok', 'ok');
if (loadError) {
  line('\n💥 لا يمكن المتابعة: فشل تحميل الوحدات.');
  line(String(loadError.stack || loadError));
  line('\n' + '='.repeat(60));
  line(`PASS ${pass} / FAIL ${fail}`);
  process.exitCode = 1;
  process.exit(1);
}

const Fin = globalThis.Fin;
check('globalThis.Fin موجود', !!Fin, typeof Fin, 'object');
const { C, U, Finance: F, Store } = Fin || {};
check('Fin.C موجود', !!C, typeof C, 'object');
check('Fin.U موجود', !!U, typeof U, 'object');
check('Fin.Finance موجود', !!F, typeof F, 'object');
check('Fin.Store موجود', !!Store, typeof Store, 'object');

check('localStorage غير معرّف (ستُستخدم البذرة)', typeof localStorage === 'undefined', typeof localStorage, 'undefined');
check('document غير معرّف (المحرّك المالي لا يحتاج DOM)', typeof document === 'undefined', typeof document, 'undefined');

const todayISO = U.todayISO();
if (todayISO !== C.TODAY) {
  contractNote(`ساعة الجهاز (${todayISO}) متقدّمة على تاريخ البذرة (${C.TODAY}) — طبيعي. الأرقام المرجعية تُقاس بتاريخ البذرة، والبذرة نفسها لا تعتمد على الساعة.`);
}

/** بذرة جديدة معزولة لكل حالة اختبار (لا تلمس القرص) */
const fresh = () => Store.reset();
const seed = Store.load();

// البذرة مثبّتة على تاريخ القصة لا على ساعة الجهاز (وإلا تغيّرت الأرقام المرجعية بمرور الأيام)
eq('بذرة القصة مثبّتة على C.TODAY', String(seed.createdAt).slice(0, 10), C.TODAY);

/* ================================================ 1) ثوابت القصة (constants) */

head('══ 1) ثوابت القصة في constants.js ══');

eq('C.TODAY = 2026-10-05', C.TODAY, '2026-10-05');
eq('C.CURRENCY = LYD', C.CURRENCY, 'LYD');
near('C.BALANCE_TOLERANCE = 0.01', C.BALANCE_TOLERANCE, 0.01);

near('الرصيد الافتتاحي: الشنطة 5,000', C.OPENING.cash, 5000);
near('الرصيد الافتتاحي: الادخار 1,500', C.OPENING.saving, 1500);
near('مجموع الافتتاحي 6,500', C.OPENING.cash + C.OPENING.saving, 6500);

const expenseParts = C.DAILY_EXPENSES.map((e) => e.amount);
near('مصروف اليوم = 302 (120+22+85+60+15)', C.DAILY_EXPENSES_TOTAL, 302);
eq('تفصيل مصروف اليوم = [120,22,85,60,15]', JSON.stringify(expenseParts), JSON.stringify([120, 22, 85, 60, 15]));
near('مجموع تفصيل المصروف = 302', U.sum(expenseParts, (x) => x), 302);

near('تحصيل اليوم = 3,400', C.RECEIVED_TODAY_TOTAL, 3400);
near(
  'تحصيل اليوم = السمكرة 1,900 + الميكانيكا 1,500',
  U.sum(C.RECEIPTS_TODAY, (r) => r.amount),
  3400
);
eq('عدد سندات اليوم = 2', C.RECEIPTS_TODAY.length, 2);

near('إجمالي المصروفات المخطّطة = 1,680', C.OBLIGATIONS_TOTAL, 1680);
near(
  'المخطّط = نطاق .org 180 + كتب 950 + زي 450 + بنزين 100',
  U.sum(C.OBLIGATIONS, (o) => o.amount),
  1680
);
near('لا ديون في البذرة (كل البنود مخطّطة لا دين)', C.OBLIGATIONS.filter((o) => o.debt).length, 0);
near('الالتزامات السنوية المتبقية = 5,000 (مدرسة: 6,000 − 1,000)', C.COMMITMENTS_REMAINING, 5000);
near('الأموال المجمّعة في الصندوق = 8,098', C.FUND_SOURCES_TOTAL, 8098);
near('رصيد الصندوق قبل اليوم = 5,000', C.FUND_OPENING, 5000);

/* ================================== 2) أرقام البذرة المرجعية (الجدول الملزم) */

head('══ 2) البذرة: الجدول المرجعي بند بند ══');

const day = F.daySummary(seed, C.TODAY);
near('دخل اليوم = 3,400', day.income, 3400);
near('مصروف اليوم = 302', day.expense, 302);
near('صافي اليوم = +3,098', day.net, 3098);
eq('صافي اليوم موجب', day.net > 0, true);

near('رصيد الشنطة (نقد) = 8,098', F.cashBalance(seed), 8098);
near('رصيد الادخار = 1,500', F.savingsBalance(seed), 1500);
near('إجمالي الحسابات = 9,598', F.totalBalance(seed), 9598);
near('هوية الرصيد: 5,000 + 3,400 − 302 = 8,098', C.OPENING.cash + day.income - day.expense, 8098);
near('هوية الإجمالي: 8,098 + 1,500', F.cashBalance(seed) + F.savingsBalance(seed), 9598);

eq('عدد معاملات البذرة = 11 (2 دخل + 5 مصروف + 4 مخطّط)', seed.transactions.length, 11);
eq('عدد سندات القبض = 2', seed.receipts.length, 2);

const oct = F.monthSummary(seed, '2026-10', C.TODAY);
near('إيراد الشهر (أكتوبر حتى 5) = 3,400', oct.income, 3400);
near('مصروف الشهر = 302', oct.expense, 302);
near('صافي الشهر = +3,098', oct.net, 3098);
eq('الشهر جزئي (حتى يوم 5)', oct.partial, true);

const series = F.dailySeries(seed, '2026-10-01', C.TODAY);
eq('سلسلة الأيام = 5 أيام', series.length, 5);
near('رصيد آخر يوم في السلسلة = 9,598', series[series.length - 1].balance, 9598);
near('صافي 2026-10-05 في السلسلة = +3,098', series[series.length - 1].net, 3098);

const byCat = F.expenseByCategory(seed, '2026-10-01', C.TODAY);
near('مجموع بنود المصروف = 302', U.sum(byCat, (c) => c.amount), 302);
eq('عدد بنود المصروف = 5', byCat.length, 5);
const src = F.incomeBySource(seed, '2026-10-01', C.TODAY);
near('مصدر الدخل الوحيد = 3,400', U.sum(src, (s) => s.amount), 3400);
near('كل الدخل من إيجار الورش', src[0].key === 'rent_workshop' ? 3400 : 0, 3400);

/* ================================================ 3) الاستحقاقات والفترات */

head('══ 3) الاستحقاقات (مستحق لي) والفترات ══');

eq('عدد الاستحقاقات = 5', seed.charges.length, 5);

const chargeById = (st, id) => (st.charges || []).find((c) => c.id === id) || null;
const charge = {
  shop: chargeById(seed, 'c-2026-10-shop-rent'),
  studio: chargeById(seed, 'c-2026-Q4-studio-rent'),
  paint: chargeById(seed, 'c-2026-10-ws-paint'),
  mech: chargeById(seed, 'c-2026-10-ws-mech'),
  rooms: chargeById(seed, 'c-2026-10-rooms')
};
for (const [k, c] of Object.entries(charge)) {
  check(`الاستحقاق موجود: ${k}`, !!c, c ? c.id : null, 'charge');
}

near('استحقاق المحل = 1,500', charge.shop.amount, 1500);
near('استحقاق الاستوديو = 2,000', charge.studio.amount, 2000);
near('استحقاق السمكرة = 1,900', charge.paint.amount, 1900);
near('استحقاق الميكانيكا = 1,500', charge.mech.amount, 1500);
near('استحقاق الحجرات = 2,000', charge.rooms.amount, 2000);
near('مجموع الاستحقاقات = 8,900', U.sum(seed.charges, (c) => c.amount), 8900);

eq('دورة الاستوديو = quarterly', charge.studio.cycle, 'quarterly');
eq('فترة الاستوديو = 2026-Q4', charge.studio.period, '2026-Q4');
eq('استحقاق الاستوديو = 2026-10-01', charge.studio.dueDate, '2026-10-01');
eq('دورة المحل = monthly وفترته 2026-10', `${charge.shop.cycle}/${charge.shop.period}`, 'monthly/2026-10');
eq('فترة السمكرة = 2026-10', charge.paint.period, '2026-10');
eq('فترة الميكانيكا = 2026-10', charge.mech.period, '2026-10');
eq('فترة الحجرات = 2026-10', charge.rooms.period, '2026-10');

eq('فترة ربعية واحدة فقط في الاستحقاقات', seed.charges.filter((c) => /-Q[1-4]$/.test(c.period)).length, 1);
eq('الربع الوحيد هو للاستوديو', seed.charges.filter((c) => /-Q[1-4]$/.test(c.period))[0].templateId, 't-studio-rent');

eq('حالة المحل = pending (لم يُحصَّل، متأخر)', charge.shop.status, 'pending');
eq('حالة السمكرة = paid (حُصِّلت اليوم)', charge.paint.status, 'paid');
eq('حالة الميكانيكا = paid (حُصِّلت اليوم)', charge.mech.status, 'paid');
eq('حالة الاستوديو = pending', charge.studio.status, 'pending');
eq('حالة الحجرات = pending', charge.rooms.status, 'pending');

const rec = F.receivables(seed, C.TODAY);
/* الرقم الملزم بعد تصحيح جدول القصة: 1,500 + 2,000 + 2,000 = 5,500
 * (السمكرة 1,900 والميكانيكا 1,500 حُصِّلتا اليوم ومربوطتان باستحقاقَيهما). */
near('مستحق لي = 5,500', rec.total, 5500);
eq('عدد الاستحقاقات غير المحصَّلة = 3', rec.count, 3);
near(
  'مستحق لي = محل 1,500 + استوديو 2,000 + حجرات 2,000',
  1500 + 2000 + 2000,
  rec.total
);
const recItem = (id) => rec.items.find((i) => i.chargeId === id) || {};
near('المحل مستحق 1,500', recItem('c-2026-10-shop-rent').remaining, 1500);
near('الاستوديو مستحق 2,000', recItem('c-2026-Q4-studio-rent').remaining, 2000);
near('الحجرات مستحق 2,000', recItem('c-2026-10-rooms').remaining, 2000);
eq('السمكرة ليست ضمن المستحق (محصَّلة)', recItem('c-2026-10-ws-paint').remaining, undefined);
eq('الميكانيكا ليست ضمن المستحق (محصَّلة)', recItem('c-2026-10-ws-mech').remaining, undefined);
check('المحل متأخر (due 2026-10-01)', recItem('c-2026-10-shop-rent').daysLate === 4, recItem('c-2026-10-shop-rent').daysLate, 4);
check('الحجرات غير متأخرة (due اليوم)', recItem('c-2026-10-rooms').daysLate === 0, recItem('c-2026-10-rooms').daysLate, 0);
near('الاستوديو يشير للربع 2026-Q4', recItem('c-2026-Q4-studio-rent').period === '2026-Q4' ? 2000 : 0, 2000);

/* تحقق حسابي مباشر من قاعدة §3.3: مجموع (amount − مدفوعات) لكل استحقاق غير مسدَّد */
const manualRec = U.sum(
  seed.charges.filter((c) => F.chargePaid(seed, c.id) < c.amount - 0.001),
  (c) => c.amount - F.chargePaid(seed, c.id)
);
near('مستحق لي (حساب يدوي من القاعدة) = مستحق لي (المحرّك)', manualRec, rec.total);

/* ============================== 4) المصروفات المخطّطة والالتزامات السنوية */

head('══ 4) لا ديون — مصروفات مخطّطة + التزامات سنوية + أموال مجمّعة ══');

const debts = F.debts(seed);
near('ديون عليّ = 0 (لا ديون في هذا التطبيق)', debts.total, 0);
eq('عدد الديون = 0', debts.count, 0);
eq('لا معاملة واحدة معلَّمة debt', seed.transactions.filter((t) => t.debt).length, 0);

const domainTx = seed.transactions.find((t) => t.category === 'domain_hosting' && t.paid === false);
near('بطاقة النطاق .org = 180 (لم تُدفع)', domainTx.amount, 180);
eq('النطاق مخطّط لا دين', domainTx.planned, true);
near('لا توجد معاملة رسوم مدرسة معلّقة (خطة سنوية لا دين)', seed.transactions.filter((t) => t.category === 'school_tuition').length, 0);

const oblig = F.obligations(seed);
near('إجمالي المصروفات المخطّطة = 1,680', oblig.total, 1680);
near('كلها مخطّطة (plannedTotal)', oblig.plannedTotal, 1680);
near('لا مصروفات معلّقة غير مخطّطة', oblig.immediateTotal, 0);
const plannedTxs = seed.transactions.filter((t) => t.planned === true);
eq('عدد المخطّط = 4 (نطاق، كتب، زي، بنزين)', plannedTxs.length, 4);
near('مخطّط: كتب 950', plannedTxs.find((t) => t.category === 'school_books').amount, 950);
near('مخطّط: زي 450', plannedTxs.find((t) => t.category === 'clothes').amount, 450);
near('مخطّط: بنزين 100', plannedTxs.find((t) => t.category === 'fuel').amount, 100);
near('لا أثر للمخطّط على الرصيد: 8,098 ثابتة', F.cashBalance(seed), 8098);

const cm = F.commitments(seed);
eq('التزام سنوي واحد (رسوم المدرسة)', cm.count, 1);
near('رسوم المدرسة السنوية = 6,000', cm.list[0].annual, 6000);
near('المدفوع منها = 1,000', cm.list[0].paidThisYear, 1000);
near('المتبقي = 5,000', cm.remainingTotal, 5000);

const funds = F.accumulatedFunds(seed);
near('الأموال المجمّعة = النقد 8,098', funds.total, 8098);
near('منها 5,000 كان قبل اليوم', funds.opening, 5000);
near('إيرادات اليوم المحصَّلة = 3,400', funds.todayIncome, 3400);
near('مصروفات اليوم = 302', funds.todayExpense, 302);
near('مجموع المصادر = النقد', U.sum(funds.sources, (s) => s.amount), funds.total);

/* ================================================= 5) حالات حدّية (معاملات) */

head('══ 5) حالات حدّية: تحصيل، سداد، مخطط، تحويل ══');

/* 5.1 تحصيل استحقاق المحل كاملاً (1,500) */
{
  let st = fresh();
  const beforeCash = F.cashBalance(st);
  const beforeTotal = F.totalBalance(st);
  const beforeRec = F.receivables(st, C.TODAY).total;
  const beforeTx = st.transactions.length;
  const beforeReceipts = st.receipts.length;

  const res = Store.recordReceipt('c-2026-10-shop-rent');
  st = Store.state;

  check('تحصيل المحل: نجح', res && res.ok === true, res && res.ok, true);
  near('تحصيل المحل: الرصيد زاد 1,500', F.cashBalance(st) - beforeCash, 1500);
  near('تحصيل المحل: الرصيد = 9,598', F.cashBalance(st), 9598);
  near('تحصيل المحل: الإجمالي زاد 1,500', F.totalBalance(st) - beforeTotal, 1500);
  near('تحصيل المحل: مستحق لي نقص إلى 4,000', F.receivables(st, C.TODAY).total, 4000);
  near('تحصيل المحل: النقص = 1,500', beforeRec - F.receivables(st, C.TODAY).total, 1500);
  eq('تحصيل المحل: حالة الاستحقاق = paid', chargeById(st, 'c-2026-10-shop-rent').status, 'paid');
  eq('تحصيل المحل: عدد المعاملات زاد 1', st.transactions.length - beforeTx, 1);
  eq('تحصيل المحل: سند قبض واحد أُضيف', st.receipts.length - beforeReceipts, 1);
  const newTx = st.transactions[st.transactions.length - 1];
  eq('تحصيل المحل: المعاملة دخل مربوطة بالاستحقاق', `${newTx.type}/${newTx.chargeId}`, `income/c-2026-10-shop-rent`);
  near('تحصيل المحل: لا يُنشئ استحقاقاً جديداً (5 استحقاقات)', st.charges.length, 5);
}
{
  /* تحصيل مبلغ أكبر من المتبقي → يُقصّ للمتبقي */
  let st = fresh();
  Store.recordReceipt('c-2026-10-shop-rent', 99999);
  st = Store.state;
  near('تحصيل زائد يُقصّ إلى المتبقي 1,500', F.receivables(st, C.TODAY).total, 4000);
  eq('حالة المحل بعد القص = paid', chargeById(st, 'c-2026-10-shop-rent').status, 'paid');
}
{
  /* تحصيل صفر/سالب → مرفوض بلا أثر */
  let st = fresh();
  const res = Store.recordReceipt('c-2026-10-shop-rent', 0);
  st = Store.state;
  eq('تحصيل 0 مرفوض', res.ok, false);
  near('تحصيل 0 لا يغيّر الرصيد', F.cashBalance(st), 8098);
  const res2 = Store.recordReceipt('c-nonexistent', 100);
  eq('تحصيل استحقاق غير موجود مرفوض', res2.ok, false);
}

/* 5.2 تحصيل جزئي: 500 من استحقاق الاستوديو (2,000) */
{
  let st = fresh();
  const beforeCash = F.cashBalance(st);
  const res = Store.recordReceipt('c-2026-Q4-studio-rent', 500);
  st = Store.state;

  check('تحصيل جزئي: نجح', res && res.ok === true, res && res.ok, true);
  eq('تحصيل جزئي: حالة الاستحقاق = partial', chargeById(st, 'c-2026-Q4-studio-rent').status, 'partial');
  eq('تحصيل جزئي: الحالة عبر المحرّك = partial', F.chargeStatus(st, chargeById(st, 'c-2026-Q4-studio-rent')), 'partial');
  const item = F.receivables(st, C.TODAY).items.find((i) => i.chargeId === 'c-2026-Q4-studio-rent');
  near('تحصيل جزئي: المتبقي من الاستوديو = 1,500', item.remaining, 1500);
  eq('تحصيل جزئي: حالة البند في القائمة = partial', item.status, 'partial');
  near('تحصيل جزئي: الرصيد زاد 500 فقط', F.cashBalance(st) - beforeCash, 500);
  near('تحصيل جزئي: الرصيد = 8,598', F.cashBalance(st), 8598);
  near('تحصيل جزئي: مستحق لي = 5,000', F.receivables(st, C.TODAY).total, 5000);
  near('تحصيل جزئي: الإجمالي = 10,098', F.totalBalance(st), 10098);
  near('تحصيل جزئي: المدفوع على الاستحقاق = 500', F.chargePaid(st, 'c-2026-Q4-studio-rent'), 500);
}

/* 5.3 دفع بطاقة النطاق (180) عبر updateTransaction */
{
  let st = fresh();
  const tx = st.transactions.find((t) => t.category === 'domain_hosting' && t.paid === false);
  const beforeCash = F.cashBalance(st);
  const res = Store.updateTransaction(tx.id, { paid: true });
  st = Store.state;

  check('دفع النطاق: updateTransaction أعاد المعاملة', !!res, res ? res.id : null, tx.id);
  near('دفع النطاق: الرصيد نقص 180', beforeCash - F.cashBalance(st), 180);
  near('دفع النطاق: الرصيد = 7,918', F.cashBalance(st), 7918);
  near('دفع النطاق: الإجمالي = 9,418', F.totalBalance(st), 9418);
  near('دفع النطاق: الديون تبقى صفراً', F.debts(st).total, 0);
  near('دفع النطاق: المخطّط نقص إلى 1,500', F.obligations(st).total, 1500);
  const after = st.transactions.find((t) => t.id === tx.id);
  eq('دفع النطاق: paid = true', after.paid, true);
  eq('دفع النطاق: نوعها ما زال expense', after.type, 'expense');
  eq('دفع النطاق: لم تُحذف (11 معاملة)', st.transactions.length, 11);
}

/* 5.4 مصروف «لم يُدفع» paid:false → مخطّط، لا يمسّ الرصيد ولا يُنشئ ديناً */
{
  let st = fresh();
  const beforeTotal = F.totalBalance(st);
  const beforeRec = F.receivables(st, C.TODAY).total;
  Store.addExpense({ amount: 250, category: 'other', paid: false, planned: true, note: 'لم يُدفع — اختبار' });
  st = Store.state;
  const added = st.transactions[st.transactions.length - 1];

  near('مصروف غير مدفوع: الرصيد لا يتغيّر', F.totalBalance(st), beforeTotal);
  near('مصروف غير مدفوع: النقد يبقى 8,098', F.cashBalance(st), 8098);
  near('مصروف غير مدفوع: يظهر في المخطّط (1,930)', F.obligations(st).total, 1930);
  near('مصروف غير مدفوع: لا ديون', F.debts(st).total, 0);
  eq('مصروف غير مدفوع: ضمن بنود المخطّط', F.obligations(st).items.some((t) => t.id === added.id), true);
  near('مصروف غير مدفوع: مجموع المخطّط = 1,680 + 250', F.obligations(st).total, 1680 + 250);
  near('مصروف غير مدفوع: لا يغيّر مستحق لي', F.receivables(st, C.TODAY).total, beforeRec);
}

/* 5.5 معاملة planned:true — لا أثر على الرصيد */
{
  let st = fresh();
  const beforeTotal = F.totalBalance(st);
  const beforeDay = F.daySummary(st, C.TODAY);
  Store.addTransaction({ type: 'expense', amount: 777, date: C.TODAY, category: 'other', planned: true, note: 'مخطط' });
  st = Store.state;
  const afterDay = F.daySummary(st, C.TODAY);

  near('مخطط (paid=true): الرصيد لا يتغيّر', F.totalBalance(st), beforeTotal);
  near('مخطط: مصروف اليوم لا يتغيّر (302)', afterDay.expense, beforeDay.expense);
  eq('مخطط: لا يُحتسب في txCount اليومي', afterDay.txCount, beforeDay.txCount);
  near('مخطط: النقد يبقى 8,098', F.cashBalance(st), 8098);
}
{
  let st = fresh();
  const beforeTotal = F.totalBalance(st);
  Store.addTransaction({ type: 'expense', amount: 333, date: C.TODAY, category: 'other', planned: true, paid: false, note: 'مخطط غير مدفوع' });
  st = Store.state;
  near('مخطط+غير مدفوع: الرصيد لا يتغيّر', F.totalBalance(st), beforeTotal);
  near('مخطط+غير مدفوع: يظهر في المخطّط (1,680 + 333)', F.obligations(st).plannedTotal, 1680 + 333);
  near('مخطط+غير مدفوع: مجموع المخطّط', F.obligations(st).total, 1680 + 333);
}
{
  let st = fresh();
  const beforeTotal = F.totalBalance(st);
  Store.addIncome({ amount: 5000, category: 'sale', planned: true, note: 'بيع متوقع' });
  st = Store.state;
  near('دخل مخطط: الرصيد لا يتغيّر', F.totalBalance(st), beforeTotal);
  near('دخل مخطط: لا يظهر كدخل اليوم', F.daySummary(st, C.TODAY).income, 3400);
}

/* 5.6 تحويل cash → saving بمقدار 1,000 */
{
  let st = fresh();
  const beforeTotal = F.totalBalance(st);
  const beforeCash = F.cashBalance(st);
  const beforeSaving = F.savingsBalance(st);
  Store.transfer('cash', 'saving', 1000, C.TODAY);
  st = Store.state;

  near('تحويل: إجمالي الحسابات لا يتغيّر', F.totalBalance(st), beforeTotal);
  near('تحويل: النقد نقص 1,000 (7,098)', F.cashBalance(st), beforeCash - 1000);
  near('تحويل: الادخار زاد 1,000 (2,500)', F.savingsBalance(st), beforeSaving + 1000);
  near('تحويل: لا يظهر كدخل أو مصروف', F.daySummary(st, C.TODAY).net, 3098);
  near('تحويل: الإجمالي يبقى 9,598', F.totalBalance(st), 9598);
}

/* ================================= 6) التنبؤ والسلاسل والفترات الشاذة */

head('══ 6) التنبؤ والسلاسل والفترات الشاذة ══');

const fc30raw = F.cashFlowForecast(seed, C.TODAY, 30);
const fc60raw = F.cashFlowForecast(seed, C.TODAY, 60);

/* العقد في ARCHITECTURE §4 يذكر مصفوفة [{date,expected,cumulative}]،
 * والتنفيذ يعيد كائناً يحمل series بنفس الشكل — نتعامل مع الشكلين ونتحقق من العناصر. */
const forecastSeries = (fc) => (Array.isArray(fc) ? fc : (fc && fc.series) || []);
const forecastEvents = (fc) => (Array.isArray(fc) ? fc : (fc && fc.events) || forecastSeries(fc));
const forecastTotal = (fc) => (Array.isArray(fc) ? U.sum(fc, (e) => e.expected) : Number(fc.totalExpected));

if (!Array.isArray(fc60raw)) {
  contractNote('cashFlowForecast يعيد كائناً {asOf,horizon,openingBalance,totalExpected,closingBalance,events,series} بينما ARCHITECTURE §4 يوثّقه كمصفوفة [{date,expected,cumulative}] — العناصر نفسها موجودة داخل series؛ وثّق الشكل أو أرجِع series مباشرة.');
}

const s60 = forecastSeries(fc60raw);
const e60 = forecastEvents(fc60raw);
check('التنبؤ: العناصر تحمل date/expected/cumulative', s60.length > 0 && s60.every((e) => 'date' in e && 'expected' in e && 'cumulative' in e), s60[0], '{date,expected,cumulative}');
eq('التنبؤ: عدد أيام السلسلة = 61 (30 يوم + البداية)', s60.length, 61);
near('التنبؤ: 60 يوماً — المتوقع 12,400', forecastTotal(fc60raw), 12400);
check('التنبؤ: المتوقع ≥ 6,400', forecastTotal(fc60raw) >= 6400, forecastTotal(fc60raw), '>= 6400');
check('التنبؤ: المتوقع يغطي المستحق الحالي (5,500) على الأقل', forecastTotal(fc60raw) >= 5500, forecastTotal(fc60raw), '>= 5500');
near('التنبؤ: مجموع الأحداث = الإجمالي المتوقع', U.sum(e60, (e) => e.expected), forecastTotal(fc60raw));
near('التنبؤ: رصيد الإغلاق = 9,598 + 12,400', fc60raw.closingBalance, 9598 + 12400);
near('التنبؤ: رصيد الفتح = الرصيد الحالي', fc60raw.openingBalance, 9598);

const ids60 = e60.map((e) => e.chargeId || `${e.templateId}|${e.date}`);
eq('التنبؤ: لا حدث مكرَّر (لا استحقاق مرتين)', new Set(ids60).size, ids60.length);
const studioEvents = e60.filter((e) => e.templateId === 't-studio-rent' || e.chargeId === 'c-2026-Q4-studio-rent');
eq('التنبؤ: الاستوديو يظهر مرة واحدة فقط', studioEvents.length, 1);
const paintEvents = e60.filter((e) => e.templateId === 't-ws-paint');
eq('التنبؤ: السمكرة المحصَّلة لا تظهر كاستحقاق قائم مرة أخرى', paintEvents.filter((e) => e.kind === 'receivable').length, 0);
eq('التنبؤ: كل الاستحقاقات القائمة (3) تظهر كأحداث receivable', e60.filter((e) => e.kind === 'receivable').length, 3);
near('التنبؤ: مجموع أحداث receivable = 5,500', U.sum(e60.filter((e) => e.kind === 'receivable'), (e) => e.expected), 5500);
near('التنبؤ 30 يوماً: = المستحق الحالي 5,500 بلا تكرار', forecastTotal(fc30raw), 5500);
eq('التنبؤ 30 يوماً: 3 أحداث فقط', forecastEvents(fc30raw).length, 3);
eq('التنبؤ: التواريخ مرتّبة تصاعدياً', s60.every((e, i) => i === 0 || s60[i - 1].date <= e.date), true);

/* فترات فارغة/معكوسة */
const emptyDay = noThrow('daySummary ليوم بلا حركات لا يرمي', () => F.daySummary(seed, '2030-01-01'));
if (emptyDay) {
  eq('يوم بلا حركات: دخل 0', emptyDay.income, 0);
  eq('يوم بلا حركات: مصروف 0', emptyDay.expense, 0);
  eq('يوم بلا حركات: صافي 0', emptyDay.net, 0);
  eq('يوم بلا حركات: عدد المعاملات 0', emptyDay.txCount, 0);
}

const rev = noThrow('rangeSummary بفترة معكوسة (from > to) لا يرمي', () => F.rangeSummary(seed, '2026-10-10', '2026-10-01'));
if (rev) {
  eq('فترة معكوسة: دخل 0', rev.income, 0);
  eq('فترة معكوسة: مصروف 0', rev.expense, 0);
  eq('فترة معكوسة: عدد المعاملات 0', rev.txCount, 0);
}
eq('rangeDays لفترة معكوسة = مصفوفة فارغة', U.rangeDays('2026-10-10', '2026-10-01').length, 0);
noThrow('rangeSummary لفترة فارغة تماماً لا يرمي', () => F.rangeSummary(seed, '2020-01-01', '2020-01-31'));
noThrow('daySummary بتاريخ غير صالح لا يرمي', () => F.daySummary(seed, 'not-a-date'));
noThrow('monthSummary بمفتاح غير صالح لا يرمي', () => F.monthSummary(seed, 'bogus', C.TODAY));
noThrow('receivables بلا تاريخ لا يرمي', () => F.receivables(seed));
noThrow('alerts لا يرمي', () => F.alerts(seed, C.TODAY));
noThrow('savingsStats لا يرمي', () => F.savingsStats(seed, '2026-10', C.TODAY));
noThrow('compareRanges لا يرمي', () => F.compareRanges(seed, { from: '2026-10-01', to: '2026-10-05' }, { from: '2026-09-01', to: '2026-09-30' }));
noThrow('state فارغ لا يرمي (كل الدوال)', () => {
  const empty = { accounts: [], transactions: [], charges: [], receipts: [], templates: [], settings: {} };
  F.totalBalance(empty);
  F.daySummary(empty, C.TODAY);
  F.rangeSummary(empty, '2026-10-01', C.TODAY);
  F.receivables(empty, C.TODAY);
  F.debts(empty);
  F.obligations(empty);
  F.dailySeries(empty, '2026-10-01', C.TODAY);
  F.monthlySeries(empty, 3, C.TODAY, C.TODAY);
  F.alerts(empty, C.TODAY);
  F.expenseByCategory(empty, '2026-10-01', C.TODAY);
  F.incomeBySource(empty, '2026-10-01', C.TODAY);
  F.topExpenses(empty, '2026-10-01', C.TODAY, 3);
  F.cashFlowForecast(empty, C.TODAY, 30);
  F.savingsStats(empty, '2026-10', C.TODAY);
  F.accumulatedFunds(empty);
  F.commitments(empty);
  F.dashboard(empty, C.TODAY);
  return true;
});

const al = F.alerts(seed, C.TODAY);
check('التنبيهات: مصفوفة غير فارغة', Array.isArray(al) && al.length > 0, al.length, '> 0');
check('التنبيهات: تنبيه «مستحق لي 5,500» موجود', al.some((a) => String(a.title).includes('5,500')), al.map((a) => a.title), 'يحتوي 5,500');
check('التنبيهات: تنبيه «مصروفات مخطّطة 1,680» موجود', al.some((a) => String(a.title).includes('1,680')), al.map((a) => a.title), 'يحتوي 1,680');
check('التنبيهات: لا يوجد أي تنبيه فيه كلمة «ديون عليّ»', !al.some((a) => /ديون عليّ/.test(String(a.title))), al.map((a) => a.title), 'لا ديون');

/* ================================================ 7) التصدير والاستيراد */

head('══ 7) التصدير والاستيراد (ذهاب وعودة) ══');

{
  let st = fresh();
  const before = {
    cash: F.cashBalance(st),
    saving: F.savingsBalance(st),
    total: F.totalBalance(st),
    tx: st.transactions.length,
    receipts: st.receipts.length,
    charges: st.charges.length,
    rec: F.receivables(st, C.TODAY).total,
    debts: F.debts(st).total,
    planned: F.obligations(st).total,
    funds: F.accumulatedFunds(st).total
  };

  const text = noThrow('exportJSON لا يرمي', () => Store.exportJSON());
  check('التصدير: نص غير فارغ', typeof text === 'string' && text.length > 100, typeof text === 'string' ? text.length : typeof text, '> 100 حرف');
  let parsed = null;
  noThrow('التصدير: JSON صالح', () => { parsed = JSON.parse(text); return true; });
  check('التصدير: يحتوي state', !!(parsed && parsed.state), parsed ? Object.keys(parsed) : null, 'state');
  near('التصدير: ملخص الرصيد داخل الملف = 9,598', parsed.summary.balance, 9598);

  Store.reset({ empty: true });
  const clean = Store.state;
  eq('نسخة نظيفة: بلا معاملات', clean.transactions.length, 0);
  eq('نسخة نظيفة: بلا استحقاقات', clean.charges.length, 0);
  near('نسخة نظيفة: الرصيد = الافتتاحي 6,500', F.totalBalance(clean), 6500);

  const imp = noThrow('importJSON لا يرمي', () => Store.importJSON(text));
  check('الاستيراد: ok = true', !!(imp && imp.ok), imp && imp.ok, true);
  st = Store.state;

  near('ذهاب وعودة: نفس رصيد النقد', F.cashBalance(st), before.cash);
  near('ذهاب وعودة: نفس رصيد الادخار', F.savingsBalance(st), before.saving);
  near('ذهاب وعودة: نفس الإجمالي', F.totalBalance(st), before.total);
  eq('ذهاب وعودة: نفس عدد المعاملات', st.transactions.length, before.tx);
  eq('ذهاب وعودة: نفس عدد السندات', st.receipts.length, before.receipts);
  eq('ذهاب وعودة: نفس عدد الاستحقاقات', st.charges.length, before.charges);
  near('ذهاب وعودة: نفس مستحق لي', F.receivables(st, C.TODAY).total, before.rec);
  near('ذهاب وعودة: نفس الديون (صفر)', F.debts(st).total, before.debts);
  near('ذهاب وعودة: نفس المخطّط', F.obligations(st).total, before.planned);
  near('ذهاب وعودة: نفس الأموال المجمّعة', F.accumulatedFunds(st).total, before.funds);
  near('ذهاب وعودة: نفس أرقام اليوم', F.daySummary(st, C.TODAY).net, 3098);
  eq('ذهاب وعودة: لا يتضاعف عدد المعاملات', st.transactions.length, 11);

  const bad = noThrow('importJSON بنص تالف لا يرمي', () => Store.importJSON('{ هذا ليس JSON'));
  check('الاستيراد: يرفض النص التالف', !!(bad && bad.ok === false), bad && bad.ok, false);
  const bad2 = Store.importJSON('{}');
  check('الاستيراد: يرفض كائناً بلا بيانات', !!(bad2 && bad2.ok === false), bad2 && bad2.ok, false);
  near('الاستيراد الفاشل لا يُفسد الحالة', F.cashBalance(Store.state), before.cash);
}

/* نسخة نظيفة تماماً: نعيد البذرة في نهاية القسم حتى لا تتأثر بقية الفحوص */
fresh();

/* ============================== 8) سلامة التحميل (وضع المتصفح الحقيقي) */

head('══ 8) سلامة التحميل: كل قيمة على الشاشة تُشتق من Finance ══');

/* 8.1 كل ملف يشير إليه index.html موجود فعلاً */
let html = '';
noThrow('قراءة index.html', () => { html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); return true; });
const localRefs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
check('index.html يشير لملفات محلية', localRefs.length > 0, localRefs.length, '> 0');
const missingRefs = localRefs.filter((r) => !fs.existsSync(path.join(ROOT, r.replace(/^\.\//, ''))));
eq('لا مسارات مكسورة في index.html', missingRefs.length, 0);
if (missingRefs.length) line('       ملفات ناقصة: ' + missingRefs.join(', '));

/* 8.1b كل سكربت يُحلَّل بلا أخطاء صياغة — نفس ما يفعله المتصفح قبل التنفيذ.
 * (هذا الفحص يمنع تكرار عطل store.js:170 و agent.js:677: ملف لا يُحلَّل = شاشة معطّلة/خطأ console) */
const scriptRefs = [...html.matchAll(/<script[^>]*src="(\.\/assets\/js\/[^"]+)"/g)].map((m) => m[1]);
check('index.html يحمّل سكربتات js', scriptRefs.length > 0, scriptRefs.length, '> 0');
const parseErrors = [];
for (const ref of scriptRefs) {
  const p = path.join(ROOT, ref.replace(/^\.\//, ''));
  if (!fs.existsSync(p)) { parseErrors.push(`${ref} — الملف مفقود`); continue; }
  try {
    new vm.Script(fs.readFileSync(p, 'utf8'), { filename: ref });
  } catch (e) {
    const where = String(e.stack || '').split('\n')[0].trim().replace(ROOT + path.sep, '').replace(/\\/g, '/');
    parseErrors.push(`${where || ref} — ${e.message}`);
  }
}
eq('كل سكربتات index.html تُحلَّل بلا أخطاء صياغة', parseErrors.length, 0);
parseErrors.forEach((p) => line('       ' + p));

/* 8.2 ترتيب السكربتات في index.html يسمح بالإقلاع فعلاً */
const declaredOrder = [...html.matchAll(/assets\/js\/([A-Za-z0-9._/-]+\.js)/g)].map((m) => m[1]);
const coreInDeclared = declaredOrder.filter((f) => DEP_ORDER.includes(f));
eq('index.html يحمّل الملفات الأربعة الأساسية', coreInDeclared.length, DEP_ORDER.length);
check(
  'index.html يحمّل finance.js قبل store.js',
  coreInDeclared.indexOf('finance.js') >= 0 && coreInDeclared.indexOf('finance.js') < coreInDeclared.indexOf('store.js'),
  coreInDeclared.join(' → '),
  'finance.js قبل store.js'
);

let bootResult = null;
let bootError = null;
try {
  const ctx = vm.createContext({ console });
  for (const rel of coreInDeclared) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, rel), 'utf8'), ctx, { filename: `assets/js/${rel}` });
  }
  bootResult = vm.runInContext(
    '(function(){ var s = Fin.Store.load(); return { cash: Fin.Finance.cashBalance(s), total: Fin.Finance.totalBalance(s), charges: s.charges.length }; })()',
    ctx
  );
} catch (e) {
  bootError = `${e.constructor.name}: ${e.message}`;
}
check(
  'الإقلاع بترتيب index.html الفعلي (Store.load) بلا استثناء',
  !bootError,
  bootError || bootResult,
  'بلا استثناء'
);
if (bootResult) {
  near('إقلاع المتصفح: رصيد الشنطة 8,098', bootResult.cash, 8098);
  near('إقلاع المتصفح: إجمالي الحسابات 9,598', bootResult.total, 9598);
  eq('إقلاع المتصفح: 5 استحقاقات', bootResult.charges, 5);
}

/* 8.3 لوحة الشاشات: كل قيمة مشتقة من Finance بلا DOM */
{
  const st = fresh();
  const dash = noThrow('Finance.dashboard يعمل بلا DOM', () => F.dashboard(st, C.TODAY));
  if (dash) {
    near('الشاشة: دخل اليوم 3,400', dash.day.income, 3400);
    near('الشاشة: مصروف اليوم 302', dash.day.expense, 302);
    near('الشاشة: صافي اليوم 3,098', dash.day.net, 3098);
    near('الشاشة: النقد 8,098', dash.cash, 8098);
    near('الشاشة: الادخار 1,500', dash.saving, 1500);
    near('الشاشة: الإجمالي 9,598', dash.totalBalance, 9598);
    near('الشاشة: مستحق لي 5,500', dash.receivables.total, 5500);
    near('الشاشة: لا ديون', dash.obligations.debtTotal === undefined ? 0 : dash.obligations.debtTotal, 0);
    near('الشاشة: مصروفات مخطّطة 1,680', dash.obligations.total, 1680);
    near('الشاشة: التزامات سنوية متبقية 5,000', dash.commitments.remainingTotal, 5000);
    near('الشاشة: الأموال المجمّعة 8,098', dash.funds.total, 8098);
    near('الشاشة: إيراد الشهر 3,400', dash.month.income, 3400);
    near('الشاشة: مصروف الشهر 302', dash.month.expense, 302);
    eq('الشاشة: 30 يوماً في السلسلة', dash.series30.length, 30);
    check('الشاشة: تنبيهات جاهزة للعرض', Array.isArray(dash.alerts) && dash.alerts.length > 0, dash.alerts.length, '> 0');
    check('الشاشة: أكبر البنود جاهزة', Array.isArray(dash.topCategories) && dash.topCategories.length === 5, dash.topCategories.length, 5);
    check('الشاشة: مصادر الدخل جاهزة', Array.isArray(dash.incomeSources) && dash.incomeSources.length >= 1, dash.incomeSources.length, '>= 1');
  }
  check('الشاشات مشتقة بلا document', typeof document === 'undefined', typeof document, 'undefined');
}

/* 8.4 PWA: قائمة precache في sw.js والمانيفست تشير لملفات موجودة */
{
  const swPath = path.join(ROOT, 'sw.js');
  const hasSw = fs.existsSync(swPath);
  check('sw.js موجود (معيار القبول 4)', hasSw, hasSw, true);
  if (hasSw) {
    const sw = fs.readFileSync(swPath, 'utf8');
    /* نقرأ مصفوفة PRECACHE صراحةً (وليس أي نص بين علامتين) لتفادي المطابقات العابرة للأسطر */
    const arr = /const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/.exec(sw);
    check('sw.js يعرّف قائمة PRECACHE', !!arr, !!arr, true);
    const paths = arr ? [...arr[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2]) : [];
    const uniq = [...new Set(paths)];
    const missing = uniq.filter((p) => p !== './' && !fs.existsSync(path.join(ROOT, p.replace(/^\.\//, ''))));
    check('قائمة precache غير فارغة', uniq.length >= 10, uniq.length, '>= 10');
    eq('كل مسارات precache موجودة على القرص', missing.length, 0);
    if (missing.length) line('       مسارات ناقصة: ' + missing.join(', '));

    const notCached = localRefs.filter((r) => /\.(js|css)$/.test(r) && !uniq.includes(r));
    eq('كل سكربتات/أنماط index.html داخل precache', notCached.length, 0);
    if (notCached.length) line('       غير مخزَّنة مسبقاً: ' + notCached.join(', '));

    const swVer = /const\s+APP_VERSION\s*=\s*'([^']+)'/.exec(sw);
    eq('إصدار sw.js يطابق C.VERSION', swVer ? swVer[1] : null, C.VERSION);
  }

  const mfPath = path.join(ROOT, 'manifest.webmanifest');
  const hasMf = fs.existsSync(mfPath);
  check('manifest.webmanifest موجود (معيار القبول 4)', hasMf, hasMf, true);
  if (hasMf) {
    let mf = null;
    noThrow('manifest.webmanifest صالح كـ JSON', () => { mf = JSON.parse(fs.readFileSync(mfPath, 'utf8')); return true; });
    if (mf) {
      check('المانيفست: name/short_name موجودان', !!mf.name && !!mf.short_name, Object.keys(mf).length, 'name + short_name');
      eq('المانيفست: dir = rtl', mf.dir, 'rtl');
      eq('المانيفست: lang = ar', mf.lang, 'ar');
      eq('المانيفست: display = standalone', mf.display, 'standalone');
      const icons = (mf.icons || []).map((i) => i.src);
      check('المانيفست: أيقونات معرّفة', icons.length >= 2, icons.length, '>= 2');
      const missingIcons = icons.filter((s) => !/^https?:/.test(s) && !fs.existsSync(path.join(ROOT, s.replace(/^\.?\//, ''))));
      eq('كل أيقونات المانيفست موجودة', missingIcons.length, 0);
      if (missingIcons.length) line('       أيقونات ناقصة: ' + missingIcons.join(', '));
    }
  }
}

/* 8.5 الراوتر يتبنّى الشاشات: كل شاشة تسجّل نفسها في Fin.Views عند التحميل
 * (ARCHITECTURE §4)، فيجب أن يصل الراوتر إليها بلا تسجيل يدوي من الخارج. */
{
  const stubEl = () => ({
    style: {}, dataset: {}, children: [], firstChild: null, parentNode: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, appendChild() {}, removeChild() {},
    insertBefore() {}, remove() {}, closest() { return null; },
    addEventListener() {}, removeEventListener() {}, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    textContent: '', innerHTML: '', value: ''
  });
  const sandbox = {
    console, Intl, Date, Math, JSON, Promise, Number, String, Boolean, Array, Object,
    RegExp, Error, isFinite, parseFloat, parseInt,
    /* مؤقّتات البيئة المصغّرة: لا تُبقي العملية حيّة ولا تُسقطها بعد الملخص */
    setTimeout(fn, ms) {
      const t = setTimeout(() => { try { fn(); } catch { /* بيئة مصغّرة */ } }, ms);
      if (t && typeof t.unref === 'function') t.unref();
      return t;
    },
    clearTimeout, setInterval, clearInterval,
    Node: function Node() {},
    Blob: class Blob { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
    FileReader: class FileReader { readAsText() {} }
  };
  sandbox.document = {
    readyState: 'complete', documentElement: stubEl(), body: stubEl(), head: stubEl(),
    addEventListener() {}, removeEventListener() {},
    getElementById() { return stubEl(); }, querySelector() { return stubEl(); },
    querySelectorAll() { return []; }, createElement() { return stubEl(); }, createElementNS() { return stubEl(); },
    createTextNode(t) { return { textContent: String(t) }; }, createDocumentFragment() { return stubEl(); }
  };
  sandbox.window = {
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; }
  };
  sandbox.location = { hash: '#/dashboard', href: 'http://localhost/', protocol: 'http:', replace() {} };
  sandbox.navigator = { userAgent: 'node' };

  const ctx2 = vm.createContext(sandbox);
  const bootErrors = [];
  for (const ref of scriptRefs) {
    const rel = ref.replace(/^\.\//, '');
    try {
      vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx2, { filename: rel });
    } catch (e) {
      if (e instanceof SyntaxError) bootErrors.push(`${rel} — ${e.message}`);
    }
  }
  eq('لا أخطاء صياغة عند تحميل سكربتات index.html', bootErrors.length, 0);
  bootErrors.forEach((p) => line('       ' + p));

  const boot = vm.runInContext(
    '({ views: Object.keys(Fin.Views || {}), router: (Fin.App && Fin.App.list ? Fin.App.list().map(function (v) { return v.id; }) : []), nav: (Fin.C.NAV || []).map(function (n) { return n.id; }) })',
    ctx2
  );
  check('6 شاشات مسجّلة في Fin.Views', boot.views.length >= 6, boot.views, '>= 6 شاشات');
  check(
    'الراوتر يتبنّى شاشات Fin.Views تلقائياً (بلا تسجيل يدوي)',
    boot.router.length >= 6,
    boot.router,
    '>= 6 شاشات في الراوتر'
  );
  const navMissing = boot.nav.filter((id) => !boot.views.includes(id));
  eq('كل تبويبات C.NAV لها شاشة مسجّلة (بما فيها المساعد)', navMissing.length, 0);
  if (navMissing.length) line('       تبويبات بلا شاشة: ' + navMissing.join(', '));

  /* الهوية البصرية: أيقونات SVG احترافية بلا إيموجي في الواجهة */
  const PICTO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}✕]/u;
  const uiFiles = ['assets/js/constants.js', 'assets/js/app.js', 'assets/js/ui.js', 'assets/js/icons.js']
    .concat(fs.readdirSync(path.join(ROOT, 'assets/js/views')).map((f) => 'assets/js/views/' + f));

  const offenders = [];
  for (const rel of uiFiles) {
    const srcLines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
    srcLines.forEach((l, i) => {
      if (PICTO.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim().slice(0, 80)}`);
    });
  }
  eq('لا إيموجي في أي ملف واجهة (أيقونات SVG فقط)', offenders.length, 0);
  offenders.slice(0, 10).forEach((o) => line('       ' + o));

  const iconCheck = vm.runInContext(
    `(function () {
       if (!Fin.I) return { ok: false };
       var names = Fin.I.names();
       var catsOk = Fin.C.EXPENSE_CATEGORIES.every(function (c) { return Fin.I.has(c.icon); }) &&
                    Fin.C.INCOME_CATEGORIES.every(function (c) { return Fin.I.has(c.icon); });
       var locOk = Fin.C.LOCATIONS.every(function (l) { return Fin.I.has(l.icon); });
       var navOk = Fin.C.NAV.every(function (n) { return Fin.I.has(n.icon); });
       var svg = Fin.I.svg('wallet');
       return {
         ok: true, count: names.length, catsOk: catsOk, locOk: locOk, navOk: navOk,
         isSvg: svg.indexOf('<svg') === 0 && svg.indexOf('stroke="currentColor"') > 0,
         hasDir: Fin.I.has('arrowUp') && Fin.I.has('arrowDown'),
         dirIncome: Fin.I.direction('income').name, dirExpense: Fin.I.direction('expense').name
       };
     })()`,
    ctx2
  );
  check('نظام الأيقونات Fin.I موجود', iconCheck.ok, iconCheck.ok, true);
  check('كل أيقونات فئات المصروفات والإيرادات معرّفة', iconCheck.catsOk, iconCheck.catsOk, true);
  check('كل أيقونات الأماكن معرّفة', iconCheck.locOk, iconCheck.locOk, true);
  check('كل أيقونات التبويبات معرّفة', iconCheck.navOk, iconCheck.navOk, true);
  check('الأيقونة تُصدَّر SVG بخط currentColor', iconCheck.isSvg, iconCheck.isSvg, true);
  check('أيقونات الاتجاه (صعود/هبوط) موجودة', iconCheck.hasDir, iconCheck.hasDir, true);
  eq('اتجاه الدخل = صعود', iconCheck.dirIncome, 'arrowUp');
  eq('اتجاه المصروف = هبوط', iconCheck.dirExpense, 'arrowDown');
  check('عدد الأيقونات المتاحة ≥ 70', iconCheck.count >= 70, iconCheck.count, '>= 70');

  /* كل أيقونة تُبنى فعلاً: عنصر <svg> فيه عناصر رسم صحيحة (يمنع أيقونات صامتة فارغة).
     نبني DOM مصغّراً حقيقياً هنا لأن stubEl العام مبسّط ولا يتتبّع الأبناء. */
  const svgBuilt = (() => {
    function makeNode(tag) {
      const n = {
        tagName: String(tag), childNodes: [], attributes: {}, className: '',
        appendChild(c) { this.childNodes.push(c); c.parentNode = this; return c; },
        setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        get firstChild() { return this.childNodes[0] || null; }
      };
      return n;
    }
    const doc = {
      createElement: (t) => makeNode(t),
      createElementNS: (ns, t) => makeNode(t),
      createTextNode: (t) => ({ nodeType: 3, textContent: String(t), childNodes: [] }),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {}, body: makeNode('body'), documentElement: makeNode('html')
    };
    const box = {
      document: doc, window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
      navigator: { userAgent: 'node' }, console, setTimeout, clearTimeout, Intl, JSON, Math, Date,
      localStorage: undefined
    };
    box.globalThis = box;
    const c2 = vm.createContext(box);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/icons.js'), 'utf8'), c2, { filename: 'icons.js' });
    return vm.runInContext(
      `(function () {
         var out = { total: 0, empty: [], noPath: [], badAttr: [] };
         Fin.I.names().forEach(function (name) {
           out.total++;
           var wrap = Fin.I.el(name);
           var svg = null;
           (wrap.childNodes || []).forEach(function (c) { if (String(c.tagName).toLowerCase() === 'svg') svg = c; });
           if (!svg) { out.empty.push(name); return; }
           if (svg.getAttribute('stroke') !== 'currentColor') out.badAttr.push(name + ':stroke');
           if (!svg.getAttribute('viewBox')) out.badAttr.push(name + ':viewBox');
           var drawable = (svg.childNodes || []).filter(function (k) {
             return ['path','circle','rect','ellipse','line','polyline','polygon'].indexOf(String(k.tagName).toLowerCase()) >= 0;
           });
           if (!drawable.length) { out.noPath.push(name); return; }
           drawable.forEach(function (d) {
             var t = String(d.tagName).toLowerCase();
             if (t === 'path' && !d.getAttribute('d')) out.badAttr.push(name + ':path بلا d');
             if (t === 'circle' && (!d.getAttribute('cx') || !d.getAttribute('r'))) out.badAttr.push(name + ':circle ناقص');
             if (t === 'rect' && (!d.getAttribute('width') || !d.getAttribute('height'))) out.badAttr.push(name + ':rect ناقص');
           });
         });
         return out;
       })()`,
      c2
    );
  })();
  check('كل الأيقونات (' + svgBuilt.total + ') تُبنى كعنصر SVG حقيقي', svgBuilt.empty.length === 0, svgBuilt.empty.slice(0, 6).join(', '));
  eq('لا أيقونة بلا عنصر رسم داخلي', svgBuilt.noPath.length, 0);
  eq('لا أيقونة بسمات ناقصة (stroke/viewBox/مسار)', svgBuilt.badAttr.length, 0);
  if (svgBuilt.badAttr.length) line('       ' + svgBuilt.badAttr.slice(0, 8).join(' | '));
  check('عدد الأيقونات المبنيّة = عدد الأسماء المعرّفة', svgBuilt.total === iconCheck.count, svgBuilt.total + ' / ' + iconCheck.count);
}

/* ================================================ ملاحظات العقد (غير محسوبة) */

head('══ 9) ملاحظات العقد ══');
if (!contractNotes.length) line('  (لا ملاحظات)');
line('  • الرقم «6,400» الوارد في جدول القصة غير مشتق من أي قاعدة:');
line('      - بنوده المذكورة نفسها: 1,500 + 1,900 + 2,000 + 2,000 = 7,400');
line('      - المحرّك بعد البذرة: 5,500 (لأن السمكرة 1,900 محصَّلة ومربوطة باستحقاقها)');
line('    المعتمد في هذا الاختبار هو 5,500 = محل 1,500 + استوديو 2,000 + حجرات 2,000.');
if (typeof seed !== 'undefined' && seed && seed.charges) {
  line(`  • الاستحقاقات المولَّدة: ${seed.charges.length} (منها ربعية واحدة: ${seed.charges.filter((c) => /-Q[1-4]$/.test(c.period)).map((c) => c.period).join(', ') || 'لا شيء'})`);
}

/* ================================================================== الملخص */

head('═'.repeat(60));
if (failures.length) {
  line(`❌ فحوص فاشلة (${failures.length}):`);
  failures.forEach((f, i) => {
    line(`  ${i + 1}. ${f.name}`);
    line(`     الفعلي: ${show(f.actual)}  |  المتوقع: ${show(f.expected)}`);
  });
  line('');
}
const total = pass + fail;
line(`النتيجة النهائية: PASS ${pass} / FAIL ${fail}   (من ${total} فحصاً)`);
line(fail === 0 ? '✅ كل الأرقام المالية مطابقة للمرجع.' : '❌ هناك فشل — راجع التفاصيل أعلاه.');
process.exitCode = fail === 0 ? 0 : 1;
