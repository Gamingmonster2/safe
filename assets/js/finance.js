/* =============================================================================
 * مصروفي — finance.js  (منطق مالي خالص — لا DOM إطلاقاً)
 * القواعد: لا يُحسب في الرصيد إلا المدفوع فعلاً وغير المخطّط.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof globalThis !== 'undefined') ? globalThis : this;
  var Fin = root.Fin = root.Fin || {};
  var C = Fin.C, U = Fin.U;
  var F = {};
  Fin.Finance = F;
  Fin.F = F;

  function round(n) { return U.round(n, 2); }

  /* ============================================================ الأساسيات */

  F.affectsBalance = function (tx) {
    if (!tx) return false;
    if (tx.planned) return false;
    if (tx.paid === false) return false;
    return true;
  };

  // نصافي أثر المعاملة: موجب = دخل، سالب = مصروف
  F.signedAmount = function (tx) {
    if (!tx) return 0;
    var a = Number(tx.amount) || 0;
    if (tx.type === 'income') return a;
    if (tx.type === 'expense') return -a;
    return 0;
  };

  F.txInRange = function (state, from, to, opts) {
    opts = opts || {};
    var list = (state && state.transactions) || [];
    return list.filter(function (tx) {
      if (!tx || !tx.date) return false;
      if (from && tx.date < from) return false;
      if (to && tx.date > to) return false;
      if (opts.type && tx.type !== opts.type) return false;
      if (opts.category && tx.category !== opts.category) return false;
      if (opts.accountId && tx.accountId !== opts.accountId) return false;
      if (opts.locationId && tx.locationId !== opts.locationId) return false;
      if (opts.paidOnly && !F.affectsBalance(tx)) return false;
      if (opts.unpaidOnly && tx.paid !== false) return false;
      if (opts.includePlanned === false && tx.planned) return false;
      if (opts.query) {
        var q = String(opts.query).toLowerCase();
        var hay = ((tx.note || '') + ' ' + (tx.category || '') + ' ' + (tx.label || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1; // الأحدث أولاً
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  };

  F.periodTotals = function (state, from, to, opts) {
    opts = opts || {};
    var txs = F.txInRange(state, from, to, { paidOnly: !opts.includeUnpaid, includePlanned: opts.includePlanned });
    var income = 0, expense = 0;
    txs.forEach(function (tx) {
      if (tx.type === 'income') income += Number(tx.amount) || 0;
      else if (tx.type === 'expense') expense += Number(tx.amount) || 0;
    });
    return { income: round(income), expense: round(expense), net: round(income - expense), count: txs.length };
  };

  /* ==================================================== اليوم المرجعي للعرض */

  // آخر يوم فيه حركة فعلية (أو تاريخ البذرة إن لا حركات).
  // السبب: لو فُتح التطبيق في يوم بلا حركات، نعرض آخر يوم مسجَّل بدل أصفار مربكة.
  F.lastActivityDay = function (state) {
    var latest = C.TODAY;
    ((state && state.transactions) || []).forEach(function (tx) {
      if (tx.date && tx.date > latest) latest = tx.date;
    });
    return latest;
  };

  // تاريخ العرض: تاريخ الجهاز إن كان فيه حركة أو كان قبل البذرة، وإلا آخر يوم فيه حركة
  F.displayDay = function (state, todayISO) {
    var today = todayISO || U.todayISO();
    var last = F.lastActivityDay(state);
    if (today <= last) return today;
    var hasToday = ((state && state.transactions) || []).some(function (tx) { return tx.date === today; });
    return hasToday ? today : last;
  };

  /* ============================================================== الأرصدة */

  F.accountById = function (state, id) {
    var list = (state && state.accounts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  F.balanceOf = function (state, accountId) {
    var acc = F.accountById(state, accountId);
    var opening = acc ? (Number(acc.opening) || 0) : 0;
    var txs = (state && state.transactions) || [];
    var delta = 0;
    txs.forEach(function (tx) {
      if (!F.affectsBalance(tx)) return;
      if (tx.type === 'transfer') {
        if (tx.accountId === accountId) delta -= Number(tx.amount) || 0;
        if (tx.toAccountId === accountId) delta += Number(tx.amount) || 0;
        return;
      }
      if (tx.accountId !== accountId) return;
      delta += F.signedAmount(tx);
    });
    return round(opening + delta);
  };

  F.balances = function (state) {
    var out = {};
    ((state && state.accounts) || []).forEach(function (a) { out[a.id] = F.balanceOf(state, a.id); });
    return out;
  };

  F.totalBalance = function (state) {
    return round(U.sum((state && state.accounts) || [], function (a) { return F.balanceOf(state, a.id); }));
  };

  F.cashBalance = function (state) {
    return F.balanceOf(state, 'cash');
  };

  F.savingsBalance = function (state) {
    return F.balanceOf(state, 'saving');
  };

  /* ======================================================= ملخصات الفترات */

  F.daySummary = function (state, iso) {
    var d = iso || U.todayISO();
    var txs = F.txInRange(state, d, d, { includePlanned: false });
    var income = 0, expense = 0, unpaid = 0, unpaidCount = 0, plannedTotal = 0;
    txs.forEach(function (tx) {
      var amt = Number(tx.amount) || 0;
      if (tx.planned) { plannedTotal += amt; return; }
      if (tx.paid === false) { unpaid += amt; unpaidCount++; return; }
      if (tx.type === 'income') income += amt;
      else if (tx.type === 'expense') expense += amt;
    });
    return {
      date: d,
      label: U.dateLabel(d),
      income: round(income),
      expense: round(expense),
      net: round(income - expense),
      txCount: txs.length,
      unpaid: round(unpaid),
      unpaidCount: unpaidCount,
      planned: round(plannedTotal),
      balance: F.totalBalance(state)
    };
  };

  F.rangeSummary = function (state, from, to) {
    var txs = F.txInRange(state, from, to, { includePlanned: false });
    var income = 0, expense = 0, byCategory = {}, byDay = {}, byAccount = {}, byLocation = {};
    var unpaid = 0, unpaidCount = 0, planned = 0;

    txs.forEach(function (tx) {
      var amt = Number(tx.amount) || 0;
      var day = tx.date;
      if (!byDay[day]) byDay[day] = { date: day, income: 0, expense: 0, net: 0 };
      if (tx.planned) { planned += amt; byDay[day].planned = (byDay[day].planned || 0) + amt; return; }
      if (tx.paid === false) {
        unpaid += amt; unpaidCount++;
        byDay[day].unpaid = (byDay[day].unpaid || 0) + amt;
        if (!byCategory[tx.category]) byCategory[tx.category] = { key: tx.category, amount: 0, count: 0, unpaid: 0 };
        byCategory[tx.category].unpaid += amt;
        return;
      }
      var sign = tx.type === 'income' ? 1 : (tx.type === 'expense' ? -1 : 0);
      if (sign === 0) return;
      if (sign > 0) { income += amt; byDay[day].income += amt; } else { expense += amt; byDay[day].expense -= amt; }
      byDay[day].net = round(byDay[day].income - byDay[day].expense);
      if (!byCategory[tx.category]) byCategory[tx.category] = { key: tx.category, amount: 0, count: 0, unpaid: 0 };
      byCategory[tx.category].amount += amt;
      byCategory[tx.category].count++;
      var accKey = tx.accountId || 'cash';
      if (!byAccount[accKey]) byAccount[accKey] = { key: accKey, income: 0, expense: 0, net: 0 };
      if (sign > 0) byAccount[accKey].income += amt; else byAccount[accKey].expense += amt;
      byAccount[accKey].net = round(byAccount[accKey].income - byAccount[accKey].expense);
      if (tx.locationId) {
        if (!byLocation[tx.locationId]) byLocation[tx.locationId] = { key: tx.locationId, amount: 0, count: 0 };
        byLocation[tx.locationId].amount += amt;
        byLocation[tx.locationId].count++;
      }
    });

    var days = U.rangeDays(from, to);
    days.forEach(function (d) { if (!byDay[d]) byDay[d] = { date: d, income: 0, expense: 0, net: 0 }; });

    return {
      from: from, to: to,
      label: from === to ? U.dateLabel(from) : (U.dateLabel(from, 'short') + ' → ' + U.dateLabel(to, 'short')),
      income: round(income), expense: round(expense), net: round(income - expense),
      txCount: txs.length, unpaid: round(unpaid), unpaidCount: unpaidCount, planned: round(planned),
      byCategory: byCategory, byDay: byDay, byAccount: byAccount, byLocation: byLocation,
      savingRate: income > 0 ? U.round((income - expense) / income * 100, 1) : 0,
      days: days.length,
      avgDailyExpense: days.length ? round(expense / days.length) : 0
    };
  };

  F.monthSummary = function (state, monthKey, asOfISO) {
    var key = /^\d{4}-\d{2}$/.test(String(monthKey)) ? String(monthKey) : U.monthKey(monthKey || U.todayISO());
    var r = U.monthRange(key + '-01');
    var to = r.to;
    var currentMonth = U.monthKey(asOfISO || U.todayISO());
    var partial = false;
    if (key === currentMonth && asOfISO && asOfISO < r.to) { to = asOfISO; partial = true; }
    var sum = F.rangeSummary(state, r.from, to);
    sum.monthKey = key;
    sum.label = U.monthLabel(key);
    sum.monthLabel = sum.label;
    sum.partial = partial;
    return sum;
  };

  F.yearSummary = function (state, year, asOfISO) {
    var y = String(year || String(U.todayISO()).slice(0, 4));
    var from = y + '-01-01', to = y + '-12-31';
    var cur = String(asOfISO || U.todayISO());
    if (cur >= from && cur < to) to = cur;
    var sum = F.rangeSummary(state, from, to);
    sum.year = y;
    sum.label = 'سنة ' + y;
    return sum;
  };

  /* ========================================================== التصنيفات */

  F.categoryTotals = function (state, from, to, type) {
    var txs = F.txInRange(state, from, to, { type: type || 'expense', paidOnly: true });
    var out = {};
    txs.forEach(function (tx) { out[tx.category] = round((out[tx.category] || 0) + (Number(tx.amount) || 0)); });
    return out;
  };

  F.expenseByCategory = function (state, from, to, limit) {
    var txs = F.txInRange(state, from, to, { type: 'expense', paidOnly: true });
    var map = {};
    txs.forEach(function (tx) {
      var k = tx.category || 'other';
      if (!map[k]) map[k] = { key: k, amount: 0, count: 0 };
      map[k].amount += Number(tx.amount) || 0;
      map[k].count++;
    });
    var total = U.sum(Object.keys(map), function (k) { return map[k].amount; });
    var out = Object.keys(map).map(function (k) {
      var cat = C.catExpense(k);
      return {
        key: k, label: cat.label, icon: cat.icon, color: cat.color, group: cat.group,
        amount: round(map[k].amount), count: map[k].count, pct: U.pct(map[k].amount, total)
      };
    }).sort(function (a, b) { return b.amount - a.amount; });
    return limit ? out.slice(0, limit) : out;
  };

  F.incomeBySource = function (state, from, to, limit) {
    var txs = F.txInRange(state, from, to, { type: 'income', paidOnly: true });
    var map = {};
    txs.forEach(function (tx) {
      var k = tx.category || 'other_income';
      if (!map[k]) map[k] = { key: k, amount: 0, count: 0 };
      map[k].amount += Number(tx.amount) || 0;
      map[k].count++;
    });
    var total = U.sum(Object.keys(map), function (k) { return map[k].amount; });
    var out = Object.keys(map).map(function (k) {
      var cat = C.catIncome(k);
      return {
        key: k, label: cat.label, icon: cat.icon, color: cat.color, group: cat.group,
        amount: round(map[k].amount), count: map[k].count, pct: U.pct(map[k].amount, total)
      };
    }).sort(function (a, b) { return b.amount - a.amount; });
    return limit ? out.slice(0, limit) : out;
  };

  F.incomeByLocation = function (state, from, to) {
    var txs = F.txInRange(state, from, to, { type: 'income', paidOnly: true });
    var map = {};
    txs.forEach(function (tx) {
      var k = tx.locationId || 'other';
      if (!map[k]) map[k] = { key: k, amount: 0, count: 0 };
      map[k].amount += Number(tx.amount) || 0;
      map[k].count++;
    });
    var total = U.sum(Object.keys(map), function (k) { return map[k].amount; });
    return Object.keys(map).map(function (k) {
      var loc = C.location(k) || { name: 'أخرى', icon: 'plus' };
      return { key: k, label: loc.name, icon: loc.icon, amount: round(map[k].amount), count: map[k].count, pct: U.pct(map[k].amount, total) };
    }).sort(function (a, b) { return b.amount - a.amount; });
  };

  F.topExpenses = function (state, from, to, n) {
    return F.txInRange(state, from, to, { type: 'expense', paidOnly: true })
      .slice()
      .sort(function (a, b) { return (Number(b.amount) || 0) - (Number(a.amount) || 0); })
      .slice(0, n || 5);
  };

  /* ================================================= الاستحقاقات (ذمم لي) */

  F.chargePaid = function (state, chargeId) {
    var receipts = (state && state.receipts) || [];
    return round(U.sum(receipts.filter(function (r) { return r.chargeId === chargeId; }), function (r) { return Number(r.amount) || 0; }));
  };

  F.chargeStatus = function (state, charge) {
    var paid = F.chargePaid(state, charge.id);
    var amount = Number(charge.amount) || 0;
    if (paid <= 0.001) return 'pending';
    if (paid + 0.001 >= amount) return 'paid';
    return 'partial';
  };

  F.ensureChargeStatus = function (state, charge) {
    var st = F.chargeStatus(state, charge);
    if (charge.status !== st) charge.status = st;
    return st;
  };

  F.receivables = function (state, asOfISO) {
    var asOf = asOfISO || U.todayISO();
    var items = [];
    ((state && state.charges) || []).forEach(function (ch) {
      var paid = F.chargePaid(state, ch.id);
      var remaining = round((Number(ch.amount) || 0) - paid);
      if (remaining <= 0.001) return;
      var st = paid > 0.001 ? 'partial' : 'pending';
      items.push({
        chargeId: ch.id,
        templateId: ch.templateId,
        locationId: ch.locationId,
        label: ch.label,
        period: ch.period,
        periodLabel: U.periodLabel(ch.period),
        dueDate: ch.dueDate,
        amount: round(Number(ch.amount) || 0),
        paid: paid,
        remaining: remaining,
        status: st,
        daysLate: U.daysLate(ch.dueDate, asOf),
        cycle: ch.cycle || 'monthly',
        receiptNo: ch.receiptNo || null
      });
    });
    items.sort(function (a, b) {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return String(a.label).localeCompare(String(b.label));
    });
    return {
      total: round(U.sum(items, function (i) { return i.remaining; })),
      count: items.length,
      overdueTotal: round(U.sum(items.filter(function (i) { return i.daysLate > 0; }), function (i) { return i.remaining; })),
      items: items
    };
  };

  F.receivableForTemplate = function (state, templateId, asOfISO) {
    var r = F.receivables(state, asOfISO);
    var found = r.items.filter(function (i) { return i.templateId === templateId; });
    return found.length ? found[0] : null;
  };

  /* ================================== المصروفات المخطّطة والأموال المجمّعة */

  // مصروفات لم تُدفع بعد (مخطّطة أو معلّقة) — **ليست ديوناً**: المستخدم لا ديون عليه.
  F.obligations = function (state) {
    var items = ((state && state.transactions) || []).filter(function (tx) {
      return tx && tx.paid === false && tx.type === 'expense';
    });
    var planned = items.filter(function (t) { return t.planned; });
    var unplanned = items.filter(function (t) { return !t.planned; });
    var total = round(U.sum(items, function (t) { return Number(t.amount) || 0; }));
    var plannedTotal = round(U.sum(planned, function (t) { return Number(t.amount) || 0; }));
    return {
      total: total,
      plannedTotal: plannedTotal,
      immediateTotal: round(U.sum(unplanned, function (t) { return Number(t.amount) || 0; })),
      count: items.length,
      items: items.sort(function (a, b) { return (Number(b.amount) || 0) - (Number(a.amount) || 0); })
    };
  };

  // لا ديون في هذا التطبيق — الدالة تبقى للتوافق وتُرجع صفراً دائماً
  F.debts = function () {
    return { total: 0, count: 0, items: [] };
  };

  // الأموال المجمّعة: من أين جاء النقد الموجود الآن (ليست ديوناً)
  F.accumulatedFunds = function (state) {
    var cash = F.cashBalance(state);
    var sources = ((state && state.fundSources) || C.FUND_SOURCES).map(function (s) {
      return {
        key: s.key, label: s.label, amount: Number(s.amount) || 0,
        note: s.note || '', fromToday: !!s.fromToday
      };
    });
    var opening = (state && state.fundOpening !== undefined) ? state.fundOpening : C.FUND_OPENING;
    return {
      total: cash,
      opening: opening,
      openingNote: C.FUND_OPENING_NOTE,
      sources: sources,
      todayIncome: round(U.sum(sources.filter(function (s) { return s.fromToday && s.amount > 0; }), function (s) { return s.amount; })),
      todayExpense: round(U.sum(sources.filter(function (s) { return s.fromToday && s.amount < 0; }), function (s) { return Math.abs(s.amount); })),
      saving: F.savingsBalance(state),
      grandTotal: F.totalBalance(state)
    };
  };

  // الالتزامات السنوية (خطط مثل رسوم المدرسة) — معلومة، وليست ديوناً
  F.commitments = function (state) {
    var list = ((state && state.commitments) || C.COMMITMENTS).map(function (c) {
      var annual = Number(c.annual) || 0;
      var paid = Number(c.paidThisYear) || 0;
      var remaining = c.remaining !== undefined ? Number(c.remaining) : Math.max(0, annual - paid);
      return Object.assign({}, c, {
        annual: round(annual), paidThisYear: round(paid), remaining: round(remaining),
        pct: annual > 0 ? U.round(paid / annual * 100, 1) : 0
      });
    });
    return {
      list: list,
      count: list.length,
      annualTotal: round(U.sum(list, function (c) { return c.annual; })),
      paidTotal: round(U.sum(list, function (c) { return c.paidThisYear; })),
      remainingTotal: round(U.sum(list, function (c) { return c.remaining; }))
    };
  };

  /* ============================================================ السلاسل الزمنية */

  F.dailySeries = function (state, from, to) {
    var days = U.rangeDays(from, to);
    var balance = F.totalBalance(state) - U.sum(F.txInRange(state, from, to, { paidOnly: true }).filter(function (t) { return t.type !== 'transfer'; }), function (t) { return F.signedAmount(t); });
    var out = [];
    var byDay = {};
    F.txInRange(state, from, to, { paidOnly: true, includePlanned: false }).forEach(function (tx) {
      if (!byDay[tx.date]) byDay[tx.date] = { income: 0, expense: 0 };
      if (tx.type === 'income') byDay[tx.date].income += Number(tx.amount) || 0;
      else if (tx.type === 'expense') byDay[tx.date].expense += Number(tx.amount) || 0;
    });
    days.forEach(function (d) {
      var b = byDay[d] || { income: 0, expense: 0 };
      balance += b.income - b.expense;
      out.push({ date: d, income: round(b.income), expense: round(b.expense), net: round(b.income - b.expense), balance: round(balance) });
    });
    return out;
  };

  F.monthlySeries = function (state, n, endISO, asOfISO) {
    var ranges = U.nMonthsEnding(n || 6, endISO || U.todayISO());
    var asOf = asOfISO || U.todayISO();
    return ranges.map(function (r) {
      var to = (asOf >= r.from && asOf < r.to) ? asOf : r.to;
      var s = F.rangeSummary(state, r.from, to);
      return { monthKey: r.key, label: U.monthLabel(r.key), income: s.income, expense: s.expense, net: s.net, partial: to !== r.to };
    });
  };

  /* ============================================================== الادخار */

  F.savingsStats = function (state, monthKey, asOfISO) {
    var ms = F.monthSummary(state, monthKey || U.monthKey(asOfISO || U.todayISO()), asOfISO);
    var savingBalance = F.savingsBalance(state);
    var avgExpense = 0;
    var months = F.monthlySeries(state, 3, asOfISO || U.todayISO(), asOfISO);
    var withExpense = months.filter(function (m) { return m.expense > 0; });
    avgExpense = withExpense.length ? round(U.sum(withExpense, function (m) { return m.expense; }) / withExpense.length) : ms.expense;
    return {
      monthKey: ms.monthKey,
      income: ms.income,
      expense: ms.expense,
      net: ms.net,
      rate: ms.income > 0 ? U.round(ms.net / ms.income * 100, 1) : (ms.net < 0 ? -100 : 0),
      savingBalance: savingBalance,
      totalBalance: F.totalBalance(state),
      avgMonthlyExpense: avgExpense,
      monthsCovered: avgExpense > 0 ? U.round(F.totalBalance(state) / avgExpense, 1) : 0,
      cash: F.cashBalance(state)
    };
  };

  /* ========================================================== التنبؤ والمقارنة */

  F.compareRanges = function (state, a, b) {
    var ra = F.rangeSummary(state, a.from, a.to);
    var rb = F.rangeSummary(state, b.from, b.to);
    return {
      a: { label: a.label || (U.dateLabel(a.from, 'short') + ' → ' + U.dateLabel(a.to, 'short')), income: ra.income, expense: ra.expense, net: ra.net },
      b: { label: b.label || (U.dateLabel(b.from, 'short') + ' → ' + U.dateLabel(b.to, 'short')), income: rb.income, expense: rb.expense, net: rb.net },
      delta: {
        income: round(ra.income - rb.income),
        expense: round(ra.expense - rb.expense),
        net: round(ra.net - rb.net),
        expensePct: rb.expense > 0 ? U.round((ra.expense - rb.expense) / rb.expense * 100, 1) : 0
      }
    };
  };

  // التنبؤ: استحقاقات غير محصَّلة + استحقاقات قادمة من القوالب خلال المدة
  F.cashFlowForecast = function (state, asOfISO, days) {
    var asOf = asOfISO || U.todayISO();
    var horizon = U.addDays(asOf, days || 30);
    var out = [];
    var running = F.totalBalance(state);

    // 1) الاستحقاقات القائمة غير المسدّدة
    F.receivables(state, asOf).items.forEach(function (item) {
      var when = item.dueDate < asOf ? asOf : item.dueDate;
      out.push({ date: when, expected: item.remaining, label: item.label + ' — ' + item.periodLabel, kind: 'receivable', chargeId: item.chargeId });
    });

    // 2) استحقاقات قادمة لم تُنشأ بعد (نتوقّعها في موعدها)
    var existing = {};
    ((state && state.charges) || []).forEach(function (ch) { existing[ch.templateId + '|' + ch.period] = true; });
    ((state && state.templates) || []).forEach(function (t) {
      var cursor = asOf, guard = 0;
      while (cursor <= horizon && guard++ < 24) {
        var period, due;
        if (t.cycle === 'quarterly') {
          var qs = U.quarterRange(cursor);
          period = qs.key;
          due = qs.from;
        } else if (t.cycle === 'yearly') {
          period = String(cursor).slice(0, 4);
          due = period + '-' + U.pad2(t.anchorMonth || 1) + '-' + U.pad2(t.dayOfMonth || 1);
        } else {
          var mr = U.monthRange(cursor);
          period = mr.key;
          var day = Math.min(t.dayOfMonth || 1, +mr.to.slice(8, 10));
          due = mr.key + '-' + U.pad2(day);
        }
        if (!existing[t.id + '|' + period]) {
          var when = due < asOf ? asOf : due;
          if (when <= horizon && due >= asOf) {
            out.push({ date: when, expected: Number(t.amount) || 0, label: t.label + ' — ' + U.periodLabel(period), kind: 'expected', templateId: t.id });
            existing[t.id + '|' + period] = true;
          }
        }
        cursor = (t.cycle === 'quarterly') ? U.addMonths(cursor, 3) : U.addMonths(cursor, 1);
      }
    });

    out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var cumulative = 0;
    var days2 = U.rangeDays(asOf, horizon);
    var byDate = {};
    out.forEach(function (e) {
      cumulative += e.expected;
      if (!byDate[e.date]) byDate[e.date] = { date: e.date, expected: 0, items: [] };
      byDate[e.date].expected += e.expected;
      byDate[e.date].items.push(e);
    });
    var series = [];
    var run = 0;
    days2.forEach(function (d) {
      if (byDate[d]) run += byDate[d].expected;
      series.push({ date: d, expected: round(byDate[d] ? byDate[d].expected : 0), cumulative: round(run), balance: round(running + run) });
    });
    return {
      asOf: asOf, horizon: horizon, openingBalance: round(running),
      totalExpected: round(cumulative), closingBalance: round(running + cumulative),
      events: out, series: series
    };
  };

  /* ============================================================ النطاقات */

  F.domainStats = function (state, asOfISO) {
    var asOf = asOfISO || U.todayISO();
    var list = ((state && state.domains) || []).map(function (d) {
      var daysLeft = U.daysBetween(asOf, d.expiry);
      var status = C.domainStatusOf(daysLeft);
      return {
        id: d.id, domain: d.domain, expiry: d.expiry, price: Number(d.price) || 0,
        currency: d.currency || C.CURRENCY, note: d.note || '', autoRenew: !!d.autoRenew,
        tld: C.domainTld(d.domain),
        daysLeft: daysLeft,
        status: status,
        statusLabel: C.DOMAIN_STATUS[status].label,
        statusTone: C.DOMAIN_STATUS[status].tone,
        statusIcon: C.DOMAIN_STATUS[status].icon,
        dueLabel: daysLeft < 0
          ? ('منتهي منذ ' + Math.abs(daysLeft) + ' يوم')
          : (daysLeft === 0 ? 'ينتهي اليوم' : (daysLeft === 1 ? 'ينتهي غداً' : 'بعد ' + daysLeft + ' يوم'))
      };
    });
    list.sort(function (a, b) { return a.expiry < b.expiry ? -1 : (a.expiry > b.expiry ? 1 : 0); });
    var byStatus = { expired: [], critical: [], soon: [], watch: [], ok: [] };
    list.forEach(function (d) { byStatus[d.status].push(d); });
    var renewNow = list.filter(function (d) { return d.status === 'expired' || d.status === 'critical' || d.status === 'soon'; });
    var byTld = {};
    list.forEach(function (d) {
      var k = d.tld || 'أخرى';
      if (!byTld[k]) byTld[k] = { tld: k, count: 0, cost: 0 };
      byTld[k].count++;
      byTld[k].cost += d.price;
    });
    var yearCost = U.sum(list, function (d) { return d.price; });
    return {
      asOf: asOf,
      list: list,
      total: list.length,
      byStatus: byStatus,
      criticalCount: byStatus.expired.length + byStatus.critical.length,
      soonCount: byStatus.soon.length,
      renewNow: renewNow,
      renewNowCost: round(U.sum(renewNow, function (d) { return d.price; })),
      yearCost: round(yearCost),
      monthlyAvgCost: list.length ? round(yearCost / 12) : 0,
      byTld: Object.keys(byTld).map(function (k) { return byTld[k]; }).sort(function (a, b) { return b.cost - a.cost; }),
      next: list[0] || null
    };
  };

  // مصروف النطاقات خلال فترة (من الحركات المصنّفة domain_hosting)
  F.domainSpend = function (state, from, to) {
    var txs = F.txInRange(state, from, to, { type: 'expense', category: 'domain_hosting', paidOnly: true });
    return {
      total: round(U.sum(txs, function (t) { return Number(t.amount) || 0; })),
      count: txs.length,
      items: txs
    };
  };

  /* ============================================================== التنبيهات */

  // تنبيهات النطاقات — تُدمج في لوحة اليوم
  F.domainAlerts = function (state, asOfISO) {
    var d = F.domainStats(state, asOfISO);
    var out = [];
    if (!d.total) return out;
    if (d.byStatus.expired.length) {
      out.push({
        level: 'danger', icon: 'alert',
        title: d.byStatus.expired.length + ' نطاق سقط فعلاً!',
        body: d.byStatus.expired.slice(0, 4).map(function (x) { return x.domain + ' (' + x.dueLabel + ')'; }).join('، '),
        go: 'domains'
      });
    }
    if (d.byStatus.critical.length) {
      out.push({
        level: 'danger', icon: 'flame',
        title: d.byStatus.critical.length + ' نطاق ينتهي خلال ' + C.DOMAIN_ALERT_DAYS.critical + ' أيام — جدّده الآن',
        body: d.byStatus.critical.slice(0, 4).map(function (x) { return x.domain + ' ' + x.dueLabel + ' · ' + U.fmtMoney(x.price); }).join('، '),
        go: 'domains'
      });
    }
    if (d.byStatus.soon.length) {
      out.push({
        level: 'warn', icon: 'clock',
        title: d.byStatus.soon.length + ' نطاق ينتهي خلال شهر',
        body: d.byStatus.soon.slice(0, 5).map(function (x) { return x.domain + ' (' + x.daysLeft + ' يوم)'; }).join('، '),
        go: 'domains'
      });
    }
    if (d.renewNowCost > 0) {
      out.push({
        level: 'info', icon: 'creditCard',
        title: 'تكلفة التجديد القريبة ' + U.fmtMoney(d.renewNowCost),
        body: 'تجديد ' + d.renewNow.length + ' نطاقاً · عندك ' + d.total + ' نطاقاً بتكلفة سنوية ' + U.fmtMoney(d.yearCost) + ' (~' + U.fmtMoney(d.monthlyAvgCost) + ' شهرياً)',
        go: 'domains'
      });
    }
    return out;
  };

  F.alerts = function (state, asOfISO) {
    var asOf = asOfISO || U.todayISO();
    var out = [];
    var rec = F.receivables(state, asOf);
    var ob = F.obligations(state);
    var ms = F.monthSummary(state, U.monthKey(asOf), asOf);

    if (rec.total > 0) {
      var late = rec.items.filter(function (i) { return i.daysLate > 0; });
      out.push({
        level: late.length ? 'danger' : 'warn',
        icon: 'hourglass',
        title: 'مستحق لي ' + U.fmtMoney(rec.total),
        body: late.length
          ? (late.length + ' استحقاق متأخر: ' + late.map(function (i) { return i.label + ' (' + U.fmtMoney(i.remaining) + ')'; }).join('، '))
          : (rec.count + ' استحقاق لم يُحصَّل بعد'),
        items: rec.items
      });
    }

    if (ob.plannedTotal > 0) {
      out.push({
        level: 'info', icon: 'target',
        title: 'مصروفات مخطّطة ' + U.fmtMoney(ob.plannedTotal),
        body: 'ليست ديوناً — لم تُدفع بعد: ' + ob.items.map(function (t) { return t.label + ' ' + U.fmtMoney(t.amount); }).join('، ')
      });
    }

    if (ob.immediateTotal > 0) {
      out.push({
        level: 'warn', icon: 'receipt',
        title: 'مصروفات معلّقة ' + U.fmtMoney(ob.immediateTotal),
        body: ob.items.filter(function (t) { return !t.planned; }).map(function (t) { return t.label + ' ' + U.fmtMoney(t.amount); }).join('، ')
      });
    }

    var cm = F.commitments(state);
    if (cm.remainingTotal > 0) {
      out.push({
        level: 'info', icon: 'school',
        title: 'التزامات سنوية: متبقٍ ' + U.fmtMoney(cm.remainingTotal),
        body: cm.list.map(function (c) { return c.label + ' — دُفع ' + U.fmtMoney(c.paidThisYear) + ' من ' + U.fmtMoney(c.annual) + ' (' + c.pct + '%)'; }).join('، ')
      });
    }

    if (ms.expense > ms.income && ms.income > 0) {
      out.push({
        level: 'warn', icon: 'trendDown',
        title: 'مصروف ' + U.monthLabel(ms.monthKey) + ' أكبر من الدخل',
        body: 'دخل ' + U.fmtMoney(ms.income) + ' مقابل مصروف ' + U.fmtMoney(ms.expense) + ' (صافي ' + U.fmtMoney(ms.net, { sign: true }) + ')'
      });
    }

    var avgDaily = ms.avgDailyExpense;
    if (avgDaily > 0) {
      var monthlyPace = round(avgDaily * 30);
      out.push({
        level: 'info', icon: 'trendUp',
        title: 'معدل الصرف اليومي ' + U.fmtMoney(avgDaily),
        body: 'بهذا المعدل تصرف ' + U.fmtMoney(monthlyPace) + ' في الشهر — يكفي رصيدك الحالي ' + U.fmtMoney(F.totalBalance(state)) + ' لمدة ' + (avgDaily > 0 ? U.round(F.totalBalance(state) / avgDaily, 0) : 0) + ' يوم'
      });
    }

    var apiKey = state && state.settings && state.settings.agent && state.settings.agent.apiKey;
    if (!apiKey) {
      out.push({
        level: 'info', icon: 'robot',
        title: 'المساعد الذكي غير مفعّل',
        body: 'أضف مفتاح DeepSeek من الإعدادات ليعمل التحليل والصوت. بدونه يعمل المحرّك المحلي فقط.'
      });
    }

    return out;
  };

  /* ==================================================== مؤشرات لوحة اليوم */

  F.dashboard = function (state, asOfISO) {
    var asOf = asOfISO || U.todayISO();
    var day = F.daySummary(state, asOf);
    var month = F.monthSummary(state, U.monthKey(asOf), asOf);
    var rec = F.receivables(state, asOf);
    var ob = F.obligations(state);
    var sav = F.savingsStats(state, U.monthKey(asOf), asOf);
    var dom = F.domainStats(state, asOf);
    return {
      asOf: asOf,
      day: day,
      month: month,
      balances: F.balances(state),
      totalBalance: F.totalBalance(state),
      cash: F.cashBalance(state),
      saving: F.savingsBalance(state),
      receivables: rec,
      obligations: ob,
      funds: F.accumulatedFunds(state),
      commitments: F.commitments(state),
      savings: sav,
      domains: dom,
      alerts: F.domainAlerts(state, asOf).concat(F.alerts(state, asOf)),
      topCategories: F.expenseByCategory(state, U.startOfMonth(asOf), asOf, 5),
      incomeSources: F.incomeBySource(state, U.startOfMonth(asOf), asOf, 5),
      series30: F.dailySeries(state, U.addDays(asOf, -29), asOf)
    };
  };

  /* ============================================================ وصف/ملخص نصي */

  F.periodDescriptor = function (range) {
    if (!range) return 'كل الفترة';
    return range.label || (U.dateLabel(range.from) + ' إلى ' + U.dateLabel(range.to));
  };

  F.summaryLines = function (state, from, to) {
    var s = F.rangeSummary(state, from, to);
    var lines = [];
    lines.push('الفترة: ' + s.label);
    lines.push('الدخل: ' + U.fmtMoney(s.income) + ' — المصروف: ' + U.fmtMoney(s.expense) + ' — الصافي: ' + U.fmtMoney(s.net, { sign: true }));
    var cats = F.expenseByCategory(state, from, to);
    if (cats.length) lines.push('أكبر بنود المصروف: ' + cats.slice(0, 4).map(function (c) { return c.label + ' ' + U.fmtMoney(c.amount) + ' (' + c.pct + '%)'; }).join('، '));
    var inc = F.incomeBySource(state, from, to);
    if (inc.length) lines.push('مصادر الدخل: ' + inc.map(function (c) { return c.label + ' ' + U.fmtMoney(c.amount); }).join('، '));
    var rec = F.receivables(state, to);
    if (rec.total > 0) lines.push('مستحق لي: ' + U.fmtMoney(rec.total) + ' (' + rec.items.map(function (i) { return i.label; }).join('، ') + ')');
    var ob = F.obligations(state);
    if (ob.plannedTotal > 0) lines.push('مصروفات مخطّطة (ليست ديوناً): ' + U.fmtMoney(ob.plannedTotal) + ' — ' + ob.items.map(function (t) { return t.label; }).join('، '));
    var cm = F.commitments(state);
    if (cm.remainingTotal > 0) lines.push('التزامات سنوية متبقية: ' + U.fmtMoney(cm.remainingTotal) + ' — ' + cm.list.map(function (c) { return c.label + ' (متبقٍ ' + U.fmtMoney(c.remaining) + ')'; }).join('، '));
    lines.push('الأموال المجمّعة في الصندوق: ' + U.fmtMoney(F.cashBalance(state)) + ' — الأصل منها قبل اليوم ' + U.fmtMoney(F.accumulatedFunds(state).opening));
    lines.push('الرصيد: ' + U.fmtMoney(F.totalBalance(state)) + ' (نقد ' + U.fmtMoney(F.cashBalance(state)) + ' + ادخار ' + U.fmtMoney(F.savingsBalance(state)) + ')');
    return lines;
  };
})();
