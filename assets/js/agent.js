/* =============================================================================
 * مصروفي — agent.js  [agent]
 * الوكيل الذكي: DeepSeek (Function / Tool calling) + محرّك محلي يعمل أوفلاين
 * + إدخال وإخراج صوتي + واجهة دردشة RTL جوال-أولاً.
 *
 * العقود (ARCHITECTURE.md §4) — بالضبط:
 *   Fin.Agent.mount(container)          بناء واجهة الدردشة داخل عنصر DOM
 *   Fin.Agent.ask(text)                 Promise<string>
 *   Fin.Agent.localAnswer(question,st)  نص بلا شبكة
 *   Fin.Agent.summarize(periodKey)      ملخص مكتوب ('today' | '2026-10' | '2026-Q4' | 'all')
 *   Fin.Agent.speak(text)               speechSynthesis إن توفّر
 *   Fin.Agent.listen({onResult,onEnd})  SpeechRecognition بلغة ar-LY أو null
 *   Fin.Agent.tools                     { name: {desc, args, run(state,args)} }
 *   Fin.Agent.isEnabled()               هل يوجد مفتاح API
 *   Fin.Agent.hasVoice()                هل الصوت مدعوم
 *
 * أمان: مفتاح DeepSeek لا يُسجَّل في console ولا يُكتب في أي ملف؛ يُقرأ من
 * Fin.Store.state.settings.agent.apiKey ويُحفظ فقط عبر Fin.Store.updateSettings.
 * لا مكتبات، بلا import/export، بلا innerHTML لمحتوى المستخدم (U.el/text فقط).
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U, F = Fin.Finance;

  var Agent = {};
  Fin.Agent = Agent;
  Agent.VERSION = '1.0.0';

  var API_URL = 'https://api.deepseek.com/chat/completions';
  var DEFAULT_MODEL = 'deepseek-chat';
  var TIMEOUT_MS = 45000;      // مهلة الطلب الواحد
  var MAX_TOOL_ROUNDS = 4;     // أقصى عدد جولات أدوات ثم إجابة نهائية
  var MAX_TOKENS = 900;
  var TEMPERATURE = 0.3;

  /* ------------------------------------------------------------- مساعدات عامة */

  function store() { return Fin.Store || null; }
  function currentState() { var s = Fin.Store; return (s && s.state) || null; }
  function money(n, opts) { return U.fmtMoney(n, opts); }
  function pctText(n) { return U.fmtNumber(Number(n) || 0, 1) + '%'; }
  function catOf(tx) { return (tx && tx.type === 'income') ? C.catIncome(tx.category) : C.catExpense(tx && tx.category); }
  function txLabel(tx) { if (!tx) return 'حركة'; return tx.label || (tx.note ? String(tx.note).slice(0, 60) : catOf(tx).label); }
  // اليوم المرجعي للمحرّك المحلي:
  //  1) تاريخ صريح يمرّره المستدعي (localAnswer(q, state, '2026-10-05')) أو الاختبار
  //  2) وإلا: تاريخ البذرة C.TODAY ما دام تاريخ الجهاز لم يتجاوزه (كي تظهر أرقام القصة صحيحة)،
  //     وبعدها يصبح تاريخ الجهاز الحقيقي.
  var refDate = null;
  function resolvedToday() {
    var sys = U.todayISO();
    return (sys <= C.TODAY) ? C.TODAY : sys;
  }
  function today() { return refDate || resolvedToday(); }
  function setRefDate(iso) { refDate = iso || null; return today(); }
  Agent.setReferenceDate = setRefDate;
  Agent.referenceDate = today;
  function toast(msg, tone) {
    var UIx = Fin.UI;
    if (UIx && typeof UIx.toast === 'function') { try { UIx.toast(msg, tone); } catch (e) { /* تجاهل */ } }
  }
  function chips(label, onClick) {
    var UIx = Fin.UI;
    if (UIx && typeof UIx.chip === 'function') { try { return UIx.chip(label, { onClick: onClick }); } catch (e) { /* fallthrough */ } }
    return U.el('button', { type: 'button', class: 'chip', text: label, onClick: onClick });
  }
  function goSettings() {
    try {
      if (Fin.App && typeof Fin.App.go === 'function') { Fin.App.go('settings'); return; }
    } catch (e) { /* تجاهل */ }
    try { if (typeof location !== 'undefined') location.hash = '#/settings'; } catch (e2) { /* تجاهل */ }
  }
  function receiptsOn(st, iso) {
    return U.sum(((st && st.receipts) || []).filter(function (r) { return r && r.date === iso; }), function (r) { return Number(r.amount) || 0; });
  }
  function countWord(n, one, few, many) {
    if (n === 1) return one;
    if (n === 2) return few;
    return (n >= 3 && n <= 10) ? many : one;
  }
  function itemWord(n) { return countWord(n, 'استحقاق', 'استحقاقان', 'استحقاقات'); }
  function lateText(n) { return countWord(n, 'متأخر ' + n + ' يوم', 'متأخر يومان', 'متأخر ' + n + ' أيام'); }

  /* ==========================================================================
   * 1) الأدوات الحقيقية — تُنفَّذ محلياً على Fin.Store.state
   * ======================================================================== */

  function T(name, desc, args, types, run) {
    Agent.tools[name] = { name: name, desc: desc, args: args || {}, types: types || {}, run: run };
  }

  // يقبل YYYY-MM-DD أو مفتاح شهر YYYY-MM أو ربع YYYY-Qx أو سنة YYYY
  function resolveBound(v, isTo) {
    if (!v) return null;
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var r = U.rangeOfPeriod(s);
    if (r) return isTo ? r.to : r.from;
    return null;
  }
  function pickRange(a) {
    var t = today();
    var from = resolveBound(a && a.from, false);
    var to = resolveBound(a && a.to, true);
    if (!from && !to) { from = U.startOfMonth(t); to = t; }
    else { if (!from) from = U.startOfMonth(to || t); if (!to) to = t; }
    if (from > to) { var tmp = from; from = to; to = tmp; }
    return { from: from, to: to, label: (from === to ? U.dateLabel(from) : (U.dateLabel(from, 'short') + ' → ' + U.dateLabel(to, 'short'))) };
  }
  function limitOf(v, def, max) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) n = def;
    return Math.min(Math.round(n), max || 50);
  }
  // تصنيف بمُرشِّح مكان/نوع (نظير expenseByCategory لكن مع locationId)
  function breakdown(st, from, to, type, opts) {
    var q = { type: type, paidOnly: true };
    if (opts && opts.locationId) q.locationId = opts.locationId;
    var txs = F.txInRange(st, from, to, q);
    var map = {}, total = 0;
    txs.forEach(function (tx) {
      var k = tx.category || (type === 'income' ? 'other_income' : 'other');
      if (!map[k]) map[k] = { key: k, amount: 0, count: 0 };
      map[k].amount += Number(tx.amount) || 0;
      map[k].count++;
      total += Number(tx.amount) || 0;
    });
    return Object.keys(map).map(function (k) {
      var c = (type === 'income') ? C.catIncome(k) : C.catExpense(k);
      return { key: k, label: c.label, icon: c.icon, amount: U.round(map[k].amount, 2), count: map[k].count, pct: U.pct(map[k].amount, total) };
    }).sort(function (x, y) { return y.amount - x.amount; });
  }
  function txBrief(tx) {
    return {
      id: tx.id, type: tx.type, date: tx.date, amount: Number(tx.amount) || 0,
      category: tx.category, categoryLabel: catOf(tx).label, label: tx.label || '',
      locationId: tx.locationId || null, accountId: tx.accountId || null,
      paid: tx.paid !== false, planned: !!tx.planned,
      note: String(tx.note || '').slice(0, 160), chargeId: tx.chargeId || null
    };
  }
  function receiptBrief(st, ch) {
    var paid = F.chargePaid(st, ch.id);
    var amount = Number(ch.amount) || 0;
    var status = paid <= 0.001 ? 'pending' : (paid + 0.001 >= amount ? 'paid' : 'partial');
    return {
      id: ch.id, templateId: ch.templateId, locationId: ch.locationId, label: ch.label,
      period: ch.period, periodLabel: U.periodLabel(ch.period), cycle: ch.cycle || 'monthly',
      dueDate: ch.dueDate, amount: U.round(amount, 2), paid: U.round(paid, 2),
      remaining: U.round(amount - paid, 2), status: status, daysLate: U.daysLate(ch.dueDate, today())
    };
  }

  Agent.tools = {};

  /* ---------------------------------------------------------------- الأدوات */

  T('get_summary',
    'ملخص فترة: الدخل والمصروف والصافي وأكبر البنود ومصادر الدخل. التواريخ YYYY-MM-DD. الافتراضي: من بداية الشهر حتى اليوم.',
    { from: 'بداية الفترة YYYY-MM-DD (اختياري)', to: 'نهاية الفترة YYYY-MM-DD (اختياري)' },
    { from: 'string', to: 'string' },
    function (st, a) {
      var r = pickRange(a);
      var s = F.rangeSummary(st, r.from, r.to);
      var cats = F.expenseByCategory(st, r.from, r.to, 6);
      var inc = F.incomeBySource(st, r.from, r.to, 6);
      return {
        from: r.from, to: r.to, label: s.label, days: s.days,
        income: s.income, expense: s.expense, net: s.net, txCount: s.txCount,
        savingRate: s.savingRate, avgDailyExpense: s.avgDailyExpense,
        unpaidUnrecorded: s.unpaid, planned: s.planned,
        topExpenses: cats.map(function (c) { return { category: c.key, label: c.label, amount: c.amount, pct: c.pct, count: c.count }; }),
        incomeSources: inc.map(function (c) { return { category: c.key, label: c.label, amount: c.amount, pct: c.pct, count: c.count }; }),
        byLocation: Object.keys(s.byLocation).map(function (k) {
          var loc = C.location(k);
          return { locationId: k, name: loc ? loc.name : k, amount: U.round(s.byLocation[k].amount, 2), count: s.byLocation[k].count };
        })
      };
    });

  T('get_expenses',
    'المصروفات في فترة: الإجمالي، التصنيفات مرتّبة تنازلياً، وأكبر المصروفات بالتفصيل. الافتراضي: الشهر الحالي حتى اليوم.',
    { from: 'بداية الفترة YYYY-MM-DD', to: 'نهاية الفترة YYYY-MM-DD', limit: 'عدد أكبر المصروفات (رقم)', locationId: 'مُرشِّح المكان: shop|studio|workshops|mech|rooms|other (اختياري)' },
    { from: 'string', to: 'string', limit: 'number', locationId: 'string' },
    function (st, a) {
      var r = pickRange(a);
      var opts = a && a.locationId ? { locationId: a.locationId } : null;
      var cats = opts ? breakdown(st, r.from, r.to, 'expense', opts) : F.expenseByCategory(st, r.from, r.to, 8);
      var txs = F.txInRange(st, r.from, r.to, { type: 'expense', paidOnly: true, locationId: (opts && opts.locationId) || undefined });
      var total = U.sum(txs, function (t) { return Number(t.amount) || 0; });
      var top = txs.slice().sort(function (x, y) { return (Number(y.amount) || 0) - (Number(x.amount) || 0); }).slice(0, limitOf(a && a.limit, 5, 20));
      return {
        from: r.from, to: r.to, label: r.label, total: U.round(total, 2), count: txs.length,
        byCategory: cats,
        top: top.map(function (t) { return { date: t.date, amount: Number(t.amount) || 0, label: t.label || '', note: t.note || '', categoryLabel: catOf(t).label, locationId: t.locationId || null }; })
      };
    });

  T('get_income',
    'الدخل في فترة: الإجمالي، المصادر، وحسب المكان (المحل/الاستوديو/الورش/الحجرات). الافتراضي: الشهر الحالي حتى اليوم.',
    { from: 'بداية الفترة YYYY-MM-DD', to: 'نهاية الفترة YYYY-MM-DD', locationId: 'مُرشِّح المكان (اختياري)' },
    { from: 'string', to: 'string', locationId: 'string' },
    function (st, a) {
      var r = pickRange(a);
      var opts = a && a.locationId ? { locationId: a.locationId } : null;
      var sources = opts ? breakdown(st, r.from, r.to, 'income', opts) : F.incomeBySource(st, r.from, r.to, 8);
      var byLoc = F.incomeByLocation(st, r.from, r.to);
      if (opts) byLoc = byLoc.filter(function (l) { return l.key === a.locationId; });
      var txs = F.txInRange(st, r.from, r.to, { type: 'income', paidOnly: true, locationId: (opts && opts.locationId) || undefined });
      return {
        from: r.from, to: r.to, label: r.label,
        total: U.round(U.sum(txs, function (t) { return Number(t.amount) || 0; }), 2), count: txs.length,
        bySource: sources,
        byLocation: byLoc.map(function (l) { return { locationId: l.key, name: l.label, amount: l.amount, pct: l.pct, count: l.count }; }),
        receiptsToday: receiptsOn(st, today())
      };
    });

  T('get_receivables',
    'المستحق لي ولم يُحصَّل بعد (ذمم): الإجمالي والتفاصيل مع تاريخ الاستحقاق وعدد أيام التأخير. asOf افتراضياً اليوم.',
    { asOf: 'التاريخ المرجعي YYYY-MM-DD (اختياري)', locationId: 'مُرشِّح المكان (اختياري)' },
    { asOf: 'string', locationId: 'string' },
    function (st, a) {
      var asOf = resolveBound(a && a.asOf, false) || today();
      var rec = F.receivables(st, asOf);
      var items = a && a.locationId ? rec.items.filter(function (i) { return i.locationId === a.locationId; }) : rec.items;
      return {
        asOf: asOf,
        total: a && a.locationId ? U.round(U.sum(items, function (i) { return i.remaining; }), 2) : rec.total,
        count: items.length,
        overdueTotal: U.round(U.sum(items.filter(function (i) { return i.daysLate > 0; }), function (i) { return i.remaining; }), 2),
        items: items.map(function (i) {
          return {
            label: i.label, locationId: i.locationId, periodLabel: i.periodLabel,
            amount: i.amount, paid: i.paid, remaining: i.remaining,
            dueDate: i.dueDate, daysLate: i.daysLate, status: i.status
          };
        }),
        collectedToday: receiptsOn(st, today())
      };
    });

  T('get_balance',
    'الأرصدة الحالية لكل حساب والإجمالي (نقد + ادخار)، مع دخل ومصروف اليوم.',
    {},
    {},
    function (st) {
      var b = F.balances(st);
      var d = F.daySummary(st, today());
      return {
        asOf: today(),
        total: F.totalBalance(st),
        cash: F.cashBalance(st),
        saving: F.savingsBalance(st),
        balances: b,
        accounts: (st.accounts || []).map(function (acc) { return { id: acc.id, name: acc.name, kind: acc.kind, balance: b[acc.id] }; }),
        today: { income: d.income, expense: d.expense, net: d.net, txCount: d.txCount }
      };
    });

  T('get_debts',
    'المصروفات المخطّطة التي لم تُدفع بعد (ليست ديوناً) + الالتزامات السنوية مثل رسوم المدرسة، والمتبقي من الرصيد.',
    {},
    {},
    function (st) {
      var ob = F.obligations(st);
      var cm = F.commitments ? F.commitments(st) : { list: [], remainingTotal: 0, annualTotal: 0, paidTotal: 0 };
      return {
        debtsTotal: 0,
        debtsCount: 0,
        hasDebts: false,
        note: 'لا ديون على المستخدم — لا يوجد أي دين مسجّل في هذا التطبيق.',
        plannedTotal: ob.total,
        plannedCount: ob.count,
        planned: ob.items.map(function (t) { return { label: t.label || catOf(t).label, amount: Number(t.amount) || 0, date: t.date, note: String(t.note || '').slice(0, 120), categoryLabel: catOf(t).label }; }),
        annualCommitments: cm.list.map(function (c) { return { label: c.label, annual: c.annual, paid: c.paidThisYear, remaining: c.remaining, pct: c.pct }; }),
        annualRemainingTotal: cm.remainingTotal,
        afterPayingAll: U.round(F.totalBalance(st) - ob.total, 2),
        cashAfterAllObligations: U.round(F.cashBalance(st) - ob.total, 2)
      };
    });

  T('get_forecast',
    'توقّع التدفق النقدي: الاستحقاقات غير المحصَّلة + الاستحقاقات القادمة من القوالب خلال عدد أيام، والرصيد المتوقّع في النهاية.',
    { days: 'عدد الأيام من اليوم (افتراضي 30)' },
    { days: 'number' },
    function (st, a) {
      var days = limitOf(a && a.days, 30, 365);
      var fc = F.cashFlowForecast(st, today(), days);
      return {
        asOf: fc.asOf, horizon: fc.horizon, days: days,
        openingBalance: fc.openingBalance, totalExpected: fc.totalExpected, closingBalance: fc.closingBalance,
        events: fc.events.slice(0, 12).map(function (e) { return { date: e.date, expected: e.expected, label: e.label, kind: e.kind }; })
      };
    });

  T('get_alerts',
    'تنبيهات مالية حالية (استحقاقات متأخرة، ديون، معدل صرف، حالة المساعد).',
    {},
    {},
    function (st) {
      return { asOf: today(), alerts: F.alerts(st, today()).map(function (a) { return { level: a.level, icon: a.icon, title: a.title, body: String(a.body || '').slice(0, 200) }; }) };
    });

  T('list_transactions',
    'سجل الحركات في فترة، مع إمكانية الفلترة بالنوع (income|expense|transfer). مرتّبة من الأحدث.',
    { from: 'بداية الفترة YYYY-MM-DD', to: 'نهاية الفترة YYYY-MM-DD', type: 'income أو expense أو transfer (اختياري)', limit: 'عدد الحركات (افتراضي 10)', locationId: 'مُرشِّح المكان (اختياري)' },
    { from: 'string', to: 'string', type: 'string', limit: 'number', locationId: 'string' },
    function (st, a) {
      var r = pickRange(a);
      var opts = { includePlanned: false };
      if (a && a.type) opts.type = a.type;
      if (a && a.locationId) opts.locationId = a.locationId;
      var txs = F.txInRange(st, r.from, r.to, opts);
      var lim = limitOf(a && a.limit, 10, 50);
      return {
        from: r.from, to: r.to, label: r.label, count: txs.length, shown: Math.min(lim, txs.length),
        transactions: txs.slice(0, lim).map(txBrief)
      };
    });

  T('compare_periods',
    'مقارنة فترتين: الدخل والمصروف والصافي والفرق بينهما. الافتراضي: هذا الشهر مقابل الشهر الماضي.',
    { fromA: 'بداية الفترة أ YYYY-MM-DD', toA: 'نهاية الفترة أ', fromB: 'بداية الفترة ب', toB: 'نهاية الفترة ب' },
    { fromA: 'string', toA: 'string', fromB: 'string', toB: 'string' },
    function (st, a) {
      var t = today();
      var lastEnd = U.addDays(U.startOfMonth(t), -1);
      var A = { from: resolveBound(a && a.fromA, false) || U.startOfMonth(t), to: resolveBound(a && a.toA, true) || t, label: 'الفترة أ' };
      var B = { from: resolveBound(a && a.fromB, false) || U.startOfMonth(lastEnd), to: resolveBound(a && a.toB, true) || U.endOfMonth(lastEnd), label: 'الفترة ب' };
      var cmp = F.compareRanges(st, A, B);
      return {
        a: { from: A.from, to: A.to, label: cmp.a.label, income: cmp.a.income, expense: cmp.a.expense, net: cmp.a.net },
        b: { from: B.from, to: B.to, label: cmp.b.label, income: cmp.b.income, expense: cmp.b.expense, net: cmp.b.net },
        delta: cmp.delta,
        noteB: (F.rangeSummary(st, B.from, B.to).txCount === 0) ? 'لا توجد حركات مسجّلة في الفترة ب' : ''
      };
    });

  T('get_charges',
    'كل الاستحقاقات (إيجارات وخلافه) وحالتها: مدفوع/جزئي/لم يُحصَّل، مع المتبقي وتاريخ الاستحقاق.',
    { locationId: 'مُرشِّح المكان (اختياري)' },
    { locationId: 'string' },
    function (st, a) {
      var list = (st.charges || []).slice().sort(function (x, y) { return String(x.dueDate) < String(y.dueDate) ? -1 : 1; });
      if (a && a.locationId) list = list.filter(function (ch) { return ch.locationId === a.locationId; });
      var briefs = list.map(function (ch) { return receiptBrief(st, ch); });
      return {
        count: briefs.length,
        totalAmount: U.round(U.sum(briefs, function (c) { return c.amount; }), 2),
        totalPaid: U.round(U.sum(briefs, function (c) { return c.paid; }), 2),
        totalRemaining: U.round(U.sum(briefs, function (c) { return c.remaining; }), 2),
        charges: briefs
      };
    });

  T('get_savings',
    'إحصاءات الادخار لشهر معيّن: الدخل والمصروف والصافي ونسبة الادخار ورصيد الادخار وكم شهر يكفي الرصيد.',
    { monthKey: 'مفتاح الشهر YYYY-MM (افتراضي: الشهر الحالي)' },
    { monthKey: 'string' },
    function (st, a) {
      var key = (a && /^\d{4}-\d{2}$/.test(String(a.monthKey))) ? String(a.monthKey) : U.monthKey(today());
      var sv = F.savingsStats(st, key, today());
      return {
        monthKey: sv.monthKey, label: U.monthLabel(sv.monthKey),
        income: sv.income, expense: sv.expense, net: sv.net, rate: sv.rate,
        savingBalance: sv.savingBalance, totalBalance: sv.totalBalance, cash: sv.cash,
        avgMonthlyExpense: sv.avgMonthlyExpense, monthsCovered: sv.monthsCovered
      };
    });

  /* ------------------------------------------------ مواصفة الأدوات للنموذج */

  Agent.toolSchemas = function () {
    return Object.keys(Agent.tools).map(function (name) {
      var t = Agent.tools[name], props = {};
      Object.keys(t.args || {}).forEach(function (k) {
        props[k] = { type: (t.types && t.types[k]) || 'string', description: t.args[k] };
      });
      return {
        type: 'function',
        function: { name: name, description: t.desc, parameters: { type: 'object', properties: props, required: [] } }
      };
    });
  };

  Agent.runTool = function (name, args, st) {
    var t = Agent.tools[name];
    if (!t) return { error: 'أداة غير معروفة: ' + name };
    try {
      var out = t.run(st || currentState(), args || {});
      return (out === undefined || out === null) ? {} : out;
    } catch (e) {
      return { error: 'فشل تنفيذ ' + name + ': ' + ((e && e.message) || String(e)) };
    }
  };

  function parseToolArgs(tc) {
    try { return JSON.parse((tc && tc.function && tc.function.arguments) || '{}') || {}; }
    catch (e) { return {}; }
  }

  /* ==========================================================================
   * 2) المحرّك المحلي — يفهم العربية واللهجة الليبية ويجيب بأرقام حقيقية
   * ======================================================================== */

  function normalize(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')      // تشكيل + تطويل
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[؟?!.,،؛:+"'()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function nz(arr) { return arr.map(normalize); }
  function has(t, words) {
    for (var i = 0; i < words.length; i++) { if (t.indexOf(words[i]) >= 0) return true; }
    return false;
  }

  var KW = {
    GREET: nz(['سلام', 'مرحبا', 'اهلا', 'هلا', 'صباح الخير', 'مساء الخير', 'شكرا', 'يعطيك', 'كيف حالك', 'من انت', 'شكون انت', 'ساعدني', 'مساعده', 'شن تقدر', 'شنهو تقدر', 'شنسوي']),
    RECV: nz(['لم احصل', 'ما حصلت', 'ماحصلت', 'غير محصل', 'مستحق', 'متاخر', 'ذمم', 'لم استلم', 'ما استلمت', 'ماحصلش', 'عليهم', 'يدفعون', 'لم يدفعوا', 'باقي عليهم', 'لم احصله', 'ما تحصّل', 'تحصيل متاخر', 'فلوس لي', 'لي عند']),
    CHARGES: nz(['استحقاق', 'ايجار', 'ايجارات', 'قوالب', 'الاستحقاقات', 'موعد الايجار']),
    DEBT: nz(['دين', 'ديون', 'عليا دين', 'علي دين', 'التزام', 'التزامات', 'مخطط', 'مخططة', 'مخططه', 'لم ادفع', 'لم ادفعه', 'ما دفعت', 'لازم ندفع', 'مطلوب مني', 'سلفه', 'سلفه عليا', 'رسوم المدرسه', 'المدرسه']),
    ADVICE: nz(['نصيح', 'انصحني', 'نصائح', 'كيف اوفر', 'اوفر', 'رايك', 'شن رايك', 'حلل', 'تحليل', 'من فضلك حلل', 'كيف احسن', 'خطه', 'وضعي المالي', 'مشوره', 'شن تنصح']),
    SAVE: nz(['ادخار', 'مدخرات', 'احتياطي', 'وفرت', 'توفير', 'مدخر', 'صندوق الطوارئ']),
    COMPARE: nz(['قارن', 'مقارنه', 'الفرق بين', 'مقابل', 'احسن من', 'افضل من', 'زياده عن']),
    FORECAST: nz(['توقع', 'متوقع', 'تنبو', 'الشهر الجاي', 'الشهر القادم', 'الايام الجايه', 'بكره', 'بكرا', 'قادم', 'سيوصلني', 'المستقبل']),
    BALANCE: nz(['رصيد', 'عندي', 'معي', 'فلوسي', 'متبقي', 'المتبقي', 'كاش', 'نقد', 'الشنطه', 'كم باقي لي', 'يكفي']),
    INCOME: nz(['دخل', 'دخلت', 'ايراد', 'وارد', 'حصلت', 'تحصيل', 'قبضت', 'استلمت', 'ربحت', 'جبنا']),
    EXPENSE: nz(['صرفت', 'صرف', 'مصروف', 'مصاريف', 'دفعت', 'خسرت', 'راحت', 'شريت', 'اشتريت', 'فاتوره']),
    TXLIST: nz(['حركات', 'معاملات', 'سجل', 'العمليات', 'شن سجلت', 'وريني', 'تفاصيل', 'اخر شي سجلت']),
    SUMMARY: nz(['ملخص', 'لخص', 'تقرير', 'احصائيات', 'اجمالي'])
  };

  var LOC_WORDS = [
    { id: 'mech', words: nz(['ميكانيك', 'الميكانيكيه', 'ورشه ميكانيكا']) },
    { id: 'workshops', words: nz(['سمكره', 'الطلاء', 'الصبغه', 'ورشه السمكره', 'الورشه الكبيره', 'ورشه']) },
    { id: 'studio', words: nz(['استوديو', 'الاستديو']) },
    { id: 'rooms', words: nz(['حجرات', 'الحجرات', 'غرف العمال', 'العمال']) },
    { id: 'shop', words: nz(['المحل', 'محلنا', 'الدكان']) }
  ];

  var MONTHS = [
    ['يناير', 1], ['فبراير', 2], ['مارس', 3], ['ابريل', 4], ['مايو', 5], ['يونيو', 6],
    ['يوليو', 7], ['يوليوز', 7], ['اغسطس', 8], ['سبتمبر', 9], ['اكتوبر', 10], ['نوفمبر', 11], ['ديسمبر', 12]
  ];

  function monthRangeOf(y, m) {
    var mm = (m < 10 ? '0' : '') + m;
    var key = y + '-' + mm;
    var r = U.rangeOfPeriod(key);
    return { key: key, from: r.from, to: r.to, label: U.monthLabel(key) };
  }

  // استخراج الفترة من الكلمات — يرجع دائماً {key, from, to, label}
  function detectRange(t) {
    var now = today(), y = +now.slice(0, 4), cm = +now.slice(5, 7);
    var cap = function (r) {
      if (r.from <= now && r.to > now) { r.to = now; r.label += ' — حتى اليوم'; }
      return r;
    };
    if (has(t, nz(['اول امس', 'قبل امس', 'اول امبارح']))) {
      var d2 = U.addDays(now, -2);
      return { key: 'day', from: d2, to: d2, label: 'أول أمس (' + U.dateLabel(d2) + ')' };
    }
    if (has(t, nz(['امبارح', 'امس', 'البارح', 'لبارح']))) {
      var d1 = U.addDays(now, -1);
      return { key: 'yesterday', from: d1, to: d1, label: 'أمس (' + U.dateLabel(d1) + ')' };
    }
    if (has(t, nz(['اليوم', 'اليومي', 'هاليوم', 'دلوقتي', 'الان']))) {
      return { key: 'today', from: now, to: now, label: 'اليوم (' + U.dateLabel(now) + ')' };
    }
    if (has(t, nz(['الشهر الماضي', 'الشهر اللي فات', 'شهر الماضي', 'الشهر الفايت', 'سبتمبر']))) {
      var le = U.addDays(U.startOfMonth(now), -1);
      return { key: 'lastMonth', from: U.startOfMonth(le), to: U.endOfMonth(le), label: 'الشهر الماضي (' + U.monthLabel(le) + ')' };
    }
    if (has(t, nz(['الاسبوع الماضي', 'الاسبوع اللي فات']))) {
      return { key: 'lastWeek', from: U.addDays(now, -13), to: U.addDays(now, -7), label: 'الأسبوع الماضي (7 أيام)' };
    }
    if (has(t, nz(['هذا الاسبوع', 'الاسبوع', 'هالاسبوع', 'اخر 7', 'اخر سبعه', '7 ايام', 'سبعه ايام', 'سبعة ايام']))) {
      return { key: 'week', from: U.addDays(now, -6), to: now, label: 'آخر 7 أيام' };
    }
    if (has(t, nz(['اخر 30', 'اخر ثلاثين', '30 يوم', 'ثلاثين يوم', 'اخر شهر']))) {
      return { key: 'last30', from: U.addDays(now, -29), to: now, label: 'آخر 30 يوماً' };
    }
    if (has(t, nz(['الربع الماضي', 'الربع اللي فات']))) {
      var qp = U.quarterRange(U.addMonths(now, -3));
      return { key: 'lastQuarter', from: qp.from, to: qp.to, label: 'الربع الماضي (' + U.periodLabel(qp.key) + ')' };
    }
    if (has(t, nz(['هذا الربع', 'الربع', 'الربع الحالي']))) {
      var q = U.quarterRange(now);
      return cap({ key: U.quarterKey(now), from: q.from, to: q.to, label: 'هذا الربع (' + U.periodLabel(q.key) + ')' });
    }
    if (has(t, nz(['السنه الماضيه', 'العام الماضي']))) {
      var py = (y - 1) + '-01-01';
      return { key: 'lastYear', from: py, to: U.endOfYear(py), label: 'سنة ' + (y - 1) };
    }
    if (has(t, nz(['هذه السنه', 'هالسنه', 'السنه', 'العام', 'هذا العام']))) {
      return { key: 'year', from: U.startOfYear(now), to: now, label: 'هذه السنة (' + y + ')' };
    }
    for (var i = 0; i < MONTHS.length; i++) {
      if (t.indexOf(MONTHS[i][0]) >= 0) {
        var m = MONTHS[i][1];
        return monthRangeOf(m <= cm ? y : y - 1, m);
      }
    }
    var explicit = /شهر\s+(\d{1,2})/.exec(t);
    if (explicit) {
      var em = +explicit[1];
      if (em >= 1 && em <= 12) return monthRangeOf(em <= cm ? y : y - 1, em);
    }
    if (has(t, nz(['كل الفتره', 'من البدايه', 'الكل', 'كل شي', 'من الاول']))) {
      var st = currentState();
      var dates = ((st && st.transactions) || []).map(function (x) { return x.date; }).filter(Boolean).sort();
      return { key: 'all', from: dates.length ? dates[0] : U.startOfYear(now), to: now, label: 'كل الفترة' };
    }
    if (has(t, nz(['هذا الشهر', 'الشهر', 'هالشهر', 'الشهر الحالي', 'هذا الشهر الحالي']))) {
      return cap({ key: U.monthKey(now), from: U.startOfMonth(now), to: U.endOfMonth(now), label: 'هذا الشهر (' + U.monthLabel(now) + ')' });
    }
    return cap({ key: U.monthKey(now), from: U.startOfMonth(now), to: U.endOfMonth(now), label: 'هذا الشهر (' + U.monthLabel(now) + ')' });
  }

  function detectLocation(t) {
    for (var i = 0; i < LOC_WORDS.length; i++) {
      if (has(t, LOC_WORDS[i].words)) return C.location(LOC_WORDS[i].id) || { id: LOC_WORDS[i].id, name: LOC_WORDS[i].id, icon: '📍' };
    }
    return null;
  }

  /* --------------------------------------------------------- بناء الإجابات */

  function ctxOf(question, st) {
    var q = normalize(question);
    return { q: q, raw: String(question || ''), state: st, range: detectRange(q), loc: detectLocation(q), today: today() };
  }

  function expenseAnswer(c) {
    var st = c.state, r = c.range;
    var s = F.rangeSummary(st, r.from, r.to);
    var cats = F.expenseByCategory(st, r.from, r.to, 6);
    var top = F.topExpenses(st, r.from, r.to, 1)[0];
    var out = ['💸 مصروف ' + r.label + ': ' + money(s.expense)];
    if (!cats.length) {
      out.push(s.txCount === 0 ? 'ما فيه أي حركة مسجلة في هذه الفترة.' : 'ما فيه مصروفات مدفوعة مسجلة في هذه الفترة.');
      out.push('للمقارنة، مصروف اليوم: ' + money(F.daySummary(st, today()).expense));
    } else {
      cats.forEach(function (x) { out.push('• ' + x.icon + ' ' + x.label + ': ' + money(x.amount) + ' (' + pctText(x.pct) + ')'); });
      if (top) out.push('أكبر بند: «' + txLabel(top) + '» ' + money(top.amount) + (top.note ? ' — ' + String(top.note).slice(0, 80) : ''));
    }
    out.push('دخل الفترة ' + money(s.income) + ' — الصافي ' + money(s.net, { sign: true }) + ' — عدد الحركات ' + s.txCount);
    return out.join('\n');
  }

  function incomeAnswer(c) {
    var st = c.state, r = c.range;
    var s = F.rangeSummary(st, r.from, r.to);
    var src = F.incomeBySource(st, r.from, r.to, 6);
    var byLoc = F.incomeByLocation(st, r.from, r.to);
    var out = ['💰 دخل ' + r.label + ': ' + money(s.income)];
    if (!src.length) {
      out.push('ما فيه دخل مسجل في هذه الفترة.');
      out.push('دخل اليوم: ' + money(F.daySummary(st, today()).income) + ' — ورصيدك الحالي ' + money(F.totalBalance(st)));
    } else {
      src.forEach(function (x) { out.push('• ' + x.icon + ' ' + x.label + ': ' + money(x.amount) + ' (' + pctText(x.pct) + ') — ' + x.count + ' حركة'); });
      if (byLoc.length) out.push('• حسب المكان: ' + byLoc.map(function (l) { return l.label + ' ' + money(l.amount); }).join('، '));
    }
    out.push('مصروف الفترة ' + money(s.expense) + ' — الصافي ' + money(s.net, { sign: true }));
    return out.join('\n');
  }

  function balanceAnswer(c) {
    var st = c.state;
    var b = F.balances(st), total = F.totalBalance(st);
    var d = F.daySummary(st, today());
    var ob = F.obligations(st), rec = F.receivables(st, today());
    var out = ['💵 رصيدك الآن: ' + money(total)];
    (st.accounts || []).forEach(function (acc) { out.push('• ' + (acc.icon || '•') + ' ' + acc.name + ': ' + money(b[acc.id])); });
    out.push('• اليوم: دخل ' + money(d.income) + ' — مصروف ' + money(d.expense) + ' — الصافي ' + money(d.net, { sign: true }));
    out.push('• مستحق لي (غير محصَّل): ' + money(rec.total) + ' — ولا ديون عليك ✅');
    if (c.q.indexOf('يكفي') >= 0 || c.q.indexOf('اكفي') >= 0) {
      var sv = F.savingsStats(st, U.monthKey(today()), today());
      if (sv.avgMonthlyExpense > 0) {
        out.push('• بمعدل مصروف شهري ' + money(sv.avgMonthlyExpense) + ' يكفي رصيدك ~' + U.fmtNumber(sv.monthsCovered, 1) + ' شهر.');
      } else {
        out.push('• ما فيه معدل صرف مسجل بعد — رصيدك كامل متاح.');
      }
      if (rec.total > 0) out.push('• وتحصيل ' + money(rec.total) + ' المستحق يزيدك إلى ' + money(total + rec.total) + '.');
      if (ob.total > 0) out.push('• وبعد دفع المخطّط (' + money(ob.total) + ') يبقى ' + money(total - ob.total) + '.');
    } else if (ob.total > 0) {
      out.push('• وبعد دفع المخطّط (' + money(ob.total) + ') يبقى ' + money(total - ob.total) + '.');
    }
    return out.join('\n');
  }

  function receivablesAnswer(c) {
    var st = c.state;
    var rec = F.receivables(st, today());
    var items = rec.items;
    if (c.loc) items = items.filter(function (i) { return i.locationId === c.loc.id; });
    var total = U.sum(items, function (i) { return i.remaining; });
    var collected = receiptsOn(st, today());
    var out = [];
    if (!items.length) {
      out.push('✅ ما فيه مستحق غير محصَّل' + (c.loc ? ' على ' + c.loc.name : '') + ' — كل الاستحقاقات محصَّلة.');
    } else {
      out.push('⏳ غير محصَّل' + (c.loc ? ' على ' + c.loc.name : '') + ': ' + money(total) + ' (' + items.length + ' ' + itemWord(items.length) + ')');
      items.slice(0, 8).forEach(function (i) {
        out.push('• ' + i.label + ' — ' + money(i.remaining) +
          ' — استحقاق ' + U.dateLabel(i.dueDate, 'short') +
          (i.daysLate > 0 ? ' (' + lateText(i.daysLate) + ')' : '') +
          (i.status === 'partial' ? ' [جزئي: حصّلت ' + money(i.paid) + ']' : '') +
          (i.periodLabel ? ' — ' + i.periodLabel : ''));
      });
      var late = U.sum(items.filter(function (i) { return i.daysLate > 0; }), function (i) { return i.remaining; });
      if (late > 0) out.push('• المتأخر منها: ' + money(late));
    }
    if (collected > 0) out.push('• حصّلت اليوم: ' + money(collected));
    return out.join('\n');
  }

  function chargesAnswer(c) {
    var st = c.state;
    var list = (st.charges || []).slice().sort(function (x, y) { return String(x.dueDate) < String(y.dueDate) ? -1 : 1; });
    if (c.loc) list = list.filter(function (ch) { return ch.locationId === c.loc.id; });
    var briefs = list.map(function (ch) { return receiptBrief(st, ch); });
    var total = U.sum(briefs, function (x) { return x.amount; });
    var paid = U.sum(briefs, function (x) { return x.paid; });
    var out = ['📋 الاستحقاقات' + (c.loc ? ' — ' + c.loc.name : '') + ': ' + briefs.length +
      ' — الإجمالي ' + money(total) + ' — محصَّل ' + money(paid) + ' — متبقي ' + money(total - paid)];
    if (!briefs.length) out.push('ما فيه استحقاقات مسجلة' + (c.loc ? ' على هذا المكان' : '') + '.');
    briefs.slice(0, 8).forEach(function (x) {
      var stat = x.status === 'paid' ? 'محصَّل ✅' : (x.status === 'partial' ? 'جزئي (' + money(x.paid) + ')' : 'لم يُحصَّل');
      out.push('• ' + x.label + ' [' + x.periodLabel + ']: ' + money(x.amount) + ' — ' + stat +
        ' — استحقاق ' + U.dateLabel(x.dueDate, 'short') + (x.daysLate > 0 ? ' (' + lateText(x.daysLate) + ')' : ''));
    });
    return out.join('\n');
  }

  function debtsAnswer(c) {
    var st = c.state;
    var ob = F.obligations(st);
    var cm = F.commitments ? F.commitments(st) : { list: [], remainingTotal: 0 };
    var out = ['✅ لا ديون عليك — ما فيه أي دين مسجّل.'];
    if (ob.items.length) {
      out.push('📌 عندك مصروفات مخطّطة (لم تُدفع بعد، وليست ديوناً): ' + money(ob.total));
      ob.items.slice(0, 6).forEach(function (t) { out.push('• ' + txLabel(t) + ': ' + money(t.amount) + (t.note ? ' — ' + String(t.note).slice(0, 70) : '')); });
    } else {
      out.push('📌 ما فيه مصروفات معلّقة.');
    }
    if (cm.remainingTotal > 0) {
      out.push('🏫 التزامات سنوية متبقية: ' + money(cm.remainingTotal) +
        ' (' + cm.list.map(function (x) { return x.label + ' متبقٍ ' + money(x.remaining) + ' من ' + money(x.annual); }).join('، ') + ')');
    }
    out.push('• النقد في الصندوق: ' + money(F.cashBalance(st)) + ' — إجمالي أموالك ' + money(F.totalBalance(st)) + '.');
    if (ob.total > 0) out.push('• لو دفعت كل المخطّط (' + money(ob.total) + ') يبقى في الصندوق ' + money(F.cashBalance(st) - ob.total) + '.');
    return out.join('\n');
  }

  function savingsAnswer(c) {
    var st = c.state;
    var key = /^\d{4}-\d{2}$/.test(String(c.range.key)) ? c.range.key : U.monthKey(c.range.from);
    var sv = F.savingsStats(st, key, today());
    var out = ['🏦 الادخار — ' + U.monthLabel(sv.monthKey)];
    out.push('• دخل ' + money(sv.income) + ' — مصروف ' + money(sv.expense) + ' — الصافي ' + money(sv.net, { sign: true }));
    out.push('• نسبة الادخار: ' + pctText(sv.rate));
    out.push('• رصيد الادخار: ' + money(sv.savingBalance) + ' — النقد: ' + money(sv.cash) + ' — الإجمالي ' + money(sv.totalBalance));
    out.push('• متوسط مصروفك الشهري ' + money(sv.avgMonthlyExpense) + ' → رصيدك يكفي ~' + U.fmtNumber(sv.monthsCovered, 1) + ' شهر.');
    return out.join('\n');
  }

  function adviceAnswer(c) {
    var st = c.state;
    var key = U.monthKey(today());
    var ms = F.monthSummary(st, key, today());
    var cats = F.expenseByCategory(st, U.startOfMonth(today()), today());
    var rec = F.receivables(st, today());
    var ob = F.obligations(st);
    var cmStat = F.commitments ? F.commitments(st) : { total: 0, remainingTotal: 0 };
    var cm = { total: cmStat.remainingTotal || 0 };
    var cash = F.cashBalance(st), saving = F.savingsBalance(st), total = F.totalBalance(st);
    var out = [];
    var keyed = !!apiKey();
    if (!keyed) out.push('ℹ️ التحليل الذكي (DeepSeek) يحتاج مفتاح API من الإعدادات — وهذا تحليل محلي من أرقامك الفعلية:');
    out.push('📊 وضعك في ' + U.monthLabel(key) + ': دخل ' + money(ms.income) + ' — مصروف ' + money(ms.expense) +
      ' — صافي ' + money(ms.net, { sign: true }) + ' (نسبة ادخار ' + pctText(ms.savingRate) + ')');
    if (cats.length) out.push('• أعلى بند: ' + cats[0].icon + ' ' + cats[0].label + ' ' + money(cats[0].amount) + ' (' + pctText(cats[0].pct) + ') — أول شي تراقبه.');
    if (ms.avgDailyExpense > 0) out.push('• معدل صرفك اليومي ' + money(ms.avgDailyExpense) + ' ≈ ' + money(U.round(ms.avgDailyExpense * 30, 2)) + ' بالشهر.');
    if (rec.total > 0) {
      out.push('• عندك ' + money(rec.total) + ' مستحق غير محصَّل' +
        (ob.total > 0
          ? (rec.total >= ob.total ? ' — يغطي مصروفاتك المخطّطة ' + money(ob.total) + ' ويزيد ' + money(rec.total - ob.total) + '.'
            : ' — وبالمقابل عندك مصروفات مخطّطة ' + money(ob.total) + '، والباقي ' + money(ob.total - rec.total) + '.')
          : '.'));
    }
    if (ob.total > 0 && cash > ob.total) {
      out.push('• توصية: خصّص ' + money(ob.total) + ' من النقد للمصروفات المخطّطة، وخلّي ' + money(saving) + ' احتياطي ما تلمسه.');
    } else if (ob.total > 0) {
      out.push('• توصية: غطِّ المصروفات المخطّطة (' + money(ob.total) + ') أول ما تحصّل ' + money(rec.total) + ' المستحق، لأن نقدك ' + money(cash) + ' أقل منها.');
    } else {
      out.push('• توصية: حوّل 10% من كل تحصيل للادخار — رصيدك الحالي ' + money(total) + ' والادخار ' + money(saving) + '.');
    }
    if (cm.total > 0) out.push('• التزامات سنوية متبقية: ' + money(cm.total) + '.');
    return out.join('\n');
  }

  function compareAnswer(c) {
    var st = c.state, now = today();
    var A, B;
    if (c.q.indexOf('اسبوع') >= 0) {
      A = { from: U.addDays(now, -6), to: now, label: 'آخر 7 أيام' };
      B = { from: U.addDays(now, -13), to: U.addDays(now, -7), label: 'الـ 7 أيام اللي قبلها' };
    } else {
      var le = U.addDays(U.startOfMonth(now), -1);
      A = { from: U.startOfMonth(now), to: now, label: U.monthLabel(now) };
      B = { from: U.startOfMonth(le), to: U.endOfMonth(le), label: U.monthLabel(le) };
    }
    var cmp = F.compareRanges(st, A, B);
    var out = ['📊 ' + cmp.a.label + ' مقابل ' + cmp.b.label];
    out.push('• الدخل: ' + money(cmp.a.income) + ' مقابل ' + money(cmp.b.income) + ' (' + money(cmp.delta.income, { sign: true }) + ')');
    out.push('• المصروف: ' + money(cmp.a.expense) + ' مقابل ' + money(cmp.b.expense) + ' (' + money(cmp.delta.expense, { sign: true }) +
      (cmp.b.expense > 0 ? ' — ' + pctText(cmp.delta.expensePct) : '') + ')');
    out.push('• الصافي: ' + money(cmp.a.net, { sign: true }) + ' مقابل ' + money(cmp.b.net, { sign: true }) + ' (الفرق ' + money(cmp.delta.net, { sign: true }) + ')');
    if (F.rangeSummary(st, B.from, B.to).txCount === 0) out.push('• ملاحظة: ما فيه حركات مسجّلة في ' + B.label + ' — البيانات تبدأ من اليوم المسجَّل في التطبيق.');
    return out.join('\n');
  }

  function forecastAnswer(c) {
    var st = c.state;
    var days = 30;
    if (c.q.indexOf('اسبوع') >= 0) days = 7;
    else if (c.q.indexOf('سنه') >= 0 || c.q.indexOf('سنة') >= 0) days = 365;
    else if (c.q.indexOf('3 شهور') >= 0 || c.q.indexOf('ثلاث شهور') >= 0 || c.q.indexOf('90') >= 0) days = 90;
    var fc = F.cashFlowForecast(st, today(), days);
    var out = ['🔮 المتوقع خلال ' + days + ' يوم (' + U.dateLabel(fc.asOf, 'short') + ' → ' + U.dateLabel(fc.horizon, 'short') + ')'];
    out.push('• رصيدك الحالي: ' + money(fc.openingBalance));
    out.push('• متوقع تحصيله: ' + money(fc.totalExpected));
    out.push('• الرصيد المتوقع في النهاية: ' + money(fc.closingBalance));
    if (fc.events.length) {
      fc.events.slice(0, 5).forEach(function (e) { out.push('• ' + U.dateLabel(e.date, 'short') + ': ' + e.label + ' — ' + money(e.expected)); });
    } else {
      out.push('• ما فيه استحقاقات قادمة مسجّلة خلال هذه المدة.');
    }
    return out.join('\n');
  }

  function locationAnswer(c) {
    var st = c.state, r = c.range, loc = c.loc;
    var txs = F.txInRange(st, r.from, r.to, { locationId: loc.id });
    var income = U.sum(txs.filter(function (t) { return t.type === 'income' && F.affectsBalance(t); }), function (t) { return Number(t.amount) || 0; });
    var expense = U.sum(txs.filter(function (t) { return t.type === 'expense' && F.affectsBalance(t); }), function (t) { return Number(t.amount) || 0; });
    var out = [loc.name + ' — ' + r.label];
    if (!txs.length) {
      out.push('• ما فيه حركات مسجّلة على هذا المكان في هذه الفترة.');
    } else {
      out.push('• دخل: ' + money(income) + ' — مصروف: ' + money(expense) + ' — الصافي ' + money(income - expense, { sign: true }) + ' (' + txs.length + ' حركة)');
      txs.slice(0, 4).forEach(function (t) { out.push('• ' + U.dateLabel(t.date, 'short') + ' — ' + txLabel(t) + ': ' + money(t.amount) + (t.paid === false ? ' (لم يُسدَّد)' : '')); });
    }
    var rec = F.receivables(st, today()).items.filter(function (i) { return i.locationId === loc.id; });
    if (rec.length) {
      out.push('• مستحق عليه: ' + money(U.sum(rec, function (i) { return i.remaining; })) + ' — ' +
        rec.map(function (i) { return i.label + ' (' + money(i.remaining) + '، استحقاق ' + U.dateLabel(i.dueDate, 'short') + ')'; }).join('، '));
    }
    if (loc.note) out.push('• ' + loc.note);
    return out.join('\n');
  }

  function txAnswer(c) {
    var st = c.state, r = c.range;
    var txs = F.txInRange(st, r.from, r.to, { includePlanned: false });
    var out = ['🧾 حركات ' + r.label + ': ' + txs.length];
    if (!txs.length) {
      out.push('ما فيه حركات مسجلة في هذه الفترة.');
    } else {
      txs.slice(0, 8).forEach(function (t) {
        var sign = t.type === 'income' ? '+' : (t.type === 'expense' ? '−' : '=');
        out.push('• ' + U.dateLabel(t.date, 'short') + ' — ' + txLabel(t) + ': ' + sign + U.fmtMoney(t.amount, { currency: false }) + ' د.ل' +
          (t.paid === false ? ' (لم يُسدَّد)' : '') + (t.planned ? ' (مخطّط)' : ''));
      });
    }
    var d = F.daySummary(st, today());
    out.push('• اليوم: دخل ' + money(d.income) + ' — مصروف ' + money(d.expense) + ' — الصافي ' + money(d.net, { sign: true }));
    return out.join('\n');
  }

  function helpAnswer(c) {
    var st = c.state;
    var total = F.totalBalance(st);
    var d = F.daySummary(st, today());
    var rec = F.receivables(st, today());
    var out = ['👋 أهلاً! أنا مساعدك المالي — أجاوب من أرقامك الفعلية' + (apiKey() ? '.' : ' (والمحرّك المحلي شغّال بلا إنترنت).')];
    out.push('• رصيدك الآن: ' + money(total) + ' — اليوم: دخل ' + money(d.income) + '، مصروف ' + money(d.expense) + '، الصافي ' + money(d.net, { sign: true }));
    out.push('• مستحق لي: ' + money(rec.total) + ' — ولا ديون عليك ✅');
    out.push('جرّب: «كم صرفت اليوم؟» — «ما الذي لم أحصّله؟» — «وين راحت الفلوس؟» — «هل يكفي رصيدي؟»');
    return out.join('\n');
  }

  function fallbackAnswer(c, prefix) {
    var st = c.state;
    var total = F.totalBalance(st), b = F.balances(st);
    var d = F.daySummary(st, today());
    var rec = F.receivables(st, today());
    var ob = F.obligations(st);
    var out = [prefix || '🤔 ما فهمت السؤال بالضبط — هذا اللي عندي من أرقامك:'];
    out.push('• رصيدك: ' + money(total) + ' (نقد ' + money(b.cash || 0) + ' + ادخار ' + money(b.saving || 0) + ')');
    out.push('• اليوم: دخل ' + money(d.income) + ' — مصروف ' + money(d.expense) + ' — الصافي ' + money(d.net, { sign: true }));
    out.push('• مستحق لي (غير محصَّل): ' + money(rec.total) + ' — مصروفات مخطّطة: ' + money(ob.total) + ' (لا ديون عليك)');
    if (has(c.q, KW.ADVICE) && !apiKey()) out.push('ℹ️ التحليل الذكي يحتاج مفتاح DeepSeek من الإعدادات — أضفه وأحلّل لك بعمق.');
    out.push('اسألني: «كم صرفت اليوم؟» — «ما الذي لم أحصّله؟» — «ملخص هذا الشهر» — «قارن هذا الشهر بالماضي».');
    return out.join('\n');
  }

  Agent.localAnswer = function (question, st, asOfISO) {
    st = st || currentState();
    if (!st) return 'ما عندي بيانات محمّلة بعد — أعد فتح التطبيق وحاول مرة ثانية.';
    // تاريخ مرجعي اختياري (للاختبارات أو لعرض تاريخ محدد)، ويُعاد للجهاز بعد الانتهاء
    var previous = refDate;
    if (asOfISO) refDate = asOfISO;
    try {
      var c = ctxOf(question, st);
      if (!c.q) return fallbackAnswer(c, 'اكتب سؤالك وأنا أجاوب من أرقامك الحقيقية:');
      if (has(c.q, KW.GREET)) return helpAnswer(c);
      if (has(c.q, KW.CHARGES)) return chargesAnswer(c);
      if (has(c.q, KW.RECV)) return receivablesAnswer(c);
      if (has(c.q, KW.DEBT)) return debtsAnswer(c);
      if (has(c.q, KW.ADVICE)) return adviceAnswer(c);
      if (has(c.q, KW.SAVE)) return savingsAnswer(c);
      if (has(c.q, KW.COMPARE)) return compareAnswer(c);
      if (has(c.q, KW.FORECAST)) return forecastAnswer(c);
      if (has(c.q, KW.BALANCE)) return balanceAnswer(c);
      if (c.loc) return locationAnswer(c);
      if (has(c.q, KW.INCOME)) return incomeAnswer(c);
      if (has(c.q, KW.EXPENSE)) return expenseAnswer(c);
      if (has(c.q, KW.TXLIST)) return txAnswer(c);
      if (has(c.q, KW.SUMMARY)) return Agent.summarize(c.range.key === 'today' ? 'today' : c.range.key);
      return fallbackAnswer(c, '🤔 ما فهمت السؤال بالضبط — هذا اللي عندي من أرقامك:');
    } finally {
      refDate = previous;
    }
  };

  /* ==========================================================================
   * 3) الملخصات المكتوبة (بلا شبكة)
   * ======================================================================== */

  function rangeFromKey(key, st) {
    var now = today();
    var k = key === null || key === undefined || key === '' ? 'month' : String(key).trim();
    var low = k.toLowerCase();
    if (low === 'today' || k === 'اليوم') return { key: 'today', from: now, to: now, label: 'اليوم (' + U.dateLabel(now) + ')' };
    if (low === 'yesterday' || k === 'أمس' || k === 'امس') {
      var y1 = U.addDays(now, -1);
      return { key: 'yesterday', from: y1, to: y1, label: 'أمس (' + U.dateLabel(y1) + ')' };
    }
    if (low === 'week') return { key: 'week', from: U.addDays(now, -6), to: now, label: 'آخر 7 أيام' };
    if (low === 'month') return { key: U.monthKey(now), from: U.startOfMonth(now), to: now, label: 'هذا الشهر (' + U.monthLabel(now) + ') — حتى اليوم' };
    if (low === 'lastmonth') {
      var le = U.addDays(U.startOfMonth(now), -1);
      return { key: U.monthKey(le), from: U.startOfMonth(le), to: U.endOfMonth(le), label: U.monthLabel(le) };
    }
    if (low === 'quarter') {
      var q = U.quarterRange(now);
      return { key: U.quarterKey(now), from: q.from, to: now, label: 'هذا الربع (' + U.periodLabel(q.key) + ') — حتى اليوم' };
    }
    if (low === 'year') return { key: 'year', from: U.startOfYear(now), to: now, label: 'هذه السنة (' + now.slice(0, 4) + ') — حتى اليوم' };
    if (low === 'all') {
      var dates = ((st.transactions) || []).map(function (x) { return x.date; }).filter(Boolean).sort();
      return { key: 'all', from: dates.length ? dates[0] : U.startOfYear(now), to: now, label: 'كل الفترة' };
    }
    var r = U.rangeOfPeriod(k);
    if (r) {
      var to = r.to, label = U.periodLabel(k) || r.key;
      if (r.from <= now && to > now) { to = now; label += ' — حتى اليوم'; }
      return { key: k, from: r.from, to: to, label: label };
    }
    return { key: U.monthKey(now), from: U.startOfMonth(now), to: now, label: 'هذا الشهر (' + U.monthLabel(now) + ') — حتى اليوم' };
  }

  function summaryText(st, range) {
    var lines = F.summaryLines(st, range.from, range.to);
    return '📅 ملخص ' + range.label + '\n• ' + lines.join('\n• ');
  }

  Agent.summarize = function (periodKey) {
    var st = currentState();
    if (!st) return 'ما عندي بيانات محمّلة بعد.';
    return summaryText(st, rangeFromKey(periodKey, st));
  };

  Agent.rangeFromKey = rangeFromKey;

  /* ==========================================================================
   * 4) الصوت (Web Speech API — اختياري)
   * ======================================================================== */

  Agent.hasVoice = function () {
    try {
      return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
    } catch (e) { return false; }
  };

  function speechText(text) {
    var s = String(text === null || text === undefined ? '' : text);
    s = s.replace(/[\uD800-\uDFFF]/g, ' ');                     // إيموجي
    s = s.replace(/[\u2022\u25CF\u25AA\u2190-\u21FF\u2600-\u27BF\uFE0F]/g, ' ');
    s = s.replace(/[#*_`>|]/g, ' ');
    s = s.replace(/[−–—]/g, ' ').replace(/[()\[\]{}]/g, ' ');
    s = s.replace(/[\r\n]+/g, '، ');
    s = s.replace(/\s+/g, ' ').replace(/،\s*،/g, '،').trim();
    return s.slice(0, 600);
  }
  Agent.speechText = speechText;

  Agent.speak = function (text) {
    if (!Agent.hasVoice()) return false;
    var clean = speechText(text);
    if (!clean) return false;
    try {
      var synth = window.speechSynthesis;
      try { synth.cancel(); } catch (e) { /* تجاهل */ }
      var u = new window.SpeechSynthesisUtterance(clean);
      u.lang = 'ar-LY';
      u.rate = 1;
      u.pitch = 1;
      try {
        var voices = synth.getVoices() || [];
        for (var i = 0; i < voices.length; i++) {
          if (/^ar(\b|-|_)/i.test(voices[i].lang || '')) { u.voice = voices[i]; break; }
        }
      } catch (e2) { /* تجاهل */ }
      synth.speak(u);
      return true;
    } catch (e3) { return false; }
  };

  Agent.stopSpeaking = function () {
    if (!Agent.hasVoice()) return false;
    try { window.speechSynthesis.cancel(); return true; } catch (e) { return false; }
  };

  Agent.listen = function (opts) {
    opts = opts || {};
    var SR = null;
    try { SR = root.SpeechRecognition || root.webkitSpeechRecognition || null; } catch (e) { SR = null; }
    if (!SR) {
      if (typeof opts.onEnd === 'function') { try { opts.onEnd({ ok: false, error: 'unsupported' }); } catch (e2) { /* تجاهل */ } }
      return null;
    }
    var rec;
    try { rec = new SR(); } catch (e3) { return null; }
    rec.lang = 'ar-LY';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    var finished = false, got = false;
    function finish(info) {
      if (finished) return;
      finished = true;
      if (typeof opts.onEnd === 'function') { try { opts.onEnd(info || { ok: got }); } catch (e) { /* تجاهل */ } }
    }
    rec.onresult = function (ev) {
      var txt = '';
      try {
        for (var i = 0; i < ev.results.length; i++) {
          var res = ev.results[i];
          if (res && res[0] && res[0].transcript) txt += res[0].transcript;
        }
      } catch (e) { /* تجاهل */ }
      txt = String(txt).trim();
      if (txt) {
        got = true;
        if (typeof opts.onResult === 'function') { try { opts.onResult(txt); } catch (e2) { /* تجاهل */ } }
      }
    };
    rec.onerror = function (ev) {
      var code = (ev && ev.error) ? ev.error : 'unknown';
      var msg = (code === 'not-allowed' || code === 'service-not-allowed') ? 'المتصفح ما عطاك إذن المايكروفون.'
        : code === 'no-speech' ? 'ما سمعت صوت — جرّب مرة ثانية.'
          : code === 'audio-capture' ? 'ما لقيت مايكروفون متصل.'
            : code === 'network' ? 'الإدخال الصوتي يحتاج إنترنت في هذا المتصفح.'
              : 'صار خطأ في الإدخال الصوتي.';
      if (typeof opts.onError === 'function') { try { opts.onError(code, msg); } catch (e) { /* تجاهل */ } }
      finish({ ok: false, error: code, message: msg });
    };
    rec.onend = function () { finish({ ok: got }); };

    try { rec.start(); } catch (e4) { finish({ ok: false, error: 'start-failed' }); return null; }
    return {
      stop: function () { try { rec.stop(); } catch (e) { /* تجاهل */ } },
      abort: function () { try { rec.abort(); } catch (e) { /* تجاهل */ } },
      recognition: rec
    };
  };

  /* ==========================================================================
   * 5) عميل DeepSeek (مكالمة مباشرة من المتصفح)
   * ======================================================================== */

  function agentSettings() {
    var s = store();
    return (s && s.state && s.state.settings && s.state.settings.agent) || {};
  }
  function apiKey() {
    var k = agentSettings().apiKey;
    return (typeof k === 'string') ? k.trim() : '';
  }
  function modelName() {
    var m = agentSettings().model;
    return (typeof m === 'string' && m.trim()) ? m.trim() : DEFAULT_MODEL;
  }
  Agent.isEnabled = function () { return !!apiKey(); };
  Agent.model = modelName;
  Agent.timeoutMs = TIMEOUT_MS;   // قابل للتغيير (يستفيد منه شاشة الإعدادات/الاختبارات)

  // إخفاء أي أثر لمفتاح في نص الخطأ (المفتاح لا يُسجَّل ولا يُعرض أبداً)
  function sanitize(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/sk-[A-Za-z0-9_\-]+/g, '***')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
      .slice(0, 220);
  }

  function httpError(status, detail) {
    var msg;
    if (status === 400) msg = 'الطلب غير صالح (400) — قد يكون اسم النموذج غير صحيح.';
    else if (status === 401) msg = 'المفتاح غير صحيح أو غير مفعّل (401) — افتح الإعدادات وتأكد من مفتاح DeepSeek.';
    else if (status === 402) msg = 'رصيد حساب DeepSeek غير كافٍ (402) — اشحن الرصيد أو استخدم المحرّك المحلي.';
    else if (status === 403) msg = 'الوصول مرفوض (403) — تحقق من صلاحية المفتاح.';
    else if (status === 404) msg = 'عنوان الخدمة غير موجود (404).';
    else if (status === 422) msg = 'بيانات الطلب غير مقبولة (422).';
    else if (status === 429) msg = 'طلبات كثيرة أو تجاوز الحد (429) — انتظر لحظات وأعد المحاولة.';
    else if (status >= 500) msg = 'خدمة DeepSeek غير متاحة حالياً (' + status + ') — جرّب بعد شوي.';
    else msg = 'خطأ في الاتصال بخدمة DeepSeek (' + status + ').';
    if (detail) msg += '\nالتفصيل: ' + sanitize(detail);
    return new Error(msg);
  }

  function apiCall(messages, opts) {
    opts = opts || {};
    // opts.apiKey/opts.model اختياريان (اختبار مفتاح مكتوب لم يُحفظ) — في الذاكرة فقط ولا يُسجَّلان
    var key = (typeof opts.apiKey === 'string' && opts.apiKey.trim()) ? opts.apiKey.trim() : apiKey();
    if (!key) return Promise.reject(new Error('ما فيه مفتاح DeepSeek — أضفه من الإعدادات أولاً.'));
    if (typeof fetch !== 'function') return Promise.reject(new Error('هذا المتصفح ما يدعم الاتصال بالشبكة (fetch) — المحرّك المحلي شغّال.'));
    var body = {
      model: (typeof opts.model === 'string' && opts.model.trim()) ? opts.model.trim() : modelName(),
      messages: messages,
      stream: false,
      temperature: opts.temperature === undefined ? TEMPERATURE : opts.temperature
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.tools && opts.tools.length) { body.tools = opts.tools; body.tool_choice = opts.toolChoice || 'auto'; }

    var timeoutMs = opts.timeout || Agent.timeoutMs || TIMEOUT_MS;
    var ctrl = null, timer = null;
    if (typeof AbortController === 'function') {
      ctrl = new AbortController();
      timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* تجاهل */ } }, timeoutMs);
    }
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body)
    };
    if (ctrl) init.signal = ctrl.signal;

    return fetch(API_URL, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var detail = (data && data.error && (data.error.message || data.error.type)) ? (data.error.message || data.error.type) : txt;
          throw httpError(res.status, detail);
        }
        if (!data || !data.choices || !data.choices.length) throw new Error('رد غير مفهوم من DeepSeek — جرّب مرة أخرى.');
        return { message: data.choices[0].message || {}, usage: data.usage || null, finishReason: data.choices[0].finish_reason || null };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && (err.name === 'AbortError' || err.code === 20)) {
        throw new Error('انتهت المهلة (' + Math.round(timeoutMs / 1000) + ' ثانية) — الشبكة بطيئة أو الخدمة ما ردّت. جرّب مرة أخرى.');
      }
      throw new Error('تعذّر الاتصال بخدمة DeepSeek — تحقق من الإنترنت، أو استخدم المحرّك المحلي.');
    });
  }

  Agent.apiCall = apiCall;   // متاح للاختبار/الإعدادات (لا يطبع المفتاح أبداً)

  /* --------------------------------------------------------- سياق النموذج */

  function systemPrompt(st) {
    var now = today();
    var from30 = U.addDays(now, -29);
    var lines = F.summaryLines(st, from30, now);
    var alerts = F.alerts(st, now).slice(0, 4);
    var p = [];
    p.push('أنت «مصروفي»، مساعد مالي شخصي لمستخدم واحد في ليبيا. تجيبه بالعربية بلهجة ليبية مبسّطة ومفهومة.');
    p.push('العملة: الدينار الليبي (د.ل). اليوم المرجعي: ' + now + ' (' + U.dateLabel(now, 'weekday') + '). المنطقة الزمنية: Africa/Tripoli (UTC+2).');
    p.push('');
    p.push('مصادر دخل المستخدم (إيجارات ثابتة):');
    p.push('• المحل (بجانب البيت): إيجار شهري 1,500 د.ل.');
    p.push('• استوديو فوق المحل: 2,000 د.ل كل 3 أشهر (الربع، وليس شهرياً).');
    p.push('• ورشة السمكرة والطلاء: 1,900 د.ل.');
    p.push('• الورشة الميكانيكية: 1,500 د.ل.');
    p.push('• حجرات العمال: 2,000 د.ل.');
    p.push('');
    p.push('ملخص آخر 30 يوماً من بياناته الفعلية:');
    lines.forEach(function (l) { p.push('• ' + l); });
    if (alerts.length) {
      p.push('');
      p.push('تنبيهات حالية:');
      alerts.forEach(function (a) { p.push('• ' + (a.icon || '') + ' ' + a.title + ' — ' + String(a.body || '').slice(0, 160)); });
    }
    p.push('');
    p.push('قواعد إلزامية:');
    p.push('1) لا تختلق أي رقم إطلاقاً. كل رقم تذكره لازم يجي من نتيجة أداة (tool) أو من الملخص أعلاه.');
    p.push('2) لأي تفصيل (مصروفات، دخل، رصيد، مستحقات، ديون، توقع، مقارنة، ادخار) استدعِ الأداة المناسبة أولاً ثم أجب من نتيجتها.');
    p.push('3) التواريخ بصيغة YYYY-MM-DD واليوم هو ' + now + '.');
    p.push('4) أجب بجمل عربية قصيرة: 3 إلى 6 أسطر، أرقام واضحة بفواصل الآلاف ورمز د.ل، بلا مقدمات طويلة ولا اعتذار.');
    p.push('5) إذا السؤال خارج المال، اعتذر بسطر واحد وارجع للعرض المالي.');
    p.push('6) إذا نقصت بيانات، قل ذلك بصراحة بدل التخمين.');
    return p.join('\n');
  }

  function historyMessages(st, limit) {
    var chat = (st && st.agentChat) || [];
    return chat.slice(-(limit || 8)).filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant') && m.content;
    }).map(function (m) { return { role: m.role, content: String(m.content).slice(0, 2000) }; });
  }

  function askRemote(question, st) {
    var messages = [{ role: 'system', content: systemPrompt(st) }].concat(historyMessages(st));
    var schemas = Agent.toolSchemas();
    var rounds = 0;
    function loop() {
      var useTools = rounds < MAX_TOOL_ROUNDS;
      var opts = { maxTokens: MAX_TOKENS };
      if (useTools) { opts.tools = schemas; opts.toolChoice = 'auto'; }
      return apiCall(messages, opts).then(function (res) {
        var msg = res.message || {};
        Agent.lastUsage = res.usage || null;
        var calls = msg.tool_calls || [];
        if (useTools && calls.length) {
          rounds++;
          messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
          calls.forEach(function (tc) {
            var name = tc && tc.function ? tc.function.name : '';
            var out = Agent.runTool(name, parseToolArgs(tc), st);
            Agent.lastToolCalls = (Agent.lastToolCalls || []).concat([{ name: name, args: parseToolArgs(tc), result: out }]);
            messages.push({ role: 'tool', tool_call_id: (tc && tc.id) || ('call_' + rounds), content: JSON.stringify(out) });
          });
          return loop();
        }
        return msg.content || '';
      });
    }
    return loop();
  }

  // النطق اختياري وصريح: لا يعمل إلا إذا فعّله المستخدم بنفسه (voice === true).
  // الافتراضي في الإعدادات هو false، فلا يصدر أي صوت من التطبيق بلا طلب.
  function voiceOn() {
    var a = agentSettings();
    return a.voice === true;
  }
  Agent.voiceEnabled = voiceOn;

  // إيقاف أي نطق جارٍ — يُنادى عند مغادرة الشاشة أو إقلاع التطبيق
  Agent.silence = function () {
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
      return true;
    } catch (e) { return false; }
  };

  Agent.ask = function (text) {
    var q = String(text === null || text === undefined ? '' : text).trim();
    var s = store();
    if (!q) return Promise.resolve('اكتب سؤالك أولاً 🙏');
    if (s) s.addChatMessage('user', q);
    var st = currentState();

    if (!Agent.isEnabled()) {
      var local = Agent.localAnswer(q, st);
      if (s) s.addChatMessage('assistant', local);
      if (voiceOn()) Agent.speak(local);
      return Promise.resolve(local);
    }

    Agent.lastToolCalls = [];
    return askRemote(q, st).then(function (answer) {
      var out = (answer && String(answer).trim()) ? String(answer).trim() : Agent.localAnswer(q, currentState());
      if (s) s.addChatMessage('assistant', out);
      if (voiceOn()) Agent.speak(out);
      return out;
    }).catch(function (err) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[agent] فشل نداء DeepSeek:', sanitize(err && err.message));
      var msg = (err && err.message) ? err.message : 'صار خطأ غير متوقع في الاتصال.';
      var fb = Agent.localAnswer(q, currentState());
      var out2 = '⚠️ ' + msg + '\n\n— من المحرّك المحلي —\n' + fb;
      if (s) s.addChatMessage('assistant', out2);
      return out2;
    });
  };

  // ترجع {ok, error, message, model, reply} — متوافقة مع شاشة الإعدادات (views/settings.js).
  // keyOverride/modelOverride اختياريان: لاختبار مفتاح مكتوب ولم يُحفظ بعد — لا يُخزَّن ولا يُطبع.
  Agent.testKey = function (keyOverride, modelOverride) {
    var key = (typeof keyOverride === 'string' && keyOverride.trim()) ? keyOverride.trim() : apiKey();
    var model = (typeof modelOverride === 'string' && modelOverride.trim()) ? modelOverride.trim() : modelName();
    if (!key) {
      var miss = 'ما فيه مفتاح محفوظ — أضف مفتاح DeepSeek من الإعدادات أولاً.';
      return Promise.resolve({ ok: false, error: miss, message: '⚠️ ' + miss, model: model, reply: '' });
    }
    return apiCall([
      { role: 'system', content: 'أجب بكلمتين فقط.' },
      { role: 'user', content: 'قل: جاهز' }
    ], { tools: null, maxTokens: 20, timeout: 20000, temperature: 0, apiKey: key, model: model }).then(function (res) {
      var txt = String((res.message && res.message.content) || '').trim().slice(0, 80);
      return {
        ok: true, error: null, model: model, reply: txt,
        message: '✅ المفتاح يعمل — النموذج ' + model + ' ردّ: ' + (txt || '(رد فارغ)')
      };
    }, function (err) {
      var msg = sanitize(err && err.message ? err.message : 'فشل اختبار المفتاح');
      return { ok: false, error: msg, message: '⚠️ ' + msg, model: model, reply: '' };
    });
  };

  Agent.clearChat = function () {
    var s = store();
    if (s && typeof s.clearChat === 'function') { s.clearChat(); return true; }
    return false;
  };

  Agent.suggestions = [
    'كم صرفت اليوم؟',
    'ما الذي لم أحصّله؟',
    'ملخص هذا الشهر',
    'وين راحت الفلوس؟',
    'هل يكفي رصيدي؟',
    'قارن هذا الشهر بالماضي'
  ];

  /* ==========================================================================
   * 6) الواجهة (RTL — جوال أولاً) — كل النص عبر textContent، بلا innerHTML
   * ======================================================================== */

  var mounted = null;   // { host, msgs, input, status, banner, voiceBtn, micBtn }

  function welcomeText() {
    var st = currentState();
    if (!st) return 'أهلاً 👋 أنا مساعدك المالي.';
    var total = F.totalBalance(st), d = F.daySummary(st, today());
    return 'أهلاً 👋 أنا مساعدك المالي — أجاوب من أرقامك الفعلية.\n' +
      '• رصيدك الآن: ' + money(total) + '\n' +
      '• اليوم: دخل ' + money(d.income) + ' — مصروف ' + money(d.expense) + ' — الصافي ' + money(d.net, { sign: true }) + '\n' +
      'اسألني: «كم صرفت اليوم؟» أو «ما الذي لم أحصّله؟»';
  }

  // في RTL: flex-start = يمين (inline-start) و flex-end = يسار (inline-end).
  // تثبيت الاتجاه مضمّناً حتى لا يعتمد على ترتيب قواعد CSS:
  //   رسالة المستخدم يميناً (flex-start) وردّ الوكيل يساراً (flex-end).
  function msgNode(role, content) {
    var isUser = role === 'user';
    return U.el('div', {
      class: 'agent-msg ' + (isUser ? 'agent-msg-user' : 'agent-msg-bot'),
      style: { alignItems: isUser ? 'flex-start' : 'flex-end' }
    }, [
      U.el('div', {
        class: 'agent-bubble',
        style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
        text: String(content === null || content === undefined ? '' : content)
      })
    ]);
  }

  function typingNode() {
    return U.el('div', {
      class: 'agent-msg agent-msg-bot',
      style: { alignItems: 'flex-end' }
    }, [
      U.el('div', { class: 'agent-bubble typing', text: 'يكتب…' })
    ]);
  }

  function scrollBottom(node) {
    try { if (node && typeof node.scrollHeight === 'number') node.scrollTop = node.scrollHeight; } catch (e) { /* تجاهل */ }
  }

  Agent.renderMessages = function () {
    if (!mounted) return null;
    var host = mounted.msgs;
    U.clear(host);
    var st = currentState();
    var chat = (st && st.agentChat) || [];
    if (!chat.length) host.appendChild(msgNode('assistant', welcomeText()));
    chat.slice(-60).forEach(function (m) {
      host.appendChild(msgNode(m.role === 'user' ? 'user' : 'assistant', m.content));
    });
    if (Agent._busy) host.appendChild(typingNode());
    scrollBottom(host);
    return host;
  };

  Agent.syncStatus = function () {
    if (!mounted) return null;
    var enabled = Agent.isEnabled();
    mounted.status.textContent = enabled ? ('المفتاح متصل · ' + modelName()) : 'بدون مفتاح — محرّك محلي';
    mounted.status.className = 'badge ' + (enabled ? 'badge-success' : 'badge-warn');
    setIcon(mounted.voiceBtn, voiceOn() ? 'volume' : 'volumeOff');
    mounted.voiceBtn.setAttribute('aria-pressed', voiceOn() ? 'true' : 'false');
    mounted.voiceBtn.title = voiceOn() ? 'الصوت مفعّل — اضغط للكتم' : 'الصوت مكتوم — اضغط للتفعيل';

    var banner = mounted.banner;
    U.clear(banner);
    if (enabled) {
      banner.style.display = 'none';
    } else {
      banner.style.display = '';
      banner.appendChild(U.el('div', { class: 'alert-ico' }, [icoSpan('key')]));
      banner.appendChild(U.el('div', { class: 'alert-main' }, [
        U.el('div', { class: 'alert-title', text: 'المساعد الذكي غير مفعّل' }),
        U.el('div', { class: 'alert-body', text: 'أضف مفتاح DeepSeek من الإعدادات ليعمل التحليل الذكي والصوت. بدون مفتاح يعمل المحرّك المحلي كامل بلا إنترنت.' })
      ]));
      banner.appendChild(U.el('button', {
        type: 'button', class: 'btn btn-primary btn-sm', text: 'الإعدادات',
        onClick: function () { goSettings(); }
      }));
    }
    return mounted.status;
  };

  /* ---- أيقونات SVG داخل واجهة المساعد (بديل الإيموجي) ---- */
  function icoSpan(name, size) {
    var I = Fin.I;
    if (!I) return U.el('span', { class: 'ic-wrap' });
    return I.el(I.has(name) ? name : 'info', { size: size || 18 });
  }
  function setIcon(host, name, size) {
    if (!host) return;
    U.clear(host);
    host.appendChild(icoSpan(name, size));
  }

  Agent.mount = function (container) {
    if (!container || typeof container.appendChild !== 'function') return null;
    U.clear(container);
    try { container.setAttribute('dir', 'rtl'); } catch (e) { /* تجاهل */ }

    var status = U.el('span', { class: 'badge badge-muted', text: '…' });
    var testBtn = U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'اختبار مفتاح DeepSeek' }, [icoSpan('key'), U.el('span', { text: 'اختبار المفتاح' })]);
    var voiceBtn = U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'النطق الصوتي', 'aria-pressed': 'false' }, [icoSpan('volumeOff')]);
    var clearBtn = U.el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'مسح المحادثة' }, [icoSpan('trash')]);

    var head = U.el('div', { class: 'agent-head' }, [
      U.el('div', { class: 'agent-head-title' }, [
        U.el('span', { class: 'agent-avatar', 'aria-hidden': 'true' }, [icoSpan('robot')]),
        U.el('span', { class: 'agent-title', text: 'المساعد المالي' })
      ]),
      status,
      U.el('div', { class: 'agent-actions' }, [testBtn, voiceBtn, clearBtn])
    ]);

    var banner = U.el('div', { class: 'alert alert-warn agent-note' });
    banner.style.display = 'none';

    var msgs = U.el('div', { class: 'agent-msgs', 'aria-live': 'polite' });

    var suggest = U.el('div', { class: 'agent-suggest' },
      Agent.suggestions.map(function (q) {
        return chips(q, function () { submit(q); });
      }));

    var input = U.el('input', {
      class: 'input agent-field',
      type: 'text',
      placeholder: 'اكتب سؤالك… مثلاً: كم صرفت اليوم؟',
      autocomplete: 'off',
      'aria-label': 'سؤال للمساعد'
    });
    var sendBtn = U.el('button', { type: 'button', class: 'btn btn-primary agent-send', text: 'إرسال' });
    var micBtn = Agent.hasVoice() ? U.el('button', { type: 'button', class: 'btn btn-ghost agent-mic', title: 'إدخال صوتي', title: 'إدخال صوتي (ar-LY)' }) : null;

    var row = U.el('div', { class: 'agent-input-row' }, [micBtn, input, sendBtn]);
    var shell = U.el('div', { class: 'agent-shell' }, [head, banner, msgs, suggest, row]);

    container.appendChild(shell);

    mounted = { host: container, shell: shell, msgs: msgs, input: input, status: status, banner: banner, voiceBtn: voiceBtn, micBtn: micBtn, testBtn: testBtn };

    // أيقونة حالة النطق تُضبط الآن (syncStatus يُنادى لاحقاً عند كل تغيير)
    setIcon(voiceBtn, voiceOn() ? 'volume' : 'volumeOff');
    voiceBtn.setAttribute('aria-pressed', voiceOn() ? 'true' : 'false');
    voiceBtn.title = voiceOn() ? 'الصوت مفعّل — اضغط للكتم' : 'الصوت مكتوم — اضغط للتفعيل';

    /* ---- الأحداث ---- */

    function submit(text) {
      var q = String(text || '').trim();
      if (!q || Agent._busy) return;
      input.value = '';
      Agent._busy = true;
      Agent.renderMessages();
      Agent.ask(q).then(function () {
        Agent._busy = false;
        Agent.renderMessages();
      }, function () {
        Agent._busy = false;
        Agent.renderMessages();
      });
    }
    Agent.submit = submit;

    sendBtn.addEventListener('click', function () { submit(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(input.value); }
    });

    testBtn.addEventListener('click', function () {
      testBtn.disabled = true;
      var old = testBtn.textContent;
      testBtn.textContent = 'يختبر…';
      Agent._busy = true;
      Agent.renderMessages();
      Agent.testKey().then(function (result) {
        Agent._busy = false;
        testBtn.disabled = false;
        testBtn.textContent = old;
        Agent.renderMessages();
        toast((result && result.message) ? result.message : 'انتهى اختبار المفتاح', (result && result.ok) ? 'success' : 'danger');
      }, function (err) {
        Agent._busy = false;
        testBtn.disabled = false;
        testBtn.textContent = old;
        Agent.renderMessages();
        toast(sanitize((err && err.message) || 'فشل اختبار المفتاح'), 'danger');
      });
    });

    voiceBtn.addEventListener('click', function () {
      var s = store();
      if (s && typeof s.updateSettings === 'function') s.updateSettings({ agent: { voice: !voiceOn() } });
      Agent.syncStatus();
      if (!voiceOn()) Agent.stopSpeaking(); else Agent.speak('الصوت مفعّل');
    });

    clearBtn.addEventListener('click', function () {
      var UIx = Fin.UI;
      var ask = (UIx && typeof UIx.confirm === 'function')
        ? UIx.confirm('تمسح كل المحادثة؟', { okLabel: 'امسح', tone: 'danger' })
        : Promise.resolve(true);
      ask.then(function (ok) {
        if (!ok) return;
        Agent.clearChat();
        Agent.renderMessages();
        toast('تم مسح المحادثة', 'success');
      });
    });

    if (micBtn) {
      micBtn.addEventListener('click', function () {
        if (Agent._listening) {
          try { Agent._listening.stop(); } catch (e) { /* تجاهل */ }
          return;
        }
        micBtn.classList.add('is-active');
        Agent._listening = Agent.listen({
          onResult: function (text) {
            micBtn.classList.remove('is-active');
            input.value = text;
            submit(text);
          },
          onError: function (code, message) {
            micBtn.classList.remove('is-active');
            toast(message, 'danger');
          },
          onEnd: function () {
            micBtn.classList.remove('is-active');
            Agent._listening = null;
          }
        });
        if (!Agent._listening) {
          micBtn.classList.remove('is-active');
          toast('الإدخال الصوتي غير مدعوم في هذا المتصفح', 'danger');
        }
      });
    }

    /* ---- التحديث التلقائي عند تغيّر الحالة ---- */
    if (Agent._unsub) { try { Agent._unsub(); } catch (e) { /* تجاهل */ } Agent._unsub = null; }
    var s = store();
    if (s && typeof s.subscribe === 'function') {
      Agent._unsub = s.subscribe(function () {
        Agent.syncStatus();
        Agent.renderMessages();
      });
    }

    Agent.syncStatus();
    Agent.renderMessages();
    try { if (input.focus) input.focus(); } catch (e) { /* تجاهل */ }
    return shell;
  };

  Agent.unmount = function () {
    if (Agent._unsub) { try { Agent._unsub(); } catch (e) { /* تجاهل */ } Agent._unsub = null; }
    if (Agent._listening) { try { Agent._listening.stop(); } catch (e2) { /* تجاهل */ } Agent._listening = null; }
    mounted = null;
  };

  Agent.isMounted = function () { return !!mounted; };
})();
